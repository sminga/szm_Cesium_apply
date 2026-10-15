"""Convert common NetCDF wind data to the NetCDF-3 schema used by this project."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

import numpy as np
import xarray as xr

U_CANDIDATES = ("U", "u", "u_wind", "eastward_wind", "ugrd", "uwnd")
V_CANDIDATES = ("V", "v", "v_wind", "northward_wind", "vgrd", "vwnd")
W_CANDIDATES = ("W", "w", "w_wind", "vertical_velocity", "upward_air_velocity", "dzdt")
LON_CANDIDATES = ("lon", "longitude", "x")
LAT_CANDIDATES = ("lat", "latitude", "y")
LEV_CANDIDATES = ("lev", "level", "height", "altitude", "z")
TIME_NAMES = {"time", "valid_time", "forecast_time", "datetime"}
INVALID_HEIGHT_ABS_LIMIT = 1e30


def find_name(names: Iterable[str], candidates: Iterable[str], label: str, required: bool = True) -> str | None:
    original = list(names)
    lowered = {name.lower(): name for name in original}
    for candidate in candidates:
        if candidate in original:
            return candidate
        if candidate.lower() in lowered:
            return lowered[candidate.lower()]
    if required:
        raise ValueError(f"无法识别{label}。可用名称: {', '.join(original)}")
    return None


def prepare_coordinate(
    ds: xr.Dataset, name: str, target: str, *, single_level_height: float = 0.0,
) -> tuple[xr.DataArray, np.ndarray, str | None]:
    coordinate = ds[name]
    if coordinate.ndim != 1:
        raise ValueError(f"{name} 必须是一维坐标，当前维度为 {coordinate.dims}")
    values = np.asarray(coordinate.values, dtype=np.float64)
    if values.size == 0:
        raise ValueError(f"{name} 坐标为空")
    note = None
    invalid_height = target == "lev" and np.any(np.abs(values) >= INVALID_HEIGHT_ABS_LIMIT)
    if target == "lev" and values.size == 1 and (not np.isfinite(values).all() or invalid_height):
        values = np.array([single_level_height], dtype=np.float64)
        note = f"单层高度 {name} 是缺测哨兵值，已按 {single_level_height:g} m 处理"
    elif not np.isfinite(values).all() or invalid_height:
        raise ValueError(f"{name} 包含空值、NaN 或无穷值")
    units = str(coordinate.attrs.get("units", "")).strip().lower()
    if target == "lev" and units in {"pa", "hpa", "mbar", "millibar", "bar"}:
        raise ValueError(f"垂直坐标 {name} 的单位是 {units}，请先转换为米制高度")
    if target == "lon":
        values = ((values + 180.0) % 360.0) - 180.0
    order = np.argsort(values)
    values = values[order]
    if values.size > 2:
        steps = np.diff(values)
        if not np.allclose(steps, steps[0], rtol=1e-2, atol=1e-6):
            raise ValueError(f"{name} 必须是规则等间距网格")
    return xr.DataArray(values.astype(np.float32), dims=(target,), name=target), order, note


def repair_constant_latitude_stripes(
    components: list[xr.DataArray], *, jump_threshold: float = 5.0, tolerance: float = 1e-6,
) -> list[tuple[int, int, int]]:
    """Interpolate suspicious full-width constant latitude runs.

    The repair is intentionally opt-in. A run is repaired only when every supplied
    component is constant across longitude and its vector jump from the two adjacent
    latitude rows is at least ``jump_threshold`` m/s.
    """
    arrays = [np.asarray(component.values).copy() for component in components]
    nz, ny, nx = arrays[0].shape
    if nx < 2 or ny < 3:
        return []
    repairs: list[tuple[int, int, int]] = []

    for z_index in range(nz):
        constant_rows = np.ones(ny, dtype=bool)
        for values in arrays:
            spans = np.ptp(values[z_index], axis=1)
            constant_rows &= spans <= tolerance

        row = 0
        while row < ny:
            if not constant_rows[row]:
                row += 1
                continue
            start = row
            while row + 1 < ny and constant_rows[row + 1]:
                row += 1
            end = row
            row += 1
            if start == 0 or end == ny - 1:
                continue

            run_vector = np.array([
                values[z_index, start:end + 1].mean() for values in arrays
            ])
            neighbor_vector = np.array([
                (values[z_index, start - 1].mean() + values[z_index, end + 1].mean()) * 0.5
                for values in arrays
            ])
            if np.linalg.norm(run_vector - neighbor_vector) < jump_threshold:
                continue

            run_length = end - start + 1
            for values in arrays:
                lower = values[z_index, start - 1].copy()
                upper = values[z_index, end + 1].copy()
                for offset, latitude_index in enumerate(range(start, end + 1), start=1):
                    weight = offset / (run_length + 1)
                    values[z_index, latitude_index] = lower * (1.0 - weight) + upper * weight
            repairs.append((z_index, start, end))

    for component, values in zip(components, arrays, strict=True):
        component.values[:] = values
        component.attrs["min"] = np.float32(values.min())
        component.attrs["max"] = np.float32(values.max())
    return repairs


def select_slice(data: xr.DataArray, spatial_dims: set[str], time_index: int) -> xr.DataArray:
    for dimension in list(data.dims):
        if dimension in spatial_dims:
            continue
        if data.sizes[dimension] == 1:
            data = data.isel({dimension: 0}, drop=True)
        elif dimension.lower() in TIME_NAMES:
            if not 0 <= time_index < data.sizes[dimension]:
                raise IndexError(f"时间索引 {time_index} 超出 0..{data.sizes[dimension] - 1}")
            data = data.isel({dimension: time_index}, drop=True)
        else:
            raise ValueError(f"变量 {data.name} 包含无法自动选择的维度 {dimension}={data.sizes[dimension]}")
    return data


def normalize_component(
    ds: xr.Dataset, name: str, target: str, *, lon_name: str, lat_name: str, lev_name: str | None,
    lon_order: np.ndarray, lat_order: np.ndarray, lev_order: np.ndarray, time_index: int,
    lon: xr.DataArray, lat: xr.DataArray, lev: xr.DataArray,
) -> xr.DataArray:
    spatial_dims = {lon_name, lat_name} | ({lev_name} if lev_name else set())
    data = select_slice(ds[name], spatial_dims, time_index)
    if lon_name not in data.dims or lat_name not in data.dims:
        raise ValueError(f"变量 {name} 必须包含经度和纬度维度")
    data = data.isel({lon_name: lon_order, lat_name: lat_order})
    rename = {lon_name: "lon", lat_name: "lat"}
    if lev_name and lev_name in data.dims:
        data = data.isel({lev_name: lev_order})
        rename[lev_name] = "lev"
    data = data.rename(rename)
    if "lev" not in data.dims:
        data = data.expand_dims(lev=[0.0])
    data = data.transpose("lev", "lat", "lon").astype(np.float32).load()
    data = data.assign_coords(lon=lon, lat=lat, lev=lev)
    values = np.asarray(data.values)
    if not np.isfinite(values).all():
        raise ValueError(f"变量 {name} 包含缺测值、NaN 或无穷值，请先填补")
    units = str(ds[name].attrs.get("units", "m s-1"))
    if target == "W" and ("pa/s" in units.lower() or "pa s" in units.lower()):
        raise ValueError("W 变量单位是 Pa/s，不能直接作为垂直速度 m/s；请先完成物理单位转换")
    data.name = target
    data.attrs = {
        "units": units,
        "min": np.float32(values.min()),
        "max": np.float32(values.max()),
    }
    return data


def convert_netcdf(
    input_path: Path, output_path: Path | None = None, *, u_name: str | None = None,
    v_name: str | None = None, w_name: str | None = None, lon_name: str | None = None,
    lat_name: str | None = None, lev_name: str | None = None, time_index: int = 0,
    single_level_height: float = 0.0, repair_latitude_stripes: bool = False,
    stripe_jump_threshold: float = 5.0,
) -> Path:
    input_path = input_path.expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"找不到输入文件: {input_path}")
    output_path = (output_path or input_path.with_name(f"{input_path.stem}_wind3d.nc")).expanduser().resolve()
    if output_path == input_path:
        raise ValueError("输出文件不能覆盖输入文件")

    with xr.open_dataset(input_path, decode_cf=True, mask_and_scale=True) as source:
        data_names = list(source.data_vars)
        all_names = list(source.variables)
        u_name = u_name or find_name(data_names, U_CANDIDATES, "U 分量")
        v_name = v_name or find_name(data_names, V_CANDIDATES, "V 分量")
        w_name = w_name or find_name(data_names, W_CANDIDATES, "W 分量", required=False)
        lon_name = lon_name or find_name(all_names, LON_CANDIDATES, "经度坐标")
        lat_name = lat_name or find_name(all_names, LAT_CANDIDATES, "纬度坐标")
        lev_name = lev_name or find_name(all_names, LEV_CANDIDATES, "高度坐标", required=False)

        lon, lon_order, _ = prepare_coordinate(source, lon_name, "lon")
        lat, lat_order, _ = prepare_coordinate(source, lat_name, "lat")
        if lev_name:
            lev, lev_order, height_note = prepare_coordinate(
                source, lev_name, "lev", single_level_height=single_level_height,
            )
        else:
            lev = xr.DataArray(np.array([0.0], dtype=np.float32), dims=("lev",), name="lev")
            lev_order = np.array([0])
            height_note = "源文件没有高度坐标，已按 0 m 处理"

        common = {
            "lon_name": lon_name, "lat_name": lat_name, "lev_name": lev_name,
            "lon_order": lon_order, "lat_order": lat_order, "lev_order": lev_order,
            "time_index": time_index, "lon": lon, "lat": lat, "lev": lev,
        }
        u = normalize_component(source, u_name, "U", **common)
        v = normalize_component(source, v_name, "V", **common)
        if w_name:
            w = normalize_component(source, w_name, "W", **common)
        else:
            w = xr.zeros_like(u).rename("W")
            w.attrs = {"units": "m s-1", "min": np.float32(0), "max": np.float32(0), "source": "missing W filled with zero"}

        repairs = []
        if repair_latitude_stripes:
            repairs = repair_constant_latitude_stripes(
                [u, v, w], jump_threshold=stripe_jump_threshold,
            )

        if u.shape != v.shape or u.shape != w.shape:
            raise ValueError(f"U/V/W 网格尺寸不一致: U={u.shape}, V={v.shape}, W={w.shape}")
        result = xr.Dataset({"U": u, "V": v, "W": w}, coords={"lon": lon, "lat": lat, "lev": lev})
        result.attrs = {"source_file": input_path.name, "Conventions": "cesium-wind-layer-3d / NetCDF-3"}
        try:
            result.to_netcdf(output_path, format="NETCDF3_64BIT_OFFSET", engine="netcdf4")
        except (ImportError, ModuleNotFoundError):
            result.to_netcdf(output_path, format="NETCDF3_64BIT", engine="scipy")

    print(f"[OK] {output_path}")
    print(f"     grid: lev={u.sizes['lev']}, lat={u.sizes['lat']}, lon={u.sizes['lon']}")
    if height_note:
        print(f"     height: {height_note}")
    if not w_name:
        print("     W: source missing, filled with 0 m/s")
    for z_index, start, end in repairs:
        print(f"     repaired latitude stripe: lev index {z_index}, lat indices {start}..{end}")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="将常见 NetCDF 风场转换为浏览器可读的标准 NetCDF-3")
    parser.add_argument("input", type=Path, help="输入 .nc 文件（可为 NetCDF-3 或 NetCDF-4/HDF5）")
    parser.add_argument("-o", "--output", type=Path, help="输出 .nc 文件")
    parser.add_argument("--u", dest="u_name", help="U 分量变量名")
    parser.add_argument("--v", dest="v_name", help="V 分量变量名")
    parser.add_argument("--w", dest="w_name", help="W 分量变量名；不指定且无法识别时补 0")
    parser.add_argument("--lon", dest="lon_name", help="经度变量名")
    parser.add_argument("--lat", dest="lat_name", help="纬度变量名")
    parser.add_argument("--lev", dest="lev_name", help="高度变量名")
    parser.add_argument("--time-index", type=int, default=0, help="多时次数据的时间索引，默认 0")
    parser.add_argument(
        "--single-level-height", type=float, default=0.0,
        help="单层高度为缺测哨兵值时使用的米制高度，默认 0",
    )
    parser.add_argument(
        "--repair-constant-latitude-stripes", action="store_true",
        help="插值修复跨越全部经度、各分量恒定且与相邻行突变的纬向异常条带",
    )
    parser.add_argument(
        "--stripe-jump-threshold", type=float, default=5.0,
        help="异常条带相对相邻行的最小矢量突变量（m/s），默认 5",
    )
    args = parser.parse_args()
    try:
        convert_netcdf(
            args.input, args.output, u_name=args.u_name, v_name=args.v_name, w_name=args.w_name,
            lon_name=args.lon_name, lat_name=args.lat_name, lev_name=args.lev_name, time_index=args.time_index,
            single_level_height=args.single_level_height,
            repair_latitude_stripes=args.repair_constant_latitude_stripes,
            stripe_jump_threshold=args.stripe_jump_threshold,
        )
    except (OSError, ValueError, IndexError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()

"""将 WRF-ARW 输出转换为本项目使用的规则 NetCDF-3 风场网格。"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import xarray as xr


def normalize_wrf_array(value: np.ndarray) -> np.ndarray:
    """把 wrf-python 诊断结果转换为普通数组，并保留真实缺测语义。"""
    # wrf-python 会在没有任何缺测点时仍返回 MaskedArray。SciPy 的 Delaunay
    # 不接受该类型，因此必须先去除数组包装；若确实存在掩码，则用 NaN 保留
    # 缺测语义，让 load_wrf_fields 后续的有限值检查明确拒绝不完整输入。
    return np.asarray(np.ma.filled(value, np.nan))


def common_height_levels(height: np.ndarray, step: float) -> np.ndarray:
    """生成所有源网格柱均有垂直覆盖的共同海拔（MSL）高度层。"""
    if step <= 0:
        raise ValueError("高度间隔必须大于 0")
    column_bottom = np.nanmax(height[0])
    column_top = np.nanmin(height[-1])
    first = np.ceil(column_bottom / step) * step
    last = np.floor(column_top / step) * step
    if first > last:
        raise ValueError("全区域没有共同的 MSL 高度范围；请检查 WRF 高度或改用区域子集")
    levels = np.arange(first, last + step * 0.5, step, dtype=np.float32)
    if len(levels) < 2:
        raise ValueError("共同 MSL 高度范围不足两个高度层，无法生成真实三维风场")
    return levels


def interpolate_vertical(field: np.ndarray, height: np.ndarray, target: float) -> np.ndarray:
    """逐个网格柱把一个质量点风场插值到指定高度。"""
    if field.shape != height.shape or field.ndim != 3 or field.shape[0] < 2:
        raise ValueError("风场和高度必须是同尺寸的三维 (level, y, x) 数组")
    if np.any(np.diff(height, axis=0) <= 0):
        raise ValueError("WRF 质量层高度不是逐列递增，不能安全执行垂直插值")

    upper = np.sum(height < target, axis=0)
    lower = np.clip(upper - 1, 0, height.shape[0] - 2)
    upper = lower + 1
    z0 = np.take_along_axis(height, lower[None, ...], axis=0)[0]
    z1 = np.take_along_axis(height, upper[None, ...], axis=0)[0]
    f0 = np.take_along_axis(field, lower[None, ...], axis=0)[0]
    f1 = np.take_along_axis(field, upper[None, ...], axis=0)[0]
    weight = (target - z0) / (z1 - z0)
    result = f0 + weight * (f1 - f0)
    valid = (target >= height[0]) & (target <= height[-1])
    return np.where(valid, result, np.nan).astype(np.float32)


def largest_valid_rectangle(mask: np.ndarray) -> tuple[int, int, int, int]:
    """返回全有效的最大行列矩形，结果为 (y0, y1, x0, x1)。"""
    if mask.ndim != 2 or not mask.size:
        raise ValueError("有效网格掩码必须是非空二维数组")
    heights = np.zeros(mask.shape[1], dtype=np.int32)
    best_area = 0
    best = None
    for y, row in enumerate(mask):
        heights = np.where(row, heights + 1, 0)
        stack: list[int] = []
        for x in range(mask.shape[1] + 1):
            current = int(heights[x]) if x < mask.shape[1] else 0
            while stack and int(heights[stack[-1]]) > current:
                index = stack.pop()
                rect_height = int(heights[index])
                left = stack[-1] + 1 if stack else 0
                area = rect_height * (x - left)
                if area > best_area:
                    best_area = area
                    best = (y - rect_height + 1, y + 1, left, x)
            stack.append(x)
    if best is None or (best[1] - best[0]) < 2 or (best[3] - best[2]) < 2:
        raise ValueError("重采样后没有至少 2x2 的完整有效矩形，请降低输出分辨率")
    return best


def load_wrf_fields(input_path: Path, time_index: int) -> tuple[np.ndarray, ...]:
    """使用 wrf-python 诊断量取得质量网格高度和地理坐标系风场。"""
    try:
        from netCDF4 import Dataset
        from wrf import getvar, to_np
    except ImportError as error:
        raise RuntimeError(
            "缺少 WRF 转换依赖。请在 Conda 环境安装 wrf-python、netCDF4、xarray、numpy、scipy"
        ) from error

    with Dataset(input_path) as source:
        if "Time" not in source.dimensions:
            raise ValueError("输入文件没有 WRF Time 维度")
        time_count = len(source.dimensions["Time"])
        if not 0 <= time_index < time_count:
            raise IndexError(f"时间索引 {time_index} 超出 0..{time_count - 1}")
        required = {"U", "V", "W", "PH", "PHB", "XLAT", "XLONG"}
        missing = required.difference(source.variables)
        if missing:
            raise ValueError(f"缺少 WRF-ARW 必需变量: {', '.join(sorted(missing))}")

        # uvmet 负责水平风去错列和地图投影旋转；wa、z 返回在质量网格点上。
        uv = normalize_wrf_array(
            to_np(getvar(source, "uvmet", timeidx=time_index, units="m s-1", meta=False))
        )
        vertical = normalize_wrf_array(
            to_np(getvar(source, "wa", timeidx=time_index, units="m s-1", meta=False))
        )
        height = normalize_wrf_array(
            to_np(getvar(source, "z", timeidx=time_index, units="m", meta=False))
        )
        latitude = normalize_wrf_array(
            to_np(getvar(source, "lat", timeidx=time_index, meta=False))
        )
        longitude = normalize_wrf_array(
            to_np(getvar(source, "lon", timeidx=time_index, meta=False))
        )

    if uv.ndim != 4 or uv.shape[0] != 2:
        raise ValueError(f"uvmet 形状异常，预期 (2, level, y, x)，实际为 {uv.shape}")
    u, v = uv[0], uv[1]
    w = vertical
    if u.shape != v.shape or u.shape != w.shape or u.shape != height.shape:
        raise ValueError(f"去错列后质量网格形状不一致: U={u.shape}, V={v.shape}, W={w.shape}, z={height.shape}")
    if u.shape[0] < 2:
        raise ValueError("WRF 输入少于两个质量层，不能转换为多层三维风场")
    if latitude.shape != u.shape[1:] or longitude.shape != u.shape[1:]:
        raise ValueError("XLAT/XLONG 网格与 WRF 风场质量网格不一致")
    if not all(np.isfinite(array).all() for array in (u, v, w, height, latitude, longitude)):
        raise ValueError("WRF 数据包含缺测值或非有限值；请先检查输入时次和变量")
    return u, v, w, height, latitude, longitude


def convert_wrf(
    input_path: Path,
    output_path: Path,
    *,
    time_index: int = 0,
    height_step: float = 500.0,
    nx: int | None = None,
    ny: int | None = None,
    overwrite: bool = False,
) -> Path:
    """把一个 WRF-ARW 时次转换为项目兼容的 NetCDF-3 风场。"""
    input_path = input_path.expanduser().resolve()
    output_path = output_path.expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"找不到 WRF 输入文件: {input_path}")
    if input_path == output_path:
        raise ValueError("输出文件不能覆盖 WRF 输入文件")
    if output_path.exists() and not overwrite:
        raise FileExistsError(f"输出文件已存在；指定 --overwrite 才会覆盖: {output_path}")

    u, v, w, height, latitude, longitude = load_wrf_fields(input_path, time_index)
    levels = common_height_levels(height, height_step)
    target_nx = nx or u.shape[2]
    target_ny = ny or u.shape[1]
    if target_nx < 2 or target_ny < 2:
        raise ValueError("规则输出网格的 nx 和 ny 都必须至少为 2")
    if np.ptp(longitude) >= 180:
        raise ValueError("当前转换不支持跨越日期变更线的 WRF 区域")

    lon = np.linspace(float(longitude.min()), float(longitude.max()), target_nx, dtype=np.float64)
    lat = np.linspace(float(latitude.min()), float(latitude.max()), target_ny, dtype=np.float64)
    grid_lon, grid_lat = np.meshgrid(lon, lat)

    try:
        from scipy.interpolate import LinearNDInterpolator
        from scipy.spatial import Delaunay
    except ImportError as error:
        raise RuntimeError("缺少 scipy；请在 Conda 环境安装 scipy 后重试") from error

    # 经度乘 cos(平均纬度)，减小局部三角剖分中的经纬度距离比例失真。
    latitude_scale = float(np.cos(np.deg2rad(latitude.mean())))
    points = np.column_stack((longitude.ravel() * latitude_scale, latitude.ravel()))
    targets = np.column_stack((grid_lon.ravel() * latitude_scale, grid_lat.ravel()))
    try:
        triangulation = Delaunay(points)
    except Exception as error:
        raise ValueError(f"WRF 经纬度网格无法建立三角剖分: {error}") from error
    output: dict[str, np.ndarray] = {name: np.empty((len(levels), target_ny, target_nx), dtype=np.float32)
                                    for name in ("U", "V", "W")}
    fields = {"U": u, "V": v, "W": w}
    for level_index, level in enumerate(levels):
        for name, field in fields.items():
            on_level = interpolate_vertical(field, height, float(level))
            interpolator = LinearNDInterpolator(triangulation, on_level.ravel(), fill_value=np.nan)
            output[name][level_index] = np.asarray(interpolator(targets)).reshape(target_ny, target_nx)

    valid = np.ones((target_ny, target_nx), dtype=bool)
    for values in output.values():
        valid &= np.isfinite(values).all(axis=0)
    y0, y1, x0, x1 = largest_valid_rectangle(valid)
    output = {name: values[:, y0:y1, x0:x1] for name, values in output.items()}
    lon = lon[x0:x1].astype(np.float32)
    lat = lat[y0:y1].astype(np.float32)

    dataset = xr.Dataset(
        {name: (("lev", "lat", "lon"), values) for name, values in output.items()},
        coords={"lon": lon, "lat": lat, "lev": levels},
        attrs={
            "source_file": input_path.name,
            "source_time_index": int(time_index),
            "vertical_reference": "mean sea level (MSL), meters",
            "horizontal_resampling": "linear interpolation from WRF curvilinear grid",
            "Conventions": "cesium-wind-layer-3d / NetCDF-3",
        },
    )
    for name in ("U", "V", "W"):
        dataset[name].attrs["units"] = "m s-1"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_netcdf(output_path, format="NETCDF3_64BIT_OFFSET", engine="netcdf4")
    print(f"[OK] {output_path}")
    print(f"     grid: lev={len(levels)}, lat={len(lat)}, lon={len(lon)}")
    print(f"     MSL levels: {levels[0]:g}..{levels[-1]:g} m, step={height_step:g} m")
    print(f"     valid rectangular crop: source target rows {y0}:{y1}, columns {x0}:{x1}")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="将 WRF-ARW NetCDF-4 转为 Cesium 风场可读的 NetCDF-3")
    parser.add_argument("input", type=Path, help="WRF wrfout 文件")
    parser.add_argument("-o", "--output", type=Path, help="输出路径；默认在输入同目录生成 *_wind3d.nc")
    parser.add_argument("--time-index", type=int, default=0, help="选择 WRF 时次，默认 0")
    parser.add_argument("--height-step", type=float, default=500, help="统一 MSL 高度间距（米），默认 500")
    parser.add_argument("--nx", type=int, help="规则经度网格宽度，默认沿用 WRF west_east 网格数")
    parser.add_argument("--ny", type=int, help="规则纬度网格高度，默认沿用 WRF south_north 网格数")
    parser.add_argument("--overwrite", action="store_true", help="允许覆盖已存在的输出文件")
    args = parser.parse_args()
    output = args.output or args.input.with_name(f"{args.input.stem}_wind3d.nc")
    convert_wrf(
        args.input, output, time_index=args.time_index, height_step=args.height_step,
        nx=args.nx, ny=args.ny, overwrite=args.overwrite,
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, IndexError, RuntimeError) as error:
        raise SystemExit(f"[ERROR] {error}") from error

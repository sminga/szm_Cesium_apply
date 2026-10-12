"""Build Cesium quantized-mesh terrain with the CTB Docker image."""

from __future__ import annotations

import argparse
import re
import shlex
import shutil
import subprocess
from pathlib import Path

from terrain_dataset import inspect_terrain_dataset

DEFAULT_IMAGE = "tumgis/ctb-quantized-mesh:latest"
SUPPORTED_EXTENSIONS = {".tif", ".tiff", ".img", ".asc", ".dem"}


def safe_dataset_name(value: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(value).stem).strip("._-")
    return name or "terrain"


def build_quantized_mesh(
    input_path: Path,
    output_root: Path,
    *,
    image: str = DEFAULT_IMAGE,
) -> Path:
    input_path = input_path.expanduser().resolve()
    output_root = output_root.expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"找不到 DEM 文件: {input_path}")
    if input_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError("DEM 仅支持 GeoTIFF、IMG、ASC 和 DEM 单文件格式")
    if not shutil.which("docker"):
        raise RuntimeError("未检测到 Docker，请先安装并启动 Docker Desktop")

    output_root.mkdir(parents=True, exist_ok=True)
    dataset = safe_dataset_name(input_path.name)
    output_dir = output_root / dataset
    counter = 2
    while output_dir.exists():
        output_dir = output_root / f"{dataset}_{counter}"
        counter += 1
    output_dir.mkdir(parents=True)

    work_root = output_root.parent.resolve()
    input_copy = work_root / "terrain-input" / input_path.name
    input_copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(input_path, input_copy)
    prepared_name = f"{output_dir.name}_wgs84.tif"
    relative_input = input_copy.relative_to(work_root).as_posix()
    relative_output = output_dir.relative_to(work_root).as_posix()
    prepared_path = f"terrain-input/{prepared_name}"
    source_arg = shlex.quote(f"/data/{relative_input}")
    prepared_arg = shlex.quote(f"/data/{prepared_path}")
    output_arg = shlex.quote(f"/data/{relative_output}")
    command = " && ".join([
        f"gdalwarp -overwrite -t_srs EPSG:4326 -r bilinear -dstnodata -32767 {source_arg} {prepared_arg}",
        f"ctb-tile -f Mesh -C -N -o {output_arg} {prepared_arg}",
        f"ctb-tile -f Mesh -C -N -l -o {output_arg} {prepared_arg}",
    ])

    try:
        subprocess.run([
            "docker", "run", "--rm",
            "-v", f"{work_root}:/data",
            image,
            "sh", "-lc", command,
        ], check=True)
    except subprocess.CalledProcessError as error:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise RuntimeError(f"CTB 地形处理失败，Docker 退出码 {error.returncode}") from error
    finally:
        (work_root / prepared_path).unlink(missing_ok=True)
        input_copy.unlink(missing_ok=True)

    inspection = inspect_terrain_dataset(output_dir)
    if not inspection["valid"]:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise RuntimeError(f"CTB 输出校验失败: {inspection.get('error', '未知错误')}")
    return output_dir


def main() -> None:
    parser = argparse.ArgumentParser(description="使用 Docker CTB 将 DEM 转成 Cesium quantized-mesh")
    parser.add_argument("input", type=Path)
    parser.add_argument("-o", "--output-root", type=Path, default=Path(__file__).resolve().parents[1] / "terrain-output")
    parser.add_argument("--image", default=DEFAULT_IMAGE)
    args = parser.parse_args()
    output = build_quantized_mesh(args.input, args.output_root, image=args.image)
    print(f"[OK] {output}")


if __name__ == "__main__":
    main()

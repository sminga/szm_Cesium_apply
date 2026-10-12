"""Validation and metadata inspection for Cesium quantized-mesh datasets."""

from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
from typing import Any


def _valid_bounds(value: object) -> dict[str, float] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    try:
        west, south, east, north = (float(item) for item in value)
    except (TypeError, ValueError):
        return None
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        return None
    return {"west": west, "south": south, "east": east, "north": north}


def _numeric_level(path: Path, root: Path) -> int | None:
    try:
        first = path.relative_to(root).parts[0]
        return int(first) if first.isdigit() else None
    except (ValueError, IndexError):
        return None


def inspect_terrain_dataset(directory: Path) -> dict[str, Any]:
    """Return validation state and useful catalog metadata for one dataset."""
    directory = directory.expanduser().resolve()
    result: dict[str, Any] = {
        "valid": False,
        "bounds": None,
        "minLevel": None,
        "maxLevel": None,
        "tileCount": 0,
        "size": 0,
        "hasVertexNormals": False,
        "hasWaterMask": False,
        "warnings": [],
    }
    try:
        if not directory.is_dir():
            raise ValueError("地形目录不存在")
        layer_path = directory / "layer.json"
        if not layer_path.is_file() or layer_path.stat().st_size == 0:
            raise ValueError("缺少有效的 layer.json")
        try:
            layer = json.loads(layer_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ValueError(f"layer.json 无法解析: {error}") from error
        if not isinstance(layer, dict):
            raise ValueError("layer.json 顶层必须是对象")

        terrain_format = layer.get("format")
        if not isinstance(terrain_format, str) or not terrain_format.startswith("quantized-mesh"):
            raise ValueError("layer.json format 不是 quantized-mesh")
        tile_templates = layer.get("tiles")
        if not isinstance(tile_templates, list) or not tile_templates:
            raise ValueError("layer.json 缺少 tiles 模板")
        for template in tile_templates:
            if not isinstance(template, str) or not template.strip():
                raise ValueError("layer.json 包含无效 tiles 模板")
            clean_path = template.split("?", 1)[0].replace("\\", "/")
            if ".." in PurePosixPath(clean_path).parts:
                raise ValueError("layer.json tiles 模板包含非法上级路径")

        tile_files = sorted(directory.rglob("*.terrain"))
        if not tile_files:
            raise ValueError("目录中没有 .terrain 瓦片")
        empty_tiles = [item for item in tile_files if item.stat().st_size == 0]
        if empty_tiles:
            raise ValueError(f"存在 {len(empty_tiles)} 个空瓦片文件")

        levels = [level for item in tile_files if (level := _numeric_level(item, directory)) is not None]
        declared_min = layer.get("minzoom")
        declared_max = layer.get("maxzoom")
        result["minLevel"] = int(declared_min) if isinstance(declared_min, (int, float)) else min(levels, default=None)
        result["maxLevel"] = int(declared_max) if isinstance(declared_max, (int, float)) else max(levels, default=None)
        if result["minLevel"] is not None and result["maxLevel"] is not None:
            if result["minLevel"] > result["maxLevel"]:
                raise ValueError("地形最小层级大于最大层级")

        result["bounds"] = _valid_bounds(layer.get("bounds"))
        if layer.get("bounds") is not None and result["bounds"] is None:
            result["warnings"].append("layer.json bounds 无效，无法自动定位")
        extensions = {str(item).lower() for item in layer.get("extensions", [])}
        result["hasVertexNormals"] = bool(extensions & {"octvertexnormals", "vertexnormals"})
        result["hasWaterMask"] = "watermask" in extensions
        result["tileCount"] = len(tile_files)
        result["size"] = layer_path.stat().st_size + sum(item.stat().st_size for item in tile_files)
        result["valid"] = True
    except (OSError, ValueError) as error:
        result["error"] = str(error)
    return result


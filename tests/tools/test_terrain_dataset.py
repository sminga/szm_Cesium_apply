import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "terrain"))

from terrain_dataset import inspect_terrain_dataset  # noqa: E402


class TerrainDatasetTests(unittest.TestCase):
    def create_dataset(self, root: Path, **overrides: object) -> Path:
        dataset = root / "sample"
        tile = dataset / "0" / "0" / "0.terrain"
        tile.parent.mkdir(parents=True)
        tile.write_bytes(b"terrain-data")
        layer = {
            "format": "quantized-mesh-1.0",
            "tiles": ["{z}/{x}/{y}.terrain?v={version}"],
            "bounds": [100, 20, 110, 30],
            "minzoom": 0,
            "maxzoom": 12,
            "extensions": ["octvertexnormals"],
            **overrides,
        }
        (dataset / "layer.json").write_text(json.dumps(layer), encoding="utf-8")
        return dataset

    def test_returns_catalog_metadata_for_valid_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            result = inspect_terrain_dataset(self.create_dataset(Path(temp)))
        self.assertTrue(result["valid"])
        self.assertEqual(result["tileCount"], 1)
        self.assertEqual(result["minLevel"], 0)
        self.assertEqual(result["maxLevel"], 12)
        self.assertEqual(result["bounds"]["west"], 100)
        self.assertTrue(result["hasVertexNormals"])

    def test_rejects_dataset_without_tiles(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            dataset = self.create_dataset(Path(temp))
            next(dataset.rglob("*.terrain")).unlink()
            result = inspect_terrain_dataset(dataset)
        self.assertFalse(result["valid"])
        self.assertIn("没有 .terrain", result["error"])

    def test_keeps_dataset_with_invalid_bounds_but_reports_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            result = inspect_terrain_dataset(
                self.create_dataset(Path(temp), bounds=[120, 30, 110, 20])
            )
        self.assertTrue(result["valid"])
        self.assertIsNone(result["bounds"])
        self.assertTrue(result["warnings"])

    def test_rejects_parent_path_in_tile_template(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            result = inspect_terrain_dataset(
                self.create_dataset(Path(temp), tiles=["../{z}/{x}/{y}.terrain"])
            )
        self.assertFalse(result["valid"])
        self.assertIn("非法上级路径", result["error"])


if __name__ == "__main__":
    unittest.main()


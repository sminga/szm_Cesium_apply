import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "server"))

from local_service import LocalServiceHandler  # noqa: E402


class LocalServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.wind_dir = root / "wind"
        self.upload_dir = root / "uploads"
        self.terrain_dir = root / "terrain"
        for directory in (self.wind_dir, self.upload_dir, self.terrain_dir):
            directory.mkdir()

        dataset = self.terrain_dir / "sample"
        tile = dataset / "0" / "0" / "0.terrain"
        tile.parent.mkdir(parents=True)
        tile.write_bytes(b"\x1f\x8bterrain")
        (dataset / "layer.json").write_text(json.dumps({
            "format": "quantized-mesh-1.0",
            "tiles": ["{z}/{x}/{y}.terrain"],
            "bounds": [100, 20, 110, 30],
        }), encoding="utf-8")
        (self.terrain_dir / "invalid").mkdir()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), LocalServiceHandler)
        self.server.wind_dir = self.wind_dir
        self.server.upload_dir = self.upload_dir
        self.server.terrain_dir = self.terrain_dir
        self.server.terrain_image = "unused"
        self.server.public_url = None
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def test_catalog_filters_invalid_datasets_and_returns_metadata(self) -> None:
        with urlopen(f"{self.base_url}/api/terrains") as response:
            payload = json.load(response)
        self.assertEqual(len(payload["terrains"]), 1)
        terrain = payload["terrains"][0]
        self.assertEqual(terrain["name"], "sample")
        self.assertEqual(terrain["tileCount"], 1)
        self.assertEqual(terrain["bounds"]["west"], 100)
        self.assertTrue(terrain["url"].startswith(self.base_url))

    def test_catalog_can_include_invalid_datasets_for_diagnostics(self) -> None:
        with urlopen(f"{self.base_url}/api/terrains?includeInvalid=true") as response:
            payload = json.load(response)
        entries = {entry["name"]: entry for entry in payload["terrains"]}
        self.assertFalse(entries["invalid"]["valid"])
        self.assertIn("layer.json", entries["invalid"]["error"])

    def test_terrain_file_supports_head_gzip_and_etag(self) -> None:
        tile_url = f"{self.base_url}/terrain/sample/0/0/0.terrain"
        with urlopen(Request(tile_url, method="HEAD")) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b"")
            self.assertEqual(response.headers["Content-Encoding"], "gzip")
            self.assertIn("immutable", response.headers["Cache-Control"])
            etag = response.headers["ETag"]

        request = Request(tile_url, headers={"If-None-Match": etag})
        with self.assertRaises(HTTPError) as raised:
            urlopen(request)
        try:
            self.assertEqual(raised.exception.code, 304)
        finally:
            raised.exception.close()


if __name__ == "__main__":
    unittest.main()


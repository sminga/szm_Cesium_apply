"""Local HTTP service for NetCDF conversion, wind catalogs and terrain processing."""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import sys
from email.utils import formatdate, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

TOOLS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS_DIR / "netcdf"))
sys.path.insert(0, str(TOOLS_DIR / "terrain"))

from convert_netcdf import convert_netcdf  # noqa: E402
from build_quantized_mesh import build_quantized_mesh  # noqa: E402
from terrain_dataset import inspect_terrain_dataset  # noqa: E402

MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_WIND_DIR = TOOLS_DIR / "converted"
DEFAULT_UPLOAD_DIR = TOOLS_DIR / "uploads"
DEFAULT_TERRAIN_DIR = TOOLS_DIR / "terrain-output"


def safe_filename(value: str, allowed: set[str]) -> str:
    filename = Path(unquote(value)).name
    filename = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._")
    if not filename:
        raise ValueError("文件名为空")
    if Path(filename).suffix.lower() not in allowed:
        raise ValueError(f"不支持的文件扩展名: {Path(filename).suffix}")
    return filename


def unique_path(directory: Path, filename: str) -> Path:
    candidate = directory / filename
    counter = 2
    while candidate.exists():
        candidate = directory / f"{Path(filename).stem}_{counter}{Path(filename).suffix}"
        counter += 1
    return candidate


def confined_path(root: Path, relative: str) -> Path:
    target = (root / unquote(relative)).resolve()
    if target != root and root not in target.parents:
        raise ValueError("非法文件路径")
    return target


class LocalServiceHandler(BaseHTTPRequestHandler):
    server_version = "CesiumWindLocalService/2.0"

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def common_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.common_headers()
        self.end_headers()
        if not getattr(self, "_head_only", False):
            self.wfile.write(body)

    def send_file(self, path: Path) -> None:
        if not path.is_file():
            self.send_json(404, {"ok": False, "message": "文件不存在"})
            return
        stat = path.stat()
        suffix = path.suffix.lower()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if suffix == ".terrain":
            content_type = "application/vnd.quantized-mesh"
        etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        cache_control = "public, max-age=31536000, immutable" if suffix == ".terrain" else "public, max-age=60, must-revalidate"
        not_modified = self.headers.get("If-None-Match") == etag
        if not not_modified and not self.headers.get("If-None-Match"):
            modified_since = self.headers.get("If-Modified-Since")
            if modified_since:
                try:
                    not_modified = int(parsedate_to_datetime(modified_since).timestamp()) >= int(stat.st_mtime)
                except (TypeError, ValueError, OverflowError):
                    pass
        if not_modified:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Last-Modified", formatdate(stat.st_mtime, usegmt=True))
            self.send_header("Cache-Control", cache_control)
            self.common_headers()
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        if suffix == ".terrain":
            with path.open("rb") as probe:
                if probe.read(2) == b"\x1f\x8b":
                    self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", formatdate(stat.st_mtime, usegmt=True))
        self.send_header("Cache-Control", cache_control)
        self.common_headers()
        self.end_headers()
        if getattr(self, "_head_only", False):
            return
        with path.open("rb") as stream:
            try:
                while chunk := stream.read(1024 * 1024):
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                return

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.common_headers()
        self.end_headers()

    def do_GET(self) -> None:
        self._head_only = False
        self.handle_get()

    def do_HEAD(self) -> None:
        self._head_only = True
        self.handle_get()

    def handle_get(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/health":
            self.send_json(200, {
                "ok": True,
                "windDirectory": str(self.server.wind_dir),
                "terrainDirectory": str(self.server.terrain_dir),
            })
            return
        if path == "/api/wind-files":
            files = [{
                "name": item.name,
                "size": item.stat().st_size,
                "url": self.service_url(f"/files/wind/{quote(item.name)}"),
            } for item in sorted(self.server.wind_dir.iterdir())
            if item.is_file() and item.suffix.lower() in {".nc", ".cdf"}]
            self.send_json(200, {"ok": True, "directory": str(self.server.wind_dir), "files": files})
            return
        if path == "/api/terrains":
            include_invalid = parse_qs(parsed.query).get("includeInvalid", ["false"])[0].lower() == "true"
            terrains = []
            for item in sorted(self.server.terrain_dir.iterdir()):
                if not item.is_dir():
                    continue
                inspection = inspect_terrain_dataset(item)
                if not inspection["valid"] and not include_invalid:
                    continue
                terrains.append({
                    "name": item.name,
                    "url": self.service_url(f"/terrain/{quote(item.name, safe='')}/"),
                    **inspection,
                })
            self.send_json(200, {"ok": True, "directory": str(self.server.terrain_dir), "terrains": terrains})
            return
        try:
            if path.startswith("/files/wind/"):
                self.send_file(confined_path(self.server.wind_dir, path.removeprefix("/files/wind/")))
                return
            if path.startswith("/terrain/"):
                relative = path.removeprefix("/terrain/") or "layer.json"
                if relative.endswith("/"):
                    relative += "layer.json"
                self.send_file(confined_path(self.server.terrain_dir, relative))
                return
        except ValueError as error:
            self.send_json(400, {"ok": False, "message": str(error)})
            return
        self.send_json(404, {"ok": False, "message": "接口不存在"})

    def service_url(self, path: str) -> str:
        if self.server.public_url:
            return f"{self.server.public_url}{path}"
        request_host = self.headers.get("Host", "")
        if request_host and re.fullmatch(r"[A-Za-z0-9.\-:\[\]]+", request_host):
            return f"http://{request_host}{path}"
        host, port = self.server.server_address
        if host in {"0.0.0.0", "::"}:
            host = "127.0.0.1"
        return f"http://{host}:{port}{path}"

    def read_upload(self, directory: Path, filename: str) -> Path:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            raise ValueError("上传文件为空")
        if content_length > MAX_UPLOAD_BYTES:
            raise ValueError("文件超过 1 GB 的服务限制")
        directory.mkdir(parents=True, exist_ok=True)
        input_path = unique_path(directory, filename)
        remaining = content_length
        with input_path.open("wb") as stream:
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise OSError("上传过程中连接中断")
                stream.write(chunk)
                remaining -= len(chunk)
        return input_path

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path in {"/convert", "/api/convert/netcdf"}:
            self.convert_netcdf_upload(query)
            return
        if parsed.path == "/api/convert/dem":
            self.convert_dem_upload(query)
            return
        self.send_json(404, {"ok": False, "message": "接口不存在"})

    def convert_netcdf_upload(self, query: dict[str, list[str]]) -> None:
        input_path = None
        output_path = None
        try:
            filename = safe_filename(query.get("filename", ["wind.nc"])[0], {".nc", ".cdf"})
            input_path = self.read_upload(self.server.upload_dir / "netcdf", filename)
            output_path = unique_path(self.server.wind_dir, f"{Path(filename).stem}_wind3d.nc")
            convert_netcdf(input_path, output_path)
            self.send_json(200, {
                "ok": True,
                "message": "NetCDF 转换成功",
                "outputPath": str(output_path.resolve()),
                "outputFile": output_path.name,
            })
        except Exception as error:
            if output_path:
                output_path.unlink(missing_ok=True)
            self.send_json(422, {"ok": False, "message": str(error)})
        finally:
            if input_path:
                input_path.unlink(missing_ok=True)

    def convert_dem_upload(self, query: dict[str, list[str]]) -> None:
        input_path = None
        try:
            allowed = {".tif", ".tiff", ".img", ".asc", ".dem"}
            filename = safe_filename(query.get("filename", ["terrain.tif"])[0], allowed)
            input_path = self.read_upload(self.server.upload_dir / "dem", filename)
            output_dir = build_quantized_mesh(input_path, self.server.terrain_dir, image=self.server.terrain_image)
            self.send_json(200, {
                "ok": True,
                "message": "DEM 已转换为 Cesium quantized-mesh",
                "outputPath": str(output_dir.resolve()),
                "terrain": output_dir.name,
                "url": self.service_url(f"/terrain/{quote(output_dir.name)}/"),
            })
        except Exception as error:
            self.send_json(422, {"ok": False, "message": str(error)})
        finally:
            if input_path:
                input_path.unlink(missing_ok=True)


def run_server(
    host: str,
    port: int,
    wind_dir: Path,
    upload_dir: Path,
    terrain_dir: Path,
    terrain_image: str,
    public_url: str | None = None,
) -> None:
    for directory in [wind_dir, upload_dir, terrain_dir]:
        directory.expanduser().resolve().mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((host, port), LocalServiceHandler)
    server.wind_dir = wind_dir.expanduser().resolve()
    server.upload_dir = upload_dir.expanduser().resolve()
    server.terrain_dir = terrain_dir.expanduser().resolve()
    server.terrain_image = terrain_image
    server.public_url = public_url.rstrip("/") if public_url else None
    print(f"Local Cesium service: http://{host}:{port}")
    print(f"Wind files: {server.wind_dir}")
    print(f"Terrain files: {server.terrain_dir}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nService stopped.")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="启动风场和本地地形处理服务")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--wind-dir", type=Path, default=DEFAULT_WIND_DIR)
    parser.add_argument("--upload-dir", type=Path, default=DEFAULT_UPLOAD_DIR)
    parser.add_argument("--terrain-dir", type=Path, default=DEFAULT_TERRAIN_DIR)
    parser.add_argument("--terrain-image", default="tumgis/ctb-quantized-mesh:latest")
    parser.add_argument("--public-url", help="浏览器访问本地服务时使用的公开基础 URL")
    args = parser.parse_args()
    run_server(
        args.host,
        args.port,
        args.wind_dir,
        args.upload_dir,
        args.terrain_dir,
        args.terrain_image,
        args.public_url,
    )


if __name__ == "__main__":
    main()

import { fromArrayBuffer } from "geotiff";
import {
  bilinearElevation,
  boundsIntersect,
  DEM_TILE_SIZE,
  deriveTerrainMaxLevel,
  geographicTileBounds,
  resolveDemProjection,
  sourceBoundsToWgs84,
  wgs84ToSourceCoordinate,
} from "./demRasterMath.js";

const TILE_CACHE_LIMIT = 96;

let dem;
const tileCache = new Map();

function postStatus(stage, detail) {
  self.postMessage({ type: "status", stage, detail });
}

function boundsObject(values) {
  return { west: values[0], south: values[1], east: values[2], north: values[3] };
}

function rememberTile(key, heights) {
  tileCache.delete(key);
  tileCache.set(key, heights);
  while (tileCache.size > TILE_CACHE_LIMIT) tileCache.delete(tileCache.keys().next().value);
}

async function loadDem(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("没有收到可读取的 DEM 文件");
  postStatus("reading", `正在读取 ${file.name}`);
  const input = await file.arrayBuffer();
  postStatus("metadata", "正在解析 GeoTIFF 坐标系与高程元数据");
  const tiff = await fromArrayBuffer(input);
  const image = await tiff.getImage();
  if (image.getSamplesPerPixel() < 1) throw new Error("GeoTIFF 不包含可读取的高程波段");

  const width = image.getWidth();
  const height = image.getHeight();
  const geoKeys = image.getGeoKeys();
  const projection = resolveDemProjection(geoKeys);
  const sourceBounds = image.getBoundingBox();
  const wgs84Bounds = sourceBoundsToWgs84(sourceBounds, projection);
  const origin = image.getOrigin();
  const resolution = image.getResolution();
  if (![...origin.slice(0, 2), ...resolution.slice(0, 2)].every(Number.isFinite)) {
    throw new Error("GeoTIFF 缺少可用的原点或像元分辨率");
  }

  postStatus("raster", `正在解码 ${width} x ${height} 高程栅格`);
  const decoded = await image.readRasters({ samples: [0], interleave: true });
  const raster = decoded instanceof Float32Array ? decoded : Float32Array.from(decoded);
  const noData = Number(image.getGDALNoData());
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let validSamples = 0;
  for (const value of raster) {
    if (!Number.isFinite(value) || (Number.isFinite(noData) && value === noData)) continue;
    minHeight = Math.min(minHeight, value);
    maxHeight = Math.max(maxHeight, value);
    validSamples += 1;
  }
  if (!validSamples) throw new Error("GeoTIFF 中没有有效高程样本");

  dem = {
    raster,
    width,
    height,
    sourceBounds,
    wgs84Bounds,
    bounds: boundsObject(wgs84Bounds),
    origin,
    resolution,
    projection,
    noData,
    // PixelIsArea 的原点位于像元左上角，采样时需移到像元中心；PixelIsPoint
    // 的 tie point 本身就是采样点，不能再偏移半个像元。
    pixelOffset: Number(geoKeys.GTRasterTypeGeoKey) === 1 ? 0.5 : 0,
    minHeight,
    maxHeight,
    validSamples,
    maxLevel: deriveTerrainMaxLevel(wgs84Bounds, width, height),
  };
  tileCache.clear();

  return {
    fileName: file.name,
    fileSize: file.size,
    width,
    height,
    projection: projection.label,
    projectionCode: projection.code,
    bounds: dem.bounds,
    noData: Number.isFinite(noData) ? noData : undefined,
    minHeight,
    maxHeight,
    validSamples,
    totalSamples: raster.length,
    maxLevel: dem.maxLevel,
  };
}

function sampleTile(x, y, level) {
  if (!dem) throw new Error("DEM 尚未完成初始化");
  const key = `${level}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) {
    rememberTile(key, cached);
    return cached;
  }

  const tileBounds = geographicTileBounds(x, y, level);
  const heights = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE);
  if (!boundsIntersect(tileBounds, dem.bounds)) {
    rememberTile(key, heights);
    return heights;
  }

  const longitudeStep = (tileBounds.east - tileBounds.west) / (DEM_TILE_SIZE - 1);
  const latitudeStep = (tileBounds.north - tileBounds.south) / (DEM_TILE_SIZE - 1);
  for (let row = 0; row < DEM_TILE_SIZE; row += 1) {
    const latitude = tileBounds.north - row * latitudeStep;
    for (let column = 0; column < DEM_TILE_SIZE; column += 1) {
      const longitude = tileBounds.west + column * longitudeStep;
      if (longitude < dem.bounds.west || longitude > dem.bounds.east
        || latitude < dem.bounds.south || latitude > dem.bounds.north) continue;
      const [sourceX, sourceY] = wgs84ToSourceCoordinate(longitude, latitude, dem.projection);
      const pixelX = (sourceX - dem.origin[0]) / dem.resolution[0] - dem.pixelOffset;
      const pixelY = (sourceY - dem.origin[1]) / dem.resolution[1] - dem.pixelOffset;
      heights[row * DEM_TILE_SIZE + column] = bilinearElevation(
        dem.raster,
        dem.width,
        dem.height,
        pixelX,
        pixelY,
        dem.noData,
      );
    }
  }
  rememberTile(key, heights);
  return heights;
}

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  try {
    if (message.type === "load") {
      const metadata = await loadDem(message.file);
      self.postMessage({ type: "result", requestId: message.requestId, value: metadata });
      return;
    }
    if (message.type === "tile") {
      const heights = sampleTile(message.x, message.y, message.level);
      // 单瓦片只有约 17 KB。保留 Worker 内的 LRU 缓存并让 structured clone
      // 复制小数组，比 transfer 后缓存 buffer 被 detach 更利于 Cesium 重复请求。
      self.postMessage({ type: "result", requestId: message.requestId, value: heights });
      return;
    }
    if (message.type === "dispose") {
      dem = undefined;
      tileCache.clear();
      self.close();
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: message.requestId,
      message: error?.message || String(error),
    });
  }
});

import proj4 from "proj4";

export const DEM_TILE_SIZE = 65;
export const OUTSIDE_DEM_MAX_LEVEL = 10;

const WGS84 = "EPSG:4326";

function finiteBounds(values) {
  return Array.isArray(values)
    && values.length === 4
    && values.every(Number.isFinite)
    && values[0] < values[2]
    && values[1] < values[3];
}

/**
 * 只接受能够在浏览器内可靠转换到 WGS84 的 GeoTIFF CRS。
 * 当前覆盖项目真实数据使用的 EPSG:4326 和 WGS84 UTM 南北半球分区；
 * 其他投影继续交给离线 GDAL，避免用猜测参数把地形放到错误位置。
 */
export function resolveDemProjection(geoKeys = {}) {
  const geographicCode = Number(geoKeys.GeographicTypeGeoKey);
  if (geographicCode === 4326) {
    return {
      kind: "geographic",
      code: "EPSG:4326",
      label: "WGS 84",
      definition: WGS84,
    };
  }

  const projectedCode = Number(geoKeys.ProjectedCSTypeGeoKey);
  const north = projectedCode >= 32601 && projectedCode <= 32660;
  const south = projectedCode >= 32701 && projectedCode <= 32760;
  if (north || south) {
    const zone = projectedCode % 100;
    const southFlag = south ? " +south" : "";
    return {
      kind: "utm",
      code: `EPSG:${projectedCode}`,
      label: `WGS 84 / UTM zone ${zone}${south ? "S" : "N"}`,
      definition: `+proj=utm +zone=${zone}${southFlag} +datum=WGS84 +units=m +no_defs +type=crs`,
      zone,
      hemisphere: south ? "south" : "north",
    };
  }

  const codeText = Number.isFinite(projectedCode) ? `EPSG:${projectedCode}` : "未知 CRS";
  throw new Error(`浏览器 DEM 暂不支持 ${codeText}；请先转为 EPSG:4326 或 WGS84 UTM`);
}

export function sourceBoundsToWgs84(sourceBounds, projection) {
  if (!finiteBounds(sourceBounds)) throw new Error("GeoTIFF 缺少有效地理范围");
  if (projection.kind === "geographic") return [...sourceBounds];

  const [west, south, east, north] = sourceBounds;
  const corners = [
    [west, south], [west, north], [east, south], [east, north],
  ].map((point) => proj4(projection.definition, WGS84, point));
  const longitudes = corners.map((point) => point[0]);
  const latitudes = corners.map((point) => point[1]);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

export function wgs84ToSourceCoordinate(longitude, latitude, projection) {
  if (projection.kind === "geographic") return [longitude, latitude];
  return proj4(WGS84, projection.definition, [longitude, latitude]);
}

/**
 * Cesium GeographicTilingScheme 在 0 级有 2x1 个瓦片，Y 从北向南编号。
 * 这里与 Cesium 使用同一规则，Worker 才能按每次瓦片请求采样正确经纬范围。
 */
export function geographicTileBounds(x, y, level) {
  const xTiles = 2 ** (level + 1);
  const yTiles = 2 ** level;
  const longitudeSpan = 360 / xTiles;
  const latitudeSpan = 180 / yTiles;
  const west = -180 + x * longitudeSpan;
  const north = 90 - y * latitudeSpan;
  return {
    west,
    south: north - latitudeSpan,
    east: west + longitudeSpan,
    north,
  };
}

export function boundsIntersect(a, b) {
  return a.west < b.east
    && a.east > b.west
    && a.south < b.north
    && a.north > b.south;
}

export function tileAvailable(x, y, level, demBounds, maxLevel, outsideMaxLevel = OUTSIDE_DEM_MAX_LEVEL) {
  const intersects = boundsIntersect(geographicTileBounds(x, y, level), demBounds);
  return level <= (intersects ? maxLevel : outsideMaxLevel);
}

/**
 * 当子瓦片超过 DEM 的有效层级时清除对应 bit，让 Cesium 从父瓦片上采样，
 * 避免 CustomHeightmapTerrainProvider 一类“所有子级均可用”的无限细分行为。
 */
export function childTileMask(x, y, level, demBounds, maxLevel, outsideMaxLevel = OUTSIDE_DEM_MAX_LEVEL) {
  const nextLevel = level + 1;
  let mask = 0;
  if (tileAvailable(x * 2, y * 2 + 1, nextLevel, demBounds, maxLevel, outsideMaxLevel)) mask |= 1;
  if (tileAvailable(x * 2 + 1, y * 2 + 1, nextLevel, demBounds, maxLevel, outsideMaxLevel)) mask |= 2;
  if (tileAvailable(x * 2, y * 2, nextLevel, demBounds, maxLevel, outsideMaxLevel)) mask |= 4;
  if (tileAvailable(x * 2 + 1, y * 2, nextLevel, demBounds, maxLevel, outsideMaxLevel)) mask |= 8;
  return mask;
}

export function deriveTerrainMaxLevel(bounds, width, height) {
  if (!finiteBounds(bounds) || width < 2 || height < 2) return 0;
  const longitudeResolution = (bounds[2] - bounds[0]) / (width - 1);
  const latitudeResolution = (bounds[3] - bounds[1]) / (height - 1);
  const longitudeLevel = Math.ceil(Math.log2(360 / (128 * longitudeResolution)));
  const latitudeLevel = Math.ceil(Math.log2(180 / (64 * latitudeResolution)));
  return Math.max(0, Math.min(22, Math.min(longitudeLevel, latitudeLevel)));
}

export function isValidElevation(value, noData) {
  return Number.isFinite(value) && (!Number.isFinite(noData) || value !== noData);
}

/**
 * 对源栅格做双线性采样。NoData 邻点不参与权重；四个邻点都无效时返回 0，
 * 让本地 DEM 之外回到 Cesium 椭球面，而不是把 -32767 一类哨兵值渲染成深坑。
 */
export function bilinearElevation(raster, width, height, pixelX, pixelY, noData) {
  if (pixelX < -0.5 || pixelY < -0.5 || pixelX > width - 0.5 || pixelY > height - 0.5) return 0;
  const clampedX = Math.max(0, Math.min(width - 1, pixelX));
  const clampedY = Math.max(0, Math.min(height - 1, pixelY));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const samples = [
    [raster[y0 * width + x0], (1 - tx) * (1 - ty)],
    [raster[y0 * width + x1], tx * (1 - ty)],
    [raster[y1 * width + x0], (1 - tx) * ty],
    [raster[y1 * width + x1], tx * ty],
  ];
  let value = 0;
  let weight = 0;
  for (const [sample, sampleWeight] of samples) {
    if (!isValidElevation(sample, noData) || sampleWeight <= 0) continue;
    value += sample * sampleWeight;
    weight += sampleWeight;
  }
  return weight > 0 ? value / weight : 0;
}

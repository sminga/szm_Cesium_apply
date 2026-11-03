import {
  Event,
  GeographicTilingScheme,
  HeightmapTerrainData,
  Math as CesiumMath,
  TerrainProvider,
} from "cesium";
import { DEM_TILE_SIZE } from "./demRasterMath.js";

function sameNumber(left, right, epsilon = CesiumMath.EPSILON10) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= epsilon;
}

/**
 * 多 DEM 组合要求所有来源共享 Cesium GeographicTilingScheme。若基础地形使用
 * WebMercator 或自定义瓦片编号，同一组 x/y/level 将指向不同位置，必须拒绝组合。
 */
export function isGeographicTerrainProvider(provider) {
  const scheme = provider?.tilingScheme;
  const rectangle = scheme?.rectangle;
  return Boolean(scheme)
    && scheme.getNumberOfXTilesAtLevel?.(0) === 2
    && scheme.getNumberOfYTilesAtLevel?.(0) === 1
    && sameNumber(rectangle?.west, -Math.PI)
    && sameNumber(rectangle?.south, -Math.PI / 2)
    && sameNumber(rectangle?.east, Math.PI)
    && sameNumber(rectangle?.north, Math.PI / 2);
}

function providerError(error, sourceName) {
  const original = error instanceof Error ? error : new Error(String(error));
  const wrapped = new Error(`${sourceName} 地形瓦片加载失败：${original.message}`, { cause: original });
  wrapped.sourceName = sourceName;
  return wrapped;
}

function sourceHasData(source, x, y, level) {
  const provider = source.provider;
  if (typeof provider.hasDataForTile === "function") {
    return provider.hasDataForTile(x, y, level);
  }
  return provider.getTileDataAvailable?.(x, y, level) !== false;
}

function sampleBaseTerrain(terrainData, rectangle, output) {
  if (!terrainData?.interpolateHeight) return;
  const longitudeStep = (rectangle.east - rectangle.west) / (DEM_TILE_SIZE - 1);
  const latitudeStep = (rectangle.north - rectangle.south) / (DEM_TILE_SIZE - 1);
  for (let row = 0; row < DEM_TILE_SIZE; row += 1) {
    const latitude = rectangle.north - row * latitudeStep;
    for (let column = 0; column < DEM_TILE_SIZE; column += 1) {
      const longitude = rectangle.west + column * longitudeStep;
      const height = terrainData.interpolateHeight(rectangle, longitude, latitude);
      output[row * DEM_TILE_SIZE + column] = Number.isFinite(height) ? height : 0;
    }
  }
}

/**
 * 对 Cesium 暴露一个 TerrainProvider，在局部 DEM 覆盖的瓦片内把基础地形采样成
 * 65x65 heightmap，再按“列表底部到顶部”覆盖有效像元。DEM 失败只跳过该来源；
 * World Terrain 或其他基础地形失败时仍保留局部 DEM，并通过 errorEvent 告知界面。
 */
export class MultiDemTerrainProvider {
  constructor(options = {}) {
    if (!options.baseProvider) throw new Error("组合地形缺少基础 TerrainProvider");
    if (!isGeographicTerrainProvider(options.baseProvider)) {
      throw new Error("当前基础地形不是 GeographicTilingScheme，不能与浏览器 DEM 组合");
    }
    this.baseProvider = options.baseProvider;
    this.sources = (options.sources ?? []).filter((source) => source?.provider);
    this.tilingScheme = new GeographicTilingScheme();
    this.errorEvent = new Event();
    this.credit = options.baseProvider.credit;
    this.hasWaterMask = false;
    this.hasVertexNormals = false;
    this.availability = undefined;
    this.levelZeroMaximumGeometricError = TerrainProvider
      .getEstimatedLevelZeroGeometricErrorForAHeightmap(
        this.tilingScheme.ellipsoid,
        DEM_TILE_SIZE,
        this.tilingScheme.getNumberOfXTilesAtLevel(0),
      );
  }

  getLevelMaximumGeometricError(level) {
    return this.baseProvider.getLevelMaximumGeometricError?.(level)
      ?? this.levelZeroMaximumGeometricError / (1 << level);
  }

  getTileDataAvailable(x, y, level) {
    const baseAvailable = this.baseProvider.getTileDataAvailable?.(x, y, level);
    if (baseAvailable !== false) return true;
    return this.sources.some((source) => sourceHasData(source, x, y, level));
  }

  loadTileDataAvailability(x, y, level) {
    return this.baseProvider.loadTileDataAvailability?.(x, y, level);
  }

  requestTileGeometry(x, y, level, request) {
    const relevantSources = this.sources.filter(
      (source) => sourceHasData(source, x, y, level),
    );
    const baseAvailable = this.baseProvider.getTileDataAvailable?.(x, y, level);
    const baseRequest = baseAvailable === false
      ? Promise.resolve(undefined)
      : this.baseProvider.requestTileGeometry(x, y, level, request);
    // undefined 也可能表示 Cesium RequestScheduler 暂时拒绝请求；只有基础 Provider
    // 明确报告瓦片不可用时，才允许局部 DEM 独立生成该瓦片。
    if (baseRequest === undefined && baseAvailable !== false) return undefined;
    if (!relevantSources.length) return baseRequest;

    const sampleRequests = relevantSources.map((source) => {
      const samples = source.provider.requestTileSamples?.(x, y, level, request);
      return samples === undefined
        ? Promise.resolve({ source, samples: undefined })
        : Promise.resolve(samples)
          .then((value) => ({ source, samples: value }))
          .catch((error) => ({ source, error }));
    });

    return Promise.all([
      Promise.resolve(baseRequest).catch((error) => {
        this.errorEvent.raiseEvent(providerError(error, "基础"));
        return undefined;
      }),
      ...sampleRequests,
    ]).then(([baseData, ...sourceResults]) => {
      const rectangle = this.tilingScheme.tileXYToRectangle(x, y, level);
      const heights = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE);
      sampleBaseTerrain(baseData, rectangle, heights);
      let childTileMask = baseData?.childTileMask ?? 0;

      // sources 按右侧面板从高到低排列；倒序写入后，上方来源最后覆盖。
      for (let index = sourceResults.length - 1; index >= 0; index -= 1) {
        const result = sourceResults[index];
        if (result.error) {
          this.errorEvent.raiseEvent(providerError(result.error, result.source.name || "局部 DEM"));
          continue;
        }
        const samples = result.samples;
        if (!samples?.heights || !samples?.validMask) continue;
        for (let sampleIndex = 0; sampleIndex < heights.length; sampleIndex += 1) {
          if (samples.validMask[sampleIndex]) heights[sampleIndex] = samples.heights[sampleIndex];
        }
        childTileMask |= result.source.provider.getChildTileMask?.(x, y, level) ?? 0;
      }

      return new HeightmapTerrainData({
        buffer: heights,
        width: DEM_TILE_SIZE,
        height: DEM_TILE_SIZE,
        childTileMask,
      });
    });
  }
}

export default MultiDemTerrainProvider;

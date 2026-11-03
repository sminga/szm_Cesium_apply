import { GeographicTilingScheme } from "cesium";
import { describe, expect, it, vi } from "vitest";
import {
  MultiDemTerrainProvider,
  isGeographicTerrainProvider,
} from "../../example/services/multiDemTerrainProvider.js";
import { DEM_TILE_SIZE } from "../../example/services/demRasterMath.js";

function baseProvider(height = 10) {
  const tilingScheme = new GeographicTilingScheme();
  const terrainData = {
    childTileMask: 1,
    interpolateHeight: () => height,
  };
  return {
    tilingScheme,
    getLevelMaximumGeometricError: (level) => 100 / (1 << level),
    getTileDataAvailable: () => true,
    requestTileGeometry: vi.fn(() => Promise.resolve(terrainData)),
    terrainData,
  };
}

function demSource(name, height, validIndexes, childTileMask = 0) {
  const heights = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE).fill(height);
  const validMask = new Uint8Array(heights.length);
  for (const index of validIndexes) validMask[index] = 1;
  return {
    name,
    provider: {
      hasDataForTile: () => true,
      getTileDataAvailable: () => true,
      getChildTileMask: () => childTileMask,
      requestTileSamples: vi.fn(async () => ({ heights, validMask })),
    },
  };
}

function heightAtCenter(provider, terrainData) {
  const rectangle = provider.tilingScheme.tileXYToRectangle(0, 0, 0);
  return terrainData.interpolateHeight(
    rectangle,
    (rectangle.west + rectangle.east) / 2,
    (rectangle.south + rectangle.north) / 2,
  );
}

describe("MultiDemTerrainProvider", () => {
  it("DEM 外部直接返回基础 TerrainData，不重采样全球瓦片", async () => {
    const base = baseProvider(12);
    const source = demSource("局部 DEM", 30, []);
    source.provider.hasDataForTile = () => false;
    const provider = new MultiDemTerrainProvider({ baseProvider: base, sources: [source] });

    const result = await provider.requestTileGeometry(0, 0, 0);
    expect(result).toBe(base.terrainData);
    expect(source.provider.requestTileSamples).not.toHaveBeenCalled();
  });

  it("优先使用严格覆盖判断，不把单 DEM 的低层级全球兼容瓦片加入组合", async () => {
    const base = baseProvider(12);
    const source = demSource("局部 DEM", 30, []);
    source.provider.hasDataForTile = vi.fn(() => false);
    source.provider.getTileDataAvailable = vi.fn(() => true);
    const provider = new MultiDemTerrainProvider({ baseProvider: base, sources: [source] });

    const result = await provider.requestTileGeometry(0, 0, 5);

    expect(result).toBe(base.terrainData);
    expect(source.provider.hasDataForTile).toHaveBeenCalledWith(0, 0, 5);
    expect(source.provider.requestTileSamples).not.toHaveBeenCalled();
  });

  it("按面板顺序覆盖有效像元，并让 NoData 回退到下层与基础地形", async () => {
    const center = 32 * DEM_TILE_SIZE + 32;
    const adjacent = center + 1;
    const low = demSource("下层 DEM", 20, [center, adjacent], 2);
    const high = demSource("上层 DEM", 30, [center], 4);
    const provider = new MultiDemTerrainProvider({
      baseProvider: baseProvider(10),
      sources: [high, low],
    });

    const terrainData = await provider.requestTileGeometry(0, 0, 0);
    const rectangle = provider.tilingScheme.tileXYToRectangle(0, 0, 0);
    const longitudeStep = (rectangle.east - rectangle.west) / (DEM_TILE_SIZE - 1);
    const centerHeight = heightAtCenter(provider, terrainData);
    const adjacentHeight = terrainData.interpolateHeight(
      rectangle,
      (rectangle.west + rectangle.east) / 2 + longitudeStep,
      (rectangle.south + rectangle.north) / 2,
    );
    const baseHeight = terrainData.interpolateHeight(rectangle, rectangle.west, rectangle.north);

    expect(centerHeight).toBeCloseTo(30, 5);
    expect(adjacentHeight).toBeCloseTo(20, 5);
    expect(baseHeight).toBeCloseTo(10, 5);
    expect(terrainData.childTileMask).toBe(7);
  });

  it("某个 DEM 瓦片失败时继续使用其他来源并发出可见错误", async () => {
    const center = 32 * DEM_TILE_SIZE + 32;
    const broken = demSource("损坏 DEM", 99, [center]);
    broken.provider.requestTileSamples = vi.fn(async () => { throw new Error("Worker failed"); });
    const fallback = demSource("可用 DEM", 24, [center]);
    const provider = new MultiDemTerrainProvider({
      baseProvider: baseProvider(10),
      sources: [broken, fallback],
    });
    const errors = [];
    provider.errorEvent.addEventListener((error) => errors.push(error));

    const terrainData = await provider.requestTileGeometry(0, 0, 0);
    expect(heightAtCenter(provider, terrainData)).toBeCloseTo(24, 5);
    expect(errors[0].message).toContain("损坏 DEM");
  });

  it("拒绝与 GeographicTilingScheme 不一致的基础地形", () => {
    expect(isGeographicTerrainProvider(baseProvider())).toBe(true);
    expect(() => new MultiDemTerrainProvider({
      baseProvider: {
        tilingScheme: {
          rectangle: { west: 0, south: 0, east: 1, north: 1 },
          getNumberOfXTilesAtLevel: () => 1,
          getNumberOfYTilesAtLevel: () => 1,
        },
      },
    })).toThrow("GeographicTilingScheme");
  });
});

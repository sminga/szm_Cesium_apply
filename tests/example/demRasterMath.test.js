import { describe, expect, it } from "vitest";
import {
  bilinearElevation,
  childTileMask,
  deriveTerrainMaxLevel,
  geographicTileBounds,
  resolveDemProjection,
  sourceBoundsToWgs84,
  tileAvailable,
} from "../../example/services/demRasterMath.js";

const XIFENG_BOUNDS = {
  west: 116.03357230251954,
  south: 40.15316878710198,
  east: 116.0532025039814,
  north: 40.16459646519027,
};

describe("demRasterMath", () => {
  it("识别西峰山两份 GeoTIFF 的 WGS84 与 UTM 50N CRS", () => {
    expect(resolveDemProjection({ GeographicTypeGeoKey: 4326 })).toMatchObject({
      kind: "geographic",
      code: "EPSG:4326",
    });
    expect(resolveDemProjection({ ProjectedCSTypeGeoKey: 32650 })).toMatchObject({
      kind: "utm",
      code: "EPSG:32650",
      zone: 50,
      hemisphere: "north",
    });
    expect(() => resolveDemProjection({ ProjectedCSTypeGeoKey: 4547 }))
      .toThrow("暂不支持 EPSG:4547");
  });

  it("把 UTM 50N 栅格范围转换到西峰山经纬度", () => {
    const projection = resolveDemProjection({ ProjectedCSTypeGeoKey: 32650 });
    const bounds = sourceBoundsToWgs84([
      417703.386425,
      4445205.6495,
      419361.886425,
      4446456.1495,
    ], projection);
    expect(bounds[0]).toBeCloseTo(116.03357, 5);
    expect(bounds[1]).toBeCloseTo(40.15317, 5);
    expect(bounds[2]).toBeCloseTo(116.05320, 5);
    expect(bounds[3]).toBeCloseTo(40.16460, 5);
  });

  it("使用 Cesium GeographicTilingScheme 的北向南 Y 编号", () => {
    const tile = geographicTileBounds(52, 8, 5);
    expect(tile.west).toBe(112.5);
    expect(tile.east).toBe(118.125);
    expect(tile.south).toBe(39.375);
    expect(tile.north).toBe(45);
  });

  it("按真实分辨率得到 WGS84 20 级和 UTM 50N 19 级", () => {
    expect(deriveTerrainMaxLevel([
      XIFENG_BOUNDS.west,
      XIFENG_BOUNDS.south,
      XIFENG_BOUNDS.east,
      XIFENG_BOUNDS.north,
    ], 4358, 2537)).toBe(20);
    expect(deriveTerrainMaxLevel([
      116.03372975921307,
      40.15317296056334,
      116.05304369429176,
      40.16459871868655,
    ], 3317, 2501)).toBe(19);
  });

  it("清除超过有效层级的子瓦片并保留 DEM 外低层级椭球", () => {
    expect(tileAvailable(52, 8, 5, XIFENG_BOUNDS, 20)).toBe(true);
    expect(tileAvailable(0, 0, 10, XIFENG_BOUNDS, 20)).toBe(true);
    expect(tileAvailable(0, 0, 11, XIFENG_BOUNDS, 20)).toBe(false);
    expect(childTileMask(1_724_560, 290_355, 20, XIFENG_BOUNDS, 20)).toBe(0);
  });

  it("双线性采样忽略 NoData，全部无效时回到 0 米", () => {
    const raster = new Float32Array([100, -32767, 200, 300]);
    expect(bilinearElevation(raster, 2, 2, 0.5, 0.5, -32767)).toBeCloseTo(200, 5);
    expect(bilinearElevation(new Float32Array(4).fill(-32767), 2, 2, 0.5, 0.5, -32767)).toBe(0);
    expect(bilinearElevation(raster, 2, 2, -2, -2, -32767)).toBe(0);
  });
});

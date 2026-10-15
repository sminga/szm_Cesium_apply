import { describe, expect, it } from "vitest";
import { detectNetCDFFormat, normalizeNetCDFReader } from "../../src/data/netcdfLoader.js";

function createReader({ includeW = false, levelUnits = "m", heightValues = [1000, 100] } = {}) {
  const dimensions = [
    { name: "time", size: 1 },
    { name: "height", size: heightValues.length },
    { name: "latitude", size: 2 },
    { name: "longitude", size: 2 },
  ];
  const variable = (name, dimensionIds, attributes = []) => ({ name, dimensions: dimensionIds, attributes });
  const variables = [
    variable("longitude", [3], [{ name: "standard_name", value: "longitude" }]),
    variable("latitude", [2], [{ name: "standard_name", value: "latitude" }]),
    variable("height", [1], [{ name: "units", value: levelUnits }]),
    variable("eastward_wind", [0, 1, 2, 3], [{ name: "standard_name", value: "eastward_wind" }]),
    variable("northward_wind", [0, 1, 2, 3], [{ name: "standard_name", value: "northward_wind" }]),
  ];
  if (includeW) {
    variables.push(variable("upward_air_velocity", [0, 1, 2, 3], [
      { name: "standard_name", value: "upward_air_velocity" },
    ]));
  }
  const data = {
    longitude: [181, 180],
    latitude: [1, 0],
    height: heightValues,
    eastward_wind: Array.from({ length: heightValues.length * 4 }, (_, index) => index + 1),
    northward_wind: new Array(heightValues.length * 4).fill(0),
    upward_air_velocity: new Array(heightValues.length * 4).fill(0.5),
  };
  return {
    dimensions,
    variables,
    getDataVariable(input) {
      return data[typeof input === "string" ? input : input.name];
    },
  };
}

describe("detectNetCDFFormat", () => {
  it("识别 NetCDF-3 和 NetCDF-4 文件头", () => {
    expect(detectNetCDFFormat(new Uint8Array([0x43, 0x44, 0x46, 1]))).toBe("netcdf3");
    expect(detectNetCDFFormat(new Uint8Array([0x89, 0x48, 0x44, 0x46]))).toBe("netcdf4");
    expect(detectNetCDFFormat(new Uint8Array([1, 2, 3, 4]))).toBe("unknown");
  });
});

describe("normalizeNetCDFReader", () => {
  it("识别常见变量名并统一经纬度和高度方向", () => {
    const { windData, metadata } = normalizeNetCDFReader(createReader({ includeW: true }));
    expect(windData).toMatchObject({
      nx: 2, ny: 2, nz: 2,
      bounds: { west: -180, east: -179, south: 0, north: 1 },
      levels: [100, 1000],
    });
    expect(Array.from(windData.u.array)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(windData.w.array[0]).toBeCloseTo(0.5);
    expect(metadata.warnings).toEqual([]);
  });

  it("缺少 W 时补零并返回警告", () => {
    const { windData, metadata } = normalizeNetCDFReader(createReader());
    expect(Array.from(windData.w.array).every((value) => value === 0)).toBe(true);
    expect(metadata.warnings).toContain("未找到垂直风速 W，已使用 0 m/s");
  });

  it("拒绝把压力层当成米制高度", () => {
    expect(() => normalizeNetCDFReader(createReader({ levelUnits: "hPa" }))).toThrow(/转换为米制高度/);
  });

  it("把未标注的单层高度缺测哨兵值回退为 0 m", () => {
    const reader = createReader({ heightValues: [9.969209968386869e36] });
    const { windData, metadata } = normalizeNetCDFReader(reader);
    expect(windData.levels).toEqual([0, 1]);
    expect(metadata.warnings).toContain("单层高度是缺测哨兵值，已按 0 m 处理");
  });
});

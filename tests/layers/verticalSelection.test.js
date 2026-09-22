import { describe, expect, it } from "vitest";
import { resolveVerticalSelection } from "../../src/core/verticalSelection.js";
import { createWindData2D } from "../../src/wind-2d/WindLayer2D.js";

const windData = {
  u: { array: new Float32Array([1, 2, 3, 4, 5, 6]) },
  v: { array: new Float32Array(6) },
  w: { array: new Float32Array(6) },
  nx: 2,
  ny: 1,
  nz: 3,
  bounds: { west: 100, south: 20, east: 101, north: 20 },
  levels: [100, 500, 1500],
};

describe("vertical selection", () => {
  it("把非等距实际高度映射到纹理层坐标", () => {
    const selection = resolveVerticalSelection(windData, {
      verticalMode: "range",
      heightRange: { min: 300, max: 1000 },
    });
    expect(selection.normalizedRange.x).toBeCloseTo(0.25);
    expect(selection.normalizedRange.y).toBeCloseTo(0.75);
  });

  it("离散单层选择最接近的真实高度层", () => {
    const selection = resolveVerticalSelection(windData, {
      verticalMode: "level",
      selectedLevel: 700,
    });
    expect(selection.displayHeight).toBe(500);
    expect(selection.normalizedHeight).toBe(0.5);
    expect(selection.fixed).toBe(true);
  });

  it("二维数据提取指定层并把 W 设为零", () => {
    const data2d = createWindData2D(windData, 1);
    expect(data2d.nz).toBe(2);
    expect(Array.from(data2d.u.array)).toEqual([3, 4, 3, 4]);
    expect(Array.from(data2d.w.array)).toEqual([0, 0, 0, 0]);
    expect(data2d.sourceLevel).toBe(500);
  });
});

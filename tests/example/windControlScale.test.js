import { describe, expect, it } from "vitest";
import {
  formatSpeedFactor,
  normalizeParameterValue,
  speedFactorFromSlider,
  speedSliderFromFactor,
} from "../../example/app/windControlScale.js";

describe("wind speed logarithmic control", () => {
  it("为低速区间提供按数量级分布的调节行程", () => {
    expect(speedFactorFromSlider(0)).toBeCloseTo(0.05);
    expect(speedFactorFromSlider(100)).toBeCloseTo(0.5);
    expect(speedFactorFromSlider(200)).toBeCloseTo(5);
  });

  it("支持默认值回填并清楚显示低速小数", () => {
    expect(speedSliderFromFactor(0.05)).toBe(0);
    expect(speedSliderFromFactor(0.3)).toBe(78);
    expect(formatSpeedFactor(0.05)).toBe("0.05");
    expect(formatSpeedFactor(0.3)).toBe("0.3");
  });

  it("限制填写值并对齐参数步进", () => {
    expect(normalizeParameterValue(33, { min: 20, max: 240, step: 5 }, 80)).toBe(35);
    expect(normalizeParameterValue(-1, { min: 0.2, max: 1, step: 0.02 }, 0.72)).toBe(0.2);
    expect(normalizeParameterValue("", { min: 64, max: 512, step: 64 }, 256)).toBe(256);
  });
});

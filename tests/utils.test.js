import { describe, it, expect } from "vitest";
import { deepMerge, computeSpeedFromComponents } from "../src/utils.js";

describe("deepMerge", () => {
  it("返回目标对象拷贝且不污染源", () => {
    const to = { a: 1, nested: { x: 1, y: 2 } };
    const from = { b: 2, nested: { y: 3 } };
    const result = deepMerge(from, to);

    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
    expect(result.nested).toEqual({ x: 1, y: 3 });
    expect(to.nested).toEqual({ x: 1, y: 2 }); // 源未被修改
    expect(from.nested).toEqual({ y: 3 });
  });

  it("数组用浅拷贝，不共享引用", () => {
    const to = { colors: ["white"] };
    const from = { colors: ["red", "green"] };
    const result = deepMerge(from, to);

    expect(result.colors).toEqual(["red", "green"]);
    result.colors.push("blue");
    expect(from.colors).toEqual(["red", "green"]);
  });

  it("undefined 值不覆盖目标", () => {
    const to = { a: 1 };
    const from = { a: undefined };
    expect(deepMerge(from, to)).toEqual({ a: 1 });
  });

  it("from 为空时返回 to 本身", () => {
    const to = { a: 1 };
    expect(deepMerge(null, to)).toBe(to);
    expect(deepMerge(undefined, to)).toBe(to);
  });
});

describe("computeSpeedFromComponents", () => {
  it("计算三分量合成幅值", () => {
    const u = new Float32Array([3, 0, 1]);
    const v = new Float32Array([4, 0, 0]);
    const w = new Float32Array([0, 0, 0]);
    const { array, min, max } = computeSpeedFromComponents(u, v, w);

    expect(array[0]).toBeCloseTo(5); // sqrt(3^2+4^2)
    expect(array[1]).toBe(0);
    expect(array[2]).toBeCloseTo(1);
    expect(min).toBeCloseTo(1);
    expect(max).toBeCloseTo(5);
  });

  it("全零输入时 min/max 保持极值哨兵", () => {
    const u = new Float32Array([0, 0]);
    const v = new Float32Array([0, 0]);
    const w = new Float32Array([0, 0]);
    const { array, min, max } = computeSpeedFromComponents(u, v, w);

    expect(array[0]).toBe(0);
    expect(min).toBe(Number.MAX_VALUE);
    expect(max).toBe(Number.MIN_VALUE);
  });
});

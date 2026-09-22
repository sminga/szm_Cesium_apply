/**
 * 风场图层使用的通用数据工具。
 * 提供配置对象深度合并，以及由三轴速度分量计算速度幅值和有效范围的能力。
 */
export function deepMerge(from, to) {
  if (!from) return to;
  if (!to) return from;

  const result = { ...to };

  for (const key in from) {
    if (Object.prototype.hasOwnProperty.call(from, key)) {
      const fromValue = from[key];
      const toValue = to[key];

      if (Array.isArray(fromValue)) {
        result[key] = fromValue.slice();
        continue;
      }

      if (fromValue && typeof fromValue === "object") {
        result[key] = deepMerge(fromValue, toValue || {});
        continue;
      }

      if (fromValue !== undefined) {
        result[key] = fromValue;
      }
    }
  }

  return result;
}

// 由 u/v/w 三分量合成速度幅值数组，并返回非零区间 [min, max]
export function computeSpeedFromComponents(u, v, w) {
  const array = new Float32Array(u.length);
  let min = Number.MAX_VALUE;
  let max = Number.MIN_VALUE;
  for (let i = 0; i < u.length; i++) {
    const s = Math.sqrt(u[i] * u[i] + v[i] * v[i] + w[i] * w[i]);
    array[i] = s;
    if (s !== 0) {
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
  }
  if (min === Number.MAX_VALUE) {
    min = 0;
    max = 0;
  }
  return { array, min, max };
}

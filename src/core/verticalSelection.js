/**
 * 把面向用户的高度模式转换为 GPU 使用的归一化高度范围。
 * 支持完整三维范围、连续高度区间、离散高度层和二维固定高度。
 */
import { Cartesian2 } from "cesium";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nearestLevelIndex(levels, requested) {
  let nearest = 0;
  for (let index = 1; index < levels.length; index++) {
    if (Math.abs(levels[index] - requested) < Math.abs(levels[nearest] - requested)) nearest = index;
  }
  return nearest;
}

function heightToNormalized(levels, requested) {
  if (levels.length < 2) return 0.5;
  if (requested <= levels[0]) return 0;
  if (requested >= levels.at(-1)) return 1;
  for (let index = 1; index < levels.length; index++) {
    if (requested <= levels[index]) {
      const interval = Math.max(levels[index] - levels[index - 1], 0.000001);
      return (index - 1 + (requested - levels[index - 1]) / interval) / (levels.length - 1);
    }
  }
  return 1;
}

export function resolveVerticalSelection(windData, options = {}) {
  const levels = windData.levels?.length ? windData.levels : [0, 1];
  const dataMin = levels[0];
  const dataMax = levels[levels.length - 1];
  const mode = options.verticalMode ?? "all";

  if (mode === "fixed") {
    const height = Number.isFinite(options.fixedHeight) ? options.fixedHeight : dataMin;
    return {
      mode,
      fixed: true,
      displayHeight: height,
      normalizedHeight: 0.5,
      normalizedRange: new Cartesian2(0.5, 0.5),
      heightRange: { min: height, max: height },
    };
  }

  if (mode === "level") {
    const levelIndex = nearestLevelIndex(levels, Number(options.selectedLevel ?? levels[0]));
    const height = levels[levelIndex];
    const normalizedHeight = levels.length > 1 ? levelIndex / (levels.length - 1) : 0.5;
    return {
      mode,
      fixed: true,
      displayHeight: height,
      normalizedHeight,
      normalizedRange: new Cartesian2(normalizedHeight, normalizedHeight),
      heightRange: { min: height, max: height },
    };
  }

  const requested = mode === "range" ? options.heightRange : undefined;
  const min = clamp(Number(requested?.min ?? dataMin), dataMin, dataMax);
  const max = clamp(Number(requested?.max ?? dataMax), min, dataMax);
  return {
    mode,
    fixed: false,
    displayHeight: min,
    normalizedHeight: heightToNormalized(levels, min),
    normalizedRange: new Cartesian2(heightToNormalized(levels, min), heightToNormalized(levels, max)),
    heightRange: { min, max },
  };
}

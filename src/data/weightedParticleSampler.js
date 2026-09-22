/**
 * 基于风速权重生成初始粒子位置。
 * 在粒子总数不变的前提下，让更多粒子落在高速网格附近，同时保留低速区域的最低覆盖率。
 */
import { resolveVerticalSelection } from "../core/verticalSelection.js";

function normalizeSpeed(speed, min, max) {
  if (!Number.isFinite(speed) || max <= min) return 0;
  return Math.min(1, Math.max(0, (speed - min) / (max - min)));
}

export function createSpeedWeights(speedData, options = {}) {
  const floor = Math.min(1, Math.max(0, options.densityFloor ?? 0.15));
  const exponent = Math.max(0.01, options.densityExponent ?? 1.5);
  const cumulative = new Float64Array(speedData.array.length);
  let total = 0;
  for (let index = 0; index < speedData.array.length; index++) {
    const normalized = normalizeSpeed(speedData.array[index], speedData.min, speedData.max);
    total += floor + (1 - floor) * normalized ** exponent;
    cumulative[index] = total;
  }
  return { cumulative, total };
}

function sampleCumulative(cumulative, total, random) {
  const target = random() * total;
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cumulative[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function createParticlePositionData(windData, particleCount, options = {}, random = Math.random) {
  const { nx, ny, nz, bounds, speed } = windData;
  const data = new Float32Array(particleCount * 4);
  const weighted = options.densityBySpeed !== false && speed?.array?.length === nx * ny * nz;
  const weights = weighted ? createSpeedWeights(speed, options) : undefined;
  const lonStep = nx > 1 ? (bounds.east - bounds.west) / (nx - 1) : 0;
  const latStep = ny > 1 ? (bounds.north - bounds.south) / (ny - 1) : 0;
  const vertical = resolveVerticalSelection(windData, options);

  for (let particle = 0; particle < particleCount; particle++) {
    const flatIndex = weighted
      ? sampleCumulative(weights.cumulative, weights.total, random)
      : Math.min(nx * ny * nz - 1, Math.floor(random() * nx * ny * nz));
    const x = flatIndex % nx;
    const y = Math.floor(flatIndex / nx) % ny;
    const z = Math.floor(flatIndex / (nx * ny));
    const jitterX = (random() - 0.5) * lonStep;
    const jitterY = (random() - 0.5) * latStep;
    const jitterZ = nz > 1 ? (random() - 0.5) / (nz - 1) : 0;
    data[particle * 4] = Math.min(bounds.east, Math.max(bounds.west, bounds.west + x * lonStep + jitterX));
    data[particle * 4 + 1] = Math.min(bounds.north, Math.max(bounds.south, bounds.south + y * latStep + jitterY));
    const sampledZ = (nz > 1 ? z / (nz - 1) : 0.5) + jitterZ;
    data[particle * 4 + 2] = vertical.fixed
      ? vertical.normalizedHeight
      : Math.min(vertical.normalizedRange.y, Math.max(vertical.normalizedRange.x, sampledZ));
    data[particle * 4 + 3] = 1;
  }
  return data;
}

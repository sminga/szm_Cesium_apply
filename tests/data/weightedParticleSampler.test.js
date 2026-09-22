import { describe, expect, it } from "vitest";
import { createParticlePositionData, createSpeedWeights } from "../../src/data/weightedParticleSampler.js";

function seededRandom() {
  let state = 1;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe("speed weighted particles", () => {
  it("高速格点拥有更高权重", () => {
    const weights = createSpeedWeights(
      { array: new Float32Array([0, 5, 10]), min: 0, max: 10 },
      { densityFloor: 0.1, densityExponent: 1 },
    );
    expect(Array.from(weights.cumulative)).toEqual([0.1, 0.65, 1.65]);
  });

  it("速度加权播种把更多粒子分配给高速区域", () => {
    const data = createParticlePositionData({
      nx: 2, ny: 1, nz: 1,
      bounds: { west: 0, east: 1, south: 0, north: 0 },
      speed: { array: new Float32Array([0, 10]), min: 0, max: 10 },
    }, 1000, { densityBySpeed: true, densityFloor: 0.05, densityExponent: 1 }, seededRandom());
    let highSpeedParticles = 0;
    for (let index = 0; index < 1000; index++) {
      if (data[index * 4] > 0.5) highSpeedParticles++;
    }
    expect(highSpeedParticles).toBeGreaterThan(850);
  });
});

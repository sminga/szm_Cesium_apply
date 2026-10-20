import { describe, expect, it } from "vitest";
import { renderParticlesVertexShader } from "../../src/shaders/segmentDraw.js";

describe("segmentDraw screen-space length limiting", () => {
  it("近景使用目标像素长度，远景平滑回落到真实投影长度", () => {
    expect(renderParticlesVertexShader).toContain("resolveSegmentEndpoint");
    expect(renderParticlesVertexShader).toContain("float actualPixelLength");
    expect(renderParticlesVertexShader).toContain("smoothstep(1500000.0, 5000000.0, cameraHeight)");
    expect(renderParticlesVertexShader).toContain("mix(actualPixelLength, max(pixelTarget, 0.0), extensionWeight)");
    expect(renderParticlesVertexShader).toContain("float scale = targetPixelLength");
    expect(renderParticlesVertexShader).toContain("mix(pointA_NDC, pointB_NDC, scale)");
    expect(renderParticlesVertexShader).not.toContain("min(1.0, max(pixelLimit");
  });

  it("保留零长度和零速度范围保护", () => {
    expect(renderParticlesVertexShader).toContain("if (deltaLength < 0.000001) return pointA");
    expect(renderParticlesVertexShader).toContain("max(domain.y - domain.x, 0.000001)");
  });
});

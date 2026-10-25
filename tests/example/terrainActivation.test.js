import { describe, expect, it, vi } from "vitest";
import { createTerrainActivationRunner } from "../../example/app/layers/terrainActivation.js";

function createHarness() {
  const entries = new Map([
    ["terrain:ellipsoid", { id: "terrain:ellipsoid", group: "terrain", active: true }],
    ["terrain:world", { id: "terrain:world", group: "terrain", active: false }],
  ]);
  const registry = {
    has: (id) => entries.has(id),
    update: vi.fn((id, patch) => Object.assign(entries.get(id), patch)),
    setExclusiveActive: vi.fn((group, id) => {
      for (const entry of entries.values()) if (entry.group === group) entry.active = entry.id === id;
    }),
  };
  let activeId = "terrain:ellipsoid";
  const run = createTerrainActivationRunner({
    registry,
    getActiveId: () => activeId,
    setActiveId: (id) => { activeId = id; },
    releasePrevious: vi.fn(async () => {}),
  });
  return { entries, registry, run, getActiveId: () => activeId };
}

describe("createTerrainActivationRunner", () => {
  it("保留原活动地形并将失败状态标记在目标源上", async () => {
    const harness = createHarness();
    const result = await harness.run("terrain:world", async () => ({
      applied: false,
      error: new Error("网络不可用"),
    }));

    expect(result.applied).toBe(false);
    expect(harness.getActiveId()).toBe("terrain:ellipsoid");
    expect(harness.entries.get("terrain:world").status).toBe("failed");
    expect(harness.entries.get("terrain:ellipsoid").active).toBe(true);
  });

  it("忽略晚到请求，只有最新成功的地形能够成为活动源", async () => {
    const harness = createHarness();
    let finishOld;
    const oldRequest = harness.run("terrain:world", () => new Promise((resolve) => { finishOld = resolve; }));
    const latestRequest = await harness.run("terrain:ellipsoid", async () => ({ applied: true }));
    finishOld({ applied: true });
    const staleResult = await oldRequest;

    expect(latestRequest.applied).toBe(true);
    expect(staleResult.applied).toBe(true);
    expect(harness.getActiveId()).toBe("terrain:ellipsoid");
    expect(harness.entries.get("terrain:ellipsoid").active).toBe(true);
    expect(harness.entries.get("terrain:world").active).toBe(false);
  });

  it("捕获 loader 抛错并保留可供用户重试的失败条目", async () => {
    const harness = createHarness();
    await expect(harness.run("terrain:world", async () => { throw new Error("Provider 初始化失败"); }))
      .resolves.toMatchObject({ applied: false, error: expect.any(Error) });
    expect(harness.entries.get("terrain:world")).toMatchObject({ status: "failed", detail: "Provider 初始化失败" });
  });

  it("Provider 已切换但旧会话清理失败时保留成功状态并显示警告", async () => {
    const harness = createHarness();
    const runner = createTerrainActivationRunner({
      registry: harness.registry,
      getActiveId: harness.getActiveId,
      setActiveId: (id) => { harness.entries.get(id).active = true; },
      releasePrevious: async () => { throw new Error("Worker dispose failed"); },
    });

    const result = await runner("terrain:world", async () => ({ applied: true }));
    expect(result.cleanupError).toBeInstanceOf(Error);
    expect(harness.entries.get("terrain:world")).toMatchObject({
      status: "ready",
      detail: "地形已切换，旧会话清理失败：Worker dispose failed",
    });
  });
});

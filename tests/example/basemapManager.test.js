import { describe, expect, it, vi } from "vitest";
import { BasemapManager } from "../../example/app/basemaps/BasemapManager.js";

function createHarness(initialLayers = []) {
  const layers = initialLayers.slice();
  const imageryLayers = {
    addImageryProvider: vi.fn((provider, index) => {
      const layer = { provider, show: true, alpha: 1 };
      layers.splice(index, 0, layer);
      return layer;
    }),
    contains: (layer) => layers.includes(layer),
    remove: vi.fn((layer) => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      return index >= 0;
    }),
  };
  return { layers, viewer: { imageryLayers }, imageryLayers };
}

function result(providerId, roles = ["base"]) {
  return {
    definition: { id: providerId, name: providerId },
    style: { id: "default", name: "default" },
    descriptors: roles.map((role) => ({ role, provider: { id: `${providerId}:${role}` } })),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("BasemapManager", () => {
  it("把复合底图按基础层到注记层的顺序插入影像栈底部，并保留专题叠加层", async () => {
    const overlay = { id: "sentinel-overlay" };
    const harness = createHarness([overlay]);
    const manager = new BasemapManager(harness.viewer, async () => result("tianditu", ["base", "boundaries", "labels"]));

    const applied = await manager.set({ providerId: "tianditu", styleId: "imagery" });

    expect(applied.applied).toBe(true);
    expect(harness.layers.map((layer) => layer.__basemapRole ?? layer.id)).toEqual([
      "base",
      "boundaries",
      "labels",
      "sentinel-overlay",
    ]);
  });

  it("新底图创建失败时保留原底图", async () => {
    const harness = createHarness();
    const factory = vi.fn()
      .mockResolvedValueOnce(result("osm"))
      .mockRejectedValueOnce(new Error("瓦片服务不可用"));
    const manager = new BasemapManager(harness.viewer, factory);
    await manager.set({ providerId: "osm" });
    const previous = harness.layers[0];

    await expect(manager.set({ providerId: "broken" })).rejects.toThrow("瓦片服务不可用");
    expect(harness.layers).toEqual([previous]);
    expect(harness.imageryLayers.remove).not.toHaveBeenCalledWith(previous, true);
  });

  it("忽略晚于新请求完成的旧底图结果", async () => {
    const first = deferred();
    const second = deferred();
    const harness = createHarness();
    const manager = new BasemapManager(harness.viewer, (selection) => (
      selection.providerId === "first" ? first.promise : second.promise
    ));

    const oldRequest = manager.set({ providerId: "first" });
    const newRequest = manager.set({ providerId: "second" });
    second.resolve(result("second"));
    await expect(newRequest).resolves.toMatchObject({ applied: true });
    first.resolve(result("first"));
    await expect(oldRequest).resolves.toEqual({ applied: false, stale: true });
    expect(harness.layers[0].provider.id).toBe("second:base");
  });

  it("统一控制复合底图显隐与透明度，并在销毁时释放全部图层", async () => {
    const harness = createHarness();
    const manager = new BasemapManager(harness.viewer, async () => result("tianditu", ["base", "labels"]));
    await manager.set({ providerId: "tianditu" });

    manager.setVisible(false);
    manager.setOpacity(0.35);
    expect(harness.layers.every((layer) => layer.show === false && layer.alpha === 0.35)).toBe(true);

    manager.destroy();
    expect(harness.layers).toEqual([]);
    await expect(manager.set({ providerId: "osm" })).rejects.toThrow("BasemapManager 已销毁");
  });
});

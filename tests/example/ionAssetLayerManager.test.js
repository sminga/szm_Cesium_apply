import { describe, expect, it, vi } from "vitest";
import { IonAssetLayerManager } from "../../example/app/ionAssetLayerManager.js";

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function createHarness() {
  const imagery = [];
  const primitives = [];
  const imageryLayers = {
    addImageryProvider: vi.fn((provider) => {
      const layer = { provider, show: true };
      imagery.push(layer);
      return layer;
    }),
    contains: (layer) => imagery.includes(layer),
    remove: vi.fn((layer) => {
      const index = imagery.indexOf(layer);
      if (index >= 0) imagery.splice(index, 1);
      return index >= 0;
    }),
  };
  const primitiveCollection = {
    add: vi.fn((primitive) => {
      primitives.push(primitive);
      return primitive;
    }),
    contains: (primitive) => primitives.includes(primitive),
    remove: vi.fn((primitive) => {
      const index = primitives.indexOf(primitive);
      if (index >= 0) primitives.splice(index, 1);
      if (index >= 0) primitive.destroy?.();
      return index >= 0;
    }),
  };
  const Cesium = {
    IonImageryProvider: { fromAssetId: vi.fn(async (assetId) => ({ assetId })) },
    Cesium3DTileset: { fromIonAssetId: vi.fn(async () => ({ destroy: vi.fn(), isDestroyed: () => false })) },
  };
  return {
    Cesium,
    imagery,
    primitives,
    viewer: { imageryLayers, scene: { primitives: primitiveCollection } },
  };
}

describe("IonAssetLayerManager", () => {
  it("adds and removes an ion imagery layer", async () => {
    const harness = createHarness();
    const manager = new IonAssetLayerManager(harness.viewer, harness.Cesium, { accessTokenAvailable: true });

    await manager.setImageryAsset(3954, true);
    expect(harness.imagery).toHaveLength(1);
    expect(manager.imageryCount).toBe(1);

    await manager.setImageryAsset(3954, false);
    expect(harness.imagery).toHaveLength(0);
    expect(manager.imageryCount).toBe(0);
  });

  it("does not add imagery after the user cancels an in-flight request", async () => {
    const harness = createHarness();
    const pending = deferred();
    harness.Cesium.IonImageryProvider.fromAssetId.mockReturnValueOnce(pending.promise);
    const manager = new IonAssetLayerManager(harness.viewer, harness.Cesium, { accessTokenAvailable: true });

    const enabling = manager.setImageryAsset(3812, true);
    await manager.setImageryAsset(3812, false);
    pending.resolve({ assetId: 3812 });

    await expect(enabling).resolves.toMatchObject({ stale: true });
    expect(harness.imagery).toHaveLength(0);
  });

  it("ignores a late imagery error after the switch has already been turned off", async () => {
    const harness = createHarness();
    let rejectRequest;
    const pending = new Promise((resolve, reject) => { rejectRequest = reject; });
    harness.Cesium.IonImageryProvider.fromAssetId.mockReturnValueOnce(pending);
    const manager = new IonAssetLayerManager(harness.viewer, harness.Cesium, { accessTokenAvailable: true });

    const enabling = manager.setImageryAsset(3830182, true);
    await manager.setImageryAsset(3830182, false);
    rejectRequest(new Error("network failed"));

    await expect(enabling).resolves.toMatchObject({ stale: true });
    expect(harness.imagery).toHaveLength(0);
  });

  it("destroys a stale 3D Tiles result instead of inserting it", async () => {
    const harness = createHarness();
    const pending = deferred();
    const tileset = { destroy: vi.fn(), isDestroyed: () => false };
    harness.Cesium.Cesium3DTileset.fromIonAssetId.mockReturnValueOnce(pending.promise);
    const manager = new IonAssetLayerManager(harness.viewer, harness.Cesium, { accessTokenAvailable: true });

    const enabling = manager.setTilesetAsset(2275207, true);
    await manager.setTilesetAsset(2275207, false);
    pending.resolve(tileset);

    await expect(enabling).resolves.toMatchObject({ stale: true });
    expect(harness.primitives).toHaveLength(0);
    expect(tileset.destroy).toHaveBeenCalledOnce();
  });

  it("rejects ion requests when the public browser token is unavailable", async () => {
    const harness = createHarness();
    const manager = new IonAssetLayerManager(harness.viewer, harness.Cesium);

    await expect(manager.setImageryAsset(2, true)).rejects.toThrow("VITE_CESIUM_ION_TOKEN");
    await expect(manager.setTilesetAsset(96188, true)).rejects.toThrow("VITE_CESIUM_ION_TOKEN");
  });
});

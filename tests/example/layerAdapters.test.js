import { describe, expect, it, vi } from "vitest";
import { SceneLayerRegistry } from "../../example/app/layers/SceneLayerRegistry.js";
import {
  ionImageryLayerDefinition,
  synchronizeImageryOrder,
} from "../../example/app/layers/layerAdapters.js";

describe("layerAdapters", () => {
  it("把列表从上到下的影像顺序映射到 Cesium 从下到上的索引", () => {
    const raised = [];
    const layers = { a: {}, b: {}, c: {} };
    const registry = {
      get: (id) => ({ metadata: { cesiumLayer: layers[id] } }),
    };
    const viewer = {
      imageryLayers: {
        contains: () => true,
        raiseToTop: (layer) => raised.push(layer),
      },
    };
    synchronizeImageryOrder(viewer, registry, ["a", "b", "c"]);
    expect(raised).toEqual([layers.c, layers.b, layers.a]);
  });

  it("影像隐藏不会移除资源，而移除会同步底层管理器", async () => {
    const layer = { show: true, alpha: 1 };
    const manager = { setImageryAsset: vi.fn(async () => ({ applied: true })) };
    const viewer = { imageryLayers: { contains: () => true, raiseToTop: vi.fn() } };
    const registry = new SceneLayerRegistry();
    registry.register(ionImageryLayerDefinition({
      assetId: 3954,
      name: "Sentinel-2",
      layer,
      manager,
      viewer,
      registry,
    }));
    await registry.perform("ion-imagery:3954", "setVisible", false);
    expect(layer.show).toBe(false);
    expect(manager.setImageryAsset).not.toHaveBeenCalled();
    await registry.perform("ion-imagery:3954", "remove");
    expect(manager.setImageryAsset).toHaveBeenCalledWith(3954, false);
  });
});

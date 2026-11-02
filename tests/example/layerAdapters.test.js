import { describe, expect, it, vi } from "vitest";
import { SceneLayerRegistry } from "../../example/app/layers/SceneLayerRegistry.js";
import {
  basemapLayerDefinition,
  ionImageryLayerDefinition,
  synchronizeImageryOrder,
} from "../../example/app/layers/layerAdapters.js";

describe("layerAdapters", () => {
  it("把复合底图登记为一个逻辑条目并统一控制全部内部图层", async () => {
    const layers = [{ show: true, alpha: 1 }, { show: true, alpha: 1 }];
    const manager = {
      setVisible: vi.fn((visible) => layers.forEach((layer) => { layer.show = visible; })),
      setOpacity: vi.fn((opacity) => layers.forEach((layer) => { layer.alpha = opacity; })),
    };
    const registry = new SceneLayerRegistry();
    registry.register(basemapLayerDefinition({
      mode: "tianditu",
      name: "天地图 · 影像",
      layers,
      manager,
      source: "国家地理信息公共服务平台",
      coordinateSystem: "CGCS2000",
    }));

    await registry.perform("basemap:current", "setVisible", false);
    await registry.perform("basemap:current", "setOpacity", 0.4);
    expect(manager.setVisible).toHaveBeenCalledWith(false);
    expect(manager.setOpacity).toHaveBeenCalledWith(0.4);
    expect(registry.get("basemap:current").metadata).toEqual({
      coordinateSystem: "CGCS2000",
      layerCount: 2,
    });
  });

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

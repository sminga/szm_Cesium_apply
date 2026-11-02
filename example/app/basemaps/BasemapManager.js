/**
 * 管理“一个逻辑底图对应多个 Cesium ImageryLayer”的生命周期。
 * 新底图全部创建并加入成功后才移除旧底图；创建失败或被更新请求淘汰时，旧底图继续显示。
 */
export class BasemapManager {
  constructor(viewer, createProviders) {
    if (!viewer?.imageryLayers) throw new TypeError("BasemapManager 需要 Cesium Viewer");
    if (typeof createProviders !== "function") throw new TypeError("BasemapManager 需要 Provider 工厂");
    this.viewer = viewer;
    this.createProviders = createProviders;
    this.layers = [];
    this.current = null;
    this.requestId = 0;
    this.destroyed = false;
  }

  async set(selection) {
    this.assertActive();
    const requestId = ++this.requestId;
    let result;
    try {
      result = await this.createProviders(selection);
    } catch (error) {
      // 用户快速切换时，较早请求即使失败也不能覆盖最新请求的状态提示。
      if (requestId !== this.requestId || this.destroyed) return { applied: false, stale: true };
      throw error;
    }
    if (requestId !== this.requestId || this.destroyed) return { applied: false, stale: true };

    const nextLayers = [];
    try {
      for (const descriptor of result.descriptors) {
        // 依次插入 0、1、2...，使基础图层位于最底部，注记层位于复合底图最上方，
        // 同时仍保持在 Sentinel-2 等独立影像叠加层的下方。
        const layer = this.viewer.imageryLayers.addImageryProvider(descriptor.provider, nextLayers.length);
        layer.__basemapRole = descriptor.role;
        nextLayers.push(layer);
      }
    } catch (error) {
      this.removeLayers(nextLayers);
      throw error;
    }

    const previousLayers = this.layers;
    this.layers = nextLayers;
    this.current = { selection: { ...selection }, definition: result.definition, style: result.style };
    this.removeLayers(previousLayers);
    return { applied: true, layers: this.layers.slice(), current: this.getCurrent() };
  }

  getCurrent() {
    if (!this.current) return null;
    return {
      selection: { ...this.current.selection },
      definition: this.current.definition,
      style: this.current.style,
      layers: this.layers.slice(),
    };
  }

  setVisible(visible) {
    this.layers.forEach((layer) => { layer.show = Boolean(visible); });
  }

  setOpacity(opacity) {
    const normalized = Math.max(0, Math.min(1, Number(opacity)));
    this.layers.forEach((layer) => { layer.alpha = normalized; });
  }

  destroy() {
    if (this.destroyed) return;
    this.requestId += 1;
    this.removeLayers(this.layers);
    this.layers = [];
    this.current = null;
    this.destroyed = true;
  }

  removeLayers(layers) {
    for (const layer of layers) {
      if (this.viewer.imageryLayers.contains(layer)) this.viewer.imageryLayers.remove(layer, true);
    }
  }

  assertActive() {
    if (this.destroyed) throw new Error("BasemapManager 已销毁");
  }
}

export default BasemapManager;

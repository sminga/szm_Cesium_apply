/**
 * 管理通过 Cesium ion 按需加载的公共影像和 3D Tiles。
 *
 * 该管理器不读取 DOM，也不持有 Token 内容；调用方只需告知当前部署是否已经
 * 配置可公开到浏览器的 ion Token。这样可以在 Vercel 静态站点中复用同一套
 * 生命周期逻辑，并在单元测试里用轻量 viewer 替身验证异步竞态和资源释放。
 */
export class IonAssetLayerManager {
  constructor(viewer, Cesium, { accessTokenAvailable = false } = {}) {
    this.viewer = viewer;
    this.Cesium = Cesium;
    this.accessTokenAvailable = accessTokenAvailable;
    this.imageryLayers = new Map();
    this.tilesets = new Map();
    this.requestVersions = new Map();
    this.destroyed = false;
  }

  _assertAvailable() {
    if (this.destroyed) throw new Error("Cesium ion 资产管理器已释放");
    if (!this.accessTokenAvailable) throw new Error("未配置 VITE_CESIUM_ION_TOKEN");
  }

  _nextRequestVersion(key) {
    const version = (this.requestVersions.get(key) ?? 0) + 1;
    this.requestVersions.set(key, version);
    return version;
  }

  _isCurrentRequest(key, version) {
    return !this.destroyed && this.requestVersions.get(key) === version;
  }

  /**
   * 打开或关闭一个 ion 影像资产。
   *
   * 影像加载完成前用户可能再次关闭开关，因此每个资产都有独立请求版本号。
   * 过期请求只返回 stale，不会把已经取消的图层重新插入 Cesium 场景。
   */
  async setImageryAsset(assetId, enabled) {
    const key = `imagery:${assetId}`;
    const version = this._nextRequestVersion(key);
    const currentLayer = this.imageryLayers.get(assetId);

    if (!enabled) {
      if (currentLayer && this.viewer.imageryLayers.contains(currentLayer)) {
        this.viewer.imageryLayers.remove(currentLayer, true);
      }
      this.imageryLayers.delete(assetId);
      return { applied: true, enabled: false };
    }

    this._assertAvailable();
    if (currentLayer && this.viewer.imageryLayers.contains(currentLayer)) {
      currentLayer.show = true;
      return { applied: true, enabled: true, layer: currentLayer };
    }

    let provider;
    try {
      provider = await this.Cesium.IonImageryProvider.fromAssetId(assetId);
    } catch (error) {
      // 若用户已关闭开关，晚到的网络错误属于被取消请求，不应覆盖“已关闭”的页面状态。
      if (!this._isCurrentRequest(key, version)) {
        return { applied: false, enabled: false, stale: true };
      }
      throw error;
    }
    if (!this._isCurrentRequest(key, version)) {
      return { applied: false, enabled: false, stale: true };
    }

    const layer = this.viewer.imageryLayers.addImageryProvider(provider);
    this.imageryLayers.set(assetId, layer);
    return { applied: true, enabled: true, layer };
  }

  /**
   * 打开或关闭一个 ion 3D Tiles 资产。
   *
   * 关闭时直接从 PrimitiveCollection 移除并销毁资源，避免高分辨率城市模型在
   * 开关关闭后继续占用 GPU/内存。异步加载若已过期，也会主动销毁刚创建的 tileset。
   */
  async setTilesetAsset(assetId, enabled, options = {}) {
    const key = `tileset:${assetId}`;
    const version = this._nextRequestVersion(key);
    const currentTileset = this.tilesets.get(assetId);

    if (!enabled) {
      if (currentTileset && this.viewer.scene.primitives.contains(currentTileset)) {
        this.viewer.scene.primitives.remove(currentTileset);
      } else if (currentTileset && !currentTileset.isDestroyed?.()) {
        currentTileset.destroy?.();
      }
      this.tilesets.delete(assetId);
      return { applied: true, enabled: false };
    }

    this._assertAvailable();
    if (currentTileset && this.viewer.scene.primitives.contains(currentTileset)) {
      currentTileset.show = true;
      return { applied: true, enabled: true, tileset: currentTileset };
    }

    let tileset;
    try {
      tileset = await this.Cesium.Cesium3DTileset.fromIonAssetId(assetId, options);
    } catch (error) {
      if (!this._isCurrentRequest(key, version)) {
        return { applied: false, enabled: false, stale: true };
      }
      throw error;
    }
    if (!this._isCurrentRequest(key, version)) {
      if (!tileset.isDestroyed?.()) tileset.destroy?.();
      return { applied: false, enabled: false, stale: true };
    }

    this.viewer.scene.primitives.add(tileset);
    this.tilesets.set(assetId, tileset);
    return { applied: true, enabled: true, tileset };
  }

  get imageryCount() {
    return this.imageryLayers.size;
  }

  get tilesetCount() {
    return this.tilesets.size;
  }

  /** 释放仍在场景中的 ion 资源，并让尚未完成的请求自动失效。 */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.requestVersions.clear();

    for (const layer of this.imageryLayers.values()) {
      if (this.viewer.imageryLayers.contains(layer)) this.viewer.imageryLayers.remove(layer, true);
    }
    for (const tileset of this.tilesets.values()) {
      if (this.viewer.scene.primitives.contains(tileset)) this.viewer.scene.primitives.remove(tileset);
      else if (!tileset.isDestroyed?.()) tileset.destroy?.();
    }
    this.imageryLayers.clear();
    this.tilesets.clear();
  }
}

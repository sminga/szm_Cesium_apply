import {
  EllipsoidTerrainProvider,
  Rectangle,
  createWorldTerrainAsync,
} from "cesium";
import { createLocalTerrainProvider } from "./createLocalTerrainProvider.js";

function normalizeBounds(bounds) {
  if (!bounds) return undefined;
  const values = Array.isArray(bounds)
    ? bounds
    : [bounds.west, bounds.south, bounds.east, bounds.north];
  if (values.length !== 4 || !values.every(Number.isFinite)) return undefined;
  const [west, south, east, north] = values;
  if (west >= east || south >= north) return undefined;
  return { west, south, east, north };
}

function errorMessage(error) {
  return error?.message || String(error || "未知地形错误");
}

/**
 * Coordinates terrain switching so stale asynchronous requests cannot replace
 * the most recently selected terrain.
 */
export class TerrainController {
  constructor(viewer, options = {}) {
    if (!viewer?.scene?.globe) throw new Error("TerrainController 需要有效的 Cesium Viewer");
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.ellipsoidTerrainProvider = options.ellipsoidTerrainProvider
      ?? new EllipsoidTerrainProvider();
    this.createWorldTerrain = options.createWorldTerrain
      ?? ((terrainOptions) => createWorldTerrainAsync(terrainOptions));
    this.createLocalTerrain = options.createLocalTerrain
      ?? ((url, terrainOptions) => createLocalTerrainProvider(url, terrainOptions));
    this.requestId = 0;
    this.removeProviderErrorListener = undefined;
    this.listeners = new Set();
    this.destroyed = false;
    this.state = {
      status: "ready",
      type: "ellipsoid",
      name: "椭球地形",
      url: undefined,
      bounds: undefined,
      requestedType: undefined,
      requestedName: undefined,
      pendingTiles: 0,
      tileErrorCount: 0,
      warning: undefined,
      error: undefined,
    };
    this.activeState = this.state;

    this.removeTileProgressListener = this.scene.globe.tileLoadProgressEvent
      ?.addEventListener((pendingTiles) => this.handleTileProgress(pendingTiles));
    if (options.onStateChange) this.subscribe(options.onStateChange);
  }

  getState() {
    return { ...this.state, bounds: this.state.bounds && { ...this.state.bounds } };
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("地形状态监听器必须是函数");
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async loadWorld(options = {}) {
    return this.loadTerrain({
      type: "world",
      name: options.name ?? "Cesium World Terrain",
      bounds: options.bounds,
      createProvider: () => this.createWorldTerrain({
        requestVertexNormals: options.requestVertexNormals ?? false,
        requestWaterMask: options.requestWaterMask ?? false,
      }),
    });
  }

  async loadLocal(terrain, options = {}) {
    const entry = typeof terrain === "string" ? { url: terrain } : terrain;
    if (!entry?.url) throw new Error("缺少本地地形 URL");
    return this.loadTerrain({
      type: "local",
      name: entry.name ?? "本地地形",
      url: entry.url,
      bounds: entry.bounds,
      createProvider: () => this.createLocalTerrain(entry.url, options),
    });
  }

  useEllipsoid() {
    this.assertActive();
    this.requestId += 1;
    this.detachProviderErrorListener();
    this.scene.terrainProvider = this.ellipsoidTerrainProvider;
    this.state = {
      status: "ready",
      type: "ellipsoid",
      name: "椭球地形",
      url: undefined,
      bounds: undefined,
      requestedType: undefined,
      requestedName: undefined,
      pendingTiles: 0,
      tileErrorCount: 0,
      warning: undefined,
      error: undefined,
    };
    this.activeState = this.state;
    this.emit();
    return this.getState();
  }

  flyToCurrentTerrain(options = {}) {
    this.assertActive();
    const bounds = normalizeBounds(this.state.bounds);
    if (!bounds || !this.viewer.camera?.flyTo) return false;
    this.viewer.camera.flyTo({
      destination: Rectangle.fromDegrees(
        bounds.west,
        bounds.south,
        bounds.east,
        bounds.north,
      ),
      duration: options.duration ?? 1.5,
    });
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.requestId += 1;
    this.detachProviderErrorListener();
    this.removeTileProgressListener?.();
    this.listeners.clear();
    this.destroyed = true;
  }

  async loadTerrain(request) {
    this.assertActive();
    const requestId = ++this.requestId;
    const previousState = this.activeState;
    this.state = {
      ...previousState,
      status: "loading",
      requestedType: request.type,
      requestedName: request.name,
      warning: undefined,
      error: undefined,
    };
    this.emit();

    try {
      const provider = await request.createProvider();
      if (requestId !== this.requestId || this.destroyed) {
        return { applied: false, reason: "superseded", provider };
      }

      this.detachProviderErrorListener();
      this.scene.terrainProvider = provider;
      this.attachProviderErrorListener(provider);
      this.state = {
        status: "ready",
        type: request.type,
        name: request.name,
        url: request.url,
        bounds: normalizeBounds(request.bounds),
        requestedType: undefined,
        requestedName: undefined,
        pendingTiles: 0,
        tileErrorCount: 0,
        warning: undefined,
        error: undefined,
      };
      this.activeState = this.state;
      this.emit();
      return { applied: true, provider, state: this.getState() };
    } catch (error) {
      if (requestId !== this.requestId || this.destroyed) {
        return { applied: false, reason: "superseded", error };
      }
      this.state = {
        ...previousState,
        status: "error",
        requestedType: request.type,
        requestedName: request.name,
        error,
      };
      this.emit();
      return { applied: false, reason: "error", error, state: this.getState() };
    }
  }

  attachProviderErrorListener(provider) {
    if (!provider?.errorEvent?.addEventListener) return;
    this.removeProviderErrorListener = provider.errorEvent.addEventListener((error) => {
      if (this.destroyed || this.scene.terrainProvider !== provider) return;
      const count = this.state.tileErrorCount + 1;
      this.state = {
        ...this.state,
        tileErrorCount: count,
        warning: `地形瓦片加载异常（${count}）：${errorMessage(error)}`,
      };
      if (this.state.status === "ready") this.activeState = this.state;
      this.emit();
    });
  }

  detachProviderErrorListener() {
    this.removeProviderErrorListener?.();
    this.removeProviderErrorListener = undefined;
  }

  handleTileProgress(pendingTiles) {
    if (this.destroyed || this.state.type === "ellipsoid") return;
    const normalized = Math.max(0, Number(pendingTiles) || 0);
    if (normalized === this.state.pendingTiles) return;
    this.state = { ...this.state, pendingTiles: normalized };
    if (this.state.status === "ready") this.activeState = this.state;
    this.emit();
  }

  assertActive() {
    if (this.destroyed) throw new Error("TerrainController 已销毁");
  }

  emit() {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}


import {
  Event,
  GeographicTilingScheme,
  HeightmapTerrainData,
  TerrainProvider,
} from "cesium";
import {
  childTileMask,
  DEM_TILE_SIZE,
  OUTSIDE_DEM_MAX_LEVEL,
  tileAvailable,
} from "./demRasterMath.js";

let sessionSequence = 0;

function abortError() {
  return new DOMException("DEM 处理已取消", "AbortError");
}

class DemWorkerClient {
  constructor(options = {}) {
    this.worker = options.workerFactory?.()
      ?? new Worker(new URL("./browserDemTerrain.worker.js", import.meta.url), { type: "module" });
    this.onStatus = options.onStatus;
    this.sequence = 0;
    this.pending = new Map();
    this.disposed = false;
    this.worker.addEventListener("message", (event) => this.handleMessage(event.data || {}));
    this.worker.addEventListener("error", (event) => {
      this.failAll(new Error(event.message || "浏览器 DEM Worker 运行失败"));
    });
  }

  handleMessage(message) {
    if (message.type === "status") {
      this.onStatus?.(message.stage, message.detail);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.type === "error") pending.reject(new Error(message.message || "DEM Worker 处理失败"));
    else pending.resolve(message.value);
  }

  request(type, payload = {}) {
    if (this.disposed) return Promise.reject(abortError());
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ type, requestId, ...payload });
    });
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  dispose(reason = abortError()) {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(reason);
    try { this.worker.postMessage({ type: "dispose" }); } catch { /* Worker 可能已经退出。 */ }
    this.worker.terminate();
  }
}

/**
 * 使用公开 Cesium TerrainProvider 接口，把本地 GeoTIFF 按请求实时采样为 heightmap。
 * 低层级的 DEM 外部区域返回 0 米椭球高度，高层级则通过 childTileMask 停止细分，
 * 既保持全球场景可见，也避免用户移到数据区外时无休止生成空瓦片。
 */
export class BrowserDemTerrainProvider {
  constructor(client, metadata) {
    this.client = client;
    this.metadata = metadata;
    this.tilingScheme = new GeographicTilingScheme();
    this.errorEvent = new Event();
    this.credit = undefined;
    this.hasWaterMask = false;
    this.hasVertexNormals = false;
    this.availability = undefined;
    this.levelZeroMaximumGeometricError = TerrainProvider
      .getEstimatedLevelZeroGeometricErrorForAHeightmap(
        this.tilingScheme.ellipsoid,
        DEM_TILE_SIZE,
        this.tilingScheme.getNumberOfXTilesAtLevel(0),
      );
  }

  getLevelMaximumGeometricError(level) {
    return this.levelZeroMaximumGeometricError / (1 << level);
  }

  getTileDataAvailable(x, y, level) {
    return tileAvailable(
      x,
      y,
      level,
      this.metadata.bounds,
      this.metadata.maxLevel,
      OUTSIDE_DEM_MAX_LEVEL,
    );
  }

  loadTileDataAvailability() {
    return undefined;
  }

  requestTileGeometry(x, y, level) {
    if (!this.getTileDataAvailable(x, y, level)) return undefined;
    return this.client.request("tile", { x, y, level })
      .then((heights) => new HeightmapTerrainData({
        buffer: heights,
        width: DEM_TILE_SIZE,
        height: DEM_TILE_SIZE,
        childTileMask: childTileMask(
          x,
          y,
          level,
          this.metadata.bounds,
          this.metadata.maxLevel,
          OUTSIDE_DEM_MAX_LEVEL,
        ),
      }))
      .catch((error) => {
        this.errorEvent.raiseEvent(error);
        throw error;
      });
  }
}

export function supportsBrowserDemTerrain(scope = globalThis) {
  return typeof scope.Worker === "function"
    && typeof scope.File === "function";
}

/**
 * 在浏览器当前会话创建本地 DEM 地形。文件对象只发送给同源 Worker，既不会
 * 经过 Vercel Function，也不会上传；dispose 后终止 Worker 并释放完整栅格引用。
 */
export async function createBrowserDemTerrainSession(file, options = {}) {
  if (!file) throw new Error("没有选择 DEM 文件");
  if (!/\.tiff?$/i.test(file.name || "")) {
    throw new Error("浏览器模式当前仅支持 .tif 和 .tiff GeoTIFF");
  }
  const client = new DemWorkerClient(options);
  const signal = options.signal;
  const abort = () => client.dispose(abortError());
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  try {
    const metadata = await client.request("load", { file });
    if (signal?.aborted) throw abortError();
    const provider = options.providerFactory?.(client, metadata)
      ?? new BrowserDemTerrainProvider(client, metadata);
    let disposed = false;
    return {
      id: `browser-dem-${Date.now().toString(36)}-${(++sessionSequence).toString(36)}`,
      name: file.name.replace(/\.tiff?$/i, "") || "浏览器本地 DEM",
      fileName: file.name,
      fileSize: file.size,
      provider,
      ...metadata,
      dispose() {
        if (disposed) return;
        disposed = true;
        signal?.removeEventListener("abort", abort);
        client.dispose();
      },
    };
  } catch (error) {
    signal?.removeEventListener("abort", abort);
    client.dispose(error);
    throw error;
  }
}

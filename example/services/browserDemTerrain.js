import {
  Event,
  GeographicTilingScheme,
  HeightmapTerrainData,
  TerrainProvider,
} from "cesium";
import {
  boundsIntersect,
  childTileMask,
  DEM_TILE_SIZE,
  geographicTileBounds,
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
 * 单独使用时，低层级的 DEM 外部区域仍返回 0 米以兼容既有全球浏览行为；组合 Provider
 * 则通过 hasDataForTile() 只请求真正与 DEM 相交的瓦片，避免把兼容性空瓦片当成覆盖数据。
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

  /**
   * 判断瓦片是否真正包含本 DEM 的有效覆盖范围。它与 getTileDataAvailable() 的区别是：
   * 后者为单 DEM 模式保留 0-10 级全球空瓦片，前者专供组合地形过滤数据来源。
   */
  hasDataForTile(x, y, level) {
    return level <= this.metadata.maxLevel
      && boundsIntersect(geographicTileBounds(x, y, level), this.metadata.bounds);
  }

  loadTileDataAvailability() {
    return undefined;
  }

  getChildTileMask(x, y, level) {
    return childTileMask(
      x,
      y,
      level,
      this.metadata.bounds,
      this.metadata.maxLevel,
      OUTSIDE_DEM_MAX_LEVEL,
    );
  }

  /**
   * 返回 heightmap 与逐像元有效掩码。组合 Provider 使用 validMask 决定是否覆盖
   * 下层 DEM；直接作为单一地形使用时，无效像元仍保持 0 米以兼容原有行为。
   */
  requestTileSamples(x, y, level) {
    if (!this.getTileDataAvailable(x, y, level)) return undefined;
    return this.client.request("tile", { x, y, level })
      .then((samples) => {
        if (ArrayBuffer.isView(samples)) {
          return {
            heights: samples,
            validMask: new Uint8Array(samples.length).fill(1),
          };
        }
        return samples;
      })
      .catch((error) => {
        this.errorEvent.raiseEvent(error);
        throw error;
      });
  }

  requestTileGeometry(x, y, level) {
    const samples = this.requestTileSamples(x, y, level);
    if (!samples) return undefined;
    return samples
      .then(({ heights }) => new HeightmapTerrainData({
        buffer: heights,
        width: DEM_TILE_SIZE,
        height: DEM_TILE_SIZE,
        childTileMask: this.getChildTileMask(x, y, level),
      }));
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
    // AbortSignal 只负责“创建会话”阶段。解析完成后由上层先把 Provider 从组合栈回滚，
    // 再调用 session.dispose()；否则取消应用时可能短暂留下一个已终止 Worker 的活动 Provider。
    signal?.removeEventListener("abort", abort);
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

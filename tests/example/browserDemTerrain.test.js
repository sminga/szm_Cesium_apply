import { describe, expect, it, vi } from "vitest";
import {
  BrowserDemTerrainProvider,
  createBrowserDemTerrainSession,
  supportsBrowserDemTerrain,
} from "../../example/services/browserDemTerrain.js";

const metadata = {
  fileName: "西峰山东侧 DEM（WGS84）.tif",
  fileSize: 58_111_953,
  width: 4358,
  height: 2537,
  projection: "WGS 84",
  projectionCode: "EPSG:4326",
  bounds: {
    west: 116.03357230251954,
    south: 40.15316878710198,
    east: 116.0532025039814,
    north: 40.16459646519027,
  },
  minHeight: 125.25,
  maxHeight: 257.98,
  validSamples: 2_826_915,
  totalSamples: 11_056_246,
  maxLevel: 20,
};

class FakeWorker {
  constructor() {
    this.listeners = new Map();
    this.terminated = false;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, data) {
    this.listeners.get(type)?.({ data });
  }

  postMessage(message) {
    if (message.type === "load") {
      queueMicrotask(() => this.emit("message", {
        type: "result",
        requestId: message.requestId,
        value: metadata,
      }));
    } else if (message.type === "tile") {
      queueMicrotask(() => this.emit("message", {
        type: "result",
        requestId: message.requestId,
        value: new Float32Array(65 * 65).fill(150),
      }));
    }
  }

  terminate() {
    this.terminated = true;
  }
}

describe("browserDemTerrain", () => {
  it("只在具备 File 与 Worker 时启用浏览器 DEM", () => {
    expect(supportsBrowserDemTerrain({ File() {}, Worker() {} })).toBe(true);
    expect(supportsBrowserDemTerrain({ File() {} })).toBe(false);
  });

  it("创建当前会话 Provider，并在释放时终止 Worker", async () => {
    const worker = new FakeWorker();
    const file = new File([new Uint8Array([1, 2, 3])], metadata.fileName);
    const session = await createBrowserDemTerrainSession(file, {
      workerFactory: () => worker,
    });

    expect(session).toMatchObject({
      name: "西峰山东侧 DEM（WGS84）",
      projectionCode: "EPSG:4326",
      maxLevel: 20,
    });
    const terrainData = await session.provider.requestTileGeometry(52, 8, 5);
    expect(terrainData.childTileMask).toBeGreaterThan(0);
    session.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("加载尚未完成时取消请求会终止 Worker", async () => {
    const worker = new FakeWorker();
    worker.postMessage = vi.fn();
    const abortController = new AbortController();
    const loading = createBrowserDemTerrainSession(
      new File([new Uint8Array([1])], metadata.fileName),
      {
        workerFactory: () => worker,
        signal: abortController.signal,
      },
    );

    abortController.abort();

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("Provider 在可用层级请求 Worker，并拒绝继续细分无数据区域", async () => {
    const client = { request: vi.fn(async () => new Float32Array(65 * 65)) };
    const provider = new BrowserDemTerrainProvider(client, metadata);

    expect(provider.getTileDataAvailable(52, 8, 5)).toBe(true);
    expect(provider.getTileDataAvailable(0, 0, 11)).toBe(false);
    expect(provider.requestTileGeometry(0, 0, 11)).toBeUndefined();
    await provider.requestTileGeometry(52, 8, 5);
    expect(client.request).toHaveBeenCalledWith("tile", { x: 52, y: 8, level: 5 });
  });

  it("公开浏览器模式拒绝非 GeoTIFF，而不会静默上传", async () => {
    await expect(createBrowserDemTerrainSession(
      new File([new Uint8Array([1])], "terrain.img"),
      { workerFactory: () => new FakeWorker() },
    )).rejects.toThrow("仅支持 .tif 和 .tiff");
  });
});

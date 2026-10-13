import { describe, expect, it } from "vitest";
import { TerrainController } from "../../src/terrain/TerrainController.js";

class TestEvent {
  constructor() {
    this.listeners = new Set();
  }

  addEventListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  raise(value) {
    for (const listener of this.listeners) listener(value);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function provider(name) {
  return { name, errorEvent: new TestEvent() };
}

function createViewer(initialProvider) {
  const tileLoadProgressEvent = new TestEvent();
  return {
    camera: { flyTo() {} },
    scene: {
      terrainProvider: initialProvider,
      globe: { tileLoadProgressEvent },
    },
  };
}

describe("TerrainController", () => {
  it("只应用最后一次地形加载请求", async () => {
    const ellipsoid = provider("ellipsoid");
    const first = deferred();
    const second = deferred();
    const viewer = createViewer(ellipsoid);
    const controller = new TerrainController(viewer, {
      ellipsoidTerrainProvider: ellipsoid,
      createLocalTerrain: (url) => (url === "first" ? first.promise : second.promise),
    });

    const firstRequest = controller.loadLocal({ name: "first", url: "first" });
    const secondRequest = controller.loadLocal({ name: "second", url: "second" });
    const secondProvider = provider("second");
    second.resolve(secondProvider);
    expect((await secondRequest).applied).toBe(true);
    first.resolve(provider("first"));
    expect((await firstRequest).reason).toBe("superseded");
    expect(viewer.scene.terrainProvider).toBe(secondProvider);
    expect(controller.getState().name).toBe("second");
    controller.destroy();
  });

  it("新地形失败时保留当前 Provider", async () => {
    const ellipsoid = provider("ellipsoid");
    const viewer = createViewer(ellipsoid);
    const controller = new TerrainController(viewer, {
      ellipsoidTerrainProvider: ellipsoid,
      createLocalTerrain: async () => { throw new Error("layer.json 损坏"); },
    });

    const result = await controller.loadLocal({ name: "broken", url: "broken" });
    expect(result.reason).toBe("error");
    expect(viewer.scene.terrainProvider).toBe(ellipsoid);
    expect(controller.getState()).toMatchObject({
      status: "error",
      type: "ellipsoid",
      requestedName: "broken",
    });
    controller.destroy();
  });

  it("后续请求失败时恢复最后一个稳定状态", async () => {
    const ellipsoid = provider("ellipsoid");
    const stable = provider("stable");
    const viewer = createViewer(ellipsoid);
    const pending = deferred();
    const controller = new TerrainController(viewer, {
      ellipsoidTerrainProvider: ellipsoid,
      createLocalTerrain: (url) => {
        if (url === "stable") return Promise.resolve(stable);
        if (url === "pending") return pending.promise;
        return Promise.reject(new Error("加载失败"));
      },
    });

    await controller.loadLocal({ name: "stable", url: "stable" });
    const oldRequest = controller.loadLocal({ name: "pending", url: "pending" });
    const failedRequest = await controller.loadLocal({ name: "failed", url: "failed" });
    expect(failedRequest.reason).toBe("error");
    expect(viewer.scene.terrainProvider).toBe(stable);
    expect(controller.getState()).toMatchObject({ type: "local", name: "stable", status: "error" });
    pending.resolve(provider("pending"));
    expect((await oldRequest).reason).toBe("superseded");
    controller.destroy();
  });

  it("失败提示期间的瓦片进度不会污染稳定状态", async () => {
    const ellipsoid = provider("ellipsoid");
    const stable = provider("stable");
    const viewer = createViewer(ellipsoid);
    let failureCount = 0;
    const controller = new TerrainController(viewer, {
      ellipsoidTerrainProvider: ellipsoid,
      createLocalTerrain: async (url) => {
        if (url === "stable") return stable;
        failureCount += 1;
        throw new Error(`失败 ${failureCount}`);
      },
    });

    await controller.loadLocal({ name: "stable", url: "stable" });
    await controller.loadLocal({ name: "failed-1", url: "failed-1" });
    viewer.scene.globe.tileLoadProgressEvent.raise(8);
    stable.errorEvent.raise(new Error("旧地形瓦片失败"));
    await controller.loadLocal({ name: "failed-2", url: "failed-2" });

    expect(controller.getState()).toMatchObject({
      status: "error",
      type: "local",
      name: "stable",
      requestedName: "failed-2",
      pendingTiles: 0,
      tileErrorCount: 0,
      warning: undefined,
    });
    controller.destroy();
  });

  it("恢复椭球会取消在途请求", async () => {
    const ellipsoid = provider("ellipsoid");
    const local = deferred();
    const viewer = createViewer(ellipsoid);
    const controller = new TerrainController(viewer, {
      ellipsoidTerrainProvider: ellipsoid,
      createLocalTerrain: () => local.promise,
    });

    const request = controller.loadLocal({ name: "local", url: "local" });
    controller.useEllipsoid();
    local.resolve(provider("local"));
    expect((await request).reason).toBe("superseded");
    expect(viewer.scene.terrainProvider).toBe(ellipsoid);
    controller.destroy();
  });

  it("切换后移除旧 Provider 的错误监听", async () => {
    const ellipsoid = provider("ellipsoid");
    const first = provider("first");
    const second = provider("second");
    const viewer = createViewer(ellipsoid);
    const controller = new TerrainController(viewer, {
      ellipsoidTerrainProvider: ellipsoid,
      createLocalTerrain: async (url) => (url === "first" ? first : second),
    });

    await controller.loadLocal({ name: "first", url: "first" });
    expect(first.errorEvent.listeners.size).toBe(1);
    await controller.loadLocal({ name: "second", url: "second" });
    expect(first.errorEvent.listeners.size).toBe(0);
    second.errorEvent.raise(new Error("瓦片 2/1/1 加载失败"));
    expect(controller.getState().tileErrorCount).toBe(1);
    expect(controller.getState().warning).toContain("瓦片 2/1/1 加载失败");
    controller.destroy();
    expect(second.errorEvent.listeners.size).toBe(0);
  });
});


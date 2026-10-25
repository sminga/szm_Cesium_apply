import { describe, expect, it, vi } from "vitest";
import { SceneLayerRegistry } from "../../example/app/layers/SceneLayerRegistry.js";

function imagery(id, actions = {}) {
  return {
    id,
    group: "imagery",
    name: id,
    capabilities: { visible: true, reorder: true, remove: true },
    actions: {
      setVisible: vi.fn(),
      reorder: vi.fn(),
      remove: vi.fn(),
      ...actions,
    },
  };
}

describe("SceneLayerRegistry", () => {
  it("登记、更新并向订阅者返回不含动作函数的快照", () => {
    const registry = new SceneLayerRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.register(imagery("a"));
    registry.update("a", { detail: "已就绪" });
    expect(registry.get("a")).toMatchObject({ id: "a", detail: "已就绪", visible: true });
    expect(registry.get("a")).not.toHaveProperty("actions");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("拒绝没有声明能力的操作", async () => {
    const registry = new SceneLayerRegistry();
    registry.register({ id: "terrain", group: "terrain", name: "terrain" });
    await expect(registry.perform("terrain", "setVisible", false)).rejects.toThrow("不支持操作");
  });

  it("先同步真实影像顺序，再提交组内排序", async () => {
    const reorder = vi.fn();
    const registry = new SceneLayerRegistry();
    registry.register(imagery("a", { reorder }));
    registry.register(imagery("b", { reorder }));
    registry.register(imagery("c", { reorder }));
    await registry.move("c", 0);
    expect(reorder).toHaveBeenCalledWith(expect.objectContaining({ id: "c" }), expect.objectContaining({
      orderedIds: ["c", "a", "b"],
    }));
    expect(registry.list("imagery").map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });

  it("排序适配器失败时保留原顺序", async () => {
    const registry = new SceneLayerRegistry();
    registry.register(imagery("a"));
    registry.register(imagery("b", { reorder: () => { throw new Error("Cesium 排序失败"); } }));
    await expect(registry.move("b", 0)).rejects.toThrow("Cesium 排序失败");
    expect(registry.list("imagery").map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("激活地形时只保留一个活动源", async () => {
    const registry = new SceneLayerRegistry();
    for (const id of ["ellipsoid", "world"]) {
      registry.register({
        id,
        group: "terrain",
        name: id,
        capabilities: { activate: true },
        actions: { activate: vi.fn() },
      });
    }
    await registry.perform("ellipsoid", "activate");
    await registry.perform("world", "activate");
    expect(registry.list("terrain").filter((entry) => entry.active).map((entry) => entry.id)).toEqual(["world"]);
  });

  it("从场景移除时先调用资源适配器", async () => {
    const remove = vi.fn();
    const registry = new SceneLayerRegistry();
    registry.register(imagery("a", { remove }));
    await registry.perform("a", "remove");
    expect(remove).toHaveBeenCalledOnce();
    expect(registry.has("a")).toBe(false);
  });
});

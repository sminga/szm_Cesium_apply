import { describe, expect, it, vi } from "vitest";
import {
  classifyFireflowAsset,
  createFireflowClient,
  describeFireflowError,
  enrichFireflowProduct,
  getFireflowConfig,
  pollFireflowRequest,
  readStoredFireflowSession,
  restoreFireflowSession,
  writeStoredFireflowSession,
} from "../../example/services/fireflowClient.js";
import { fireflowOptionValue } from "../../example/app/FireflowController.js";

describe("fireflowClient", () => {
  it("公开构建默认关闭，且只读取显式环境配置", () => {
    expect(getFireflowConfig({})).toMatchObject({ enabled: false, baseUrl: "" });
    expect(getFireflowConfig({
      VITE_FIREFLOW_ENABLED: "true",
      VITE_FIREFLOW_BASE_URL: "https://example.test/",
    })).toMatchObject({ enabled: true, baseUrl: "https://example.test/" });
  });

  it("创建浏览器客户端时绑定原生 fetch，避免实例方法调用触发 Illegal invocation", () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = function (...args) {
      calls.push({ receiver: this, args });
      return Promise.resolve({ ok: true, json: async () => ({ receiver_types: [] }) });
    };
    try {
      const client = createFireflowClient({ enabled: true, baseUrl: "http://localhost", timeoutMs: 1000 });
      return client.profiles().then(() => expect(calls[0].receiver).toBe(globalThis));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("保存和读取恢复会话所需的最小字段", () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    };
    writeStoredFireflowSession({
      session_id: "SESSION_1",
      terminal_id: "CESIUM_1",
      receiver_type: "command_center",
      role_id: "commander",
      ignored: "not-persisted",
    }, storage);
    expect(readStoredFireflowSession(storage)).toEqual({
      session_id: "SESSION_1",
      terminal_id: "CESIUM_1",
      receiver_type: "command_center",
      role_id: "commander",
    });
  });

  it("恢复会话后写回客户端内存 sessionId", async () => {
    const client = { api: vi.fn(async () => ({ session_id: "SESSION_2" })), sessionId: null };
    await expect(restoreFireflowSession(client, { session_id: "SESSION_2" })).resolves.toEqual({ session_id: "SESSION_2" });
    expect(client.api).toHaveBeenCalledWith("/api/v1/identity-selections/SESSION_2");
    expect(client.sessionId).toBe("SESSION_2");
  });

  it("按服务端用途区分侧栏图、风场、地图影像和普通下载", () => {
    expect(classifyFireflowAsset({ data_role: "chart", media_type: "image/png" })).toBe("image");
    expect(classifyFireflowAsset({ data_role: "wind_2d" })).toBe("wind");
    expect(classifyFireflowAsset({ data_role: "map_overlay", map_ready: true, bbox: [100, 20, 110, 30] })).toBe("map_overlay");
    expect(classifyFireflowAsset({ data_role: "map_overlay", map_ready: true, bbox: [100, 20, 110, 30], media_type: "image/tiff" })).toBe("map_overlay");
    expect(classifyFireflowAsset({ data_role: "map_overlay", map_ready: false })).toBe("download");
    expect(classifyFireflowAsset({ data_role: "attachment", media_type: "application/json" })).toBe("download");
  });

  it("识别真实接口中不同类型选项的标识字段", () => {
    expect(fireflowOptionValue({ receiver_type: "command_center" })).toBe("command_center");
    expect(fireflowOptionValue({ role_id: "commander" })).toBe("commander");
    expect(fireflowOptionValue({ category_id: "wind" })).toBe("wind");
    expect(fireflowOptionValue({ request_type: "wind3d_slice_latest" })).toBe("wind3d_slice_latest");
  });

  it("旧版附件缺少展示字段时读取数据集元信息补齐", async () => {
    const client = {
      api: vi.fn(async () => ({
        file_name: "summary.json",
        format: "json",
        size_bytes: 1607,
        sha256: "abc",
        content_url: "/api/v1/datasets/DS_1/content",
      })),
    };
    const result = await enrichFireflowProduct(client, {
      product_id: "PRD_1",
      assets: [{ dataset_id: "DS_1", label: "数值说明" }],
    });
    expect(client.api).toHaveBeenCalledWith("/api/v1/datasets/DS_1");
    expect(result.assets[0]).toMatchObject({
      file_name: "summary.json",
      media_type: "application/json",
      size_bytes: 1607,
    });
  });

  it("持续轮询并在 completed 后停止", async () => {
    const statuses = [
      { status: "pending" },
      { status: "running" },
      { status: "completed", result_product_id: "PRD_1" },
    ];
    const client = { requestStatus: vi.fn(async () => statuses.shift()) };
    const updates = [];
    const result = await pollFireflowRequest(client, "REQ_1", {
      sleep: async () => {},
      onUpdate: (status) => updates.push(status.status),
    });
    expect(updates).toEqual(["pending", "running", "completed"]);
    expect(result.result_product_id).toBe("PRD_1");
    expect(client.requestStatus).toHaveBeenCalledTimes(3);
  });

  it("把会话、权限和服务错误转换为普通用户提示", () => {
    expect(describeFireflowError(new Error("FIREFLOW_HTTP_409"))).toContain("会话已失效");
    expect(describeFireflowError(new Error("FIREFLOW_HTTP_403"))).toContain("没有访问");
    expect(describeFireflowError(new Error("FIREFLOW_HTTP_503"))).toContain("暂时不可用");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  listAvailableTerrains,
  listPublishedTerrains,
} from "../../example/services/terrainCatalogClient.js";

function response(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    url: options.url ?? "https://preview.example/terrain/catalog.json",
    json: async () => body,
  };
}

describe("terrainCatalogClient", () => {
  it("读取公开目录并基于目录地址解析相对 URL", async () => {
    const fetchImpl = vi.fn(async () => response({
      name: "演示地形",
      terrains: [
        { name: "山地", url: "./mountain/", bounds: [100, 20, 110, 30] },
        { name: "无效条目" },
      ],
    }));

    const result = await listPublishedTerrains({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("./terrain/catalog.json", { cache: "no-cache" });
    expect(result.directory).toBe("演示地形");
    expect(result.terrains).toEqual([expect.objectContaining({
      name: "山地",
      url: "https://preview.example/terrain/mountain/",
      source: "published",
    })]);
  });

  it("允许公开目录为空", async () => {
    const result = await listPublishedTerrains({
      fetchImpl: async () => response({ version: 1, terrains: [] }),
    });
    expect(result.terrains).toEqual([]);
  });

  it("公开目录响应失败时返回可读错误", async () => {
    await expect(listPublishedTerrains({
      fetchImpl: async () => response({}, { ok: false, status: 503 }),
    })).rejects.toThrow("公开地形目录读取失败：HTTP 503");
  });

  it("按 URL 合并公开和开发者本地目录", async () => {
    const result = await listAvailableTerrains({
      localEnabled: true,
      publishedLoader: async () => ({
        directory: "公开地形目录",
        terrains: [{ name: "公开 A", url: "https://example.test/a/", source: "published" }],
      }),
      localLoader: async () => ({
        directory: "tools/terrain-output",
        terrains: [
          { name: "重复 A", url: "https://example.test/a/" },
          { name: "本地 B", url: "http://127.0.0.1:8765/files/terrain/b/" },
        ],
      }),
    });

    expect(result.terrains.map((entry) => entry.name)).toEqual(["公开 A", "本地 B"]);
    expect(result.directory).toContain("tools/terrain-output");
  });

  it("生产模式不调用本地目录加载器", async () => {
    const localLoader = vi.fn();
    const result = await listAvailableTerrains({
      localEnabled: false,
      localLoader,
      publishedLoader: async () => ({ directory: "公开地形目录", terrains: [] }),
    });

    expect(localLoader).not.toHaveBeenCalled();
    expect(result.terrains).toEqual([]);
  });

  it("本地服务不可用时仍保留公开目录", async () => {
    const result = await listAvailableTerrains({
      localEnabled: true,
      publishedLoader: async () => ({
        directory: "公开地形目录",
        terrains: [{ name: "公开 A", url: "https://example.test/a/" }],
      }),
      localLoader: async () => { throw new Error("本地服务未启动"); },
    });

    expect(result.terrains).toHaveLength(1);
    expect(result.localWarning).toBe("本地服务未启动");
  });
});

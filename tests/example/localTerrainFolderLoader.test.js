import { describe, expect, it } from "vitest";
import {
  inspectLocalTerrainFiles,
  normalizeRelativePath,
} from "../../example/services/localTerrainFolderLoader.js";

function localFile(path, content = new Uint8Array([1, 2, 3])) {
  const blob = new Blob([content]);
  return {
    name: path.split("/").at(-1),
    relativePath: path,
    size: blob.size,
    text: () => blob.text(),
  };
}

function layer(overrides = {}) {
  return JSON.stringify({
    tilejson: "2.1.0",
    format: "quantized-mesh-1.0",
    version: "1.0.0",
    scheme: "tms",
    tiles: ["{z}/{x}/{y}.terrain?v={version}"],
    minzoom: 0,
    maxzoom: 4,
    bounds: [100, 20, 110, 30],
    ...overrides,
  });
}

describe("localTerrainFolderLoader", () => {
  it("识别嵌套且包含中文路径的 quantized-mesh 地形", async () => {
    const result = await inspectLocalTerrainFiles([
      localFile("处理结果/山地一号/layer.json", layer()),
      localFile("处理结果/山地一号/0/0/0.terrain"),
      localFile("处理结果/山地一号/4/8/6.terrain"),
      localFile("处理结果/其他说明.txt", "说明"),
    ]);

    expect(result.folderName).toBe("处理结果");
    expect(result.rootPath).toBe("处理结果/山地一号");
    expect(result.tileCount).toBe(2);
    expect(result.files.map((item) => item.relativePath)).toEqual([
      "layer.json",
      "0/0/0.terrain",
      "4/8/6.terrain",
    ]);
    expect(result.bounds).toEqual({ west: 100, south: 20, east: 110, north: 30 });
    expect(result.minLevel).toBe(0);
    expect(result.maxLevel).toBe(4);
  });

  it("优先使用 CTB valid_bounds 定位局部 DEM", async () => {
    const result = await inspectLocalTerrainFiles([
      localFile("xfsDEMWGS84/layer.json", layer({
        bounds: [-180, -90, 180, 90],
        valid_bounds: [116.03356763720512, 40.15316918492317, 116.05319872498512, 40.16459807753563],
      })),
      localFile("xfsDEMWGS84/20/1724560/758220.terrain"),
    ]);

    expect(result.bounds).toEqual({
      west: 116.03356763720512,
      south: 40.15316918492317,
      east: 116.05319872498512,
      north: 40.16459807753563,
    });
  });

  it("valid_bounds 无效时回退到兼容的 bounds", async () => {
    const result = await inspectLocalTerrainFiles([
      localFile("terrain/layer.json", layer({ valid_bounds: [116, 40, 115, 41] })),
      localFile("terrain/0/0/0.terrain"),
    ]);

    expect(result.bounds).toEqual({ west: 100, south: 20, east: 110, north: 30 });
  });

  it("保留 gzip terrain 文件并计入瓦片", async () => {
    const result = await inspectLocalTerrainFiles([
      localFile("terrain/layer.json", layer()),
      localFile("terrain/0/0/0.terrain", new Uint8Array([0x1f, 0x8b, 0x08, 0x00])),
    ]);
    expect(result.tileCount).toBe(1);
    expect(result.files[1].file.size).toBe(4);
  });

  it("拒绝缺少 layer.json 的目录", async () => {
    await expect(inspectLocalTerrainFiles([
      localFile("terrain/0/0/0.terrain"),
    ])).rejects.toThrow("未找到 layer.json");
  });

  it("拒绝没有 terrain 瓦片的目录", async () => {
    await expect(inspectLocalTerrainFiles([
      localFile("terrain/layer.json", layer()),
    ])).rejects.toThrow("没有 .terrain 瓦片");
  });

  it("拒绝无效 JSON 和非 quantized-mesh 格式", async () => {
    await expect(inspectLocalTerrainFiles([
      localFile("terrain/layer.json", "{"),
      localFile("terrain/0/0/0.terrain"),
    ])).rejects.toThrow("不是有效的 JSON");

    await expect(inspectLocalTerrainFiles([
      localFile("terrain/layer.json", layer({ format: "heightmap-1.0" })),
      localFile("terrain/0/0/0.terrain"),
    ])).rejects.toThrow("format 不是 quantized-mesh");
  });

  it("拒绝一次选择多个有效地形目录", async () => {
    await expect(inspectLocalTerrainFiles([
      localFile("root/a/layer.json", layer()),
      localFile("root/a/0/0/0.terrain"),
      localFile("root/b/layer.json", layer()),
      localFile("root/b/0/0/0.terrain"),
    ])).rejects.toThrow("多个有效地形目录");
  });

  it("规范化 Windows 与 URL 风格的相对路径", () => {
    expect(normalizeRelativePath("根目录\\子目录\\layer.json")).toBe("根目录/子目录/layer.json");
    expect(normalizeRelativePath("./根目录//0/0/0.terrain")).toBe("根目录/0/0/0.terrain");
  });
});


import { describe, expect, it, vi } from "vitest";

vi.mock("@cesium-china/cesium-map", () => {
  class Provider {
    constructor(options) {
      this.options = options;
      this.kind = this.constructor.name;
    }
  }
  return {
    AMapImageryProvider: class AMapImageryProvider extends Provider {},
    BaiduImageryProvider: class BaiduImageryProvider extends Provider {},
    TencentImageryProvider: class TencentImageryProvider extends Provider {},
  };
});

import {
  createBasemapProviders,
  describeBasemapSelection,
  readBasemapConfig,
} from "../../example/app/basemaps/basemapProviders.js";

function createCesiumMock() {
  class Provider {
    constructor(options) {
      this.options = options;
    }
  }
  return {
    Credit: class Credit { constructor(text) { this.text = text; } },
    WebMapTileServiceImageryProvider: class WebMapTileServiceImageryProvider extends Provider {},
    OpenStreetMapImageryProvider: class OpenStreetMapImageryProvider extends Provider {},
    UrlTemplateImageryProvider: class UrlTemplateImageryProvider extends Provider {},
    IonWorldImageryStyle: { AERIAL: "AERIAL" },
    createWorldImageryAsync: vi.fn(async () => ({ kind: "cesium-world-imagery" })),
    IonImageryProvider: {
      fromAssetId: vi.fn(async (assetId) => ({ kind: "ion-imagery", assetId })),
    },
  };
}

const fullConfig = Object.freeze({
  ionToken: "ion-token",
  tiandituToken: "tdt-token",
  amapUrl: "https://example.com/amap/{style}/{z}/{x}/{y}",
  baiduUrl: "https://example.com/baidu/{style}/{z}/{x}/{y}",
  tencentUrl: "https://example.com/tencent/{style}/{z}/{x}/{y}",
  geovisUrl: "https://example.com/geovis/{style}/{z}/{x}/{y}?token={token}",
  geovisToken: "geovis-token",
  production: true,
});

describe("basemapProviders", () => {
  it("创建天地图基础层、境界线和匹配当前样式的中文注记", async () => {
    const Cesium = createCesiumMock();
    const result = await createBasemapProviders({
      providerId: "tianditu",
      styleId: "imagery",
      labelsEnabled: true,
      boundariesEnabled: true,
    }, fullConfig, Cesium);

    expect(result.descriptors.map((entry) => entry.role)).toEqual(["base", "boundaries", "labels"]);
    expect(result.descriptors.map((entry) => entry.provider.options.layer)).toEqual(["img", "ibo", "cia"]);
    expect(result.descriptors[0].provider.options.tileMatrixSetID).toBe("w");
    expect(result.descriptors[0].provider.options.credit.text).toBe("天地图");
  });

  it.each([
    ["amap", "AMapImageryProvider", "6"],
    ["baidu", "BaiduImageryProvider", "img"],
    ["tencent", "TencentImageryProvider", "img"],
  ])("为 %s 使用 WGS84 对齐模式和部署者提供的 URL", async (providerId, kind, styleToken) => {
    const result = await createBasemapProviders({
      providerId,
      styleId: "imagery",
      labelsEnabled: false,
      boundariesEnabled: false,
    }, fullConfig, createCesiumMock());
    const provider = result.descriptors[0].provider;
    expect(provider.kind).toBe(kind);
    expect(provider.options.crs).toBe("WGS84");
    expect(provider.options.url).toContain(`/${styleToken}/`);
    expect(provider.options.credit).toBeTruthy();
  });

  it("Google 底图只通过指定 Cesium ion 资产创建", async () => {
    const Cesium = createCesiumMock();
    const result = await createBasemapProviders({ providerId: "google", styleId: "satellite-labels" }, fullConfig, Cesium);
    expect(Cesium.IonImageryProvider.fromAssetId).toHaveBeenCalledWith(3830183);
    expect(result.descriptors[0].provider.assetId).toBe(3830183);
  });

  it("缺少厂商配置时返回可操作的环境变量提示", async () => {
    await expect(createBasemapProviders(
      { providerId: "tianditu", styleId: "imagery" },
      { ...fullConfig, tiandituToken: "" },
      createCesiumMock(),
    )).rejects.toThrow("VITE_TIANDITU_TOKEN");
  });

  it("生产环境拒绝指向开发者本机的瓦片地址", async () => {
    await expect(createBasemapProviders(
      { providerId: "amap", styleId: "imagery" },
      { ...fullConfig, amapUrl: "http://127.0.0.1:9000/{style}/{z}/{x}/{y}" },
      createCesiumMock(),
    )).rejects.toThrow("不能指向开发者本机");
  });

  it("环境变量读取会把示例占位 Token 视为未配置", () => {
    expect(readBasemapConfig({ VITE_CESIUM_ION_TOKEN: "your_browser_token" }).ionToken).toBe("");
  });

  it("注册中心描述只包含服务信息，不包含 Token 或授权 URL", () => {
    const description = describeBasemapSelection({
      providerId: "tianditu",
      styleId: "vector",
      labelsEnabled: true,
      boundariesEnabled: false,
    });
    expect(description.name).toBe("天地图 · 矢量");
    expect(JSON.stringify(description)).not.toContain("token");
    expect(JSON.stringify(description)).not.toContain("https://");
  });
});

import * as Cesium from "cesium";
import {
  AMapImageryProvider,
  BaiduImageryProvider,
  TencentImageryProvider,
} from "@cesium-china/cesium-map";
import {
  getBasemapAvailability,
  getBasemapDefinition,
  getBasemapStyle,
} from "./basemapCatalog.js";

const CREDIT_TEXT = Object.freeze({
  osm: "© OpenStreetMap contributors",
  tianditu: "天地图",
  amap: "高德地图",
  baidu: "百度地图",
  tencent: "腾讯地图",
  geovis: "星图地球",
});

function readValue(value) {
  const normalized = value?.trim() ?? "";
  const lower = normalized.toLowerCase();
  if (lower === "your_browser_token" || lower === "your_token" || lower.startsWith("replace_with_")) return "";
  return normalized;
}

export function readBasemapConfig(env = {}) {
  return Object.freeze({
    ionToken: readValue(env.VITE_CESIUM_ION_TOKEN),
    tiandituToken: readValue(env.VITE_TIANDITU_TOKEN),
    amapUrl: readValue(env.VITE_AMAP_TILE_URL),
    baiduUrl: readValue(env.VITE_BAIDU_TILE_URL),
    tencentUrl: readValue(env.VITE_TENCENT_TILE_URL),
    geovisUrl: readValue(env.VITE_GEOVIS_TILE_URL),
    geovisToken: readValue(env.VITE_GEOVIS_TOKEN),
    production: Boolean(env.PROD),
  });
}

function assertPublicTileUrl(url, config, providerName) {
  if (!config.production || !url) return;
  const normalized = url.toLowerCase();
  if (normalized.includes("localhost") || normalized.includes("127.0.0.1") || normalized.startsWith("file:")) {
    throw new Error(`${providerName} 的生产瓦片地址不能指向开发者本机`);
  }
  if (!normalized.startsWith("https://") && !normalized.startsWith("/")) {
    throw new Error(`${providerName} 的 Vercel 生产瓦片地址必须使用 HTTPS 或同源相对路径`);
  }
}

function resolveTemplate(template, style, token, providerName) {
  let url = template.replaceAll("{style}", style.urlStyle ?? style.id);
  const needsToken = /\{(?:token|key)\}/.test(url);
  if (needsToken && !token) throw new Error(`${providerName} 的瓦片地址需要配置服务 Token`);
  url = url.replaceAll("{token}", token ?? "").replaceAll("{key}", token ?? "");
  return url;
}

function credit(CesiumApi, providerId) {
  return new CesiumApi.Credit(CREDIT_TEXT[providerId]);
}

function createTiandituProvider(CesiumApi, service, token) {
  return new CesiumApi.WebMapTileServiceImageryProvider({
    url: `https://t{s}.tianditu.gov.cn/${service}_w/wmts?tk=${encodeURIComponent(token)}`,
    layer: service,
    style: "default",
    format: "tiles",
    tileMatrixSetID: "w",
    subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
    maximumLevel: 18,
    credit: credit(CesiumApi, "tianditu"),
  });
}

/**
 * 创建一次底图切换所需的全部 Provider。业务数据始终保持 WGS84；高德、腾讯和百度
 * 只在影像瓦片的 tilingScheme 中做 GCJ-02/BD-09 对齐，避免修改风场、DEM 或矢量数据。
 * 返回值按从下到上的顺序排列，BasemapManager 会将它们整体放到影像栈底部。
 */
export async function createBasemapProviders(selection, config, CesiumApi = Cesium) {
  const definition = getBasemapDefinition(selection.providerId);
  const availability = getBasemapAvailability(definition, config);
  if (!availability.available) throw new Error(availability.reason);
  const style = getBasemapStyle(definition, selection.styleId);
  const descriptors = [];

  if (definition.id === "none") return { definition, style, descriptors };

  if (definition.id === "cesium") {
    descriptors.push({
      role: "base",
      provider: await CesiumApi.createWorldImageryAsync({ style: CesiumApi.IonWorldImageryStyle.AERIAL }),
    });
  } else if (definition.id === "osm") {
    descriptors.push({
      role: "base",
      provider: new CesiumApi.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: credit(CesiumApi, "osm"),
      }),
    });
  } else if (definition.id === "tianditu") {
    descriptors.push({ role: "base", provider: createTiandituProvider(CesiumApi, style.service, config.tiandituToken) });
    if (selection.boundariesEnabled) {
      descriptors.push({ role: "boundaries", provider: createTiandituProvider(CesiumApi, "ibo", config.tiandituToken) });
    }
    if (selection.labelsEnabled) {
      descriptors.push({ role: "labels", provider: createTiandituProvider(CesiumApi, style.labelService, config.tiandituToken) });
    }
  } else if (definition.id === "google") {
    descriptors.push({ role: "base", provider: await CesiumApi.IonImageryProvider.fromAssetId(style.assetId) });
  } else if (definition.id === "amap") {
    const url = resolveTemplate(config.amapUrl, style, "", definition.name);
    assertPublicTileUrl(url, config, definition.name);
    descriptors.push({
      role: "base",
      provider: new AMapImageryProvider({
        url,
        style: style.providerStyle,
        crs: "WGS84",
        credit: credit(CesiumApi, "amap"),
      }),
    });
  } else if (definition.id === "baidu") {
    const url = resolveTemplate(config.baiduUrl, style, "", definition.name);
    assertPublicTileUrl(url, config, definition.name);
    descriptors.push({
      role: "base",
      provider: new BaiduImageryProvider({
        url,
        style: style.providerStyle,
        crs: "WGS84",
        credit: credit(CesiumApi, "baidu"),
      }),
    });
  } else if (definition.id === "tencent") {
    const url = resolveTemplate(config.tencentUrl, style, "", definition.name);
    assertPublicTileUrl(url, config, definition.name);
    descriptors.push({
      role: "base",
      provider: new TencentImageryProvider({
        url,
        style: style.providerStyle,
        crs: "WGS84",
        credit: credit(CesiumApi, "tencent"),
      }),
    });
  } else if (definition.id === "geovis") {
    const url = resolveTemplate(config.geovisUrl, style, config.geovisToken, definition.name);
    assertPublicTileUrl(url, config, definition.name);
    descriptors.push({
      role: "base",
      provider: new CesiumApi.UrlTemplateImageryProvider({
        url,
        credit: credit(CesiumApi, "geovis"),
      }),
    });
  }

  return { definition, style, descriptors };
}

export function describeBasemapSelection(selection) {
  const definition = getBasemapDefinition(selection.providerId);
  const style = getBasemapStyle(definition, selection.styleId);
  const auxiliaries = [];
  if (definition.supportsBoundaries && selection.boundariesEnabled) auxiliaries.push("境界线");
  if (definition.supportsLabels && selection.labelsEnabled) auxiliaries.push("注记");
  return {
    id: definition.id,
    name: `${definition.name} · ${style.name}`,
    source: definition.source,
    coordinateSystem: definition.coordinateSystem,
    detail: auxiliaries.length ? `复合底图：${auxiliaries.join("、")}` : "固定在影像栈底部",
  };
}

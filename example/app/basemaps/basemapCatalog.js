const BASEMAP_CATALOG = Object.freeze([
  {
    id: "cesium",
    name: "Cesium",
    source: "Cesium ion",
    coordinateSystem: "WGS84 / Web Mercator",
    defaultStyle: "aerial",
    requiredConfig: [{ key: "ionToken", label: "VITE_CESIUM_ION_TOKEN" }],
    styles: [{ id: "aerial", name: "全球影像" }],
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    source: "OpenStreetMap",
    coordinateSystem: "WGS84 / Web Mercator",
    defaultStyle: "standard",
    styles: [{ id: "standard", name: "标准地图" }],
  },
  {
    id: "tianditu",
    name: "天地图",
    source: "国家地理信息公共服务平台",
    coordinateSystem: "CGCS2000",
    defaultStyle: "imagery",
    requiredConfig: [{ key: "tiandituToken", label: "VITE_TIANDITU_TOKEN" }],
    styles: [
      { id: "imagery", name: "影像", service: "img", labelService: "cia" },
      { id: "vector", name: "矢量", service: "vec", labelService: "cva" },
      { id: "relief", name: "地形晕渲图", service: "ter", labelService: "cta" },
    ],
    supportsLabels: true,
    supportsBoundaries: true,
  },
  {
    id: "amap",
    name: "高德地图",
    source: "高德开放平台",
    coordinateSystem: "GCJ-02（Provider 对齐 WGS84）",
    defaultStyle: "imagery",
    requiredConfig: [{ key: "amapUrl", label: "VITE_AMAP_TILE_URL" }],
    styles: [
      { id: "imagery", name: "影像", providerStyle: "img", urlStyle: "6" },
      { id: "vector", name: "电子地图", providerStyle: "elec", urlStyle: "8" },
    ],
  },
  {
    id: "baidu",
    name: "百度地图",
    source: "百度地图开放平台",
    coordinateSystem: "BD-09（Provider 对齐 WGS84）",
    defaultStyle: "imagery",
    requiredConfig: [{ key: "baiduUrl", label: "VITE_BAIDU_TILE_URL" }],
    styles: [
      { id: "imagery", name: "影像", providerStyle: "img", urlStyle: "img" },
      { id: "vector", name: "矢量", providerStyle: "vec", urlStyle: "vec" },
    ],
  },
  {
    id: "tencent",
    name: "腾讯地图",
    source: "腾讯位置服务",
    coordinateSystem: "GCJ-02（Provider 对齐 WGS84）",
    defaultStyle: "imagery",
    requiredConfig: [{ key: "tencentUrl", label: "VITE_TENCENT_TILE_URL" }],
    styles: [
      { id: "imagery", name: "影像", providerStyle: "img", urlStyle: "img" },
      { id: "vector", name: "经典地图", providerStyle: "elec", urlStyle: "1" },
    ],
  },
  {
    id: "google",
    name: "Google",
    source: "Cesium ion 3830183",
    coordinateSystem: "由 Cesium ion Provider 管理",
    defaultStyle: "satellite-labels",
    requiredConfig: [{ key: "ionToken", label: "VITE_CESIUM_ION_TOKEN" }],
    styles: [{ id: "satellite-labels", name: "卫星含标签", assetId: 3830183 }],
  },
  {
    id: "geovis",
    name: "星图地球",
    source: "星图地球授权服务",
    coordinateSystem: "按授权服务定义",
    defaultStyle: "imagery",
    requiredConfig: [{ key: "geovisUrl", label: "VITE_GEOVIS_TILE_URL" }],
    styles: [
      { id: "imagery", name: "影像", urlStyle: "img" },
      { id: "vector", name: "矢量", urlStyle: "vec" },
      { id: "relief", name: "地形晕渲图", urlStyle: "ter" },
    ],
  },
  {
    id: "none",
    name: "无底图",
    source: "场景设置",
    coordinateSystem: "不适用",
    defaultStyle: "none",
    styles: [{ id: "none", name: "仅显示地球与场景内容" }],
  },
]);

function isConfigured(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== "your_browser_token"
    && normalized !== "your_token"
    && !normalized.startsWith("replace_with_");
}

export function getBasemapCatalog() {
  return BASEMAP_CATALOG;
}

export function getBasemapDefinition(id) {
  const definition = BASEMAP_CATALOG.find((entry) => entry.id === id);
  if (!definition) throw new Error(`未知底图服务：${id}`);
  return definition;
}

export function getBasemapStyle(definition, styleId) {
  const style = definition.styles.find((entry) => entry.id === styleId)
    ?? definition.styles.find((entry) => entry.id === definition.defaultStyle);
  if (!style) throw new Error(`${definition.name} 没有可用地图样式`);
  return style;
}

export function getBasemapAvailability(definition, config) {
  const missing = (definition.requiredConfig ?? [])
    .filter((requirement) => !isConfigured(config[requirement.key]))
    .map((requirement) => requirement.label);
  return missing.length
    ? { available: false, reason: `需要配置 ${missing.join("、")}` }
    : { available: true, reason: "" };
}

export default BASEMAP_CATALOG;

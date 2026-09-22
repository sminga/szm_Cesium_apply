/*
 * 多二维/三维风场、图层切换和本地 quantized-mesh 地形示例。
 */
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  Box,
  Building2,
  CircleOff,
  createIcons,
  Eye,
  FileUp,
  FolderOpen,
  FolderCog,
  Layers2,
  Layers3,
  LocateFixed,
  Map,
  Mountain,
  MountainSnow,
  RefreshCw,
  Satellite,
  Trash2,
  Wind,
  Wrench,
  X,
} from "lucide";
import {
  createLocalTerrainProvider,
  loadNetCDF3File,
  WindLayerManager,
} from "../../dist/cesium-wind-layer-3d.js";
import {
  checkLocalService,
  convertDEMFile,
  convertNetCDFFile,
  fetchWindFile,
  listConvertedWindFiles,
  listLocalTerrains,
} from "../services/localServiceClient.js";
import { SERVICE_TOKENS } from "../config/serviceTokens.js";

Cesium.Ion.defaultAccessToken = SERVICE_TOKENS.cesiumIon;

const viewer = new Cesium.Viewer("cesiumContainer", {
  infoBox: false,
  geocoder: true,
  homeButton: true,
  sceneModePicker: true,
  baseLayerPicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
});

viewer.cesiumWidget.creditContainer.style.display = "none";
viewer.scene.debugShowFramesPerSecond = true;
viewer.scene.globe.enableLighting = false;
viewer.scene.fog.enabled = true;
viewer.scene.fog.density = 0.00008;

const ellipsoidTerrainProvider = new Cesium.EllipsoidTerrainProvider();
const windLayers = new WindLayerManager(viewer);
let activeLayerId = null;
let buildingsTileset = null;
let basemapRequestId = 0;
let catalogMode = "3d";
let catalogEntries = [];

const WIND_COLORS = [
  "rgb(74, 152, 255)", "rgb(46, 184, 229)", "rgb(56, 205, 176)",
  "rgb(128, 220, 101)", "rgb(242, 222, 72)", "rgb(247, 157, 55)",
  "rgb(224, 70, 62)", "rgb(151, 53, 126)",
];

const sharedOptions = {
  colors: WIND_COLORS,
  particlesTextureSize: 256,
  lineWidth: { min: 0.9, max: 1.6 },
  lineLength: { min: 20, max: 400 },
  heightScale: 10,
  speedFactor: 0.3,
  dropRate: 0.003,
  dropRateBump: 0.001,
  useViewerBounds: true,
  lowSpeedOpacity: 0.72,
  densityBySpeed: true,
  densityExponent: 1.5,
  densityFloor: 0.15,
  dynamic: true,
};

const status = document.getElementById("status");
const catalogDialog = document.getElementById("wind-catalog-dialog");
const terrainCatalogDialog = document.getElementById("terrain-catalog-dialog");

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
  status.hidden = !message;
}

function setInlineMessage(element, message, state = "") {
  element.textContent = message;
  element.classList.remove("error", "success");
  if (state) element.classList.add(state);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSpeed(value) {
  if (!Number.isFinite(value)) return "--";
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function activeEntry() {
  return activeLayerId ? windLayers.get(activeLayerId) : undefined;
}

function updateLegend(speed) {
  const min = Number.isFinite(speed?.min) ? speed.min : 0;
  const max = Number.isFinite(speed?.max) && speed.max > min ? speed.max : min + 1;
  document.getElementById("speed-gradient").style.background = `linear-gradient(to right, ${WIND_COLORS.join(",")})`;
  document.getElementById("speed-ticks").replaceChildren(...Array.from({ length: 5 }, (_, index) => {
    const tick = document.createElement("span");
    tick.textContent = formatSpeed(min + (max - min) * index / 4);
    return tick;
  }));
}

function updateSummary() {
  const list = windLayers.list();
  const count2d = list.filter((entry) => entry.kind === "2d").length;
  const count3d = list.filter((entry) => entry.kind === "3d").length;
  document.getElementById("data-summary").textContent = `${count2d} 个二维层 / ${count3d} 个三维层`;
  document.getElementById("wind-layer-count").textContent = `${list.length} 层`;
}

function selectLayer(id) {
  const entry = windLayers.get(id);
  if (!entry) return;
  activeLayerId = id;
  updateLegend(entry.layer.windData.speed);
  document.querySelectorAll(".wind-layer-item").forEach((item) => item.classList.toggle("active", item.dataset.layerId === id));
  renderVerticalControls(entry);
}

function renderVerticalControls(entry) {
  const section = document.getElementById("vertical-controls");
  section.hidden = entry.kind !== "3d";
  if (entry.kind !== "3d") return;
  const levels = entry.layer.windData.levels;
  const options = entry.layer.options;
  const min = levels[0];
  const max = levels.at(-1);
  document.getElementById("vertical-data-range").textContent = `${min}～${max} m`;
  document.getElementById("height-min").value = options.heightRange?.min ?? min;
  document.getElementById("height-max").value = options.heightRange?.max ?? max;
  const levelSelect = document.getElementById("height-level");
  levelSelect.replaceChildren(...levels.map((height) => {
    const option = document.createElement("option");
    option.value = String(height);
    option.textContent = `${height} m`;
    return option;
  }));
  levelSelect.value = String(options.selectedLevel ?? levels[0]);
  setHeightModeUI(options.verticalMode ?? "all");
}

function setHeightModeUI(mode) {
  document.querySelectorAll("[data-height-mode]").forEach((button) => button.classList.toggle("active", button.dataset.heightMode === mode));
  document.getElementById("height-range-controls").hidden = mode !== "range";
  document.getElementById("height-level-control").hidden = mode !== "level";
}

function layerSubtitle(entry) {
  if (entry.kind === "2d") return `${entry.layer.options.fixedHeight} m 固定高度`;
  const levels = entry.layer.windData.levels;
  const mode = entry.layer.options.verticalMode ?? "all";
  if (mode === "level") return `${entry.layer.options.selectedLevel ?? levels[0]} m 单层`;
  if (mode === "range") {
    const min = entry.layer.options.heightRange?.min ?? levels[0];
    const max = entry.layer.options.heightRange?.max ?? levels.at(-1);
    return `${min}～${max} m`;
  }
  return `${levels[0]}～${levels.at(-1)} m`;
}

function renderWindLayerList() {
  const container = document.getElementById("wind-layer-list");
  const entries = windLayers.list();
  updateSummary();
  if (!entries.length) {
    container.innerHTML = '<p class="empty-message">尚未加载风场</p>';
    document.getElementById("vertical-controls").hidden = true;
    return;
  }
  container.replaceChildren(...entries.map((entry) => {
    const row = document.createElement("div");
    row.className = `wind-layer-item${entry.id === activeLayerId ? " active" : ""}`;
    row.dataset.layerId = entry.id;
    row.innerHTML = `
      <button class="layer-select" type="button">
        <span class="layer-kind">${entry.kind.toUpperCase()}</span>
        <span><b></b><small></small></span>
      </button>
      <div class="layer-actions">
        ${entry.kind === "2d" ? '<input class="layer-height-input" type="number" step="100" title="显示高度（米）" />' : ""}
        <button type="button" data-action="visible" title="显隐"><i data-lucide="eye"></i></button>
        <button type="button" data-action="zoom" title="定位"><i data-lucide="locate-fixed"></i></button>
        <button type="button" data-action="remove" title="删除"><i data-lucide="trash-2"></i></button>
      </div>`;
    row.querySelector("b").textContent = entry.name;
    row.querySelector("small").textContent = layerSubtitle(entry);
    const heightInput = row.querySelector(".layer-height-input");
    if (heightInput) {
      heightInput.value = String(entry.layer.options.fixedHeight);
      heightInput.addEventListener("change", () => {
        entry.layer.setHeight(Number(heightInput.value));
        row.querySelector("small").textContent = layerSubtitle(entry);
      });
    }
    row.querySelector(".layer-select").addEventListener("click", () => selectLayer(entry.id));
    row.querySelector('[data-action="visible"]').addEventListener("click", () => {
      entry.layer.show = !entry.layer.show;
      row.classList.toggle("muted", !entry.layer.show);
    });
    row.querySelector('[data-action="zoom"]').addEventListener("click", () => entry.layer.zoomTo(1.2));
    row.querySelector('[data-action="remove"]').addEventListener("click", () => {
      windLayers.remove(entry.id);
      if (activeLayerId === entry.id) activeLayerId = windLayers.list().at(-1)?.id ?? null;
      renderWindLayerList();
      if (activeLayerId) selectLayer(activeLayerId);
    });
    return row;
  }));
  createIcons({ icons: { Eye, LocateFixed, Trash2 }, root: container });
}

async function loadWindFile(file, kind, options = {}) {
  setStatus(`正在读取 ${file.name}`);
  const result = await loadNetCDF3File(file);
  const metadata = { name: file.name, source: file.name };
  const entry = kind === "2d"
    ? windLayers.add2D(result.windData, { ...sharedOptions, fixedHeight: options.fixedHeight }, metadata)
    : windLayers.add3D(result.windData, { ...sharedOptions, verticalMode: "all" }, metadata);
  activeLayerId = entry.id;
  renderWindLayerList();
  selectLayer(entry.id);
  entry.layer.zoomTo(0);
  const warning = result.metadata.warnings.join("；");
  setStatus(warning);
  if (warning) window.setTimeout(() => setStatus(""), 4500);
  else setStatus("");
}

function catalogOptionsHtml(mode) {
  if (mode !== "2d") return '<p class="catalog-note">三维文件加载后可在主面板选择全部高度、连续范围或离散单层。</p>';
  return `
    <label>起始高度（m）<input id="catalog-start-height" type="number" value="1000" step="100" /></label>
    <label>层间距（m）<input id="catalog-height-step" type="number" value="1000" step="100" /></label>
    <p class="catalog-note">多选文件时按文件列表顺序依次放置到不同高度。</p>`;
}

async function openWindCatalog(mode) {
  catalogMode = mode;
  document.getElementById("catalog-title").textContent = mode === "2d" ? "加载二维风场" : "加载三维风场";
  document.getElementById("catalog-options").innerHTML = catalogOptionsHtml(mode);
  const filesContainer = document.getElementById("catalog-files");
  filesContainer.innerHTML = '<p class="empty-message">正在读取 tools/converted</p>';
  catalogDialog.showModal();
  try {
    const result = await listConvertedWindFiles();
    catalogEntries = result.files;
    document.getElementById("catalog-directory").textContent = result.directory;
    filesContainer.replaceChildren(...result.files.map((entry, index) => {
      const label = document.createElement("label");
      label.className = "catalog-file";
      label.innerHTML = `<input type="${mode === "2d" ? "checkbox" : "radio"}" name="catalog-file" value="${index}" /><span><b></b><small></small></span>`;
      label.querySelector("b").textContent = entry.name;
      label.querySelector("small").textContent = formatBytes(entry.size);
      return label;
    }));
    if (!result.files.length) filesContainer.innerHTML = '<p class="empty-message">tools/converted 中没有 NC 文件</p>';
  } catch (error) {
    catalogEntries = [];
    document.getElementById("catalog-directory").textContent = "本地服务未连接";
    filesContainer.innerHTML = `<p class="empty-message error-text">${error.message}</p>`;
  }
}

async function loadCatalogSelection() {
  const selected = Array.from(document.querySelectorAll('input[name="catalog-file"]:checked'))
    .map((input) => catalogEntries[Number(input.value)]).filter(Boolean);
  if (!selected.length) throw new Error("请至少选择一个风场文件");
  const start = Number(document.getElementById("catalog-start-height")?.value ?? 1000);
  const step = Number(document.getElementById("catalog-height-step")?.value ?? 1000);
  for (let index = 0; index < selected.length; index++) {
    const entry = selected[index];
    await loadWindFile(await fetchWindFile(entry), catalogMode, { fixedHeight: start + step * index });
  }
}

function bindCatalog() {
  document.getElementById("open-2d-catalog").addEventListener("click", () => openWindCatalog("2d"));
  document.getElementById("open-3d-catalog").addEventListener("click", () => openWindCatalog("3d"));
  catalogDialog.addEventListener("close", async () => {
    try {
      if (catalogDialog.returnValue === "load") await loadCatalogSelection();
      if (catalogDialog.returnValue === "browse") document.getElementById(catalogMode === "2d" ? "browse-2d-input" : "browse-3d-input").click();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  for (const [id, kind] of [["browse-2d-input", "2d"], ["browse-3d-input", "3d"]]) {
    document.getElementById(id).addEventListener("change", async (event) => {
      const files = Array.from(event.target.files ?? []);
      for (let index = 0; index < files.length; index++) {
        await loadWindFile(files[index], kind, { fixedHeight: 1000 + index * 1000 });
      }
      event.target.value = "";
    });
  }
}

function bindHeightControls() {
  document.querySelectorAll("[data-height-mode]").forEach((button) => button.addEventListener("click", () => {
    const entry = activeEntry();
    if (!entry || entry.kind !== "3d") return;
    const mode = button.dataset.heightMode;
    entry.layer.updateOptions({ verticalMode: mode });
    setHeightModeUI(mode);
    renderWindLayerList();
  }));
  document.getElementById("apply-height-range").addEventListener("click", () => {
    const entry = activeEntry();
    if (!entry || entry.kind !== "3d") return;
    const min = Number(document.getElementById("height-min").value);
    const max = Number(document.getElementById("height-max").value);
    entry.layer.updateOptions({ verticalMode: "range", heightRange: { min, max } });
    renderWindLayerList();
  });
  document.getElementById("height-level").addEventListener("change", (event) => {
    const entry = activeEntry();
    if (!entry || entry.kind !== "3d") return;
    entry.layer.updateOptions({ verticalMode: "level", selectedLevel: Number(event.target.value) });
    renderWindLayerList();
  });
}

function bindPanelTabs() {
  const tabs = Array.from(document.querySelectorAll(".panel-tab"));
  const pages = Array.from(document.querySelectorAll(".panel-page"));
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    pages.forEach((page) => {
      const selected = page.dataset.page === tab.dataset.panel;
      page.classList.toggle("active", selected);
      page.hidden = !selected;
    });
  }));
}

function updateAllLayers(option) {
  for (const entry of windLayers.list()) entry.layer.updateOptions(option);
}

function bindRange(id, option) {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}-value`);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    output.value = String(value);
    sharedOptions[option] = value;
    updateAllLayers({ [option]: value });
  });
}

function bindWindControls() {
  bindRange("particles", "particlesTextureSize");
  bindRange("speed", "speedFactor");
  bindRange("low-speed-opacity", "lowSpeedOpacity");
  bindRange("height", "heightScale");
  bindRange("density", "densityExponent");
  document.getElementById("length").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    document.getElementById("length-value").value = String(value);
    sharedOptions.lineLength = { min: 20, max: value };
    updateAllLayers({ lineLength: sharedOptions.lineLength });
  });
  document.getElementById("dynamic").addEventListener("change", (event) => {
    sharedOptions.dynamic = event.target.checked;
    updateAllLayers({ dynamic: event.target.checked });
  });
  document.getElementById("density-enabled").addEventListener("change", (event) => {
    sharedOptions.densityBySpeed = event.target.checked;
    updateAllLayers({ densityBySpeed: event.target.checked });
  });
  document.getElementById("zoom").addEventListener("click", () => activeEntry()?.layer.zoomTo(1.2));
}

async function setBasemap(mode) {
  const requestId = ++basemapRequestId;
  const message = document.getElementById("layer-message");
  setInlineMessage(message, "正在切换底图");
  try {
    let provider = null;
    let label = "无底图";
    if (mode === "ion") {
      if (!SERVICE_TOKENS.cesiumIon) throw new Error("未配置 Cesium ion token");
      provider = await Cesium.createWorldImageryAsync({ style: Cesium.IonWorldImageryStyle.AERIAL });
      label = "Cesium 影像";
    } else if (mode === "osm") {
      provider = new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" });
      label = "OpenStreetMap";
    }
    if (requestId !== basemapRequestId) return;
    viewer.imageryLayers.removeAll();
    if (provider) viewer.imageryLayers.addImageryProvider(provider);
    document.querySelectorAll("[data-basemap]").forEach((button) => button.classList.toggle("active", button.dataset.basemap === mode));
    document.getElementById("basemap-status").textContent = label;
    setInlineMessage(message, `${label} 已加载`, "success");
  } catch (error) {
    setInlineMessage(message, `底图切换失败：${error.message}`, "error");
  }
}

async function toggleBuildings(enabled) {
  const checkbox = document.getElementById("buildings-toggle");
  const message = document.getElementById("ion-layer-message");
  try {
    if (enabled) {
      if (!SERVICE_TOKENS.cesiumIon) throw new Error("未配置 Cesium ion token");
      setInlineMessage(message, "正在加载 OSM 建筑物");
      buildingsTileset ??= await Cesium.Cesium3DTileset.fromIonAssetId(96188);
      if (!viewer.scene.primitives.contains(buildingsTileset)) viewer.scene.primitives.add(buildingsTileset);
      buildingsTileset.show = true;
    } else if (buildingsTileset) buildingsTileset.show = false;
    setInlineMessage(message, enabled ? "OSM 建筑物已开启" : "OSM 建筑物已关闭", enabled ? "success" : "");
  } catch (error) {
    checkbox.checked = false;
    setInlineMessage(message, `建筑物加载失败：${error.message}`, "error");
  }
}

async function toggleWorldTerrain(enabled) {
  const checkbox = document.getElementById("terrain-toggle");
  const message = document.getElementById("ion-layer-message");
  try {
    if (enabled) {
      if (!SERVICE_TOKENS.cesiumIon) throw new Error("未配置 Cesium ion token");
      setInlineMessage(message, "正在加载世界地形");
      viewer.scene.terrainProvider = await Cesium.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true });
    } else viewer.scene.terrainProvider = ellipsoidTerrainProvider;
    setInlineMessage(message, enabled ? "世界地形已开启" : "世界地形已关闭", enabled ? "success" : "");
  } catch (error) {
    checkbox.checked = false;
    viewer.scene.terrainProvider = ellipsoidTerrainProvider;
    setInlineMessage(message, `地形加载失败：${error.message}`, "error");
  }
}

async function refreshTerrains() {
  const select = document.getElementById("local-terrain-select");
  const message = document.getElementById("layer-message");
  try {
    const result = await listLocalTerrains();
    select.replaceChildren(...result.terrains.map((terrain) => {
      const option = document.createElement("option");
      option.value = terrain.url;
      option.textContent = terrain.name;
      return option;
    }));
    if (!result.terrains.length) select.innerHTML = '<option value="">暂无本地地形</option>';
    setInlineMessage(message, `找到 ${result.terrains.length} 个本地地形`, "success");
  } catch (error) {
    setInlineMessage(message, error.message, "error");
  }
}

async function openTerrainCatalog() {
  const filesContainer = document.getElementById("terrain-catalog-files");
  filesContainer.innerHTML = '<p class="empty-message">正在读取 tools/terrain-output</p>';
  document.getElementById("terrain-catalog-directory").textContent = "正在读取目录";
  terrainCatalogDialog.showModal();
  await refreshTerrainCatalog();
}

async function refreshTerrainCatalog() {
  const filesContainer = document.getElementById("terrain-catalog-files");
  try {
    const result = await listLocalTerrains();
    document.getElementById("terrain-catalog-directory").textContent = result.directory;
    filesContainer.replaceChildren(...result.terrains.map((terrain, index) => {
      const label = document.createElement("label");
      label.className = "catalog-file";
      label.innerHTML = `<input type="radio" name="terrain-catalog-file" value="${index}" /><span><b></b><small>Cesium quantized-mesh 地形</small></span>`;
      label.querySelector("b").textContent = terrain.name;
      label.querySelector("input").dataset.url = terrain.url;
      return label;
    }));
    if (!result.terrains.length) filesContainer.innerHTML = '<p class="empty-message">tools/terrain-output 中暂无已处理地形</p>';
    terrainCatalogDialog.dataset.terrains = JSON.stringify(result.terrains);
  } catch (error) {
    document.getElementById("terrain-catalog-directory").textContent = "本地服务未连接";
    filesContainer.innerHTML = `<p class="empty-message error-text">${error.message}</p>`;
  }
}

function loadTerrainFromCatalog() {
  const selected = document.querySelector('input[name="terrain-catalog-file"]:checked');
  if (!selected) throw new Error("请先选择一个本地地形");
  const terrains = JSON.parse(terrainCatalogDialog.dataset.terrains || "[]");
  const terrain = terrains[Number(selected.value)];
  if (!terrain) throw new Error("所选地形目录已失效，请刷新列表");
  document.getElementById("local-terrain-select").value = terrain.url;
  return loadSelectedTerrain();
}

async function loadSelectedTerrain() {
  const url = document.getElementById("local-terrain-select").value;
  const message = document.getElementById("layer-message");
  if (!url) return setInlineMessage(message, "请先选择本地地形", "error");
  try {
    setInlineMessage(message, "正在加载本地 quantized-mesh 地形");
    viewer.scene.terrainProvider = await createLocalTerrainProvider(url);
    document.getElementById("terrain-toggle").checked = false;
    setInlineMessage(message, "本地地形已加载", "success");
  } catch (error) {
    viewer.scene.terrainProvider = ellipsoidTerrainProvider;
    setInlineMessage(message, `本地地形加载失败：${error.message}`, "error");
  }
}

function bindLayerControls() {
  document.querySelectorAll("[data-basemap]").forEach((button) => button.addEventListener("click", () => setBasemap(button.dataset.basemap)));
  document.getElementById("buildings-toggle").addEventListener("change", (event) => toggleBuildings(event.target.checked));
  document.getElementById("terrain-toggle").addEventListener("change", (event) => toggleWorldTerrain(event.target.checked));
  document.getElementById("refresh-terrains").addEventListener("click", refreshTerrains);
  document.getElementById("load-local-terrain").addEventListener("click", loadSelectedTerrain);
  document.getElementById("open-local-terrain-catalog").addEventListener("click", openTerrainCatalog);
  document.getElementById("refresh-terrain-catalog").addEventListener("click", refreshTerrainCatalog);
  terrainCatalogDialog.addEventListener("close", async () => {
    if (terrainCatalogDialog.returnValue !== "load") return;
    try {
      await loadTerrainFromCatalog();
    } catch (error) {
      setInlineMessage(document.getElementById("layer-message"), error.message, "error");
    }
  });
  document.getElementById("disable-terrain").addEventListener("click", () => {
    viewer.scene.terrainProvider = ellipsoidTerrainProvider;
    document.getElementById("terrain-toggle").checked = false;
    setInlineMessage(document.getElementById("layer-message"), "已恢复椭球地形");
  });
}

function updateToolResult(id, title, detail, state = "") {
  const result = document.getElementById(id);
  result.className = `conversion-result${state ? ` ${state}` : ""}`;
  const heading = document.createElement("b");
  heading.textContent = title;
  const description = document.createElement("span");
  description.textContent = detail;
  result.replaceChildren(heading, description);
}

function bindTools() {
  const ncInput = document.getElementById("convert-file-input");
  const demInput = document.getElementById("dem-file-input");
  document.getElementById("convert-file").addEventListener("click", () => ncInput.click());
  document.getElementById("convert-dem").addEventListener("click", () => demInput.click());
  ncInput.addEventListener("change", async () => {
    const file = ncInput.files?.[0];
    if (!file) return;
    updateToolResult("conversion-result", "正在处理", file.name, "processing");
    try {
      const result = await convertNetCDFFile(file);
      updateToolResult("conversion-result", "转换成功", `文件已保存到：${result.outputPath}`, "success");
    } catch (error) {
      updateToolResult("conversion-result", "转换失败", error.message, "error");
    } finally { ncInput.value = ""; }
  });
  demInput.addEventListener("change", async () => {
    const file = demInput.files?.[0];
    if (!file) return;
    updateToolResult("dem-result", "正在处理 DEM", "Docker CTB 处理可能需要较长时间", "processing");
    try {
      const result = await convertDEMFile(file);
      updateToolResult("dem-result", "DEM 处理成功", `地形已保存到：${result.outputPath}`, "success");
      await refreshTerrains();
    } catch (error) {
      updateToolResult("dem-result", "DEM 处理失败", error.message, "error");
    } finally { demInput.value = ""; }
  });
  document.querySelector('[data-panel="tools"]').addEventListener("click", async () => {
    const health = await checkLocalService();
    updateToolResult("conversion-result", health ? "本地服务已连接" : "本地服务未启动", health ? health.windDirectory : "请运行 npm run local:server", health ? "success" : "error");
  });
}

async function loadExample() {
  const response = await fetch("./data/wind_3d.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.json();
  const windData = {
    u: { array: new Float32Array(raw.u.array) },
    v: { array: new Float32Array(raw.v.array) },
    w: { array: new Float32Array(raw.w.array) },
    nx: raw.nx, ny: raw.ny, nz: raw.nz, bounds: raw.bounds, levels: raw.levels,
  };
  const entry = windLayers.add3D(windData, { ...sharedOptions }, { name: "wind_3d.json", source: "示例数据" });
  activeLayerId = entry.id;
  renderWindLayerList();
  selectLayer(entry.id);
  entry.layer.zoomTo(0);
}

async function main() {
  bindPanelTabs();
  bindCatalog();
  bindHeightControls();
  bindWindControls();
  bindLayerControls();
  bindTools();
  createIcons({
    icons: {
      Box, Building2, CircleOff, FileUp, FolderOpen, FolderCog, Layers2, Layers3, LocateFixed,
      Map, Mountain, MountainSnow, RefreshCw, Satellite, Wind, Wrench, X,
    },
  });
  try {
    await loadExample();
    setStatus("");
  } catch (error) {
    setStatus(`示例风场加载失败：${error.message}`, true);
  }
}

main();

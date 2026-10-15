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
  Globe2,
  Home,
  Layers2,
  Layers3,
  LocateFixed,
  Map,
  Mountain,
  MountainSnow,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  Satellite,
  Server,
  Trash2,
  Wind,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide";
import {
  loadNetCDF3File,
  TerrainController,
  WindLayerManager,
} from "../../src/index.js";
import {
  checkLocalService,
  convertDEMFile,
  convertNetCDFFile,
  fetchWindFile,
  listConvertedWindFiles,
  listLocalTerrains,
} from "../services/localServiceClient.js";
import { listAvailableTerrains } from "../services/terrainCatalogClient.js";

const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim() ?? "";
const LOCAL_TOOLS_ENABLED = import.meta.env.DEV
  || import.meta.env.VITE_ENABLE_LOCAL_TOOLS === "true";
const LOCAL_SERVICE_URL = import.meta.env.VITE_LOCAL_SERVICE_URL?.trim()
  || "http://127.0.0.1:8765";
const LOCAL_SERVICE_OPTIONS = { serviceUrl: LOCAL_SERVICE_URL };
const EXAMPLE_WIND_URL = new URL("../data/wind_3d.json", import.meta.url).href;

if (CESIUM_ION_TOKEN) Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

const viewer = new Cesium.Viewer("cesiumContainer", {
  infoBox: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  baseLayerPicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  baseLayer: false,
});
viewer.cesiumWidget.creditContainer.style.display = "none";
viewer.scene.debugShowFramesPerSecond = false;
viewer.scene.globe.enableLighting = false;
viewer.scene.fog.enabled = true;
viewer.scene.fog.density = 0.00008;

const ellipsoidTerrainProvider = new Cesium.EllipsoidTerrainProvider();
const terrainController = new TerrainController(viewer, {
  ellipsoidTerrainProvider,
});
const windLayers = new WindLayerManager(viewer);
let activeLayerId = null;
let buildingsTileset = null;
let basemapRequestId = 0;
let catalogMode = "3d";
let catalogEntries = [];
let terrainEntries = [];

const WIND_COLORS = [
  "rgb(74, 152, 255)", "rgb(46, 184, 229)", "rgb(56, 205, 176)",
  "rgb(128, 220, 101)", "rgb(242, 222, 72)", "rgb(247, 157, 55)",
  "rgb(224, 70, 62)", "rgb(151, 53, 126)",
];

const sharedOptions = {
  colors: WIND_COLORS,
  particlesTextureSize: 256,
  lineWidth: { min: 0.9, max: 1.6 },
  lineLength: { min: 8, max: 80 },
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

function renderTerrainState(state) {
  const worldToggle = document.getElementById("terrain-toggle");
  const worldMessage = document.getElementById("ion-layer-message");
  const localMessage = document.getElementById("layer-message");
  const summary = document.getElementById("terrain-state");
  const locateButton = document.getElementById("locate-terrain");
  const sceneTerrainLabel = document.getElementById("scene-terrain-label");
  const requestedWorld = state.status === "loading" && state.requestedType === "world";
  worldToggle.checked = requestedWorld || (state.status !== "loading" && state.type === "world");
  locateButton.disabled = !state.bounds || state.type !== "local";
  summary.querySelector("b").textContent = `当前：${state.name}`;

  let detail = "地形已就绪";
  let messageState = "success";
  if (state.status === "loading") {
    detail = `正在加载${state.requestedName || "地形"}`;
    messageState = "";
  } else if (state.status === "error") {
    detail = `${state.requestedName || "地形"}加载失败：${state.error?.message || state.error}`;
    messageState = "error";
  } else if (state.warning) {
    detail = state.warning;
    messageState = "error";
  } else if (state.pendingTiles > 0) {
    detail = `正在加载当前视野瓦片，剩余 ${state.pendingTiles}`;
    messageState = "";
  } else if (state.type === "ellipsoid") {
    detail = "当前未启用高程地形";
    messageState = "";
  }
  summary.querySelector("span").textContent = detail;
  summary.className = `conversion-result${messageState ? ` ${messageState}` : ""}`;
  sceneTerrainLabel.textContent = state.status === "loading"
    ? "加载中"
    : state.type === "ellipsoid" ? "椭球" : state.name;

  const target = state.requestedType === "world" || state.type === "world"
    ? worldMessage
    : localMessage;
  setInlineMessage(target, detail, messageState);
  if (state.type !== "world" && state.requestedType !== "world") {
    setInlineMessage(worldMessage, "世界地形已关闭");
  }
}

terrainController.subscribe(renderTerrainState);

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
  filesContainer.innerHTML = LOCAL_TOOLS_ENABLED
    ? '<p class="empty-message">正在读取开发者本地风场目录</p>'
    : '<p class="empty-message">公开站点不连接本机目录，请浏览并选择本机 NC 文件</p>';
  catalogDialog.showModal();
  if (!LOCAL_TOOLS_ENABLED) {
    catalogEntries = [];
    document.getElementById("catalog-directory").textContent = "浏览器本地文件";
    return;
  }
  try {
    const result = await listConvertedWindFiles(LOCAL_SERVICE_OPTIONS);
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
    if (!result.files.length) filesContainer.innerHTML = '<p class="empty-message">开发者本地目录中没有 NC 文件</p>';
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
    if (window.matchMedia("(max-width: 900px)").matches) setPanelOpen("left", true);
  }));
}

function setPanelOpen(side, open) {
  document.body.classList.toggle(`${side}-panel-closed`, !open);
  if (open && window.matchMedia("(max-width: 900px)").matches) {
    const otherSide = side === "left" ? "right" : "left";
    document.body.classList.add(`${otherSide}-panel-closed`);
  }
  window.setTimeout(() => viewer.resize(), 220);
}

function togglePanel(side) {
  const closed = document.body.classList.contains(`${side}-panel-closed`);
  setPanelOpen(side, closed);
}

function bindWorkspaceChrome() {
  if (window.matchMedia("(max-width: 900px)").matches) {
    document.body.classList.add("left-panel-closed", "right-panel-closed");
  }
  document.getElementById("toggle-left-panel").addEventListener("click", () => togglePanel("left"));
  document.getElementById("toggle-right-panel").addEventListener("click", () => togglePanel("right"));
  document.getElementById("close-left-panel").addEventListener("click", () => setPanelOpen("left", false));
  document.getElementById("close-right-panel").addEventListener("click", () => setPanelOpen("right", false));
  document.getElementById("toggle-panels").addEventListener("click", () => {
    const bothClosed = document.body.classList.contains("left-panel-closed")
      && document.body.classList.contains("right-panel-closed");
    setPanelOpen("left", bothClosed);
    setPanelOpen("right", bothClosed);
  });
  window.addEventListener("resize", () => viewer.resize());
}

function bindMapControls() {
  const locateActiveLayer = () => activeEntry()?.layer.zoomTo(1.2);
  document.getElementById("map-locate").addEventListener("click", locateActiveLayer);
  document.getElementById("home-view").addEventListener("click", () => viewer.camera.flyHome(0.8));
  document.getElementById("zoom-in").addEventListener("click", () => {
    viewer.camera.zoomIn(Math.max(100, viewer.camera.positionCartographic.height * 0.35));
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    viewer.camera.zoomOut(Math.max(100, viewer.camera.positionCartographic.height * 0.35));
  });
}

function bindStatusBar() {
  const longitude = document.getElementById("coordLng");
  const latitude = document.getElementById("coordLat");
  const altitude = document.getElementById("coordAlt");
  const fpsCounter = document.getElementById("fpsCounter");
  const renderStatus = document.getElementById("render-status");
  renderStatus.textContent = viewer.scene.context.webgl2 ? "WebGL2" : "WebGL1";

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
    if (!cartesian) return;
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    longitude.textContent = `经度 ${Cesium.Math.toDegrees(cartographic.longitude).toFixed(4)}°`;
    latitude.textContent = `纬度 ${Cesium.Math.toDegrees(cartographic.latitude).toFixed(4)}°`;
    altitude.textContent = `高度 ${Math.round(viewer.camera.positionCartographic.height).toLocaleString()}m`;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  let lastSample = performance.now();
  let frameCount = 0;
  const removePostRender = viewer.scene.postRender.addEventListener(() => {
    frameCount += 1;
    const now = performance.now();
    const elapsed = now - lastSample;
    if (elapsed < 1000) return;
    fpsCounter.textContent = `FPS ${Math.round(frameCount * 1000 / elapsed)}`;
    altitude.textContent = `高度 ${Math.round(viewer.camera.positionCartographic.height).toLocaleString()}m`;
    frameCount = 0;
    lastSample = now;
  });

  window.addEventListener("beforeunload", () => {
    handler.destroy();
    removePostRender();
  }, { once: true });
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
    sharedOptions.lineLength = { min: 8, max: value };
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
      if (!CESIUM_ION_TOKEN) throw new Error("未配置 VITE_CESIUM_ION_TOKEN");
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
    document.getElementById("scene-basemap-label").textContent = label;
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
      if (!CESIUM_ION_TOKEN) throw new Error("未配置 VITE_CESIUM_ION_TOKEN");
      setInlineMessage(message, "正在加载 OSM 建筑物");
      buildingsTileset ??= await Cesium.Cesium3DTileset.fromIonAssetId(96188);
      if (!viewer.scene.primitives.contains(buildingsTileset)) viewer.scene.primitives.add(buildingsTileset);
      buildingsTileset.show = true;
    } else if (buildingsTileset) buildingsTileset.show = false;
    document.getElementById("scene-buildings-label").textContent = enabled ? "开启" : "关闭";
    setInlineMessage(message, enabled ? "OSM 建筑物已开启" : "OSM 建筑物已关闭", enabled ? "success" : "");
  } catch (error) {
    checkbox.checked = false;
    document.getElementById("scene-buildings-label").textContent = "关闭";
    setInlineMessage(message, `建筑物加载失败：${error.message}`, "error");
  }
}

async function toggleWorldTerrain(enabled) {
  const checkbox = document.getElementById("terrain-toggle");
  const message = document.getElementById("ion-layer-message");
  try {
    if (enabled) {
      if (!CESIUM_ION_TOKEN) throw new Error("未配置 VITE_CESIUM_ION_TOKEN");
      await terrainController.loadWorld({
        requestVertexNormals: viewer.scene.globe.enableLighting,
        requestWaterMask: false,
      });
    } else if (terrainController.getState().type === "world"
      || terrainController.getState().requestedType === "world") {
      terrainController.useEllipsoid();
    }
  } catch (error) {
    checkbox.checked = false;
    setInlineMessage(message, `地形加载失败：${error.message}`, "error");
  }
}

async function refreshTerrains() {
  const select = document.getElementById("local-terrain-select");
  const message = document.getElementById("layer-message");
  const selectedUrl = select.value;
  try {
    const result = await listAvailableTerrains({
      localEnabled: LOCAL_TOOLS_ENABLED,
      localLoader: listLocalTerrains,
      localOptions: LOCAL_SERVICE_OPTIONS,
    });
    terrainEntries = result.terrains;
    select.replaceChildren(...terrainEntries.map((terrain) => {
      const option = document.createElement("option");
      option.value = terrain.url;
      option.textContent = terrain.name;
      return option;
    }));
    if (!terrainEntries.length) select.innerHTML = '<option value="">暂无已发布地形</option>';
    else if (terrainEntries.some((terrain) => terrain.url === selectedUrl)) select.value = selectedUrl;
    const detail = result.localWarning
      ? `找到 ${terrainEntries.length} 个公开地形；本地目录不可用`
      : `找到 ${terrainEntries.length} 个可用地形`;
    setInlineMessage(message, detail, terrainEntries.length ? "success" : "");
  } catch (error) {
    setInlineMessage(message, error.message, "error");
  }
}

async function openTerrainCatalog() {
  const filesContainer = document.getElementById("terrain-catalog-files");
  filesContainer.innerHTML = '<p class="empty-message">正在读取公开地形目录</p>';
  document.getElementById("terrain-catalog-directory").textContent = "正在读取目录";
  terrainCatalogDialog.showModal();
  await refreshTerrainCatalog();
}

async function refreshTerrainCatalog() {
  const filesContainer = document.getElementById("terrain-catalog-files");
  try {
    const result = await listAvailableTerrains({
      localEnabled: LOCAL_TOOLS_ENABLED,
      localLoader: listLocalTerrains,
      localOptions: LOCAL_SERVICE_OPTIONS,
    });
    document.getElementById("terrain-catalog-directory").textContent = result.directory;
    filesContainer.replaceChildren(...result.terrains.map((terrain, index) => {
      const label = document.createElement("label");
      label.className = "catalog-file";
      label.innerHTML = `<input type="radio" name="terrain-catalog-file" value="${index}" /><span><b></b><small>Cesium quantized-mesh 地形</small></span>`;
      label.querySelector("b").textContent = terrain.name;
      label.querySelector("input").dataset.url = terrain.url;
      return label;
    }));
    if (!result.terrains.length) filesContainer.innerHTML = '<p class="empty-message">暂无已发布地形；开发者可离线处理后更新公开目录</p>';
    terrainCatalogDialog.dataset.terrains = JSON.stringify(result.terrains);
  } catch (error) {
    document.getElementById("terrain-catalog-directory").textContent = "公开地形目录不可用";
    filesContainer.innerHTML = `<p class="empty-message error-text">${error.message}</p>`;
  }
}

function loadTerrainFromCatalog() {
  const selected = document.querySelector('input[name="terrain-catalog-file"]:checked');
  if (!selected) throw new Error("请先选择一个地形");
  const terrains = JSON.parse(terrainCatalogDialog.dataset.terrains || "[]");
  const terrain = terrains[Number(selected.value)];
  if (!terrain) throw new Error("所选地形目录已失效，请刷新列表");
  return loadSelectedTerrain(terrain);
}

function ensureTerrainOption(terrain) {
  const select = document.getElementById("local-terrain-select");
  let option = Array.from(select.options).find((item) => item.value === terrain.url);
  if (!option) {
    option = document.createElement("option");
    option.value = terrain.url;
    option.textContent = terrain.name || "地形";
    select.append(option);
  }
  select.value = terrain.url;
}

async function loadSelectedTerrain(selectedTerrain) {
  const select = document.getElementById("local-terrain-select");
  const url = selectedTerrain?.url || select.value;
  const message = document.getElementById("layer-message");
  if (!url) return setInlineMessage(message, "请先选择地形", "error");
  const terrain = selectedTerrain
    || terrainEntries.find((entry) => entry.url === url)
    || { name: select.selectedOptions[0]?.textContent || "地形", url };
  const result = await terrainController.loadLocal(terrain, {
    requestVertexNormals: viewer.scene.globe.enableLighting,
    requestWaterMask: false,
  });
  if (result.applied) ensureTerrainOption(terrain);
  return result;
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
    terrainController.useEllipsoid();
  });
  document.getElementById("locate-terrain").addEventListener("click", () => {
    if (!terrainController.flyToCurrentTerrain()) {
      setInlineMessage(document.getElementById("layer-message"), "当前地形未提供有效覆盖范围", "error");
    }
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
  const convertButton = document.getElementById("convert-file");
  const demButton = document.getElementById("convert-dem");
  if (!LOCAL_TOOLS_ENABLED) {
    convertButton.disabled = true;
    demButton.disabled = true;
    document.getElementById("service-status").textContent = "公开站点";
    updateToolResult("conversion-result", "开发者离线工具", "请在开发环境运行 npm run local:server");
    updateToolResult("dem-result", "开发者离线工具", "DEM 需在本地处理，再发布为网站可访问资源");
    return;
  }
  convertButton.addEventListener("click", () => ncInput.click());
  demButton.addEventListener("click", () => demInput.click());
  ncInput.addEventListener("change", async () => {
    const file = ncInput.files?.[0];
    if (!file) return;
    updateToolResult("conversion-result", "正在处理", file.name, "processing");
    try {
      const result = await convertNetCDFFile(file, LOCAL_SERVICE_OPTIONS);
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
      const result = await convertDEMFile(file, LOCAL_SERVICE_OPTIONS);
      updateToolResult("dem-result", "DEM 处理成功", `地形已保存到：${result.outputPath}`, "success");
      await refreshTerrains();
    } catch (error) {
      updateToolResult("dem-result", "DEM 处理失败", error.message, "error");
    } finally { demInput.value = ""; }
  });
  document.querySelector('[data-panel="tools"]').addEventListener("click", async () => {
    const health = await checkLocalService(LOCAL_SERVICE_URL);
    document.getElementById("service-status").textContent = health ? "本地服务已连接" : "本地服务未启动";
    updateToolResult("conversion-result", health ? "本地服务已连接" : "本地服务未启动", health ? health.windDirectory : "请运行 npm run local:server", health ? "success" : "error");
  });
}

async function loadExample() {
  const response = await fetch(EXAMPLE_WIND_URL);
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
  bindWorkspaceChrome();
  bindMapControls();
  bindStatusBar();
  bindCatalog();
  bindHeightControls();
  bindWindControls();
  bindLayerControls();
  bindTools();
  createIcons({
    icons: {
      Box, Building2, CircleOff, FileUp, FolderOpen, FolderCog, Globe2, Home, Layers2, Layers3,
      LocateFixed, Map, Mountain, MountainSnow, PanelLeftClose, PanelRightClose, RefreshCw,
      Satellite, Server, Wind, Wrench, X, ZoomIn, ZoomOut,
    },
  });
  try {
    await setBasemap(CESIUM_ION_TOKEN ? "ion" : "osm");
    await loadExample();
    setStatus("");
  } catch (error) {
    setStatus(`示例风场加载失败：${error.message}`, true);
  }
}

window.addEventListener("beforeunload", () => terrainController.destroy(), { once: true });
main();

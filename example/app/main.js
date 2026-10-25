/*
 * 多二维/三维风场、图层切换和本地 quantized-mesh 地形示例。
 */
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  ArrowDown,
  ArrowUp,
  Box,
  Building2,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleCheck,
  CircleOff,
  Crosshair,
  createIcons,
  Eye,
  EyeOff,
  FileUp,
  FolderOpen,
  FolderCog,
  Globe2,
  GripVertical,
  Home,
  Image as ImageIcon,
  Landmark,
  Layers2,
  Layers3,
  ListChecks,
  LoaderCircle,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  MoonStar,
  MoreHorizontal,
  Mountain,
  MountainSnow,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  RotateCcw,
  Route,
  Satellite,
  Server,
  Shapes,
  Tags,
  Trash2,
  TriangleAlert,
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
import {
  createBrowserDemTerrainSession,
  supportsBrowserDemTerrain,
} from "../services/browserDemTerrain.js";
import { createLocalTerrainSession } from "../services/localTerrainFolderLoader.js";
import { IonAssetLayerManager } from "./ionAssetLayerManager.js";
import { LayerPanelController } from "./layers/LayerPanelController.js";
import { SceneToolsController } from "./sceneToolsController.js";
import { createTerrainActivationRunner } from "./layers/terrainActivation.js";
import { SceneLayerRegistry } from "./layers/SceneLayerRegistry.js";
import {
  basemapLayerDefinition,
  demSessionDetail,
  ionImageryLayerDefinition,
  ionTilesetLayerDefinition,
  taskLayerDefinition,
  terrainSourceDefinition,
  windLayerDefinition,
} from "./layers/layerAdapters.js";
import {
  formatSpeedFactor,
  normalizeParameterValue,
  speedFactorFromSlider,
  speedSliderFromFactor,
} from "./windControlScale.js";

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
// Bing、Google、Sentinel、OpenStreetMap 和 Cesium ion 数据都带有署名要求。
// 公开 Vercel 页面必须保留 Cesium credit 容器，具体位置由页面 CSS 调整到地图右下角。
viewer.cesiumWidget.creditContainer.style.removeProperty("display");
viewer.scene.debugShowFramesPerSecond = false;
viewer.scene.globe.enableLighting = false;
viewer.scene.fog.enabled = true;
viewer.scene.fog.density = 0.00008;

const ellipsoidTerrainProvider = new Cesium.EllipsoidTerrainProvider();
const terrainController = new TerrainController(viewer, {
  ellipsoidTerrainProvider,
});
const windLayers = new WindLayerManager(viewer);
const ionAssetLayers = new IonAssetLayerManager(viewer, Cesium, {
  accessTokenAvailable: Boolean(CESIUM_ION_TOKEN),
});
const sceneLayers = new SceneLayerRegistry();
let activeLayerId = null;
let activeTerrainSourceId = "terrain:ellipsoid";
let basemapLayer = null;
let sceneTools = null;
let basemapRequestId = 0;
let catalogMode = "3d";
let catalogEntries = [];
let terrainEntries = [];
let localTerrainSession = null;
let localTerrainSourceId = null;
const localTerrainSources = new Map();
let browserDemSession = null;
let demProcessingAbortController = null;
let demLocalConversionAbortController = null;
const browserDemSources = new Map();
let demTaskSequence = 0;

const WIND_COLORS = [
  "rgb(74, 152, 255)", "rgb(46, 184, 229)", "rgb(56, 205, 176)",
  "rgb(128, 220, 101)", "rgb(242, 222, 72)", "rgb(247, 157, 55)",
  "rgb(224, 70, 62)", "rgb(151, 53, 126)",
];

const RENDERING_PARAMETER_DEFAULTS = Object.freeze({
  particlesTextureSize: 256,
  speedFactor: 0.3,
  lowSpeedOpacity: 0.72,
  heightScale: 10,
  lineLengthMax: 80,
  densityExponent: 1.5,
});

const sharedOptions = {
  colors: WIND_COLORS,
  particlesTextureSize: RENDERING_PARAMETER_DEFAULTS.particlesTextureSize,
  lineWidth: { min: 0.9, max: 1.6 },
  lineLength: { min: 8, max: RENDERING_PARAMETER_DEFAULTS.lineLengthMax },
  heightScale: RENDERING_PARAMETER_DEFAULTS.heightScale,
  speedFactor: RENDERING_PARAMETER_DEFAULTS.speedFactor,
  dropRate: 0.003,
  dropRateBump: 0.001,
  useViewerBounds: true,
  lowSpeedOpacity: RENDERING_PARAMETER_DEFAULTS.lowSpeedOpacity,
  densityBySpeed: true,
  densityExponent: RENDERING_PARAMETER_DEFAULTS.densityExponent,
  densityFloor: 0.15,
  dynamic: true,
};

const status = document.getElementById("status");
const catalogDialog = document.getElementById("wind-catalog-dialog");
const terrainCatalogDialog = document.getElementById("terrain-catalog-dialog");
const layerPanel = new LayerPanelController(
  document.getElementById("scene-layer-list"),
  sceneLayers,
  {
    onSelect: (entry) => {
      if (entry.group === "wind") selectLayer(entry.id);
    },
    onError: (error) => setStatus(error.message || String(error), true),
  },
);

sceneLayers.subscribe((entries) => {
  document.getElementById("scene-layer-count").textContent = `${entries.filter((entry) => entry.group !== "task").length} 项`;
});

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
  if (state.status !== "loading" && state.status !== "error" && sceneLayers.has(activeTerrainSourceId)) {
    sceneLayers.update(activeTerrainSourceId, {
      status: state.status,
      detail,
    });
  }

  const target = state.requestedType === "world" || state.type === "world"
    ? worldMessage
    : localMessage;
  setInlineMessage(target, detail, messageState);
  if (state.type !== "world" && state.requestedType !== "world") {
    setInlineMessage(worldMessage, "世界地形已关闭");
  }
}

terrainController.subscribe(renderTerrainState);

/**
 * 同步地形管理按钮的可用状态。
 * 下拉框没有候选项时禁用“应用所选地形”，当前地形没有有效 bounds 时由
 * renderTerrainState() 单独禁用定位按钮，避免用户点击后才收到可提前判断的错误。
 */
function syncTerrainActions() {
  const select = document.getElementById("local-terrain-select");
  document.getElementById("load-local-terrain").disabled = !select.value;
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
}

function selectLayer(id) {
  const entry = windLayers.get(id);
  if (!entry) return;
  activeLayerId = id;
  sceneLayers.setExclusiveActive("wind", id);
  updateLegend(entry.layer.windData.speed);
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
  const entries = windLayers.list();
  updateSummary();
  if (!entries.length) {
    document.getElementById("vertical-controls").hidden = true;
    return;
  }
  for (const entry of entries) {
    const definition = windLayerDefinition(entry, windLayers, {
      detail: layerSubtitle,
      onRemoved: async (removedId) => {
        if (activeLayerId === removedId) activeLayerId = windLayers.list().at(-1)?.id ?? null;
        updateSummary();
        if (activeLayerId) selectLayer(activeLayerId);
        else document.getElementById("vertical-controls").hidden = true;
      },
    });
    sceneLayers.upsert({ ...definition, active: entry.id === activeLayerId });
  }
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

function bindWindControls() {
  const parameterDefinitions = [
    { id: "particles", option: "particlesTextureSize", defaultValue: RENDERING_PARAMETER_DEFAULTS.particlesTextureSize },
    { id: "low-speed-opacity", option: "lowSpeedOpacity", defaultValue: RENDERING_PARAMETER_DEFAULTS.lowSpeedOpacity },
    { id: "height", option: "heightScale", defaultValue: RENDERING_PARAMETER_DEFAULTS.heightScale },
    { id: "length", option: "lineLengthMax", defaultValue: RENDERING_PARAMETER_DEFAULTS.lineLengthMax },
    { id: "density", option: "densityExponent", defaultValue: RENDERING_PARAMETER_DEFAULTS.densityExponent },
  ];
  const speedDefinition = {
    id: "speed",
    option: "speedFactor",
    defaultValue: RENDERING_PARAMETER_DEFAULTS.speedFactor,
  };

  /**
   * 所有入口最终都调用同一个提交函数，避免滑块、填写框和恢复默认分别维护状态。
   * 输入值在这里统一限制到 HTML 声明的 min/max/step；更新图层后再回写两个控件，
   * 因此拖动滑块不会抢占正在键入但尚未提交的填写框内容。
   */
  function commitParameter(definition, rawValue, updateLayers = true) {
    const slider = document.getElementById(definition.id);
    const numberInput = document.getElementById(`${definition.id}-value`);
    const constraints = {
      min: Number(numberInput.min),
      max: Number(numberInput.max),
      step: Number(numberInput.step),
    };
    const currentValue = definition.option === "lineLengthMax"
      ? sharedOptions.lineLength.max
      : sharedOptions[definition.option];
    const value = normalizeParameterValue(rawValue, constraints, currentValue);

    numberInput.value = definition.option === "speedFactor"
      ? formatSpeedFactor(value)
      : String(value);
    slider.value = definition.option === "speedFactor"
      ? String(speedSliderFromFactor(value))
      : String(value);
    if (definition.option === "speedFactor") slider.setAttribute("aria-valuetext", formatSpeedFactor(value));

    if (definition.option === "lineLengthMax") {
      sharedOptions.lineLength = { min: 8, max: value };
      if (updateLayers) updateAllLayers({ lineLength: sharedOptions.lineLength });
    } else {
      sharedOptions[definition.option] = value;
      if (updateLayers) updateAllLayers({ [definition.option]: value });
    }
    return value;
  }

  for (const definition of parameterDefinitions) {
    const slider = document.getElementById(definition.id);
    const numberInput = document.getElementById(`${definition.id}-value`);
    slider.addEventListener("input", () => commitParameter(definition, slider.value));
    numberInput.addEventListener("change", () => commitParameter(definition, numberInput.value));
  }

  const speedSlider = document.getElementById(speedDefinition.id);
  const speedNumber = document.getElementById(`${speedDefinition.id}-value`);
  commitParameter(speedDefinition, sharedOptions.speedFactor, false);
  speedSlider.addEventListener("input", () => {
    commitParameter(speedDefinition, speedFactorFromSlider(speedSlider.value));
  });
  speedNumber.addEventListener("change", () => commitParameter(speedDefinition, speedNumber.value));

  document.getElementById("reset-rendering-parameters").addEventListener("click", () => {
    // 先只同步页面和 sharedOptions，再一次性通知每个图层，避免六次连续重建资源。
    for (const definition of [...parameterDefinitions, speedDefinition]) {
      commitParameter(definition, definition.defaultValue, false);
    }
    updateAllLayers({
      particlesTextureSize: sharedOptions.particlesTextureSize,
      speedFactor: sharedOptions.speedFactor,
      lowSpeedOpacity: sharedOptions.lowSpeedOpacity,
      heightScale: sharedOptions.heightScale,
      lineLength: sharedOptions.lineLength,
      densityExponent: sharedOptions.densityExponent,
    });
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

    // 底图固定插入影像栈最底层，只移除上一次底图。不能使用 removeAll()，否则
    // 用户在“公共影像”中打开的 ion 叠加层也会被一并销毁，开关状态将与场景脱节。
    const nextBasemapLayer = provider
      ? viewer.imageryLayers.addImageryProvider(provider, 0)
      : null;
    if (basemapLayer && viewer.imageryLayers.contains(basemapLayer)) {
      viewer.imageryLayers.remove(basemapLayer, true);
    }
    basemapLayer = nextBasemapLayer;
    document.querySelectorAll("[data-basemap]").forEach((button) => button.classList.toggle("active", button.dataset.basemap === mode));
    document.getElementById("basemap-status").textContent = label;
    sceneLayers.upsert(basemapLayerDefinition({ mode, name: label, layer: basemapLayer }));
    setInlineMessage(message, `${label} 已加载`, "success");
  } catch (error) {
    setInlineMessage(message, `底图切换失败：${error.message}`, "error");
  }
}

function updateIonAssetSummary() {
  // 右侧总数由 SceneLayerRegistry 订阅统一计算；保留该函数作为左侧开关流程的
  // 同步节点，后续若需要分类型计数可在这里扩展，而不再直接维护第二套列表 DOM。
}

/**
 * 响应公共影像开关。每个开关由 IonAssetLayerManager 独立管理请求版本，用户在
 * 网络请求结束前关闭开关时，不会出现图层稍后又自行显示的异步竞态。
 */
async function toggleIonImagery(input) {
  const assetId = Number(input.dataset.ionImagery);
  const label = input.dataset.ionLabel || `ion 影像 ${assetId}`;
  const message = document.getElementById("ion-layer-message");
  const enabled = input.checked;
  try {
    setInlineMessage(message, enabled ? `正在加载 ${label}` : `正在关闭 ${label}`);
    const result = await ionAssetLayers.setImageryAsset(assetId, enabled);
    if (!result.applied) return;
    const layerId = `ion-imagery:${assetId}`;
    if (enabled) {
      sceneLayers.register(ionImageryLayerDefinition({
        assetId,
        name: label,
        layer: result.layer,
        manager: ionAssetLayers,
        viewer,
        registry: sceneLayers,
        onRemoved: () => { input.checked = false; },
      }));
      await sceneLayers.move(layerId, 0);
    } else {
      await sceneLayers.remove(layerId, { dispose: false });
    }
    updateIonAssetSummary();
    setInlineMessage(message, `${label} 已${enabled ? "开启" : "关闭"}`, enabled ? "success" : "");
  } catch (error) {
    input.checked = false;
    updateIonAssetSummary();
    setInlineMessage(message, `${label} 加载失败：${error.message}`, "error");
  }
}

/**
 * 响应 ion 3D Tiles 开关。Google Photorealistic 数据量明显大于普通建筑图层，
 * 因此限制客户端缓存并适度放宽屏幕空间误差，降低公开网站访客的显存和带宽压力。
 */
async function toggleIonTileset(input) {
  const assetId = Number(input.dataset.ionTileset);
  const label = input.dataset.ionLabel || `ion 3D Tiles ${assetId}`;
  const message = document.getElementById("ion-layer-message");
  const enabled = input.checked;
  const options = assetId === 2275207
    ? {
        maximumScreenSpaceError: 24,
        cacheBytes: 256 * 1024 * 1024,
        maximumCacheOverflowBytes: 128 * 1024 * 1024,
      }
    : {};
  try {
    setInlineMessage(message, enabled ? `正在加载 ${label}` : `正在关闭 ${label}`);
    const result = await ionAssetLayers.setTilesetAsset(assetId, enabled, options);
    if (!result.applied) return;
    const layerId = `ion-tileset:${assetId}`;
    if (enabled) {
      sceneLayers.register(ionTilesetLayerDefinition({
        assetId,
        name: label,
        tileset: result.tileset,
        manager: ionAssetLayers,
        viewer,
        onRemoved: () => { input.checked = false; },
      }));
    } else {
      await sceneLayers.remove(layerId, { dispose: false });
    }
    updateIonAssetSummary();
    setInlineMessage(message, `${label} 已${enabled ? "开启" : "关闭"}`, enabled ? "success" : "");
  } catch (error) {
    input.checked = false;
    updateIonAssetSummary();
    setInlineMessage(message, `${label} 加载失败：${error.message}`, "error");
  }
}

function initializeIonAssetControls() {
  const controls = document.querySelectorAll("[data-ion-imagery], [data-ion-tileset], [data-ion-terrain]");
  if (CESIUM_ION_TOKEN) {
    setInlineMessage(document.getElementById("ion-layer-message"), "Cesium ion 公共资产待命");
    return;
  }

  // ion 公共资产仍要求站点提供受域名限制的浏览器 Token。“公共”不表示可以
  // 绕过 ion 鉴权；禁用开关比让每次点击都产生失败请求更适合公开 Vercel 页面。
  controls.forEach((control) => { control.disabled = true; });
  setInlineMessage(
    document.getElementById("ion-layer-message"),
    "未配置 VITE_CESIUM_ION_TOKEN，Cesium ion 公共资产不可用",
    "error",
  );
}

function terrainSourceId(terrain) {
  const source = terrain.source || "catalog";
  return `terrain:${source}:${terrain.url || terrain.name}`;
}

function flyToBounds(bounds, duration = 1.2) {
  if (!bounds) return false;
  const values = Array.isArray(bounds)
    ? bounds
    : [bounds.west, bounds.south, bounds.east, bounds.north];
  if (values.length !== 4 || !values.every(Number.isFinite)) return false;
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(...values),
    duration,
  });
  return true;
}

/**
 * TerrainController 保证异步请求只有最后一次能够进入场景；这里再把请求状态映射到
 * 统一地形源条目。只有新 Provider 成功应用后才释放活动的浏览器 DEM Worker，
 * 因而失败切换不会破坏仍在显示的旧地形。
 */
const runTerrainActivation = createTerrainActivationRunner({
  registry: sceneLayers,
  getActiveId: () => activeTerrainSourceId,
  setActiveId: (id) => { activeTerrainSourceId = id; },
  releasePrevious: releaseBrowserDemSession,
});

function registerCatalogTerrainSource(terrain) {
  const id = terrainSourceId(terrain);
  sceneLayers.upsert(terrainSourceDefinition({
    id,
    type: "quantized-mesh",
    name: terrain.name || "目录地形",
    source: terrain.source === "local" ? "开发者本地目录" : "公开地形目录",
    detail: terrain.bounds ? "quantized-mesh · 已提供覆盖范围" : "quantized-mesh",
    bounds: terrain.bounds,
    active: id === activeTerrainSourceId,
    activate: () => runTerrainActivation(id, async () => {
      cancelPendingBrowserDemProcessing();
      const result = await terrainController.loadLocal(terrain, {
        requestVertexNormals: viewer.scene.globe.enableLighting,
        requestWaterMask: false,
      });
      if (result.applied) ensureTerrainOption(terrain);
      return result;
    }),
    locate: terrain.bounds ? () => flyToBounds(terrain.bounds) : undefined,
    removable: true,
    remove: async () => {
      if (activeTerrainSourceId === id) await sceneLayers.perform("terrain:ellipsoid", "activate");
      const select = document.getElementById("local-terrain-select");
      Array.from(select.options).find((option) => option.value === terrain.url)?.remove();
      syncTerrainActions();
    },
  }));
  return id;
}

function registerLocalFolderTerrainSource(session) {
  const id = `terrain:browser-folder:${session.id}`;
  const terrain = {
    name: session.name,
    url: session.url,
    bounds: session.bounds,
    source: "browser-folder",
  };
  localTerrainSources.set(id, session);
  sceneLayers.register(terrainSourceDefinition({
    id,
    type: "quantized-mesh-folder",
    name: session.name,
    source: "浏览器本地文件夹",
    detail: `${session.tileCount} 个瓦片 · 文件未上传`,
    bounds: session.bounds,
    localOnly: true,
    removable: true,
    activate: () => runTerrainActivation(id, () => terrainController.loadLocal(terrain, {
      requestVertexNormals: viewer.scene.globe.enableLighting,
      requestWaterMask: false,
    })),
    locate: session.bounds ? () => flyToBounds(session.bounds) : undefined,
    remove: async () => {
      if (activeTerrainSourceId === id) await sceneLayers.perform("terrain:ellipsoid", "activate");
      if (localTerrainSession === session) {
        localTerrainSession = null;
        localTerrainSourceId = null;
      }
      localTerrainSources.delete(id);
      const select = document.getElementById("local-terrain-select");
      Array.from(select.options).find((option) => option.value === session.url)?.remove();
      syncTerrainActions();
      await session.dispose();
    },
  }));
  return { id, terrain };
}

function registerCoreTerrainSources() {
  sceneLayers.upsert(terrainSourceDefinition({
    id: "terrain:ellipsoid",
    type: "ellipsoid",
    name: "关闭高程地形",
    source: "Cesium Ellipsoid",
    detail: "使用椭球表面，不加载高程瓦片",
    active: activeTerrainSourceId === "terrain:ellipsoid",
    activate: () => runTerrainActivation("terrain:ellipsoid", async () => {
      cancelPendingBrowserDemProcessing();
      return { applied: true, state: terrainController.useEllipsoid() };
    }),
  }));
  sceneLayers.upsert(terrainSourceDefinition({
    id: "terrain:world",
    type: "world",
    name: "Cesium World Terrain",
    source: "Cesium ion 1",
    detail: CESIUM_ION_TOKEN ? "在线全球地形" : "缺少公开浏览器 Token，当前不可用",
    active: activeTerrainSourceId === "terrain:world",
    activate: CESIUM_ION_TOKEN ? () => runTerrainActivation("terrain:world", async () => {
      cancelPendingBrowserDemProcessing();
      return terrainController.loadWorld({
        requestVertexNormals: viewer.scene.globe.enableLighting,
        requestWaterMask: false,
      });
    }) : false,
  }));
}

async function toggleWorldTerrain(enabled) {
  const checkbox = document.getElementById("terrain-toggle");
  const message = document.getElementById("ion-layer-message");
  cancelPendingBrowserDemProcessing();
  try {
    if (enabled) {
      if (!CESIUM_ION_TOKEN) throw new Error("未配置 VITE_CESIUM_ION_TOKEN");
      const result = await sceneLayers.perform("terrain:world", "activate");
      if (result?.applied === false) throw result.error || new Error("世界地形加载失败");
    } else if (terrainController.getState().type === "world"
      || terrainController.getState().requestedType === "world") {
      await sceneLayers.perform("terrain:ellipsoid", "activate");
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
    terrainEntries.forEach(registerCatalogTerrainSource);
    select.replaceChildren(...terrainEntries.map((terrain) => {
      const option = document.createElement("option");
      option.value = terrain.url;
      option.textContent = terrain.name;
      return option;
    }));
    if (!terrainEntries.length) select.innerHTML = '<option value="">暂无已发布地形</option>';
    else if (terrainEntries.some((terrain) => terrain.url === selectedUrl)) select.value = selectedUrl;

    // 浏览器文件夹地形不属于公开目录或本地服务目录。刷新目录时继续保留当前
    // 会话选项，否则 Cesium 仍在显示地形，但下拉框和“应用所选地形”会失去对应项。
    for (const session of localTerrainSources.values()) {
      ensureTerrainOption({
        name: session.name,
        url: session.url,
        bounds: session.bounds,
        source: "browser-folder",
      });
    }
    if (selectedUrl && Array.from(select.options).some((option) => option.value === selectedUrl)) {
      select.value = selectedUrl;
    }
    syncTerrainActions();
    const detail = result.localWarning
      ? `找到 ${terrainEntries.length} 个公开地形；本地目录不可用`
      : `找到 ${terrainEntries.length} 个可用地形`;
    setInlineMessage(message, detail, terrainEntries.length ? "success" : "");
  } catch (error) {
    setInlineMessage(message, error.message, "error");
    syncTerrainActions();
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
    result.terrains.forEach(registerCatalogTerrainSource);
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
  option.dataset.source = terrain.source || "catalog";
  select.value = terrain.url;
  syncTerrainActions();
}

async function releaseBrowserDemSession(exceptSession) {
  if (!browserDemSession || browserDemSession === exceptSession) return;
  const session = browserDemSession;
  browserDemSession = null;
  for (const source of browserDemSources.values()) {
    if (source.session === session) source.session = null;
  }
  await session.dispose();
}

function cancelPendingBrowserDemProcessing() {
  // 地形选择遵循“最后一次用户操作优先”。如果 GeoTIFF 仍在 Worker 中解析，继续
  // 执行可能会在目录地形、世界地形或椭球已经选中后把旧 DEM 再次应用到场景。
  demProcessingAbortController?.abort();
}

function throwIfDemProcessingCancelled(signal) {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("DEM 处理已取消", "AbortError");
}

async function loadSelectedTerrain(selectedTerrain) {
  const select = document.getElementById("local-terrain-select");
  const url = selectedTerrain?.url || select.value;
  const message = document.getElementById("layer-message");
  if (!url) return setInlineMessage(message, "请先选择地形", "error");
  cancelPendingBrowserDemProcessing();
  const terrain = selectedTerrain
    || terrainEntries.find((entry) => entry.url === url)
    || {
      name: select.selectedOptions[0]?.textContent || "地形",
      url,
      source: select.selectedOptions[0]?.dataset.source,
    };
  const folderSource = terrain.source === "browser-folder"
    ? Array.from(localTerrainSources.entries()).find(([, session]) => session.url === url)
    : undefined;
  const id = folderSource
    ? folderSource[0]
    : registerCatalogTerrainSource(terrain);
  return sceneLayers.perform(id, "activate");
}

function bindLayerControls() {
  document.querySelectorAll("[data-basemap]").forEach((button) => button.addEventListener("click", () => setBasemap(button.dataset.basemap)));
  document.querySelectorAll("[data-ion-imagery]").forEach((input) => {
    input.addEventListener("change", () => toggleIonImagery(input));
  });
  document.querySelectorAll("[data-ion-tileset]").forEach((input) => {
    input.addEventListener("change", () => toggleIonTileset(input));
  });
  document.getElementById("terrain-toggle").addEventListener("change", (event) => toggleWorldTerrain(event.target.checked));
  document.getElementById("refresh-terrains").addEventListener("click", refreshTerrains);
  document.getElementById("local-terrain-select").addEventListener("change", syncTerrainActions);
  // DOM 会把 click Event 作为监听器的第一个参数。loadSelectedTerrain() 的可选参数
  // 是目录中的地形对象，不能直接把函数当监听器，否则 Event 会被误判为地形条目，
  // 最终因缺少 url 而加载失败。按钮入口显式无参数调用，下拉框值再由函数内部读取。
  document.getElementById("load-local-terrain").addEventListener("click", () => loadSelectedTerrain());
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
  document.getElementById("disable-terrain").addEventListener("click", async () => {
    cancelPendingBrowserDemProcessing();
    await sceneLayers.perform("terrain:ellipsoid", "activate");
  });
  document.getElementById("locate-terrain").addEventListener("click", () => {
    if (!terrainController.flyToCurrentTerrain()) {
      setInlineMessage(document.getElementById("layer-message"), "当前地形未提供有效覆盖范围", "error");
    }
  });
  syncTerrainActions();
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

async function loadTerrainFolder(fileList) {
  cancelPendingBrowserDemProcessing();
  updateToolResult("local-terrain-folder-result", "正在查询文件夹", "正在检查 layer.json 和地形瓦片", "processing");
  let session;
  try {
    session = await createLocalTerrainSession(fileList);
    updateToolResult(
      "local-terrain-folder-result",
      "目录检查通过，正在加载",
      `${session.tileCount} 个瓦片，${formatBytes(session.totalBytes)}`,
      "processing",
    );
    const { id, terrain } = registerLocalFolderTerrainSource(session);
    const result = await sceneLayers.perform(id, "activate");
    if (!result.applied) throw result.error || new Error("地形加载请求已取消");

    const previousSession = localTerrainSession;
    const previousSourceId = localTerrainSourceId;
    localTerrainSession = session;
    localTerrainSourceId = id;
    ensureTerrainOption(terrain);
    // 已有浏览器文件夹地形作为候选保留，用户可在右侧再次切换回去；每个文件对象
    // 只由自己的 Service Worker 会话持有，只有用户明确移除条目或关闭页面才释放。
    void previousSession;
    void previousSourceId;
    const levelText = Number.isFinite(session.minLevel) && Number.isFinite(session.maxLevel)
      ? `，层级 ${session.minLevel}-${session.maxLevel}`
      : "";
    updateToolResult(
      "local-terrain-folder-result",
      "本地地形已加载",
      `${session.folderName}：${session.tileCount} 个瓦片${levelText}，文件未上传`,
      "success",
    );
  } catch (error) {
    if (session && session !== localTerrainSession) await session.dispose();
    const failedId = session && `terrain:browser-folder:${session.id}`;
    if (failedId) {
      localTerrainSources.delete(failedId);
      await sceneLayers.remove(failedId, { dispose: false });
    }
    updateToolResult("local-terrain-folder-result", "本地地形加载失败", error.message || String(error), "error");
  }
}

function registerBrowserDemTerrainSource(source) {
  const metadata = source.metadata;
  sceneLayers.upsert(terrainSourceDefinition({
    id: source.id,
    type: "browser-dem",
    name: metadata.name,
    source: "浏览器 GeoTIFF",
    detail: demSessionDetail(metadata),
    bounds: metadata.bounds,
    localOnly: true,
    removable: true,
    active: source.id === activeTerrainSourceId,
    activate: async () => {
      if (!source.session) return loadBrowserDem(source.file, { sourceId: source.id });
      return applyBrowserDemSession(source, source.session);
    },
    locate: () => flyToBounds(metadata.bounds),
    remove: async () => {
      if (activeTerrainSourceId === source.id) await sceneLayers.perform("terrain:ellipsoid", "activate");
      if (browserDemSession === source.session) browserDemSession = null;
      await source.session?.dispose();
      source.session = null;
      browserDemSources.delete(source.id);
    },
  }));
}

async function applyBrowserDemSession(source, session) {
  const result = await runTerrainActivation(source.id, () => terrainController.loadProvider({
    name: session.name,
    bounds: session.bounds,
  }, session.provider), { releaseBrowser: false });
  if (!result.applied) return result;

  // 浏览器 DEM 只保留当前活动源的解码栅格和 Worker。其他候选源保留 File 引用与
  // 元数据，用户再次激活时重新解析，避免多个完整 DEM 长期占用访客内存。
  const previousSession = browserDemSession;
  browserDemSession = session;
  source.session = session;
  if (previousSession && previousSession !== session) {
    for (const candidate of browserDemSources.values()) {
      if (candidate.session === previousSession) candidate.session = null;
    }
    await previousSession.dispose();
  }
  terrainController.flyToCurrentTerrain({ duration: 1.2 });
  return result;
}

async function loadBrowserDem(file, options = {}) {
  const demButton = document.getElementById("convert-dem");
  const cancelButton = document.getElementById("cancel-dem-processing");
  cancelPendingBrowserDemProcessing();
  const abortController = new AbortController();
  demProcessingAbortController = abortController;
  const taskId = options.taskId || `task:dem:${Date.now().toString(36)}:${++demTaskSequence}`;
  const taskName = `处理 DEM：${file.name}`;
  sceneLayers.upsert(taskLayerDefinition({
    id: taskId,
    type: "dem",
    name: taskName,
    status: "queued",
    detail: `${formatBytes(file.size)} · 等待读取`,
    cancel: () => abortController.abort(new DOMException("DEM 处理已取消", "AbortError")),
    retry: async () => {
      // 重试使用新任务 ID，避免已结束请求的晚到回调覆盖新一轮任务状态。
      abortController.abort(new DOMException("DEM 处理正在重试", "AbortError"));
      await sceneLayers.remove(taskId, { dispose: false });
      return loadBrowserDem(file, { ...options, taskId: undefined });
    },
    remove: () => abortController.abort(new DOMException("DEM 任务已移除", "AbortError")),
  }));
  demButton.disabled = true;
  cancelButton.hidden = false;
  sceneLayers.update(taskId, { status: "reading", detail: `${file.name} · 文件不会上传` });
  updateToolResult("dem-result", "正在读取本地 DEM", `${file.name}，${formatBytes(file.size)}，文件不会上传`, "processing");

  let session;
  let source;
  try {
    session = await createBrowserDemTerrainSession(file, {
      signal: abortController.signal,
      onStatus: (stage, detail) => {
        if (abortController.signal.aborted || demProcessingAbortController !== abortController) return;
        sceneLayers.update(taskId, { status: "processing", detail: `${stage} · ${detail}` });
        updateToolResult("dem-result", "正在处理本地 DEM", detail, "processing");
      },
    });
    throwIfDemProcessingCancelled(abortController.signal);
    sceneLayers.update(taskId, {
      status: "applying",
      detail: `${session.width} × ${session.height} · ${session.projection} · 正在应用`,
    });
    updateToolResult(
      "dem-result",
      "DEM 已解析，正在应用地形",
      `${session.width} x ${session.height}，${session.projection}，层级 0-${session.maxLevel}`,
      "processing",
    );
    const sourceId = options.sourceId || `terrain:${session.id}`;
    source = browserDemSources.get(sourceId) || {
      id: sourceId,
      file,
      metadata: session,
      session: null,
    };
    source.file = file;
    source.metadata = session;
    source.session = session;
    browserDemSources.set(sourceId, source);
    registerBrowserDemTerrainSource(source);
    const result = await applyBrowserDemSession(source, session);
    throwIfDemProcessingCancelled(abortController.signal);
    if (!result.applied) throw result.error || new Error("浏览器 DEM 地形加载请求已取消");
    if (demProcessingAbortController !== abortController) {
      throw new DOMException("DEM 处理已被后续任务取代", "AbortError");
    }

    // Provider 成功进入场景后，处理任务退出任务组，只保留可重新激活的地形源。
    if (demProcessingAbortController === abortController) demProcessingAbortController = null;
    sceneLayers.setExclusiveActive("terrain", sourceId);
    await sceneLayers.remove(taskId, { dispose: false });
    updateToolResult(
      "dem-result",
      "本地 DEM 已加载",
      `${session.fileName}：${session.projectionCode}，高程 ${session.minHeight.toFixed(1)}-${session.maxHeight.toFixed(1)} m，文件未上传`,
      "success",
    );
    return result;
  } catch (error) {
    if (session && session !== browserDemSession) await session.dispose();
    if (source?.session === session && browserDemSession !== session) source.session = null;
    const cancelled = error?.name === "AbortError";
    if (sceneLayers.has(taskId) && demProcessingAbortController === abortController) {
      sceneLayers.update(taskId, {
        status: cancelled ? "cancelled" : "failed",
        detail: cancelled ? `${file.name} · 已取消，可重试` : (error.message || String(error)),
      });
    }
    if (demProcessingAbortController === abortController) {
      updateToolResult(
        "dem-result",
        cancelled ? "DEM 处理已取消" : "浏览器 DEM 处理失败",
        cancelled ? file.name : (error.message || String(error)),
        cancelled ? "" : "error",
      );
    }
    return { applied: false, error };
  } finally {
    if (demProcessingAbortController === abortController) {
      demProcessingAbortController = null;
      demButton.disabled = false;
      cancelButton.hidden = true;
    }
  }
}

async function convertDemWithLocalService(file) {
  demLocalConversionAbortController?.abort(new DOMException("已开始新的 DEM 转换", "AbortError"));
  const taskId = `task:dem-convert:${Date.now().toString(36)}:${++demTaskSequence}`;
  const abortController = new AbortController();
  demLocalConversionAbortController = abortController;
  const isCurrentTask = () => demLocalConversionAbortController === abortController;
  sceneLayers.register(taskLayerDefinition({
    id: taskId,
    type: "dem-convert",
    name: `离线转换 DEM：${file.name}`,
    status: "queued",
    detail: "等待开发者本地服务接收",
    cancel: () => abortController.abort(new DOMException("DEM 转换已取消", "AbortError")),
    retry: async () => {
      abortController.abort(new DOMException("DEM 转换正在重试", "AbortError"));
      await sceneLayers.remove(taskId, { dispose: false });
      return convertDemWithLocalService(file);
    },
    remove: () => abortController.abort(new DOMException("DEM 转换任务已移除", "AbortError")),
  }));
  sceneLayers.update(taskId, { status: "processing", detail: "Docker CTB 正在生成 quantized-mesh" });
  updateToolResult("dem-result", "正在离线转换 DEM", "Docker CTB 处理可能需要较长时间", "processing");
  try {
    const result = await convertDEMFile(file, { ...LOCAL_SERVICE_OPTIONS, signal: abortController.signal });
    if (!isCurrentTask()) return;
    sceneLayers.update(taskId, { status: "applying", detail: "转换完成，正在刷新地形目录" });
    updateToolResult("dem-result", "DEM 处理成功", `地形已保存到：${result.outputPath}`, "success");
    await refreshTerrains();
    await sceneLayers.remove(taskId, { dispose: false });
  } catch (error) {
    if (sceneLayers.has(taskId) && isCurrentTask()) {
      const cancelled = error?.name === "AbortError";
      sceneLayers.update(taskId, {
        status: cancelled ? "cancelled" : "failed",
        detail: cancelled ? "离线转换已取消" : (error.message || String(error)),
      });
      updateToolResult("dem-result", cancelled ? "DEM 转换已取消" : "DEM 处理失败", error.message || String(error), cancelled ? "" : "error");
    }
  } finally {
    if (isCurrentTask()) demLocalConversionAbortController = null;
  }
}

function bindTools() {
  sceneTools = new SceneToolsController(viewer, Cesium, sceneLayers, {
    onStatus: (message) => setStatus(message),
  });
  const ncInput = document.getElementById("convert-file-input");
  const demInput = document.getElementById("dem-file-input");
  const terrainFolderInput = document.getElementById("local-terrain-folder-input");
  const convertButton = document.getElementById("convert-file");
  const demButton = document.getElementById("convert-dem");
  const cancelDemButton = document.getElementById("cancel-dem-processing");
  const terrainFolderButton = document.getElementById("load-local-terrain-folder");
  const browserDemSupported = supportsBrowserDemTerrain(window);

  const folderLoadingSupported = window.isSecureContext
    && Boolean(navigator.serviceWorker)
    && "webkitdirectory" in terrainFolderInput;
  if (folderLoadingSupported) {
    terrainFolderButton.addEventListener("click", () => terrainFolderInput.click());
    terrainFolderInput.addEventListener("change", async () => {
      const files = terrainFolderInput.files;
      if (files?.length) await loadTerrainFolder(files);
      terrainFolderInput.value = "";
    });
  } else {
    terrainFolderButton.disabled = true;
    updateToolResult(
      "local-terrain-folder-result",
      "当前浏览器不支持",
      "请使用支持文件夹选择和 Service Worker 的 HTTPS 浏览器",
      "error",
    );
  }

  if (!LOCAL_TOOLS_ENABLED) {
    convertButton.disabled = true;
    document.getElementById("service-status").textContent = "公开站点";
    updateToolResult("conversion-result", "开发者离线工具", "请在开发环境运行 npm run local:server");
  } else {
    convertButton.addEventListener("click", () => ncInput.click());
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
  }

  if (!browserDemSupported && !LOCAL_TOOLS_ENABLED) {
    demButton.disabled = true;
    updateToolResult("dem-result", "当前浏览器不支持", "请使用支持 Web Worker 和 File API 的现代桌面浏览器", "error");
  } else {
    demButton.addEventListener("click", () => demInput.click());
    cancelDemButton.addEventListener("click", () => demProcessingAbortController?.abort());
  }
  demInput.addEventListener("change", async () => {
    const file = demInput.files?.[0];
    if (!file) return;
    try {
      if (/\.tiff?$/i.test(file.name) && browserDemSupported) await loadBrowserDem(file);
      else if (LOCAL_TOOLS_ENABLED) await convertDemWithLocalService(file);
      else updateToolResult(
        "dem-result",
        "浏览器模式不支持该格式",
        "公开网站请使用 .tif 或 .tiff；IMG、ASC、DEM 需要开发者离线服务",
        "error",
      );
    } finally { demInput.value = ""; }
  });
  if (LOCAL_TOOLS_ENABLED) {
    document.querySelector('[data-panel="tools"]').addEventListener("click", async () => {
      const health = await checkLocalService(LOCAL_SERVICE_URL);
      document.getElementById("service-status").textContent = health ? "本地服务已连接" : "本地服务未启动";
      updateToolResult("conversion-result", health ? "本地服务已连接" : "本地服务未启动", health ? health.windDirectory : "请运行 npm run local:server", health ? "success" : "error");
    });
  }
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
  registerCoreTerrainSources();
  bindPanelTabs();
  bindWorkspaceChrome();
  bindMapControls();
  bindStatusBar();
  bindCatalog();
  bindHeightControls();
  bindWindControls();
  bindLayerControls();
  bindTools();
  initializeIonAssetControls();
  createIcons({
    icons: {
      Box, Building2, CircleOff, FileUp, FolderOpen, FolderCog, Globe2, Home, Image: ImageIcon,
      ArrowDown, ArrowUp, ChevronDown, ChevronsDown, ChevronsUp, Circle, CircleCheck, Eye, EyeOff,
      Crosshair, GripVertical, Landmark, Layers2, Layers3, ListChecks, LoaderCircle, LocateFixed, Map: MapIcon, MapPin,
      MoreHorizontal, MoonStar, Mountain, MountainSnow, PanelLeftClose, PanelRightClose, RefreshCw,
      RotateCcw, Route, Satellite, Server, Shapes, Tags, Trash2, TriangleAlert, Wind, Wrench, X, ZoomIn, ZoomOut,
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

window.addEventListener("beforeunload", () => {
  demProcessingAbortController?.abort();
  for (const session of localTerrainSources.values()) session.dispose();
  browserDemSession?.dispose();
  browserDemSources.clear();
  sceneTools?.destroy();
  layerPanel.destroy();
  sceneLayers.clear({ dispose: false });
  ionAssetLayers.destroy();
  terrainController.destroy();
}, { once: true });
main();

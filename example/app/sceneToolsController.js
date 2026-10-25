import { loadVectorFile, VECTOR_FILE_LIMITS } from "../services/vectorFileLoader.js";

const MODEL_FILE_LIMIT = 100 * 1024 * 1024;
const TOOL_GROUP = "vector";

function createId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `scene-tool:${prefix}:${suffix}`;
}

export function setOptions(select, records, emptyLabel, preferredId = "") {
  const previous = select.value;
  select.replaceChildren();
  if (!records.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
    return "";
  }
  for (const record of records) {
    const option = document.createElement("option");
    option.value = record.id;
    option.textContent = record.name;
    select.append(option);
  }
  const selectedId = records.some((record) => record.id === preferredId)
    ? preferredId
    : records.some((record) => record.id === previous) ? previous : records.at(-1).id;
  select.value = selectedId;
  return select.value;
}

function setResult(element, title, detail, state = "") {
  if (!element) return;
  element.className = `conversion-result${state ? ` ${state}` : ""}`;
  const titleNode = element.querySelector("b");
  const detailNode = element.querySelector("span");
  if (titleNode) titleNode.textContent = title;
  if (detailNode) detailNode.textContent = detail;
}

function cartographicDetails(Cesium, cartesian) {
  const value = Cesium.Cartographic.fromCartesian(cartesian);
  if (!value) return null;
  return {
    longitude: Cesium.Math.toDegrees(value.longitude),
    latitude: Cesium.Math.toDegrees(value.latitude),
    height: value.height,
  };
}

function formatCoordinate(details, heightSource) {
  return `经度 ${details.longitude.toFixed(6)}° · 纬度 ${details.latitude.toFixed(6)}° · 高度 ${details.height.toFixed(1)} m（${heightSource}）`;
}

function entitiesAtPosition(Cesium, position, radius = 7) {
  return {
    point: { pixelSize: radius, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
    position,
  };
}

/**
 * 管理工作台中的点、路径、浏览器本地模型和矢量文件。
 * Cesium 点击输入、页面控件监听、Entity、DataSource 与 Blob URL 由本实例统一释放，
 * 避免切换工具模式或移除场景条目后留下仍然响应的事件和本地文件引用。
 */
export class SceneToolsController {
  constructor(viewer, Cesium, sceneLayers, options = {}) {
    this.viewer = viewer;
    this.Cesium = Cesium;
    this.sceneLayers = sceneLayers;
    this.onStatus = options.onStatus ?? (() => {});
    this.points = new Map();
    this.routes = new Map();
    this.vectorLayers = new Map();
    this.selectedPointId = "";
    this.selectedRouteId = "";
    this.mode = "";
    this.previewRoute = null;
    this.playbackRouteId = "";
    this.clockSnapshot = null;
    this.domListeners = [];
    this.destroyed = false;
    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    this.handler.setInputAction((movement) => this.handleMapClick(movement.position), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.removeClockListener = viewer.clock.onTick.addEventListener(() => this.checkPlaybackCompletion());
    this.bindControls();
    this.render();
  }

  bind(element, type, listener) {
    if (!element) return;
    element.addEventListener(type, listener);
    this.domListeners.push(() => element.removeEventListener(type, listener));
  }

  bindControls() {
    for (const button of document.querySelectorAll("[data-scene-mode]")) {
      this.bind(button, "click", () => this.setMode(this.mode === button.dataset.sceneMode ? "" : button.dataset.sceneMode));
    }
    this.bind(document.getElementById("scene-tool-cancel"), "click", () => this.setMode(""));
    this.bind(document, "keydown", (event) => {
      if (event.key === "Escape" && this.mode) {
        event.preventDefault();
        this.setMode("");
      }
    });
    this.bind(document.getElementById("scene-point-select"), "change", (event) => {
      this.selectedPointId = event.target.value;
      this.renderPointEditor();
    });
    this.bind(document.getElementById("scene-point-save"), "click", () => this.renamePoint());
    this.bind(document.getElementById("scene-point-remove"), "click", () => this.removeSelectedPoint());
    this.bind(document.getElementById("scene-route-select"), "change", (event) => {
      this.selectedRouteId = event.target.value;
      this.renderRouteEditor();
    });
    this.bind(document.getElementById("scene-route-name"), "change", () => this.renameRoute());
    this.bind(document.getElementById("scene-route-save"), "click", () => this.renameRoute());
    this.bind(document.getElementById("scene-route-speed"), "change", () => this.updateRouteButtons());
    this.bind(document.getElementById("scene-route-finish"), "click", () => this.finishRoute());
    this.bind(document.getElementById("scene-route-remove"), "click", () => this.removeSelectedRoute());
    this.bind(document.getElementById("scene-model-file"), "change", (event) => this.loadModelFile(event.target.files?.[0]));
    this.bind(document.getElementById("scene-route-play"), "click", () => this.startRoutePlayback());
    this.bind(document.getElementById("scene-route-pause"), "click", () => this.pauseRoutePlayback());
    this.bind(document.getElementById("scene-route-resume"), "click", () => this.resumeRoutePlayback());
    this.bind(document.getElementById("scene-route-stop"), "click", () => this.stopRoutePlayback());
    this.bind(document.getElementById("scene-vector-load"), "click", () => document.getElementById("scene-vector-file")?.click());
    this.bind(document.getElementById("scene-vector-file"), "change", (event) => this.loadVector(event.target.files));
  }

  setMode(mode) {
    if (this.mode === "route" && this.previewRoute && mode !== "route") this.discardPreviewRoute();
    this.mode = mode;
    for (const button of document.querySelectorAll("[data-scene-mode]")) {
      const active = button.dataset.sceneMode === mode;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("active", active);
    }
    const status = document.getElementById("scene-tool-mode-status");
    const instructions = {
      point: ["创建点模式", "点击地图添加点位；再次点击点位可选中并编辑名称"],
      route: ["路线绘制模式", "依次点击地图添加路径点，至少两个点后结束路线"],
      coordinate: ["坐标拾取模式", "点击地图读取经纬度与位置高度"],
    };
    setResult(status, ...(instructions[mode] ?? ["地图工具待命", "选择一种模式后在地图上操作"]));
    const cancelButton = document.getElementById("scene-tool-cancel");
    if (cancelButton) cancelButton.hidden = !mode;
    const finishButton = document.getElementById("scene-route-finish");
    if (finishButton) finishButton.disabled = mode !== "route" || (this.previewRoute?.positions.length ?? 0) < 2;
    this.renderRouteStatus();
  }

  handleMapClick(screenPosition) {
    if (this.destroyed) return;
    if (!this.mode) {
      this.selectPointAt(screenPosition);
      return;
    }
    if (this.mode === "point" && this.selectPointAt(screenPosition)) {
      setResult(document.getElementById("scene-tool-mode-status"), "已选中点位", "名称可在下方编辑；继续点击空白地图可创建新点", "success");
      return;
    }
    const picked = this.pickSurface(screenPosition);
    if (!picked) {
      if (this.mode === "coordinate") setResult(document.getElementById("scene-tool-mode-status"), "未拾取到位置", "请点击地球或可见场景表面", "error");
      return;
    }
    if (this.mode === "point") this.createPoint(picked.position, picked.source);
    else if (this.mode === "route") this.addRoutePoint(picked.position);
    else if (this.mode === "coordinate") {
      const details = cartographicDetails(this.Cesium, picked.position);
      if (!details) return;
      const result = document.getElementById("scene-coordinate-result");
      if (result) result.textContent = formatCoordinate(details, picked.source);
      this.onStatus(formatCoordinate(details, picked.source));
      this.setMode("");
    }
  }

  /** 深度拾取可读取模型/地形；不可用时退回地形射线，再退回 WGS84 椭球。 */
  pickSurface(screenPosition) {
    const { scene, camera } = this.viewer;
    if (scene.pickPositionSupported) {
      try {
        const position = scene.pickPosition(screenPosition);
        if (position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
          return { position, source: "场景深度" };
        }
      } catch {
        // 深度读取在未完成首帧或浏览器不支持时可能抛错，下面继续尝试公开地表 API。
      }
    }
    const ray = camera.getPickRay(screenPosition);
    const terrainPosition = ray && scene.globe.pick(ray, scene);
    if (terrainPosition) return { position: terrainPosition, source: "地形表面" };
    const ellipsoidPosition = camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid);
    return ellipsoidPosition ? { position: ellipsoidPosition, source: "WGS84 椭球" } : null;
  }

  createPoint(position, heightSource) {
    const id = createId("point");
    const details = cartographicDetails(this.Cesium, position);
    const name = `点位 ${this.points.size + 1}`;
    const entity = this.viewer.entities.add({
      id,
      ...entitiesAtPosition(this.Cesium, position, 9),
      label: {
        text: name,
        font: "13px sans-serif",
        fillColor: this.Cesium.Color.WHITE,
        outlineColor: this.Cesium.Color.BLACK,
        outlineWidth: 3,
        style: this.Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new this.Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { sceneToolType: "point", sceneToolId: id },
    });
    const record = { id, name, entity, details, heightSource };
    this.points.set(id, record);
    this.sceneLayers.register({
      id, group: TOOL_GROUP, type: "map-point", name, source: "浏览器标注",
      detail: details ? `${details.longitude.toFixed(5)}°, ${details.latitude.toFixed(5)}° · ${heightSource}` : "地图位置",
      localOnly: true, capabilities: { visible: true, locate: true, remove: true },
      actions: {
        setVisible: (_entry, visible) => { entity.show = visible; },
        locate: () => this.viewer.flyTo(entity),
        remove: () => {
          this.viewer.entities.remove(entity);
          this.points.delete(id);
          if (this.selectedPointId === id) this.selectedPointId = "";
          this.render();
        },
      },
    });
    this.selectedPointId = id;
    this.render();
    setResult(document.getElementById("scene-tool-mode-status"), "点位已创建", "可在下方编辑名称；点击已有点位可重新选中", "success");
  }

  selectPointAt(screenPosition) {
    const picked = this.viewer.scene.pick(screenPosition);
    const entityId = picked?.id?.id ?? picked?.id;
    const entity = typeof entityId === "string" ? this.viewer.entities.getById(entityId) : entityId;
    const toolType = entity?.properties?.sceneToolType?.getValue?.(this.viewer.clock.currentTime);
    const pointId = entity?.properties?.sceneToolId?.getValue?.(this.viewer.clock.currentTime);
    if (toolType === "point" && this.points.has(pointId)) {
      this.selectedPointId = pointId;
      const select = document.getElementById("scene-point-select");
      if (select) select.value = pointId;
      this.renderPointEditor();
      return true;
    }
    return false;
  }

  renamePoint() {
    const point = this.points.get(this.selectedPointId);
    const input = document.getElementById("scene-point-name");
    const name = input?.value.trim();
    if (!point || !name) return;
    point.name = name;
    point.entity.label.text = name;
    this.sceneLayers.update(point.id, { name });
    this.render();
  }

  async removeSelectedPoint() {
    if (this.selectedPointId) await this.sceneLayers.perform(this.selectedPointId, "remove");
    this.render();
  }

  beginRoute() {
    if (this.previewRoute) return;
    const Cesium = this.Cesium;
    const route = {
      id: createId("route"),
      name: `路线 ${this.routes.size + 1}`,
      positions: [],
      waypointEntities: [],
      lineEntity: null,
    };
    route.lineEntity = this.viewer.entities.add({
      id: route.id,
      polyline: {
        positions: new Cesium.CallbackProperty(() => route.positions, false),
        width: 4,
        material: Cesium.Color.CYAN,
        clampToGround: true,
      },
      properties: { sceneToolType: "route", sceneToolId: route.id },
    });
    this.previewRoute = route;
  }

  addRoutePoint(position) {
    this.beginRoute();
    this.previewRoute.positions.push(position);
    const waypoint = this.viewer.entities.add({
      id: `${this.previewRoute.id}:waypoint:${this.previewRoute.waypointEntities.length + 1}`,
      ...entitiesAtPosition(this.Cesium, position, 6),
    });
    this.previewRoute.waypointEntities.push(waypoint);
    const finish = document.getElementById("scene-route-finish");
    if (finish) finish.disabled = this.previewRoute.positions.length < 2;
    this.renderRouteStatus();
  }

  discardPreviewRoute() {
    if (!this.previewRoute) return;
    this.viewer.entities.remove(this.previewRoute.lineEntity);
    for (const entity of this.previewRoute.waypointEntities) this.viewer.entities.remove(entity);
    this.previewRoute = null;
    this.renderRouteStatus();
  }

  finishRoute() {
    if (!this.previewRoute || this.previewRoute.positions.length < 2) {
      setResult(document.getElementById("scene-route-status"), "路线点不足", "至少点击两个地图位置后才能结束路线", "error");
      return;
    }
    const route = this.previewRoute;
    route.lineEntity.polyline.positions = route.positions.slice();
    this.previewRoute = null;
    route.modelEntity = null;
    route.modelUrl = "";
    route.modelFileName = "";
    route.playbackStatus = "ready";
    this.routes.set(route.id, route);
    this.sceneLayers.register({
      id: route.id, group: TOOL_GROUP, type: "model-route", name: route.name,
      source: "浏览器绘制", detail: `${route.positions.length} 个路径点 · 尚未绑定模型`,
      localOnly: true, capabilities: { visible: true, locate: true, remove: true },
      metadata: { pointCount: route.positions.length },
      actions: {
        setVisible: (_entry, visible) => {
          route.lineEntity.show = visible;
          for (const entity of route.waypointEntities) entity.show = visible;
          if (route.modelEntity) route.modelEntity.show = visible;
        },
        locate: () => this.viewer.flyTo(route.lineEntity),
        remove: async () => {
          await this.removeRouteResources(route);
          this.render();
        },
      },
    });
    this.selectedRouteId = route.id;
    this.setMode("");
    this.render();
    setResult(document.getElementById("scene-route-status"), "路线已创建", "可绑定 GLB 模型，并设置移动速度后播放", "success");
  }

  async removeRouteResources(route) {
    if (this.playbackRouteId === route.id) this.stopRoutePlayback();
    this.viewer.entities.remove(route.lineEntity);
    for (const entity of route.waypointEntities) this.viewer.entities.remove(entity);
    if (route.modelEntity) this.viewer.entities.remove(route.modelEntity);
    if (route.modelUrl) URL.revokeObjectURL(route.modelUrl);
    route.modelEntity = null;
    route.modelUrl = "";
    this.routes.delete(route.id);
    if (this.selectedRouteId === route.id) this.selectedRouteId = "";
  }

  async removeSelectedRoute() {
    const route = this.routes.get(this.selectedRouteId);
    if (route) await this.sceneLayers.perform(route.id, "remove");
    this.render();
  }

  renameRoute() {
    const route = this.routes.get(this.selectedRouteId);
    const name = document.getElementById("scene-route-name")?.value.trim();
    if (!route || !name) return;
    route.name = name;
    this.sceneLayers.update(route.id, {
      name,
      detail: `${route.positions.length} 个路径点 · ${route.modelFileName || "尚未绑定模型"}`,
    });
    this.render();
  }

  async loadModelFile(file) {
    const input = document.getElementById("scene-model-file");
    if (input) input.value = "";
    const route = this.routes.get(this.selectedRouteId);
    if (!file) return;
    if (!route) {
      setResult(document.getElementById("scene-route-status"), "请先选择路线", "完成一条至少包含两个点的路线后再绑定模型", "error");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".glb")) {
      setResult(document.getElementById("scene-route-status"), "模型格式不支持", "首版仅支持单文件 .glb；外部依赖 .gltf 暂不支持", "error");
      return;
    }
    if (file.size > MODEL_FILE_LIMIT) {
      setResult(document.getElementById("scene-route-status"), "模型文件过大", "单文件 GLB 最大为 100 MiB，以控制浏览器内存占用", "error");
      return;
    }
    if (this.playbackRouteId === route.id) this.stopRoutePlayback();
    if (route.modelEntity) this.viewer.entities.remove(route.modelEntity);
    if (route.modelUrl) URL.revokeObjectURL(route.modelUrl);
    route.modelUrl = URL.createObjectURL(file);
    route.modelFileName = file.name;
    route.modelEntity = this.viewer.entities.add({
      id: `${route.id}:model`,
      position: new this.Cesium.ConstantPositionProperty(route.positions[0]),
      model: { uri: route.modelUrl, minimumPixelSize: 36, maximumScale: 200 },
      properties: { sceneToolType: "route-model", sceneToolId: route.id },
    });
    // 播放前先确认模型 Entity 已有位置；播放时会替换为按路线采样的位置属性。
    route.positionProperty = route.modelEntity.position;
    route.playbackStatus = "ready";
    this.sceneLayers.update(route.id, {
      detail: `${route.positions.length} 个路径点 · ${file.name}`,
    });
    this.render();
    setResult(document.getElementById("scene-route-status"), "模型已绑定", `${file.name} · 文件保留在当前浏览器会话`, "success");
  }

  routeSamples(route, speed) {
    const samples = [{ position: route.positions[0], seconds: 0 }];
    let seconds = 0;
    for (let index = 1; index < route.positions.length; index += 1) {
      seconds += this.Cesium.Cartesian3.distance(route.positions[index - 1], route.positions[index]) / speed;
      samples.push({ position: route.positions[index], seconds });
    }
    return samples;
  }

  startRoutePlayback() {
    const route = this.routes.get(this.selectedRouteId);
    const speed = Number(document.getElementById("scene-route-speed")?.value);
    if (!route?.modelEntity || !route.positionProperty) {
      setResult(document.getElementById("scene-route-status"), "尚未绑定模型", "先选择有效的 GLB 文件", "error");
      return;
    }
    if (!Number.isFinite(speed) || speed < 0.1 || speed > 10_000) {
      setResult(document.getElementById("scene-route-status"), "移动速度无效", "请输入 0.1 至 10000 米/秒之间的数值", "error");
      return;
    }
    const samples = this.routeSamples(route, speed);
    if (!Number.isFinite(samples.at(-1).seconds) || samples.at(-1).seconds <= 0) {
      setResult(document.getElementById("scene-route-status"), "路线长度无效", "请重新绘制间距大于零的路线", "error");
      return;
    }
    if (this.playbackRouteId) this.stopRoutePlayback();
    const Cesium = this.Cesium;
    const clock = this.viewer.clock;
    this.clockSnapshot = {
      currentTime: Cesium.JulianDate.clone(clock.currentTime),
      startTime: Cesium.JulianDate.clone(clock.startTime),
      stopTime: Cesium.JulianDate.clone(clock.stopTime),
      clockRange: clock.clockRange,
      clockStep: clock.clockStep,
      multiplier: clock.multiplier,
      shouldAnimate: clock.shouldAnimate,
    };
    const start = Cesium.JulianDate.addSeconds(Cesium.JulianDate.now(), 0.2, new Cesium.JulianDate());
    route.positionProperty = new Cesium.SampledPositionProperty();
    route.positionProperty.setInterpolationOptions({
      interpolationAlgorithm: Cesium.LinearApproximation,
      interpolationDegree: 1,
    });
    for (const sample of samples) {
      route.positionProperty.addSample(
        Cesium.JulianDate.addSeconds(start, sample.seconds, new Cesium.JulianDate()),
        sample.position,
      );
    }
    route.modelEntity.position = route.positionProperty;
    route.modelEntity.orientation = new Cesium.VelocityOrientationProperty(route.positionProperty);
    route.playbackStart = start;
    route.playbackStop = Cesium.JulianDate.addSeconds(start, samples.at(-1).seconds, new Cesium.JulianDate());
    route.playbackStatus = "playing";
    clock.startTime = Cesium.JulianDate.clone(start);
    clock.stopTime = Cesium.JulianDate.clone(route.playbackStop);
    clock.currentTime = Cesium.JulianDate.clone(start);
    clock.clockRange = Cesium.ClockRange.CLAMPED;
    clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    clock.multiplier = 1;
    clock.shouldAnimate = true;
    this.playbackRouteId = route.id;
    this.renderRouteEditor();
    setResult(document.getElementById("scene-route-status"), "路线播放中", `${route.name} · ${speed} 米/秒`, "processing");
  }

  pauseRoutePlayback() {
    const route = this.routes.get(this.playbackRouteId);
    if (!route || route.playbackStatus !== "playing") return;
    this.viewer.clock.shouldAnimate = false;
    route.playbackStatus = "paused";
    this.renderRouteEditor();
    setResult(document.getElementById("scene-route-status"), "路线已暂停", route.name, "success");
  }

  resumeRoutePlayback() {
    const route = this.routes.get(this.playbackRouteId);
    if (!route || route.playbackStatus !== "paused") return;
    this.viewer.clock.shouldAnimate = true;
    route.playbackStatus = "playing";
    this.renderRouteEditor();
    setResult(document.getElementById("scene-route-status"), "路线播放中", route.name, "processing");
  }

  checkPlaybackCompletion() {
    const route = this.routes.get(this.playbackRouteId);
    if (!route || !route.playbackStop || !this.Cesium.JulianDate.greaterThanOrEquals(this.viewer.clock.currentTime, route.playbackStop)) return;
    this.stopRoutePlayback(true);
  }

  stopRoutePlayback(completed = false) {
    const route = this.routes.get(this.playbackRouteId);
    if (!route) return;
    this.viewer.clock.shouldAnimate = false;
    if (route.playbackStop && route.modelEntity) {
      route.modelEntity.position = new this.Cesium.ConstantPositionProperty(route.positions.at(-1));
      route.modelEntity.orientation = undefined;
    }
    if (this.clockSnapshot) {
      const clock = this.viewer.clock;
      clock.startTime = this.clockSnapshot.startTime;
      clock.stopTime = this.clockSnapshot.stopTime;
      clock.currentTime = this.clockSnapshot.currentTime;
      clock.clockRange = this.clockSnapshot.clockRange;
      clock.clockStep = this.clockSnapshot.clockStep;
      clock.multiplier = this.clockSnapshot.multiplier;
      clock.shouldAnimate = this.clockSnapshot.shouldAnimate;
    }
    this.clockSnapshot = null;
    route.playbackStatus = completed ? "completed" : "ready";
    route.playbackStart = null;
    route.playbackStop = null;
    this.playbackRouteId = "";
    this.renderRouteEditor();
    setResult(document.getElementById("scene-route-status"), completed ? "路线播放完成" : "路线已停止", route.name, "success");
  }

  async loadVector(file) {
    // 浏览器的 FileList 是与 input.value 绑定的实时对象；必须先复制成普通数组，
    // 再清空输入框，才能允许用户重复选择同名文件而不把本次文件列表清成空数组。
    const files = Array.isArray(file)
      ? file.slice()
      : file && typeof file.length === "number" && typeof file.arrayBuffer !== "function"
        ? Array.from(file)
        : file ? [file] : [];
    const input = document.getElementById("scene-vector-file");
    if (input) input.value = "";
    if (!files.length) return;
    const fileLabel = files.length === 1 ? files[0].name : `${files[0].name} 等 ${files.length} 个文件`;
    const status = document.getElementById("scene-vector-status");
    setResult(status, "正在读取矢量文件", fileLabel, "processing");
    try {
      const loaded = await loadVectorFile(files);
      const dataSource = await this.Cesium.GeoJsonDataSource.load(loaded.geojson, {
        clampToGround: true,
        stroke: this.Cesium.Color.CYAN,
        fill: this.Cesium.Color.CYAN.withAlpha(0.16),
        strokeWidth: 2,
        markerColor: this.Cesium.Color.CYAN,
      });
      if (this.destroyed) {
        dataSource.destroy?.();
        return;
      }
      dataSource.name = loaded.name || fileLabel;
      await this.viewer.dataSources.add(dataSource);
      if (this.destroyed) {
        this.viewer.dataSources.remove(dataSource, true);
        return;
      }
      const id = createId("vector");
      const record = { id, name: loaded.name || fileLabel, dataSource };
      this.vectorLayers.set(id, record);
      this.sceneLayers.register({
        id, group: TOOL_GROUP, type: `local-${loaded.format.toLowerCase()}`, name: loaded.name || fileLabel,
        source: `本地 ${loaded.format}`, detail: `${loaded.featureCount} 个要素 · ${loaded.name || fileLabel}`,
        localOnly: true, capabilities: { visible: true, locate: true, remove: true },
        metadata: { featureCount: loaded.featureCount, format: loaded.format },
        actions: {
          setVisible: (_entry, visible) => { dataSource.show = visible; },
          locate: () => this.viewer.flyTo(dataSource),
          remove: () => { this.viewer.dataSources.remove(dataSource, true); this.vectorLayers.delete(id); },
        },
      });
      setResult(status, "矢量文件已加载", `${loaded.format} · ${loaded.featureCount} 个要素 · 仅保留在当前浏览器`, "success");
    } catch (error) {
      setResult(status, "矢量文件加载失败", error.message || String(error), "error");
    }
  }

  render() {
    const points = [...this.points.values()];
    const routes = [...this.routes.values()];
    this.selectedPointId = setOptions(document.getElementById("scene-point-select"), points, "暂无点位", this.selectedPointId);
    this.selectedRouteId = setOptions(document.getElementById("scene-route-select"), routes, "暂无路线", this.selectedRouteId);
    const pointCount = document.getElementById("scene-point-count");
    const routeCount = document.getElementById("scene-route-count");
    if (pointCount) pointCount.textContent = `${points.length} 个`;
    if (routeCount) routeCount.textContent = `${routes.length} 条`;
    this.renderPointEditor();
    this.renderRouteEditor();
  }

  renderPointEditor() {
    const point = this.points.get(this.selectedPointId);
    const input = document.getElementById("scene-point-name");
    const save = document.getElementById("scene-point-save");
    const remove = document.getElementById("scene-point-remove");
    if (input) input.value = point?.name ?? "";
    if (save) save.disabled = !point;
    if (remove) remove.disabled = !point;
  }

  renderRouteEditor() {
    const route = this.routes.get(this.selectedRouteId);
    const name = document.getElementById("scene-route-name");
    const save = document.getElementById("scene-route-save");
    const remove = document.getElementById("scene-route-remove");
    const modelInput = document.getElementById("scene-model-file");
    const playing = route && this.playbackRouteId === route.id;
    if (name) name.value = route?.name ?? "";
    if (save) save.disabled = !route;
    if (remove) remove.disabled = !route;
    if (modelInput) modelInput.disabled = !route;
    const play = document.getElementById("scene-route-play");
    const pause = document.getElementById("scene-route-pause");
    const resume = document.getElementById("scene-route-resume");
    const stop = document.getElementById("scene-route-stop");
    if (play) play.disabled = !route?.modelEntity || Boolean(playing);
    if (pause) pause.disabled = !playing || route.playbackStatus !== "playing";
    if (resume) resume.disabled = !playing || route.playbackStatus !== "paused";
    if (stop) stop.disabled = !playing;
    this.updateRouteButtons();
  }

  updateRouteButtons() {
    const finish = document.getElementById("scene-route-finish");
    if (finish) finish.disabled = this.mode !== "route" || (this.previewRoute?.positions.length ?? 0) < 2;
  }

  renderRouteStatus() {
    if (this.previewRoute) {
      setResult(document.getElementById("scene-route-status"), "路线绘制中", `已添加 ${this.previewRoute.positions.length} 个路径点`);
      return;
    }
    if (!this.routes.size) setResult(document.getElementById("scene-route-status"), "尚无路线", "路线与模型只保存在当前浏览器会话");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.setMode("");
    this.stopRoutePlayback();
    this.discardPreviewRoute();
    this.handler = this.handler && !this.handler.isDestroyed() ? this.handler.destroy() : this.handler;
    this.removeClockListener?.();
    for (const remove of this.domListeners) remove();
    this.domListeners = [];
    for (const route of this.routes.values()) {
      this.viewer.entities.remove(route.lineEntity);
      for (const entity of route.waypointEntities) this.viewer.entities.remove(entity);
      if (route.modelEntity) this.viewer.entities.remove(route.modelEntity);
      if (route.modelUrl) URL.revokeObjectURL(route.modelUrl);
    }
    for (const point of this.points.values()) this.viewer.entities.remove(point.entity);
    for (const layer of this.vectorLayers.values()) this.viewer.dataSources.remove(layer.dataSource, true);
    this.routes.clear();
    this.points.clear();
    this.vectorLayers.clear();
  }
}

export { formatCoordinate, MODEL_FILE_LIMIT, VECTOR_FILE_LIMITS };

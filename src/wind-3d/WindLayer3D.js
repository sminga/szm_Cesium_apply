/**
 * 3D 风场图层的公共入口。
 * 负责规范化风场数据和配置、跟踪 Cesium 相机可视范围，并管理粒子系统的创建、显隐、更新与销毁。
 */
import { Cartesian2, SceneMode, Math as CesiumMath, Rectangle } from "cesium";
import { WindParticleSystem } from "../rendering/windParticleSystem";
import { deepMerge, computeSpeedFromComponents } from "../core/utils";

export const DefaultOptions = {
  particlesTextureSize: 128,
  dropRate: 0.003,
  dropRateBump: 0.01,
  speedFactor: 1.0,
  lineWidth: { min: 1, max: 2 },
  lineLength: { min: 20, max: 100 },
  heightScale: 1,
  colors: ["white"],
  flipY: false,
  useViewerBounds: false,
  domain: undefined,
  displayRange: undefined,
  lowSpeedOpacity: 0.72,
  densityBySpeed: true,
  densityExponent: 1.5,
  densityFloor: 0.15,
  verticalMode: "all",
  heightRange: undefined,
  selectedLevel: undefined,
  fixedHeight: undefined,
  dynamic: true,
};

export class WindLayer3D {
  constructor(viewer, windData, options) {
    this._show = true;
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.options = deepMerge(options, DefaultOptions);
    this.windData = this.processWindData(windData);

    this.viewerParameters = {
      lonRange: new Cartesian2(-180, 180),
      latRange: new Cartesian2(-90, 90),
      pixelSize: 1000.0,
      sceneMode: this.scene.mode,
    };
    this.updateViewerParameters();

    this.particleSystem = new WindParticleSystem(
      this.scene.context,
      this.windData,
      this.options,
      this.viewerParameters,
      this.scene
    );
    this.add();

    this._updateViewerParametersBound = this.updateViewerParameters.bind(this);
    this.setupEventListeners();
  }

  get show() {
    return this._show;
  }

  set show(value) {
    if (this._show !== value) {
      this._show = value;
      this.updatePrimitivesVisibility(value);
    }
  }

  setupEventListeners() {
    this.viewer.camera.percentageChanged = 0.01;
    this.viewer.camera.changed.addEventListener(this._updateViewerParametersBound);
    this.scene.morphComplete.addEventListener(this._updateViewerParametersBound);
    window.addEventListener("resize", this._updateViewerParametersBound);
  }

  removeEventListeners() {
    this.viewer.camera.changed.removeEventListener(this._updateViewerParametersBound);
    this.scene.morphComplete.removeEventListener(this._updateViewerParametersBound);
    window.removeEventListener("resize", this._updateViewerParametersBound);
  }

  processWindData(windData) {
    if (!windData?.u?.array || !windData?.v?.array || !windData?.w?.array) {
      throw new Error("风场数据必须包含 U、V、W 三个分量");
    }
    if (!Array.isArray(windData.levels) || windData.levels.length < 2) {
      throw new Error("风场数据至少需要两个高度层；二维数据请使用 WindLayer2D");
    }
    if (!windData.speed?.array) {
      const { array, min, max } = computeSpeedFromComponents(
        windData.u.array,
        windData.v.array,
        windData.w.array
      );
      windData = { ...windData, speed: { array, min, max } };
    }
    return windData;
  }

  updateViewerParameters() {
    const scene = this.viewer.scene;
    const canvas = scene.canvas;
    const corners = [
      { x: 0, y: 0 },
      { x: 0, y: canvas.clientHeight },
      { x: canvas.clientWidth, y: 0 },
      { x: canvas.clientWidth, y: canvas.clientHeight },
    ];

    let minLon = 180;
    let maxLon = -180;
    let minLat = 90;
    let maxLat = -90;
    let isOutsideGlobe = false;

    for (const corner of corners) {
      const cartesian = scene.camera.pickEllipsoid(
        new Cartesian2(corner.x, corner.y),
        scene.globe.ellipsoid
      );
      if (!cartesian) {
        isOutsideGlobe = true;
        break;
      }
      const cartographic = scene.globe.ellipsoid.cartesianToCartographic(cartesian);
      const lon = CesiumMath.toDegrees(cartographic.longitude);
      const lat = CesiumMath.toDegrees(cartographic.latitude);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    if (!isOutsideGlobe) {
      const lonRange = new Cartesian2(
        Math.max(this.windData.bounds.west, minLon),
        Math.min(this.windData.bounds.east, maxLon)
      );
      const latRange = new Cartesian2(
        Math.max(this.windData.bounds.south, minLat),
        Math.min(this.windData.bounds.north, maxLat)
      );

      const lonBuffer = (lonRange.y - lonRange.x) * 0.05;
      const latBuffer = (latRange.y - latRange.x) * 0.05;
      lonRange.x = Math.max(this.windData.bounds.west, lonRange.x - lonBuffer);
      lonRange.y = Math.min(this.windData.bounds.east, lonRange.y + lonBuffer);
      latRange.x = Math.max(this.windData.bounds.south, latRange.x - latBuffer);
      latRange.y = Math.min(this.windData.bounds.north, latRange.y + latBuffer);

      this.viewerParameters.lonRange = lonRange;
      this.viewerParameters.latRange = latRange;

      const dataLonRange = this.windData.bounds.east - this.windData.bounds.west;
      const dataLatRange = this.windData.bounds.north - this.windData.bounds.south;
      const visibleRatioLon = (lonRange.y - lonRange.x) / dataLonRange;
      const visibleRatioLat = (latRange.y - latRange.x) / dataLatRange;
      const visibleRatio = Math.min(visibleRatioLon, visibleRatioLat);
      const pixelSize = 1000 * visibleRatio;
      if (pixelSize > 0) {
        this.viewerParameters.pixelSize = Math.max(0, Math.min(1000, pixelSize));
      }
    }

    this.viewerParameters.sceneMode = this.scene.mode;
    this.particleSystem?.applyViewerParameters(this.viewerParameters);
  }

  updateWindData(data) {
    if (this._isDestroyed) return;
    this.windData = this.processWindData(data);
    this.particleSystem.computing.updateWindData(this.windData);
    this.viewer.scene.requestRender();
  }

  updateOptions(options) {
    if (this._isDestroyed) return;
    this.options = deepMerge(options, this.options);
    this.particleSystem.changeOptions(options);
    this.viewer.scene.requestRender();
  }

  zoomTo(duration = 0) {
    if (this.windData.bounds) {
      const rectangle = Rectangle.fromDegrees(
        this.windData.bounds.west,
        this.windData.bounds.south,
        this.windData.bounds.east,
        this.windData.bounds.north
      );
      this.viewer.camera.flyTo({ destination: rectangle, duration });
    }
  }

  add() {
    this.primitives = this.particleSystem.getPrimitives();
    this.primitives.forEach((primitive) => {
      this.scene.primitives.add(primitive);
    });
  }

  remove() {
    this.primitives.forEach((primitive) => {
      this.scene.primitives.remove(primitive);
    });
    this.primitives = [];
  }

  isDestroyed() {
    return this._isDestroyed;
  }

  destroy() {
    this.remove();
    this.removeEventListeners();
    this.particleSystem.destroy();
    this._isDestroyed = true;
  }

  updatePrimitivesVisibility(visibility) {
    const show = visibility !== undefined ? visibility : this._show;
    this.primitives.forEach((primitive) => {
      primitive.show = show;
    });
  }
}

export default WindLayer3D;

/**
 * 多风场图层管理器。
 * 允许同一 Cesium Viewer 同时维护多个二维固定高度层和多个三维风场层。
 */
import { WindLayer2D } from "../wind-2d/WindLayer2D.js";
import { WindLayer3D } from "../wind-3d/WindLayer3D.js";

let nextLayerId = 1;

export class WindLayerManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.layers = new Map();
  }

  add2D(windData, options = {}, metadata = {}) {
    return this.add("2d", new WindLayer2D(this.viewer, windData, options), metadata);
  }

  add3D(windData, options = {}, metadata = {}) {
    return this.add("3d", new WindLayer3D(this.viewer, windData, options), metadata);
  }

  add(kind, layer, metadata = {}) {
    const id = metadata.id ?? `wind-${nextLayerId++}`;
    const entry = {
      id,
      kind,
      name: metadata.name ?? (kind === "2d" ? "二维风场" : "三维风场"),
      source: metadata.source,
      layer,
    };
    this.layers.set(id, entry);
    return entry;
  }

  get(id) {
    return this.layers.get(id);
  }

  list() {
    return Array.from(this.layers.values());
  }

  setVisible(id, visible) {
    const entry = this.require(id);
    entry.layer.show = Boolean(visible);
  }

  updateOptions(id, options) {
    this.require(id).layer.updateOptions(options);
  }

  remove(id) {
    const entry = this.layers.get(id);
    if (!entry) return false;
    entry.layer.destroy();
    this.layers.delete(id);
    return true;
  }

  clear(kind) {
    for (const entry of this.list()) {
      if (!kind || entry.kind === kind) this.remove(entry.id);
    }
  }

  require(id) {
    const entry = this.layers.get(id);
    if (!entry) throw new Error(`风场图层不存在：${id}`);
    return entry;
  }

  destroy() {
    this.clear();
  }
}

export default WindLayerManager;

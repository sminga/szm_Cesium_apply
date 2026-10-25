import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleCheck,
  Eye,
  EyeOff,
  GripVertical,
  Image,
  ListChecks,
  LoaderCircle,
  LocateFixed,
  Map as MapIcon,
  MoreHorizontal,
  Mountain,
  RotateCcw,
  Shapes,
  Trash2,
  TriangleAlert,
  Wind,
  X,
  createIcons,
} from "lucide";
import { LAYER_GROUP_ORDER, LAYER_GROUPS } from "./layerCapabilities.js";

const ICONS = {
  ArrowDown, ArrowUp, Building2, ChevronDown, Circle, CircleCheck, Eye, EyeOff,
  ChevronsDown, ChevronsUp, GripVertical, Image, ListChecks, LoaderCircle, LocateFixed, Map: MapIcon, MoreHorizontal,
  Mountain, RotateCcw, Shapes, Trash2, TriangleAlert, Wind, X,
};

function icon(name, className = "") {
  return `<i data-lucide="${name}"${className ? ` class="${className}"` : ""}></i>`;
}

function statusIcon(entry) {
  if (["queued", "reading", "processing", "applying", "loading"].includes(entry.status)) {
    return icon("loader-circle", "scene-layer-status-icon spinning");
  }
  if (entry.status === "failed" || entry.status === "error") {
    return icon("triangle-alert", "scene-layer-status-icon error");
  }
  return icon(LAYER_GROUPS[entry.group].icon, "scene-layer-status-icon");
}

export class LayerPanelController {
  constructor(container, registry, options = {}) {
    if (!container) throw new Error("缺少统一图层面板容器");
    this.container = container;
    this.registry = registry;
    this.onSelect = options.onSelect;
    this.onError = options.onError;
    this.openEditors = new Set();
    this.groupOpenState = new Map();
    this.draggedId = undefined;
    this.unsubscribe = registry.subscribe((entries) => this.render(entries));
  }

  destroy() {
    this.unsubscribe?.();
    this.container.replaceChildren();
  }

  render(entries) {
    const groups = LAYER_GROUP_ORDER
      .map((group) => ({ group, entries: entries.filter((entry) => entry.group === group) }))
      .filter(({ entries: groupEntries }) => groupEntries.length);
    if (!groups.length) {
      this.container.innerHTML = '<p class="empty-message">场景中暂无可管理资源</p>';
      return;
    }
    this.container.replaceChildren(...groups.map(({ group, entries: groupEntries }) => this.createGroup(group, groupEntries)));
    createIcons({ icons: ICONS, root: this.container });
  }

  createGroup(group, entries) {
    const definition = LAYER_GROUPS[group];
    const section = document.createElement("details");
    section.className = "scene-layer-group";
    section.open = this.groupOpenState.get(group) ?? true;
    section.addEventListener("toggle", () => this.groupOpenState.set(group, section.open));
    const summary = document.createElement("summary");
    summary.innerHTML = `<span>${icon("chevron-down")}<b>${definition.label}</b></span><small>${entries.length}</small>`;
    const list = document.createElement("div");
    list.className = "scene-layer-group-list";
    list.replaceChildren(...entries.map((entry, index) => this.createRow(entry, index, entries.length)));
    section.append(summary, list);
    return section;
  }

  createRow(entry, index, groupLength) {
    const row = document.createElement("div");
    row.className = `scene-layer-row${entry.active ? " active" : ""}${entry.visible === false ? " muted" : ""}`;
    row.dataset.layerId = entry.id;
    row.dataset.group = entry.group;
    row.draggable = entry.capabilities.reorder;
    const taskRunning = ["queued", "reading", "processing", "applying", "loading"].includes(entry.status);
    const reorderHandle = entry.capabilities.reorder ? icon("grip-vertical", "drag-handle") : "";
    const localBadge = entry.localOnly ? '<span class="scene-layer-badge">本机临时</span>' : "";
    row.innerHTML = `
      <button class="scene-layer-main" type="button">
        ${reorderHandle}${statusIcon(entry)}
        <span class="scene-layer-copy"><b></b><small></small></span>
      </button>
      <div class="scene-layer-actions">
        ${entry.capabilities.activate ? `<button type="button" data-action="activate" title="${entry.active ? "当前地形" : "切换到此地形"}">${icon(entry.active ? "circle-check" : "circle")}</button>` : ""}
        ${entry.capabilities.visible ? `<button type="button" data-action="visible" title="${entry.visible === false ? "显示" : "隐藏"}">${icon(entry.visible === false ? "eye-off" : "eye")}</button>` : ""}
        ${entry.capabilities.locate ? `<button type="button" data-action="locate" title="定位">${icon("locate-fixed")}</button>` : ""}
        ${entry.capabilities.cancel && taskRunning ? `<button type="button" data-action="cancel" title="取消任务">${icon("x")}</button>` : ""}
        ${entry.capabilities.retry && !taskRunning ? `<button type="button" data-action="retry" title="重试">${icon("rotate-ccw")}</button>` : ""}
        ${(entry.capabilities.opacity || entry.capabilities.reorder || (entry.capabilities.style && entry.metadata.kind === "2d")) ? `<button type="button" data-action="more" title="更多设置">${icon("more-horizontal")}</button>` : ""}
        ${entry.capabilities.remove ? `<button type="button" data-action="remove" title="从场景移除">${icon("trash-2")}</button>` : ""}
      </div>
      <div class="scene-layer-meta">${localBadge}<span class="scene-layer-source"></span></div>
      ${this.createEditorMarkup(entry, index, groupLength)}`;
    row.querySelector(".scene-layer-copy b").textContent = entry.name;
    row.querySelector(".scene-layer-copy small").textContent = entry.detail || entry.status;
    row.querySelector(".scene-layer-main").title = entry.name;
    row.querySelector(".scene-layer-source").textContent = entry.source || entry.type;
    row.querySelector(".scene-layer-main").addEventListener("click", () => this.onSelect?.(entry));
    this.bindActions(row, entry, index);
    this.bindDrag(row, entry, index);
    return row;
  }

  createEditorMarkup(entry, index, groupLength) {
    const fixedHeight = entry.capabilities.style && entry.metadata.kind === "2d";
    if (!entry.capabilities.opacity && !entry.capabilities.reorder && !fixedHeight) return "";
    const hidden = this.openEditors.has(entry.id) ? "" : " hidden";
    return `<div class="scene-layer-editor"${hidden}>
      ${entry.capabilities.opacity ? `<label><span>透明度</span><output>${Math.round(entry.opacity * 100)}%</output><input type="range" min="0" max="1" step="0.05" value="${entry.opacity}" data-action="opacity" /></label>` : ""}
      ${fixedHeight ? `<label><span>显示高度（m）</span><input class="scene-layer-number" type="number" step="100" value="${entry.metadata.fixedHeight}" data-action="fixed-height" /></label>` : ""}
      ${entry.capabilities.reorder ? `<div class="scene-layer-order"><span>叠放顺序</span><button type="button" data-action="move-top" title="移到最上方" ${index === 0 ? "disabled" : ""}>${icon("chevrons-up")}</button><button type="button" data-action="move-up" title="上移" ${index === 0 ? "disabled" : ""}>${icon("arrow-up")}</button><button type="button" data-action="move-down" title="下移" ${index === groupLength - 1 ? "disabled" : ""}>${icon("arrow-down")}</button><button type="button" data-action="move-bottom" title="移到最下方" ${index === groupLength - 1 ? "disabled" : ""}>${icon("chevrons-down")}</button></div>` : ""}
    </div>`;
  }

  bindActions(row, entry, index) {
    const perform = (action, ...args) => this.registry.perform(entry.id, action, ...args).catch((error) => this.onError?.(error, entry));
    row.querySelector('[data-action="activate"]')?.addEventListener("click", () => perform("activate"));
    row.querySelector('[data-action="visible"]')?.addEventListener("click", () => perform("setVisible", entry.visible === false));
    row.querySelector('[data-action="locate"]')?.addEventListener("click", () => perform("locate"));
    row.querySelector('[data-action="cancel"]')?.addEventListener("click", () => perform("cancel"));
    row.querySelector('[data-action="retry"]')?.addEventListener("click", () => perform("retry"));
    row.querySelector('[data-action="remove"]')?.addEventListener("click", () => perform("remove"));
    row.querySelector('[data-action="more"]')?.addEventListener("click", () => {
      if (this.openEditors.has(entry.id)) this.openEditors.delete(entry.id);
      else this.openEditors.add(entry.id);
      this.render(this.registry.list());
    });
    row.querySelector('[data-action="move-up"]')?.addEventListener("click", () => perform("reorder", index - 1));
    row.querySelector('[data-action="move-down"]')?.addEventListener("click", () => perform("reorder", index + 1));
    row.querySelector('[data-action="move-top"]')?.addEventListener("click", () => perform("reorder", 0));
    row.querySelector('[data-action="move-bottom"]')?.addEventListener("click", () => perform("reorder", this.registry.list(entry.group).length - 1));
    const opacity = row.querySelector('[data-action="opacity"]');
    opacity?.addEventListener("input", () => {
      opacity.previousElementSibling.textContent = `${Math.round(Number(opacity.value) * 100)}%`;
    });
    opacity?.addEventListener("change", () => perform("setOpacity", Number(opacity.value)));
    row.querySelector('[data-action="fixed-height"]')?.addEventListener("change", (event) => {
      perform("style", { fixedHeight: Number(event.target.value) });
    });
  }

  bindDrag(row, entry, index) {
    if (!entry.capabilities.reorder) return;
    row.addEventListener("dragstart", (event) => {
      this.draggedId = entry.id;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", entry.id);
    });
    row.addEventListener("dragend", () => {
      this.draggedId = undefined;
      row.classList.remove("dragging");
    });
    row.addEventListener("dragover", (event) => {
      const dragged = this.registry.get(this.draggedId);
      if (!dragged || dragged.group !== entry.group) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!this.draggedId || this.draggedId === entry.id) return;
      this.registry.move(this.draggedId, index).catch((error) => this.onError?.(error, entry));
    });
  }
}

export default LayerPanelController;

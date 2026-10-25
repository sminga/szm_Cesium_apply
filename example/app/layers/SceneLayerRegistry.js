import {
  ACTION_CAPABILITY,
  LAYER_GROUP_ORDER,
  assertLayerGroup,
  normalizeCapabilities,
} from "./layerCapabilities.js";

function clampOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(1, Math.max(0, number));
}

function publicSnapshot(record) {
  const { actions: _actions, sequence: _sequence, ...entry } = record;
  return {
    ...entry,
    capabilities: { ...entry.capabilities },
    metadata: { ...entry.metadata },
  };
}

function normalizeRecord(definition, sequence, previous) {
  if (!definition?.id || typeof definition.id !== "string") {
    throw new TypeError("场景图层必须提供非空字符串 id");
  }
  const group = assertLayerGroup(definition.group ?? previous?.group);
  if (previous && previous.group !== group) throw new Error("已登记图层不能跨分组移动");
  return {
    id: definition.id,
    group,
    type: definition.type ?? previous?.type ?? group,
    name: definition.name ?? previous?.name ?? definition.id,
    source: definition.source ?? previous?.source ?? "",
    detail: definition.detail ?? previous?.detail ?? "",
    status: definition.status ?? previous?.status ?? "ready",
    visible: definition.visible ?? previous?.visible ?? true,
    opacity: clampOpacity(definition.opacity ?? previous?.opacity ?? 1),
    active: definition.active ?? previous?.active ?? false,
    localOnly: definition.localOnly ?? previous?.localOnly ?? false,
    removable: definition.removable ?? previous?.removable ?? true,
    order: Number.isFinite(definition.order) ? definition.order : (previous?.order ?? sequence),
    metadata: { ...(previous?.metadata ?? {}), ...(definition.metadata ?? {}) },
    capabilities: normalizeCapabilities(definition.capabilities ?? previous?.capabilities),
    actions: definition.actions ?? previous?.actions ?? {},
    sequence: previous?.sequence ?? sequence,
  };
}

/**
 * 统一登记示例网站中已经加载的场景资源和短时处理任务。
 *
 * 注册中心只保存可序列化状态和动作适配器，不直接操作 DOM，也不替代已有的
 * WindLayerManager、IonAssetLayerManager 或 TerrainController。底层资源释放仍由
 * 对应管理器负责，注册中心负责能力校验、顺序、订阅和界面状态一致性。
 */
export class SceneLayerRegistry {
  constructor() {
    this.records = new Map();
    this.listeners = new Set();
    this.sequence = 0;
    this.destroyed = false;
  }

  has(id) {
    return this.records.has(id);
  }

  get(id) {
    const record = this.records.get(id);
    return record ? publicSnapshot(record) : undefined;
  }

  list(group) {
    const groupIndex = new Map(LAYER_GROUP_ORDER.map((name, index) => [name, index]));
    return Array.from(this.records.values())
      .filter((record) => !group || record.group === group)
      .sort((a, b) => (groupIndex.get(a.group) - groupIndex.get(b.group))
        || (a.order - b.order)
        || (a.sequence - b.sequence))
      .map(publicSnapshot);
  }

  register(definition) {
    this.assertActive();
    if (this.records.has(definition?.id)) throw new Error(`场景图层已存在：${definition.id}`);
    const record = normalizeRecord(definition, ++this.sequence);
    this.records.set(record.id, record);
    this.normalizeGroupOrder(record.group);
    this.emit();
    return this.get(record.id);
  }

  upsert(definition) {
    return this.records.has(definition?.id)
      ? this.update(definition.id, definition)
      : this.register(definition);
  }

  update(id, patch) {
    this.assertActive();
    const previous = this.requireRecord(id);
    const record = normalizeRecord({ ...patch, id }, ++this.sequence, previous);
    this.records.set(id, record);
    this.normalizeGroupOrder(record.group);
    this.emit();
    return this.get(id);
  }

  setExclusiveActive(group, id) {
    this.assertActive();
    assertLayerGroup(group);
    if (id && this.requireRecord(id).group !== group) throw new Error(`图层 ${id} 不属于 ${group}`);
    let changed = false;
    for (const record of this.records.values()) {
      if (record.group !== group) continue;
      const active = record.id === id;
      if (record.active !== active) {
        record.active = active;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  async perform(id, action, ...args) {
    this.assertActive();
    const record = this.requireRecord(id);
    const capability = ACTION_CAPABILITY[action];
    if (!capability || !record.capabilities[capability]) {
      throw new Error(`${record.name} 不支持操作：${action}`);
    }
    if (action === "reorder") return this.move(id, ...args);
    const handler = record.actions[action];
    if (typeof handler !== "function") throw new Error(`${record.name} 缺少 ${action} 动作适配器`);
    const result = await handler(publicSnapshot(record), ...args);
    if (result?.applied === false) return result;
    if (action === "remove") {
      await this.remove(id, { dispose: false });
      return result ?? { applied: true };
    }
    if (action === "setVisible") this.update(id, { visible: Boolean(args[0]) });
    else if (action === "setOpacity") this.update(id, { opacity: clampOpacity(args[0]) });
    else if (action === "activate") this.setExclusiveActive(record.group, id);
    if (result?.patch && this.records.has(id)) this.update(id, result.patch);
    return result ?? { applied: true };
  }

  /**
   * 只允许在同一分组内部移动，并在提交注册中心顺序前先同步真实渲染顺序。
   * 适配器失败时列表保持原顺序，避免 UI 与 Cesium 场景发生分叉。
   */
  async move(id, targetIndex) {
    const record = this.requireRecord(id);
    if (!record.capabilities.reorder) throw new Error(`${record.name} 不支持排序`);
    const records = this.groupRecords(record.group);
    const fromIndex = records.findIndex((item) => item.id === id);
    const nextIndex = Math.max(0, Math.min(records.length - 1, Number(targetIndex) || 0));
    if (fromIndex === nextIndex) return { applied: true, unchanged: true };
    const ordered = records.slice();
    ordered.splice(nextIndex, 0, ordered.splice(fromIndex, 1)[0]);
    const handler = record.actions.reorder;
    if (typeof handler !== "function") throw new Error(`${record.name} 缺少 reorder 动作适配器`);
    await handler(publicSnapshot(record), {
      fromIndex,
      toIndex: nextIndex,
      orderedIds: ordered.map((item) => item.id),
    });
    ordered.forEach((item, index) => { item.order = index; });
    this.emit();
    return { applied: true, fromIndex, toIndex: nextIndex };
  }

  async remove(id, { dispose = true } = {}) {
    const record = this.records.get(id);
    if (!record) return false;
    if (dispose && typeof record.actions.dispose === "function") {
      await record.actions.dispose(publicSnapshot(record));
    }
    this.records.delete(id);
    this.normalizeGroupOrder(record.group);
    this.emit();
    return true;
  }

  subscribe(listener, { immediate = true } = {}) {
    if (typeof listener !== "function") throw new TypeError("图层注册中心监听器必须是函数");
    this.listeners.add(listener);
    if (immediate) listener(this.list());
    return () => this.listeners.delete(listener);
  }

  async clear({ dispose = true } = {}) {
    for (const id of Array.from(this.records.keys())) await this.remove(id, { dispose });
  }

  async destroy() {
    if (this.destroyed) return;
    await this.clear();
    this.listeners.clear();
    this.destroyed = true;
  }

  groupRecords(group) {
    return Array.from(this.records.values())
      .filter((record) => record.group === group)
      .sort((a, b) => (a.order - b.order) || (a.sequence - b.sequence));
  }

  normalizeGroupOrder(group) {
    this.groupRecords(group).forEach((record, index) => { record.order = index; });
  }

  requireRecord(id) {
    const record = this.records.get(id);
    if (!record) throw new Error(`场景图层不存在：${id}`);
    return record;
  }

  assertActive() {
    if (this.destroyed) throw new Error("场景图层注册中心已销毁");
  }

  emit() {
    const snapshot = this.list();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export default SceneLayerRegistry;

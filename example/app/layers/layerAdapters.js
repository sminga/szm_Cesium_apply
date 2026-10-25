function layerDetail(parts) {
  return parts.filter(Boolean).join(" · ");
}

export function windLayerDefinition(entry, manager, options = {}) {
  return {
    id: entry.id,
    group: "wind",
    type: entry.kind,
    name: entry.name,
    source: entry.source || "浏览器会话",
    detail: options.detail?.(entry) ?? (entry.kind === "2d" ? "二维固定高度风场" : "三维风场"),
    visible: entry.layer.show !== false,
    capabilities: { visible: true, locate: true, style: true, remove: true },
    metadata: {
      kind: entry.kind,
      fixedHeight: entry.kind === "2d" ? entry.layer.options.fixedHeight : undefined,
    },
    actions: {
      setVisible: (_layer, visible) => manager.setVisible(entry.id, visible),
      locate: () => entry.layer.zoomTo(1.2),
      style: (_layer, changes = {}) => {
        if (entry.kind === "2d" && Number.isFinite(Number(changes.fixedHeight))) {
          entry.layer.setHeight(Number(changes.fixedHeight));
          return {
            patch: {
              detail: options.detail?.(entry),
              metadata: { kind: entry.kind, fixedHeight: entry.layer.options.fixedHeight },
            },
          };
        }
        options.onSelect?.(entry.id);
        return undefined;
      },
      remove: async () => {
        manager.remove(entry.id);
        await options.onRemoved?.(entry.id);
      },
    },
  };
}

export function basemapLayerDefinition({ mode, name, layer }) {
  return {
    id: "basemap:current",
    group: "basemap",
    type: mode,
    name,
    source: mode === "none" ? "场景设置" : "在线影像服务",
    detail: mode === "none" ? "当前未显示底图" : "固定在影像栈底部",
    visible: Boolean(layer?.show ?? layer),
    opacity: layer?.alpha ?? 1,
    capabilities: { visible: Boolean(layer), opacity: Boolean(layer) },
    removable: false,
    actions: {
      setVisible: (_entry, visible) => { layer.show = visible; },
      setOpacity: (_entry, opacity) => { layer.alpha = opacity; },
    },
  };
}

/** 右侧列表从上到下表示覆盖顺序，Cesium 则用更大的集合索引显示在更上方。 */
export function synchronizeImageryOrder(viewer, registry, orderedIds) {
  for (const id of orderedIds.slice().reverse()) {
    const layer = registry.get(id)?.metadata.cesiumLayer;
    if (layer && viewer.imageryLayers.contains(layer)) viewer.imageryLayers.raiseToTop(layer);
  }
}

export function ionImageryLayerDefinition({ assetId, name, layer, manager, viewer, registry, onRemoved }) {
  const id = `ion-imagery:${assetId}`;
  return {
    id,
    group: "imagery",
    type: "ion-imagery",
    name,
    source: `Cesium ion ${assetId}`,
    detail: "影像叠加层",
    visible: layer.show !== false,
    opacity: layer.alpha ?? 1,
    capabilities: { visible: true, reorder: true, opacity: true, remove: true },
    metadata: { assetId, cesiumLayer: layer },
    actions: {
      setVisible: (_entry, visible) => { layer.show = visible; },
      setOpacity: (_entry, opacity) => { layer.alpha = opacity; },
      reorder: (_entry, change) => synchronizeImageryOrder(viewer, registry, change.orderedIds),
      remove: async () => {
        await manager.setImageryAsset(assetId, false);
        onRemoved?.();
      },
    },
  };
}

export function ionTilesetLayerDefinition({ assetId, name, tileset, manager, viewer, onRemoved }) {
  return {
    id: `ion-tileset:${assetId}`,
    group: "tileset",
    type: "ion-tileset",
    name,
    source: `Cesium ion ${assetId}`,
    detail: "深度测试三维内容，列表顺序不代表遮挡顺序",
    visible: tileset.show !== false,
    capabilities: { visible: true, locate: true, remove: true },
    metadata: { assetId },
    actions: {
      setVisible: (_entry, visible) => { tileset.show = visible; },
      locate: () => viewer.zoomTo(tileset),
      remove: async () => {
        await manager.setTilesetAsset(assetId, false);
        onRemoved?.();
      },
    },
  };
}

export function terrainSourceDefinition(source) {
  return {
    id: source.id,
    group: "terrain",
    type: source.type ?? "terrain",
    name: source.name,
    source: source.source ?? "地形源",
    detail: source.detail ?? "可切换地形源",
    status: source.status ?? "ready",
    active: source.active ?? false,
    localOnly: source.localOnly ?? false,
    removable: source.removable ?? false,
    capabilities: {
      activate: source.activate !== false,
      locate: Boolean(source.locate),
      remove: Boolean(source.remove),
    },
    metadata: { ...(source.metadata ?? {}), bounds: source.bounds },
    actions: {
      activate: source.activate,
      locate: source.locate,
      remove: source.remove,
      dispose: source.dispose,
    },
  };
}

export function taskLayerDefinition(task) {
  return {
    id: task.id,
    group: "task",
    type: task.type ?? "processing",
    name: task.name,
    source: task.source ?? "浏览器任务",
    detail: task.detail ?? "等待处理",
    status: task.status ?? "queued",
    localOnly: task.localOnly ?? true,
    capabilities: {
      cancel: Boolean(task.cancel),
      retry: Boolean(task.retry),
      remove: Boolean(task.remove),
    },
    actions: {
      cancel: task.cancel,
      retry: task.retry,
      remove: task.remove,
      dispose: task.dispose,
    },
  };
}

export function demSessionDetail(session) {
  return layerDetail([
    session.projectionCode,
    `${session.width} × ${session.height}`,
    Number.isFinite(session.minHeight) && Number.isFinite(session.maxHeight)
      ? `${session.minHeight.toFixed(1)}-${session.maxHeight.toFixed(1)} m`
      : "",
    "本机临时",
  ]);
}

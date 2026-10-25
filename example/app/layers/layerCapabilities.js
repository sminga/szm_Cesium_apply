export const LAYER_GROUPS = Object.freeze({
  task: Object.freeze({ label: "数据任务", icon: "list-checks", empty: "暂无处理任务" }),
  basemap: Object.freeze({ label: "底图", icon: "map", empty: "暂无底图" }),
  imagery: Object.freeze({ label: "影像叠加", icon: "image", empty: "暂无影像叠加层" }),
  vector: Object.freeze({ label: "矢量数据", icon: "shapes", empty: "暂无矢量数据" }),
  wind: Object.freeze({ label: "风场", icon: "wind", empty: "尚未加载风场" }),
  tileset: Object.freeze({ label: "3D 内容", icon: "building-2", empty: "暂无 3D 内容" }),
  terrain: Object.freeze({ label: "地形源", icon: "mountain", empty: "暂无地形源" }),
});

export const LAYER_GROUP_ORDER = Object.freeze(Object.keys(LAYER_GROUPS));

export const LAYER_CAPABILITIES = Object.freeze([
  "visible",
  "reorder",
  "opacity",
  "locate",
  "style",
  "activate",
  "remove",
  "cancel",
  "retry",
]);

export const ACTION_CAPABILITY = Object.freeze({
  setVisible: "visible",
  reorder: "reorder",
  setOpacity: "opacity",
  locate: "locate",
  style: "style",
  activate: "activate",
  remove: "remove",
  cancel: "cancel",
  retry: "retry",
});

/**
 * 把各适配器声明的能力压缩成固定布尔结构。右侧面板只根据能力显示操作，
 * 从而避免给 3D Tiles、风场或地形展示没有真实 Cesium 语义的“上下排序”。
 */
export function normalizeCapabilities(capabilities = {}) {
  return Object.fromEntries(LAYER_CAPABILITIES.map((name) => [name, capabilities[name] === true]));
}

export function assertLayerGroup(group) {
  if (!Object.hasOwn(LAYER_GROUPS, group)) throw new Error(`不支持的场景图层分组：${group}`);
  return group;
}

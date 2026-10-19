# 多风场图层管理

`WindLayerManager.js` 为一个 Cesium `Viewer` 维护多个二维和三维风场实例。示例页面右侧图层列表以管理器中的条目为唯一数据来源。

## 条目与使用

每个条目包含 `id`、`kind`、`name`、可选 `source` 和实际 `layer`。

```js
const manager = new WindLayerManager(viewer);
const entry = manager.add3D(windData, { speedFactor: 0.3 }, {
  name: "业务风场",
  source: "forecast.nc",
});

manager.setVisible(entry.id, false);
manager.updateOptions(entry.id, { lineWidth: { min: 1, max: 3 } });
manager.remove(entry.id);
manager.destroy();
```

## 生命周期和错误

- `remove()` 会先调用图层 `destroy()`，再删除条目。
- `clear(kind)` 可只清理二维或三维图层；不传参数时清理全部。
- 对不存在的 ID 执行显隐或更新会抛出明确错误。
- 页面销毁或替换 Viewer 时必须调用 `manager.destroy()`。

管理器只负责集合和生命周期，不负责 DOM、目录加载或文件解析。新增条目元数据时同步更新 `types/index.d.ts` 和示例图层列表。

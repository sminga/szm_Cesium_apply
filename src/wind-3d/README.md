# 三维风场图层

`WindLayer3D.js` 负责校验数据、合并选项、跟踪 Cesium 相机视域、创建 GPU 粒子系统，并管理图层显隐、更新、定位和销毁。

## 输入和高度模式

- 输入必须包含 U、V、W、`nx/ny/nz`、`bounds` 和至少两个高度层。
- 缺少 `speed` 时会根据 U/V/W 自动计算。
- `all` 使用全部高度，`range` 使用连续区间，`level` 选择最近离散层，`fixed` 固定绝对高度。

```js
const layer = new WindLayer3D(viewer, windData, {
  verticalMode: "range",
  heightRange: { min: 100, max: 800 },
  speedFactor: 0.3,
});
layer.updateOptions({ selectedLevel: 300, verticalMode: "level" });
layer.zoomTo(0.8);
layer.destroy();
```

## 生命周期与维护

构造时会创建 `WindParticleSystem`、加入 Cesium Primitive，并监听相机、场景模式和窗口尺寸。`destroy()` 会移除 Primitive、事件监听和 GPU 资源。单层数据应使用 `WindLayer2D`。

修改 `DefaultOptions` 时同步更新类型声明、根文档、示例控件和测试。建议先读公开方法，再进入 `rendering/windParticleSystem.js` 理解 GPU 管线。

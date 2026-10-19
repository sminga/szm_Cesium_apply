# 二维风场图层

`WindLayer2D.js` 从输入风场提取一个水平层，将 W 分量设为零，并固定显示在指定绝对高度。多个二维实例可以在同一区域按不同高度叠加。

## 核心流程

1. `createWindData2D()` 根据 `sourceLevelIndex` 选择水平层。
2. U/V 切片复制为两个纹理层，满足底层三维纹理要求。
3. W 创建为全零数组，并重新计算速度。
4. `WindLayer2D` 复用 `WindLayer3D`，强制使用 `verticalMode: "fixed"`。

```js
const layer = new WindLayer2D(viewer, windData, {
  sourceLevelIndex: 0,
  fixedHeight: 300,
  speedFactor: 0.3,
});
layer.setHeight(500);
layer.destroy();
```

`sourceLevelIndex` 越界时会限制到有效范围，默认固定高度为 `1000` 米，转换不会修改原始风场对象。相关测试位于 `tests/layers/verticalSelection.test.js`。

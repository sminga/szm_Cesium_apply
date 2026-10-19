# 风场高度与二维切片测试

`verticalSelection.test.js` 同时验证 `src/core/verticalSelection.js` 和 `src/wind-2d/WindLayer2D.js` 的纯数据逻辑。

覆盖范围包括：

- 全部高度、连续范围、离散单层和固定高度模式。
- 非等距高度层的归一化坐标。
- 超出数据范围时的限制行为。
- 从三维数据提取二维层、复制纹理层和 W 清零。

```powershell
npx vitest run tests/layers/verticalSelection.test.js
```

涉及真实 Cesium Primitive 和 GPU 绘制的行为不在此单元测试内，仍需生产预览和视觉验证。

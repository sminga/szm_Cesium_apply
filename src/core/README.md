# 核心基础模块

`src/core/` 保存多个风场模块共同使用的底层能力。这里的代码不负责页面 UI，也不读取本地服务。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `customPrimitive.js` | 把 Cesium `DrawCommand` 或 `ComputeCommand` 封装为可加入场景的自定义 Primitive，并管理相关资源。 |
| `shaderManager.js` | 汇总 GLSL 源码、属性位置和 uniform，供计算与绘制模块创建 ShaderProgram。 |
| `utils.js` | 提供递归配置合并 `deepMerge()` 和风速计算 `computeSpeedFromComponents()`。 |
| `verticalSelection.js` | 把 `all`、`range`、`level`、`fixed` 四种高度模式换算为 GPU 使用的归一化高度范围。 |

## 高度换算示例

```js
const selection = resolveVerticalSelection(windData, {
  verticalMode: "range",
  heightRange: { min: 100, max: 500 },
});
```

输出包含是否固定单层、实际高度范围以及 `0..1` 范围内的纹理 Z 坐标。非等距高度层会分段插值，不会直接按最低和最高高度线性换算。

## 边界与维护

- 高度请求会限制在数据真实范围内；离散层选择会寻找最近高度。
- `deepMerge()` 用于合并嵌套选项，修改时要检查默认配置和运行时更新是否仍兼容。
- `CustomPrimitive` 与 WebGL 资源生命周期紧密相关，新增资源时必须提供销毁逻辑。
- uniform 名称在 `core/`、`rendering/` 和 `shaders/` 之间必须保持一致。

## 测试与学习

`tests/core/utils.test.js` 验证配置和风速计算，`tests/layers/verticalSelection.test.js` 验证高度模式。建议先读 `verticalSelection.js`，再读计算模块如何使用结果。

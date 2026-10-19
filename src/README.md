# 核心库源码

`src/` 保存可以被示例网站和其他 Cesium 项目复用的风场与地形核心代码。外部使用者应优先从 `src/index.js` 或 npm 包入口导入，不要直接依赖内部文件路径。

## 目录结构

| 目录 | 职责 | 建议先读 |
| --- | --- | --- |
| `core/` | Cesium 自定义图元、配置合并、速度计算、Shader 装配和高度模式换算 | `verticalSelection.js` |
| `data/` | NetCDF-3 读取、变量识别、网格重排和粒子初始位置采样 | `netcdfLoader.js` |
| `wind-2d/` | 从三维输入提取水平层并固定在指定绝对高度 | `WindLayer2D.js` |
| `wind-3d/` | 三维风场公共图层和 Cesium 生命周期 | `WindLayer3D.js` |
| `layers/` | 在同一个 Viewer 中管理多个二维/三维风场 | `WindLayerManager.js` |
| `rendering/` | WebGL2 纹理、GPU 粒子计算、流线绘制和资源重建 | `windParticleSystem.js` |
| `shaders/` | 粒子推进、位置更新、重生和线段绘制 GLSL | `calculateSpeed.js` |
| `terrain/` | quantized-mesh Provider 创建和地形切换状态管理 | `TerrainController.js` |

## 公共入口

`index.js` 导出 `WindLayer3D`、`WindLayer2D`、`WindLayerManager`、NetCDF 加载函数、高度换算函数和地形控制能力。

```js
import { loadNetCDF3File, WindLayer3D } from "cesium-wind-layer-3d";

const { windData, metadata } = await loadNetCDF3File(file);
console.log(metadata.warnings);
const layer = new WindLayer3D(viewer, windData, { speedFactor: 0.3 });

// 页面或 Viewer 释放时必须同步销毁 GPU 资源和事件监听。
layer.destroy();
```

## 主要数据流

1. `data/netcdfLoader.js` 把 NetCDF 文件规范化为统一风场数据。
2. `WindLayer2D` 或 `WindLayer3D` 校验并保存数据。
3. `rendering/windParticleSystem.js` 创建计算纹理和绘制命令。
4. `shaders/` 在 GPU 上采样风速、推进粒子并绘制流线。
5. `WindLayerManager` 为页面提供多个图层的统一增删改查入口。

## 使用和维护注意事项

- 核心库不应依赖 DOM、Vercel 环境变量、本机路径或 Python 服务。
- `WindLayer3D` 输入至少需要两个高度层；单层展示应使用 `WindLayer2D`。
- 创建了 Cesium Primitive、事件监听或 GPU 资源的实例都需要调用 `destroy()`。
- 新增公共导出时同步更新 `src/index.js`、`types/index.d.ts`、根 README 和测试。
- 改动 Shader、纹理尺寸或数据排列时，应同时检查 `rendering/` 与 `data/` 的约定。

## 测试与学习顺序

运行 `npm test` 执行 JavaScript 测试。建议依次阅读 `data/README.md`、`core/verticalSelection.js`、`wind-3d/WindLayer3D.js`、`rendering/windParticleSystem.js` 和 `shaders/README.md`。

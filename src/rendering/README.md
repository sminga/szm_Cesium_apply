# GPU 粒子计算与流线渲染

`src/rendering/` 把统一风场数据转换为 WebGL2 纹理和 Cesium 命令，在 GPU 上推进粒子并绘制连续流线。此目录是数据层与 GLSL 之间的连接层。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `windParticleSystem.js` | 总协调器。创建 computing/rendering 子系统，组合 Primitive，处理选项、数据、相机参数和资源重建。 |
| `windParticlesComputing.js` | 创建风场三维纹理、粒子位置纹理和 ComputeCommand，执行风速采样、位置推进与越界重生。 |
| `windParticlesRendering.js` | 创建顶点数组、绘制命令、帧缓冲和后处理流程，把粒子前后位置绘制为线段。 |

## 每帧流程

1. `calculateSpeed` 从三维风场纹理采样 U/V/W 并计算下一步速度。
2. `updatePosition` 使用速度推进粒子位置。
3. `postProcessingPosition` 处理越界、随机丢弃和重生。
4. rendering 使用当前与上一帧位置绘制线段，并交换双缓冲纹理。

## 关键输入

- 风场数据的数组顺序、尺寸和范围来自 `src/data/`。
- 高度归一化结果来自 `core/verticalSelection.js`。
- Shader 字符串来自 `src/shaders/`。
- 相机经纬度范围和像素尺度来自 `WindLayer3D.updateViewerParameters()`。

## 资源生命周期

- 粒子数量、风场尺寸或影响纹理布局的选项变化时，需要重建相关纹理和命令。
- 普通颜色、速度、线宽等 uniform 变化应尽量复用现有资源。
- `destroy()` 必须释放纹理、framebuffer、vertex array、shader program 和 Primitive，避免切换图层后继续占用 GPU 内存。
- WebGL2 或三维纹理不可用时，应由调用页面显示可理解的错误，而不是只写控制台。

## 学习和调试

建议先读 `windParticleSystem.js` 了解对象关系，再按 computing、shaders、rendering 顺序阅读。调试异常轨迹时同时检查数据数组顺序、真实高度映射、纹理尺寸、uniform 值和 Shader 坐标换算。相关数据测试位于 `tests/data/` 和 `tests/layers/`。

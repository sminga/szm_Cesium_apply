# WebGL2 Shader 模块

`src/shaders/` 以 JavaScript 字符串保存 GLSL ES 3.00 源码。Shader 不直接创建 WebGL 资源，由 `src/rendering/` 通过 Cesium 命令调用。

## 文件职责

| 文件 | 阶段 | 作用 |
| --- | --- | --- |
| `calculateSpeed.js` | 计算 | 在三维风场纹理中采样速度，执行 RK2 推进所需计算，并应用高度范围和速度缩放。 |
| `updatePosition.js` | 计算 | 根据上一位置和速度更新粒子经纬度及归一化高度。 |
| `postProcessingPosition.js` | 计算 | 对越界或随机丢弃粒子重生，保证粒子持续留在有效数据范围。 |
| `segmentDraw.js` | 绘制 | 提供线段顶点和片元 Shader，根据速度、线宽、线长上限、颜色和透明度绘制轨迹。 |

## 坐标与数据约定

- X/Y 使用经纬度，Z 使用 `0..1` 的高度纹理坐标。
- 真实高度与归一化 Z 的换算由 `resolveVerticalSelection()` 和高度层 uniform 共同决定。
- 纹理数组顺序必须与 `netcdfLoader.js` 和 `windParticlesComputing.js` 一致。
- U/V/W 单位和垂直方向不正确会直接造成轨迹方向或长度异常。
- `lineLength.min/max` 是按风速插值的近景目标屏幕长度。区域近景使用该目标保持粒子清晰且让控件生效；三维相机高度约从 `1500 km` 增加到 `5000 km` 时，Shader 会把人为延长平滑衰减到真实投影长度，避免全球视角出现放射状变形。

## 修改注意事项

- 修改 uniform 名称时同步更新 JavaScript 端 uniformMap。
- WebGL2 Shader 必须保留 `#version 300 es`，并注意浮点精度和不同 GPU 的兼容性。
- 循环、分支和纹理采样数量会影响移动设备性能；新增计算前应评估每粒子、每帧成本。
- 不要只修改 Shader 中的高度限制，还要检查粒子初始播种和重生是否使用同一范围。
- 修改屏幕空间长度时必须同时验证近景可读性和全球远景比例。全视距强制固定像素长度会让小范围风场在全球视角呈放射状扩散；全视距只保留真实投影长度又会让近景粒子过短，并使线长控件失去明显作用。

## 学习和验证

建议按 `calculateSpeed`、`updatePosition`、`postProcessingPosition`、`segmentDraw` 的帧顺序阅读，再对照 `src/rendering/README.md`。目前 Shader 主要通过上层自动测试、生产构建和浏览器视觉验证间接检查；修改后应在代表性数据和不同相机高度下观察轨迹。

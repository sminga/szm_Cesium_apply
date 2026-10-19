# 风场数据模块

`src/data/` 负责把外部数据转换为渲染层可直接消费的统一结构，并决定粒子初始位置的空间分布。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `netcdfLoader.js` | 识别 NetCDF 格式，读取 NetCDF-3，匹配经纬度、高度和 U/V/W 变量，排序坐标并重排数组。 |
| `weightedParticleSampler.js` | 根据风速生成累计权重，在高速区域增加粒子密度，同时保留低速区域可见性。 |

## 统一数据结构

渲染模块需要 U/V/W `Float32Array`、可选速度数组、`nx/ny/nz`、真实 `levels` 和经纬度 `bounds`。数组按 `(z, y, x)` 顺序扁平存储。

```js
const { windData, metadata } = await loadNetCDF3File(file, { timeIndex: 0 });
console.log(metadata.variables, metadata.warnings);
```

## 输入约束和错误处理

- 浏览器只直接支持 NetCDF-3；NetCDF-4/HDF5 先使用 `tools/netcdf/convert_netcdf.py`。
- 高度必须是长度单位；Pa/s 的垂直气压速度不能直接作为 m/s 的 W。
- 经度、纬度和高度会排序，U/V/W 会按相同索引重排。
- 缺少 W 时补零并产生警告；缺少必要坐标或 U/V 时抛出错误。
- 可使用 `maxBytes` 限制浏览器文件大小，降低内存风险。

## 测试与学习

`tests/data/` 覆盖格式、变量、单位、排序、W 补零和速度权重。建议先读 `normalizeNetCDFReader()`，再读 `createParticlePositionData()`，最后查看 `rendering/` 如何上传纹理。

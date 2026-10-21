# 浏览器本地 DEM 加载

## 1. 功能目标

公开 Vercel 网站现在可以让访问者主动选择本机 GeoTIFF，并在当前浏览器会话中把它作为 Cesium 地形加载。整个处理过程不依赖 `npm run local:server`、Python、Docker、固定盘符或开发者电脑上的端口，也不会把文件上传到 Vercel Function 或第三方服务。

这项能力解决的是“立即预览本机 DEM”问题，不替代 `tools/terrain/` 的离线发布流程：

| 场景 | 浏览器本地 DEM | 离线 quantized-mesh |
| --- | --- | --- |
| 是否需要 `npm run local:server` | 否 | 网页入口需要；命令行可直接运行 Python 工具 |
| 输入 | `.tif`、`.tiff` GeoTIFF | `.tif`、`.tiff`、`.img`、`.asc`、`.dem` |
| 输出 | 当前会话的 `HeightmapTerrainData` | 可长期保存和发布的 `layer.json` 与 `.terrain` 瓦片 |
| 是否上传原始文件 | 否 | 仅开发者本机服务接收后在本机处理 |
| 页面刷新后是否保留 | 否 | 是，输出目录仍在磁盘或已发布存储中 |
| 适合公开 Vercel 访客 | 是 | 访客只能使用已经发布的结果，不能在 Vercel 上运行 Docker |

## 2. 用户使用方法

1. 打开工作台，切换到“地形”。
2. 点击“选择并加载 DEM”。
3. 选择一个受支持的 GeoTIFF。
4. 页面会显示读取、元数据解析和栅格解码进度；处理期间可以点击“取消本次 DEM 处理”。
5. 成功后页面显示坐标系、高程范围和“文件未上传”，并自动定位到 DEM 的真实覆盖范围。
6. 切换到其他公开地形、本地 quantized-mesh 文件夹、Cesium World Terrain 或椭球时，当前 DEM Worker 会被终止并释放栅格引用。

处理结果只存在于当前标签页内。刷新或关闭页面后，需要重新选择原始 GeoTIFF。

## 3. 支持范围

当前浏览器模式只接受能够可靠转换到 WGS84 的单波段 GeoTIFF：

- `EPSG:4326`，即 WGS 84 经纬度。
- `EPSG:32601` 至 `EPSG:32660`，即 WGS 84 / UTM 北半球 1-60 区。
- `EPSG:32701` 至 `EPSG:32760`，即 WGS 84 / UTM 南半球 1-60 区。

以下情况会给出可见错误，并建议使用离线 GDAL/CTB 工具：

- `.img`、`.asc`、`.dem` 或其他非 GeoTIFF 文件。
- CGCS2000、高斯-克吕格或其他未配置的投影。
- 缺少有效原点、像元分辨率、地理范围或高程波段的 GeoTIFF。
- 全部样本均为 NoData 的栅格。
- 浏览器缺少 `File` 或 Web Worker 能力。

页面没有设置 4.5 MB 的前端限制。实际可处理大小由浏览器可用内存、GeoTIFF 压缩方式、栅格尺寸和设备性能决定。大文件会同时占用原始文件缓冲区、解码栅格和 Cesium 瓦片缓存所需内存，因此仍不能承诺任意大小都可加载。

## 4. 核心流程

### 4.1 主线程

`example/services/browserDemTerrain.js` 创建模块 Worker，并实现自定义 `BrowserDemTerrainProvider`：

1. 把用户主动选择的 `File` 发送给同源 Worker。
2. 接收投影、WGS84 范围、有效高程、NoData 和建议最大层级。
3. 使用 Cesium 公共 `TerrainProvider` 接口响应 `requestTileGeometry(x, y, level)`。
4. 将 Worker 返回的 `65 x 65` 高程数组包装为 `HeightmapTerrainData`。
5. 使用 `childTileMask` 和 `getTileDataAvailable()` 阻止 Cesium 在无数据区域或超过源分辨率后继续无限细分。

`TerrainController.loadProvider()` 把调用方已经创建的 Provider 接入现有地形状态机，统一处理异步竞态、错误状态、瓦片加载进度和相机定位。Provider 及 Worker 的资源生命周期仍由示例页面会话负责。

### 4.2 Worker

`example/services/browserDemTerrain.worker.js` 执行以下重任务，避免阻塞 Cesium UI：

1. 使用 `geotiff` 读取 GeoTIFF 元数据和第一个高程波段。
2. 使用 `proj4` 把 WGS84 UTM 范围转换为经纬度，并把 Cesium 请求点反投影到源栅格坐标。
3. 扫描有效样本，统计最小和最大高程。
4. 按 Cesium `GeographicTilingScheme` 的全球瓦片编号实时生成 heightmap。
5. 使用最多 96 个瓦片的 LRU 缓存降低相机重复请求时的采样开销。
6. 收到 `dispose`、取消、切换地形或页面关闭事件时清空缓存并终止 Worker。

如果 GeoTIFF 仍在解析，用户又选择目录地形、世界地形或椭球，页面会立即取消待处理 Worker，避免旧结果晚到后覆盖最后一次操作。若浏览器 Provider 已经成功应用，则不会在新地形尚未成功时提前销毁；新地形接管场景后才释放旧 DEM，确保失败回退仍有可用地形。

### 4.3 NoData 与边界

双线性插值只累计有效邻点的权重，`-32767`、`-9999` 等 NoData 哨兵不参与高程计算。如果一个采样点周围没有有效高程，则返回 `0 m`，避免把哨兵值渲染成深坑。

这个回退也有已知视觉限制：源数据边缘如果存在较大的 NoData 区域，`0 m` 与有效山体之间可能出现明显过渡。当前实现优先保证数值安全和可预测性；若需要更自然的边缘，应在离线阶段填补 NoData、裁切有效范围或生成正式 quantized-mesh。

## 5. 技术调研与依赖

实现优先使用 Cesium 公共 API：

- `TerrainProvider`：https://cesium.com/learn/cesiumjs/ref-doc/TerrainProvider.html
- `HeightmapTerrainData`：https://cesium.com/learn/cesiumjs/ref-doc/HeightmapTerrainData.html
- `GeographicTilingScheme`：https://cesium.com/learn/cesiumjs/ref-doc/GeographicTilingScheme.html

新增并锁定两项示例站点开发依赖。它们只服务 `example/` 构建，不会作为 npm 核心库的运行依赖传给仅使用 `src/` 导出的消费者：

| 依赖 | 版本 | 来源与许可证 | 采用范围 |
| --- | --- | --- | --- |
| `geotiff` | `3.0.5` | https://github.com/geotiffjs/geotiff.js ，MIT | 读取 GeoTIFF 元数据、投影键、NoData、边界和栅格 |
| `proj4` | `2.22.0` | https://github.com/proj4js/proj4js ，MIT | WGS84 与 WGS84 UTM 南北半球分区互转 |

选择理由：两者都是浏览器可用、职责清晰且有测试和文档的成熟实现，避免在项目中自行解析 TIFF 压缩格式或手写 UTM 投影。没有复制第三方源码；许可证信息同时从已安装包和 `package-lock.json` 核对。

曾评估直接在浏览器生成 quantized-mesh 的 WASM 路线，但代表性数据验证发现候选实现不能正确保留真实范围、NoData 识别和 Cesium 全球瓦片编号，因此没有采用。当前方案只在内存中生成 Cesium heightmap，不伪装成可发布的 `.terrain` 产物。

## 6. Vercel 与构建影响

- 公开构建不会探测 `127.0.0.1:8765`；只有开发模式或显式设置 `VITE_ENABLE_LOCAL_TOOLS=true` 时才启用本地服务请求。
- GeoTIFF 文件保留在访客浏览器内，不进入 Vercel 请求体，因此不受旧本地上传接口约 4.5 MB 请求体限制，也不消耗 Vercel Function 上传带宽和临时磁盘。
- `vite.example.config.js` 和 `example/vite.config.js` 使用 `worker: { format: "es" }`。GeoTIFF 解码器需要 Worker code-splitting；默认 IIFE Worker 无法生成多 chunk。
- 本次生产构建中，主站脚本约 `244.46 kB`，浏览器 DEM Worker 入口约 `177.75 kB`；JPEG、Deflate、LZW、LERC、Zstd 等解码器保持独立 chunk，在对应 TIFF 压缩格式需要时加载。
- Vercel Preview 和生产域名尚未部署验证。已完成与 Vercel 等价的本地生产构建和真实浏览器生产预览，但域名、CDN 和线上浏览器策略仍需在后续 Preview 中复核。

## 7. 代表性数据验证

验证数据来自 `D:\AAAcode\CesiumLearn\Cesium-learn\Cesium-Learn\libs\Terrain\西峰山东侧数据`，仅用于本机测试，没有加入项目仓库或网站构建：

| 文件 | 大小 | 栅格 | CRS | NoData | 有效高程 | 结果 |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| `西峰山东侧 DEM（WGS84）.tif` | 58,111,953 B | 4358 x 2537 | EPSG:4326 | -32767 | 125.3-258.0 m | 成功，自动定位约 116.0466 E、40.1639 N |
| `西峰山东侧DEM（WGS84 UTM 50N）.tif` | 7,145,060 B | 3317 x 2501 | EPSG:32650 | -9999 | 125.2-258.0 m | 成功，自动定位到同一地理区域 |

两次验证均在 `npm run local:server` 未参与的生产预览中完成，页面地形状态为“地形已就绪”，近景相机高度约 1.45 km，控制台没有应用错误。另用 58.1 MB 文件验证了解析中恢复椭球：页面显示取消，等待 30 秒仍保持椭球，没有被旧 Worker 覆盖。

## 8. 验证命令

```powershell
npm test
npm run test:python
npm run build
npm run build:vercel
npm audit --json
git diff --check
```

单元测试覆盖投影识别、UTM 范围转换、Cesium 瓦片编号、层级推导、NoData 插值、Worker 会话释放、TerrainProvider 请求和 `TerrainController.loadProvider()`。浏览器验证仍是必要步骤，因为构建和单元测试不能证明真实 Cesium 画面、相机跳转或 Worker 解码性能。

## 9. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 页面提示不支持 CRS | 先用 GDAL 转为 EPSG:4326 或 WGS84 UTM，再重新选择。 |
| 页面提示没有有效高程 | 检查 NoData 标记和高程波段；必要时用 GIS 软件修复。 |
| 大文件处理缓慢或标签页内存过高 | 先裁切范围、降低分辨率或用离线工具生成 quantized-mesh。 |
| 刷新后地形消失 | 浏览器模式不持久化文件，需重新选择；正式共享应发布 quantized-mesh。 |
| DEM 边缘出现陡直过渡 | NoData 回退到 0 m；离线填洞、裁切或正式瓦片化可改善。 |
| 需要 `.terrain` 文件 | 使用 `tools/terrain/build_quantized_mesh.py`，浏览器模式不提供下载或持久化转换结果。 |

# 浏览器本地 DEM 加载

## 1. 功能目标

公开 Vercel 网站可以让访问者主动选择一份或多份本机 GeoTIFF，并在当前浏览器会话中把它们作为局部 Cesium 地形同时加载。页面使用“一个基础地形 + 多个局部 DEM”的组合模型：Cesium World Terrain、椭球或一个 quantized-mesh 负责全局回退，多个 GeoTIFF 在各自有效范围内覆盖基础高程。整个处理过程不依赖 `npm run local:server`、Python、Docker、固定盘符或开发者电脑上的端口，也不会把文件上传到 Vercel Function 或第三方服务。

这项能力解决的是“立即预览本机 DEM”问题，不替代 `tools/terrain/` 的离线发布流程：

| 场景 | 浏览器本地 DEM | 离线 quantized-mesh |
| --- | --- | --- |
| 是否需要 `npm run local:server` | 否 | 网页入口需要；命令行可直接运行 Python 工具 |
| 输入 | `.tif`、`.tiff` GeoTIFF | `.tif`、`.tiff`、`.img`、`.asc`、`.dem` |
| 输出 | 当前会话的多 DEM 组合 `HeightmapTerrainData` | 可长期保存和发布的 `layer.json` 与 `.terrain` 瓦片 |
| 是否上传原始文件 | 否 | 仅开发者本机服务接收后在本机处理 |
| 页面刷新后是否保留 | 否 | 是，输出目录仍在磁盘或已发布存储中 |
| 适合公开 Vercel 访客 | 是 | 访客只能使用已经发布的结果，不能在 Vercel 上运行 Docker |

## 2. 用户使用方法

1. 打开工作台，切换到“地形”。
2. 点击“选择并加载 DEM（可多选）”。
3. 选择一份或多份受支持的 GeoTIFF。多选文件按顺序逐个解码，避免多个大文件同时展开造成瞬时内存峰值。
4. 页面会显示当前文件的读取、元数据解析和栅格解码进度；处理期间可以点击“取消本次 DEM 处理”。
5. 成功后页面自动定位到所有已启用 DEM 的联合范围。每份文件都会出现在右侧“局部 DEM”折叠组。
6. 点击眼睛按钮可单独关闭或重新启用 DEM；关闭成功后立即终止该 Worker 并释放解码栅格，重新启用时从当前标签页保留的 `File` 重新解析。
7. 使用“更多设置”中的上移、下移按钮调整重叠区优先级。列表越靠上，重叠像元的优先级越高。
8. “基础地形”组仍为单选。切换 Cesium World Terrain、椭球或一个 quantized-mesh 不会删除已启用的局部 DEM。

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

页面没有设置 4.5 MB 的前端限制。实际可处理大小由浏览器可用内存、GeoTIFF 压缩方式、栅格尺寸、启用数量和设备性能决定。每份已启用 DEM 都保留独立 Worker 与完整解码栅格，因此同时启用多个大文件时内存近似随总像元数增长；无法承诺任意数量或大小都能加载。

## 4. 核心流程

### 4.1 主线程

`example/services/browserDemTerrain.js` 为每份文件创建模块 Worker，并实现自定义 `BrowserDemTerrainProvider`：

1. 把用户主动选择的 `File` 发送给同源 Worker。
2. 接收投影、WGS84 范围、有效高程、NoData 和建议最大层级。
3. 使用 Cesium 公共 `TerrainProvider` 接口响应 `requestTileGeometry(x, y, level)`。
4. 接收 Worker 返回的 `65 x 65` 高程数组和逐像元有效掩码。有效掩码用于区分真实 `0 m` 与范围外/NoData。
5. 使用 `childTileMask` 和 `getTileDataAvailable()` 阻止 Cesium 在无数据区域或超过源分辨率后继续无限细分。

`example/services/multiDemTerrainProvider.js` 对 Cesium 暴露一个组合 `TerrainProvider`。它先请求并采样基础地形，再从列表底部到顶部覆盖各 DEM 的有效像元；因此上层 DEM 的 NoData 会回退到下层 DEM，所有局部 DEM 都无效时再回退到 World Terrain、quantized-mesh 或椭球。DEM 覆盖范围以外直接返回基础 `TerrainData`，不会把全球瓦片无条件重采样为 heightmap。

`TerrainController.loadProvider()` 把每次新建的组合 Provider 接入现有地形状态机，统一处理最后请求优先、失败保留旧 Provider、错误状态、瓦片加载进度和相机定位。Provider 及 Worker 的资源生命周期仍由示例页面会话负责。

### 4.2 Worker

`example/services/browserDemTerrain.worker.js` 执行以下重任务，避免阻塞 Cesium UI：

1. 使用 `geotiff` 读取 GeoTIFF 元数据和第一个高程波段。
2. 使用 `proj4` 把 WGS84 UTM 范围转换为经纬度，并把 Cesium 请求点反投影到源栅格坐标。
3. 扫描有效样本，统计最小和最大高程。
4. 按 Cesium `GeographicTilingScheme` 的全球瓦片编号实时生成高度与有效性掩码。
5. 使用最多 96 个瓦片的 LRU 缓存降低相机重复请求时的采样开销。
6. 收到 `dispose`、取消、关闭/删除对应 DEM 或页面关闭事件时清空缓存并终止 Worker。

同一批多选文件串行解析。用户主动开始另一批 DEM 时会取消仍在解析的当前文件，避免旧结果晚到覆盖新任务。关闭或删除已启用 DEM 时，页面先让不含该来源的新组合 Provider 成功接管场景，再终止 Worker；如果组合重建失败，原 DEM 与原 Provider 都继续保留。

### 4.3 NoData 与边界

双线性插值只累计有效邻点的权重，`-32767`、`-9999` 等 NoData 哨兵不参与高程计算。如果一个采样点周围没有有效高程，Worker 返回 `valid=false`，组合 Provider 不会覆盖下一层。只有最终基础地形为椭球时，回退结果才是 `0 m`。

不同 DEM 或 World Terrain 可能采用不同垂直基准、采样分辨率和生产时间，边界仍可能出现高度台阶。当前实现不做羽化、基准面改正或跨数据集平滑；需要无缝生产效果时，应在离线阶段统一高程基准、分辨率、NoData 与裁切边界，再生成正式 quantized-mesh。

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

本次还核对了 Cesium 官方 `Globe.terrainProvider`、`TerrainProvider`、`TerrainData.interpolateHeight()` 与 `HeightmapTerrainData` 公共接口，并查看 CesiumGS/cesium#12817 及 MIT 许可的 `juunie-roh/cesium-utils` HybridTerrainProvider。候选实现按完整瓦片区域切换 Provider，不能满足 GeoTIFF 边缘和 NoData 的逐像元回退，因此没有引入依赖或复制代码；项目继续使用自有的最小组合 Provider。

## 6. Vercel 与构建影响

- 公开构建不会探测 `127.0.0.1:8765`；只有开发模式或显式设置 `VITE_ENABLE_LOCAL_TOOLS=true` 时才启用本地服务请求。
- GeoTIFF 文件保留在访客浏览器内，不进入 Vercel 请求体，因此不受旧本地上传接口约 4.5 MB 请求体限制，也不消耗 Vercel Function 上传带宽和临时磁盘。
- `vite.example.config.js` 和 `example/vite.config.js` 使用 `worker: { format: "es" }`。GeoTIFF 解码器需要 Worker code-splitting；默认 IIFE Worker 无法生成多 chunk。
- 2026-11-03 的最终生产构建中，页面 JS 约 `355.39 kB`，浏览器 DEM Worker 入口约 `177.94 kB`；页面 JS 同时包含工作区已有的 Fireflow/UI 未提交功能，不能把全部体积变化归因于多 DEM。JPEG、Deflate、LZW、LERC、Zstd 等解码器保持独立 chunk。
- Vercel Preview 和生产域名尚未部署验证。已完成与 Vercel 等价的本地生产构建和真实浏览器生产预览，但域名、CDN 和线上浏览器策略仍需在后续 Preview 中复核。

## 7. 代表性数据验证

验证数据来自 `D:\AAAcode\CesiumLearn\Cesium-learn\Cesium-Learn\libs\Terrain\西峰山东侧数据`，仅用于本机测试，没有加入项目仓库或网站构建：

| 文件 | 大小 | 栅格 | CRS | NoData | 有效高程 | 结果 |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| `西峰山东侧 DEM（WGS84）.tif` | 58,111,953 B | 4358 x 2537 | EPSG:4326 | -32767 | 125.3-258.0 m | 成功，自动定位约 116.0466 E、40.1639 N |
| `西峰山东侧DEM（WGS84 UTM 50N）.tif` | 7,145,060 B | 3317 x 2501 | EPSG:32650 | -9999 | 125.2-258.0 m | 成功，自动定位到同一地理区域 |

2026-11-03 在 `npm run local:server` 未参与的生产预览 `http://127.0.0.1:4183/` 中一次多选以上两份文件：页面显示“成功 2 个，失败 0 个”，右侧“局部 DEM”出现两个可见条目，加载按钮恢复可用且取消按钮隐藏；启用 World Terrain 后状态为“Cesium World Terrain + 2 个局部 DEM”。关闭 WGS84 DEM 后状态变为 1 个局部 DEM，条目显示 Worker 与解码栅格已释放；重新启用会重新解析 58.1 MB 文件并恢复 2 个。把 UTM DEM 上移后列表顺序改变，组合 Provider 重建成功。最终 Cesium 画布为 `658 x 540`、画面非空、没有 Vite 错误覆盖层，页面错误与控制台日志为空。

## 8. 验证命令

```powershell
npm test
npm run test:python
npm run build
npm run build:vercel
npm audit --json
git diff --check
```

完整 `npm test -- --maxWorkers=1 --no-file-parallelism` 通过 22 个测试文件、118 项测试。单元测试覆盖投影识别、UTM 范围转换、Cesium 瓦片编号、严格覆盖过滤、NoData 有效掩码、基础地形回退、多 DEM 重叠优先级、单来源失败降级、解析后取消的延迟释放、右侧显隐/排序和 `TerrainController`。浏览器验证仍是必要步骤，因为构建和单元测试不能证明真实 Cesium 画面、Worker 解码性能或 ion 网络访问。

## 9. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 页面提示不支持 CRS | 先用 GDAL 转为 EPSG:4326 或 WGS84 UTM，再重新选择。 |
| 页面提示没有有效高程 | 检查 NoData 标记和高程波段；必要时用 GIS 软件修复。 |
| 大文件处理缓慢或标签页内存过高 | 先裁切范围、降低分辨率或用离线工具生成 quantized-mesh。 |
| 多个 DEM 重叠时显示了错误数据 | 在右侧“局部 DEM”组调整顺序；越靠上的 DEM 优先。 |
| 关闭 DEM 后重新打开需要等待 | 关闭时会释放 Worker 与完整栅格以控制内存，重新启用必须再次解析保留的本地 `File`。 |
| 刷新后地形消失 | 浏览器模式不持久化文件，需重新选择；正式共享应发布 quantized-mesh。 |
| DEM 边缘出现台阶 | NoData 会逐级回退，但不同数据的高程基准和分辨率仍可能不一致；需离线统一数据。 |
| 需要 `.terrain` 文件 | 使用 `tools/terrain/build_quantized_mesh.py`，浏览器模式不提供下载或持久化转换结果。 |

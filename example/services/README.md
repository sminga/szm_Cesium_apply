# 示例网站服务与数据入口

`example/services/` 封装浏览器与数据来源之间的通信，避免页面入口直接处理 URL、上传协议、目录合并和本地文件会话。

## 文件职责

| 文件 | 运行环境 | 作用 |
| --- | --- | --- |
| `localServiceClient.js` | 仅开发模式或显式开启 | 检查本地 Python 服务、列出转换后风场、上传 NC/DEM、读取本地地形目录。 |
| `terrainCatalogClient.js` | Vercel 与开发环境 | 读取公开 `terrain/catalog.json`，解析相对 URL，并可在开发模式合并本地服务目录。 |
| `localTerrainFolderLoader.js` | 支持 Service Worker 的浏览器 | 校验访客选择的 quantized-mesh 文件夹，注册临时同源会话，并把 `File` 按需交给 Service Worker。 |
| `browserDemTerrain.js` | 支持 File 与 Web Worker 的浏览器 | 创建浏览器 DEM 会话、自定义 Cesium `TerrainProvider`，并管理 Worker 请求、取消和释放。 |
| `browserDemTerrain.worker.js` | 模块 Web Worker | 使用 `geotiff` 解码栅格，按 Cesium 瓦片请求采样 heightmap，并维护小型 LRU 缓存。 |
| `demRasterMath.js` | 浏览器与单元测试 | 识别 WGS84/WGS84 UTM、执行 `proj4` 坐标转换、计算全球瓦片范围、NoData 插值和层级。 |
| `multiDemTerrainProvider.js` | Vercel 与开发环境 | 把一个基础 TerrainProvider 与多个浏览器 DEM 按像元有效性和列表优先级组合为单个 Cesium TerrainProvider。 |
| `vectorFileLoader.js` | 浏览器与单元测试 | 读取本地 GeoJSON/TopoJSON/Shapefile 文件、限制文件/要素规模，并将结果转换成 Cesium 可加载的 GeoJSON FeatureCollection。 |
| `fireflowClient.js` | 经批准的同源 HTTPS 页面 | 复用交接薄客户端，管理配置、会话恢复、旧附件元信息补齐、结果分类、状态轮询和附件读取。 |

## Fireflow 分发服务

Fireflow 默认不启用。设置 `VITE_FIREFLOW_ENABLED=true` 后，客户端仍要求 `VITE_FIREFLOW_BASE_URL` 与页面同源；留空则使用当前 `origin`。这样可以把内网 Cesium 构建产物与 `/api/v1/*` 放在同一个受控 HTTPS 入口下，不把机器 Token、私钥或任意跨域代理能力放入浏览器。

旧产品附件可能只有 `dataset_id` 和基本标签，`enrichFireflowProduct()` 会读取数据集元信息补充文件名、格式、大小和哈希。资源用途缺失时保持下载，不根据文件名猜测地图位置或科学含义。`pollFireflowRequest()` 支持 AbortSignal；中止只停止前端轮询，不会取消后端计算。

## 公开地形目录

```js
const result = await listAvailableTerrains({
  localEnabled: import.meta.env.DEV,
  localLoader: listLocalTerrains,
});
```

公开目录始终优先。开发者本地目录加载失败时保留公开结果并返回 `localWarning`；相同 URL 只保留第一条记录。

## 浏览器本地 DEM

```js
const session = await createBrowserDemTerrainSession(file, {
  signal: abortController.signal,
  onStatus: (_stage, detail) => renderProgress(detail),
});

const provider = new MultiDemTerrainProvider({
  baseProvider: ellipsoidProvider,
  sources: [{ name: session.name, provider: session.provider }],
});

await terrainController.loadProvider({ name: session.name, bounds: session.bounds }, provider);

// 切换地形、取消或页面销毁时必须终止 Worker。
session.dispose();
```

GeoTIFF `File` 只会从页面发送给当前站点创建的模块 Worker，不会上传到 Vercel、本地 Python 服务或第三方。每份启用 DEM 都有独立 Worker；Worker 保存解码后的第一波段栅格，按请求生成 `65 x 65` 高度与有效掩码。组合 Provider 用上层有效像元覆盖下层，NoData 逐级回退到其他 DEM 或基础地形。页面不会生成、下载或持久化 `.terrain` 文件。

当前支持 EPSG:4326、EPSG:32601-32660 和 EPSG:32701-32760。详细算法、重叠顺序、NoData 回退、内存边界和真实数据结果见 `docs/浏览器本地DEM加载.md`。

## 浏览器本地地形

```js
const session = await createLocalTerrainSession(fileInput.files);
await terrainController.loadLocal({
  name: session.name,
  url: session.url,
  bounds: session.bounds,
});

// 切换地形或页面销毁时释放文件引用和 Service Worker 会话。
await session.dispose();
```

文件不会上传到 Vercel 或本地 Python 服务。页面保存用户选择得到的 `File`，`example/public/local-terrain-sw.js` 只拦截 `/__local-terrain__/` 前缀并按需取回文件。

文件夹检查器会从 `layer.json` 提取相机定位范围。CTB 局部 DEM 常把 `bounds` 写成全球瓦片金字塔范围，同时用 `valid_bounds` 保存真实高程覆盖范围；页面优先使用合法的 `valid_bounds`，缺失或无效时再兼容回退到 `bounds`。这只影响“定位当前地形”，不会改写原文件，也不会改变 Cesium Provider 请求瓦片的方式。

## 浏览器本地矢量文件

```js
const { geojson, format, featureCount } = await loadVectorFile(file);
const dataSource = await Cesium.GeoJsonDataSource.load(geojson, { clampToGround: true });
await viewer.dataSources.add(dataSource);
```

`loadVectorFile(input)` 只读取浏览器选择的本地文件，不会执行 HTTP 请求。GeoJSON 经过格式和规模校验后返回；TopoJSON 通过 `topoJsonToGeoJson()` 展开仿射变换、delta 编码 arcs 和负值反向弧线引用；Shapefile 通过项目依赖 `shpjs@6.2.0` 读取 ZIP 或同名 `.shp/.dbf/.prj/.cpg` 配套文件，再统一转换为 GeoJSON。输出供 Cesium 原生 DataSource 接入。限制为总大小 50 MiB 和 100,000 个要素；超限或文件结构无效会抛出可显示的异常。

不支持 KML、外部 URL 文件或服务端上传。Shapefile 建议优先选择包含 `.shp`、`.dbf`、`.prj` 等配套文件的 ZIP；缺少 `.dbf` 时可能没有属性字段，缺少 `.prj` 时无法按投影信息转换。大数据集建议离线简化或拆分，再把适合公开浏览的数据发布为静态 GeoJSON/TopoJSON。

`shpjs` 来源：npm package `shpjs@6.2.0`，MIT License。它只负责浏览器端 Shapefile 解析，本项目没有复制其源码；构建时由 Vite 打入前端 bundle。引入它会增加生产 bundle 体积，需通过 `npm run build:vercel` 检查实际影响。

## 错误和安全边界

- `localServiceClient.js` 默认地址是 `127.0.0.1:8765`，生产代码只有显式开启时才能调用。
- 公开站点选择 GeoTIFF 时不会探测或调用 `127.0.0.1:8765`，文件大小也不经过本地服务上传接口限制。
- 浏览器 DEM 会话必须在关闭、删除、取消或页面销毁时调用 `dispose()`，否则 Worker 和完整栅格仍会占用内存。切换基础地形不会释放仍启用的局部 DEM。
- 文件夹加载拒绝缺少 `layer.json`、非 quantized-mesh、没有瓦片、上级路径模板或一次选择多个有效地形。
- 公开目录条目必须有 `name` 和 `url`；无效条目被忽略，目录结构错误会抛出可读异常。
- 页面负责捕获异常并显示给用户，不能只输出控制台。
- Fireflow 不允许非同源地址、非本机 HTTP 或 URL 中的账号密码；公开构建默认关闭，不能直接请求实验室私网 IP。

## 测试与学习

`tests/example/` 分别测试公开目录、浏览器 GeoTIFF、多 DEM 组合、浏览器文件夹、ion 资产、矢量格式解码和场景工具辅助逻辑。学习浏览器 DEM 时建议按 `demRasterMath.js`、`browserDemTerrain.worker.js`、`browserDemTerrain.js`、`multiDemTerrainProvider.js` 的顺序阅读。

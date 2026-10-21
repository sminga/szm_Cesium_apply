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

await terrainController.loadProvider({
  name: session.name,
  bounds: session.bounds,
}, session.provider);

// 切换地形、取消或页面销毁时必须终止 Worker。
session.dispose();
```

GeoTIFF `File` 只会从页面发送给当前站点创建的模块 Worker，不会上传到 Vercel、本地 Python 服务或第三方。Worker 保存解码后的第一波段栅格，Cesium 请求某个 `GeographicTilingScheme` 瓦片时才生成对应的 `65 x 65` heightmap；页面不会生成、下载或持久化 `.terrain` 文件。

当前支持 EPSG:4326、EPSG:32601-32660 和 EPSG:32701-32760。NoData 不参与双线性插值；没有有效邻点时返回 0 m。详细算法、依赖、内存边界和真实数据结果见 `docs/浏览器本地DEM加载.md`。

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

## 错误和安全边界

- `localServiceClient.js` 默认地址是 `127.0.0.1:8765`，生产代码只有显式开启时才能调用。
- 公开站点选择 GeoTIFF 时不会探测或调用 `127.0.0.1:8765`，文件大小也不经过本地服务上传接口限制。
- 浏览器 DEM 会话必须在取消、替换地形和页面销毁时调用 `dispose()`，否则 Worker 和完整栅格仍会占用内存。
- 文件夹加载拒绝缺少 `layer.json`、非 quantized-mesh、没有瓦片、上级路径模板或一次选择多个有效地形。
- 公开目录条目必须有 `name` 和 `url`；无效条目被忽略，目录结构错误会抛出可读异常。
- 页面负责捕获异常并显示给用户，不能只输出控制台。

## 测试与学习

`tests/example/` 分别测试公开目录、浏览器 GeoTIFF、浏览器文件夹和 ion 资产管理。学习浏览器 DEM 时建议按 `demRasterMath.js`、`browserDemTerrain.worker.js`、`browserDemTerrain.js` 的顺序阅读，再对照 `TerrainController.loadProvider()` 和 `main.js` 的会话切换逻辑。

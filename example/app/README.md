# 示例网站业务层

`example/app/` 负责把 Cesium Viewer、核心风场库、地形目录和页面控件组合成可交互工作台。这里属于网站业务代码，不应放入可复用核心库 `src/`。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `main.js` | 网站入口：创建 Viewer、初始化风场和地形管理器、绑定 DOM、加载示例数据、维护状态栏与图层列表。 |
| `workspaceTabs.js` | 管理顶部工作区页签的选中状态、ARIA 关系和方向键、`Home`、`End` 键盘切换。 |
| `basemaps/` | 多厂商底图目录、Cesium Provider 工厂、GCJ-02/BD-09 瓦片对齐和复合底图生命周期。 |
| `FireflowController.js` | 管理火场分发侧栏的身份、目录、幂等申请、状态轮询、产品摘要和附件预览；不直接创建 Cesium 图层。 |
| `ionAssetLayerManager.js` | 按需加载/释放 Cesium ion 影像与 3D Tiles，并用请求版本号避免异步加载完成后恢复已关闭图层。 |
| `sceneToolsController.js` | 管理工具页点位、路线、GLB Entity、坐标拾取、浏览器文件关联、Viewer 时钟恢复和 Cesium/DOM 资源释放。 |
| `layers/` | 统一场景资源注册、能力适配、地形切换竞态保护和右侧面板渲染，详见该目录 README。 |
| `windControlScale.js` | 在页面滑块位置与核心库使用的 `speedFactor` 浮点值之间转换，并统一处理数值填写框的范围限制、步进对齐和无效值回退。 |
| `favicon.png` | 示例网站图标。 |

## `main.js` 功能分区

虽然当前入口仍集中在一个文件中，但逻辑按以下职责组织：

1. 读取 `VITE_*` 公开配置并创建 Cesium Viewer。
2. 创建 `WindLayerManager`、`TerrainController`、`BasemapManager`、`IonAssetLayerManager` 和 `FireflowController`。
3. 渲染风场图层、高度控件、地形状态和场景摘要。
4. 通过 `workspaceTabs.js` 绑定顶部模式的鼠标与键盘切换，再绑定左右面板、地图工具、状态栏和参数控件。
5. 连接 `services/` 的公开目录、Fireflow 同源 API、本地开发服务、浏览器 GeoTIFF 和浏览器文件夹地形能力。
6. 加载示例风场并处理页面卸载时的资源释放。

渲染参数控件遵循“单一参数状态、多个输入入口”：滑块和数值填写框都通过 `main.js` 中同一个提交函数更新 `sharedOptions`，再同步到所有已加载图层。填写框只在提交时校正，避免用户键入中间值时被滑块回写打断；“恢复默认”先同步六项页面状态，再一次性通知图层，减少连续资源更新。

新增复杂业务时，优先抽到独立模块，不要继续把网络客户端、通用解析器或可测试状态机直接写入 `main.js`。

## 多厂商底图

底图配置、样式和 Provider 创建位于 `basemaps/`。`BasemapManager` 把天地图“基础层 + 境界线 + 注记”等内部层作为一个逻辑底图管理，所有新层成功后才释放旧底图；失败或过期请求不会清空当前地图。高德、腾讯的 GCJ-02 和百度的 BD-09 只在瓦片 tiling scheme 内对齐，风场、DEM、SHP 和工具点位仍保持 WGS84。

右侧 `SceneLayerRegistry` 只接收不含 Token 和授权 URL 的摘要。完整配置、依赖与扩展规则见 [`basemaps/README.md`](basemaps/README.md) 和 [`docs/多厂商底图与坐标系适配.md`](../../docs/多厂商底图与坐标系适配.md)。

右侧图层面板仅负责呈现 `SceneLayerRegistry` 状态。影像叠加层按真实 imagery stack 排序；“基础地形”保持单选；“局部 DEM”允许多选显隐和排序，顺序决定重叠区优先级。基础地形切换由 `terrainActivation.js` 保护，组合地形由 `MultiDemTerrainProvider` 生成。

## 浏览器 DEM 会话

`main.js` 只负责编排 UI 和地形生命周期，不直接解析 GeoTIFF。多选文件串行创建 `createBrowserDemTerrainSession()`；每份成功文件进入右侧“局部 DEM”，再与当前基础 Provider 组合后通过 `TerrainController.loadProvider()` 应用。

关闭或删除局部 DEM、页面卸载会释放对应 Worker；关闭后保留 `File` 引用，重新启用时再次解析。切换 World Terrain、椭球或 quantized-mesh 只替换基础地形，不释放已启用 DEM。所有 Provider 更新继续遵守最后请求优先和失败保留旧场景。

## ion 资产管理

```js
const manager = new IonAssetLayerManager(viewer, Cesium, {
  accessTokenAvailable: Boolean(token),
});

await manager.setImageryAsset(assetId, true);
await manager.setTilesetAsset(assetId, true, options);
manager.destroy();
```

管理器不读取 DOM，也不持有 Token 字符串。Token 由入口设置到 Cesium，并通过布尔值告知管理器是否可用。关闭或销毁时会移除 Cesium 资源；过期的成功结果不会恢复已关闭图层，过期的失败也不会覆盖当前关闭状态，晚到的 3D Tiles 结果会主动销毁。

## 地图工具

`SceneToolsController` 只属于示例网站，不进入核心库。构造时接收 Viewer、Cesium 命名空间和现有 `SceneLayerRegistry`，自身负责工具表单与 Cesium 左键事件。点、完整路线和 GeoJSON/TopoJSON/Shapefile 数据源归入 `vector` 组，复用图层显隐、定位和移除动作。Shapefile 文件由浏览器 `File`/`FileList` 读取后交给 `vectorFileLoader.js`，不会上传到服务端。

地图模式互斥。点创建支持重复落点；路线先进入临时预览，用户结束后才登记为正式条目，取消会清理临时 Polyline 和路径点。模型使用 `ModelGraphics` 与临时 Blob URL，按路线点距离和用户速度生成时间采样位置，并由 `VelocityOrientationProperty` 计算朝向。播放前备份 Viewer Clock；停止、完成、移除路线或页面销毁时恢复原时钟状态。

页面卸载时必须调用 `destroy()`，解绑事件、停止播放、移除 Entity/DataSource 并撤销 GLB Object URL。异步加载完成时还要检查控制器是否已销毁，避免迟到的数据重新进入场景。工具入口和边界见 [`docs/工具页地图标注与路线.md`](../../docs/工具页地图标注与路线.md)。

## Vercel 与配置边界

- `main.js` 随 Vite 构建到 `site-dist`，不能依赖开发者绝对路径。
- Cesium ion 和各厂商 `VITE_*` Token/URL 会进入浏览器包，只能使用限制域名、服务范围和配额的公开配置。
- `VITE_ENABLE_LOCAL_TOOLS` 和 `VITE_LOCAL_SERVICE_URL` 只用于开发者本地工具；公开构建默认不请求访客的 localhost。
- Fireflow 默认关闭；只有 `VITE_FIREFLOW_ENABLED=true` 且存在经批准的同源 HTTPS 路由时才启用。公开 Vercel 页面不能直接请求实验室 `10.x` 私网地址。
- GeoTIFF 浏览器会话不使用 `VITE_LOCAL_SERVICE_URL`，也不经过 Vercel Function；模块 Worker 由 Vite 与页面一起发布。
- 所有网络或浏览器能力失败都应转化为可见提示。
- Cesium credit 容器必须保持可见；新增数据提供者时同时检查署名、许可、带宽、缓存和 GPU 资源占用。

## 测试与学习

- `tests/example/ionAssetLayerManager.test.js` 覆盖 ion 图层增删、异步取消和资源销毁。
- `tests/example/basemapManager.test.js` 和 `basemapProviders.test.js` 覆盖复合底图、失败回退、坐标 Provider 参数、配置错误和生产 URL 边界。
- `tests/example/browserDemTerrain.test.js`、`demRasterMath.test.js` 和 `multiDemTerrainProvider.test.js` 覆盖浏览器 DEM 会话、投影、有效掩码、多源优先级、基础回退与资源释放。
- `tests/example/fireflowClient.test.js` 覆盖分发配置、会话、真实字段、资源分类、旧附件补齐、轮询和错误提示。
- `tests/example/workspaceTabs.test.js` 覆盖页签状态同步、键盘循环和 HTML 中的 `tablist/tab/tabpanel` 关联。
- 页面完整交互通过 `npm run build:vercel` 后的生产预览验证；本次还使用 `D:\下载\内蒙古自治区` 的 WGS84 Polygon Shapefile 文件组完成浏览器导入，页面显示 12 个要素并在右侧“矢量数据”组登记。
- 建议先读 `example/index.html` 了解控件，再按 `main()` 调用顺序阅读 `main.js`，最后查看 `services/`。

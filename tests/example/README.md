# 示例网站业务测试

## 文件职责

| 文件 | 覆盖行为 |
| --- | --- |
| `terrainCatalogClient.test.js` | 公开目录解析、相对 URL、空目录、HTTP 失败、公开/本地合并和生产模式边界。 |
| `fireflowClient.test.js` | 分发服务默认关闭、会话持久化与恢复、旧版附件元信息补齐、资源分类、状态轮询和错误提示。 |
| `workspaceTabs.test.js` | 顶部工作区页签的 ARIA 状态、内容面板显隐、方向键循环、`Home`/`End` 键和 HTML 关联。 |
| `localTerrainFolderLoader.test.js` | 中文/嵌套路径、`layer.json` 校验、`valid_bounds` 优先定位、无效范围回退、瓦片存在性、gzip 文件、多地形拒绝和路径规范化。 |
| `demRasterMath.test.js` | EPSG:4326 与 WGS84 UTM 识别、UTM 范围转换、Cesium 全球瓦片编号、层级推导和 NoData 插值。 |
| `browserDemTerrain.test.js` | File/Worker 能力检测、浏览器 DEM 会话创建和释放、严格覆盖判断、解析后取消的延迟释放、按需瓦片请求及非 GeoTIFF 拒绝。 |
| `multiDemTerrainProvider.test.js` | 基础地形直通、严格覆盖过滤、多 DEM 重叠顺序、NoData 逐级回退、单来源失败降级和瓦片方案兼容检查。 |
| `ionAssetLayerManager.test.js` | ion 影像与 3D Tiles 增删、Token 缺失、异步取消、晚到错误忽略和过期资源销毁。 |
| `basemapManager.test.js` | 复合底图顺序、专题影像保留、失败回退、旧请求晚到、统一显隐/透明度和销毁。 |
| `basemapProviders.test.js` | 天地图样式配对、GCJ-02/BD-09 Provider 参数、Google ion 资产、环境变量、署名和生产 URL 边界。 |
| `windControlScale.test.js` | 粒子流速度比例滑块的 `0.05～5` 范围、默认值回填、小数显示，以及填写值的边界限制、步进对齐和空值回退。 |
| `sceneLayerRegistry.test.js` | 图层能力声明、快照、排序同步、基础地形单选、局部 DEM 多选与移除前资源清理。 |
| `layerAdapters.test.js` | ion 影像真实叠放顺序、复合底图逻辑条目、显隐保留资源和移除委托。 |
| `terrainActivation.test.js` | 地形激活失败保留原活动源、旧请求晚到保护和 Provider 初始化异常。 |

```powershell
npx vitest run tests/example
```

这些测试不访问真实 Cesium ion、Vercel、Service Worker 或本机目录，也不真实解码 GeoTIFF，而是验证可分离的业务逻辑。修改 `example/app` 或 `example/services` 时，应把不依赖 DOM 的逻辑抽出后在此测试。

Service Worker 注册、文件夹权限、真实 GeoTIFF 解码、Cesium 地形画面、相机跳转和页面布局仍需浏览器生产预览验证。

图层注册中心和适配器的边界说明见 `example/app/layers/README.md`；统一图层阶段方案见 `docs/统一场景图层管理方案.md`。

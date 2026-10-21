# 示例网站业务测试

## 文件职责

| 文件 | 覆盖行为 |
| --- | --- |
| `terrainCatalogClient.test.js` | 公开目录解析、相对 URL、空目录、HTTP 失败、公开/本地合并和生产模式边界。 |
| `localTerrainFolderLoader.test.js` | 中文/嵌套路径、`layer.json` 校验、`valid_bounds` 优先定位、无效范围回退、瓦片存在性、gzip 文件、多地形拒绝和路径规范化。 |
| `demRasterMath.test.js` | EPSG:4326 与 WGS84 UTM 识别、UTM 范围转换、Cesium 全球瓦片编号、层级推导和 NoData 插值。 |
| `browserDemTerrain.test.js` | File/Worker 能力检测、浏览器 DEM 会话创建和释放、按需瓦片请求、无数据区域停止细分及非 GeoTIFF 拒绝。 |
| `ionAssetLayerManager.test.js` | ion 影像与 3D Tiles 增删、Token 缺失、异步取消、晚到错误忽略和过期资源销毁。 |
| `windControlScale.test.js` | 粒子流速度比例滑块的 `0.05～5` 范围、默认值回填、小数显示，以及填写值的边界限制、步进对齐和空值回退。 |

```powershell
npx vitest run tests/example
```

这些测试不访问真实 Cesium ion、Vercel、Service Worker 或本机目录，也不真实解码 GeoTIFF，而是验证可分离的业务逻辑。修改 `example/app` 或 `example/services` 时，应把不依赖 DOM 的逻辑抽出后在此测试。

Service Worker 注册、文件夹权限、真实 GeoTIFF 解码、Cesium 地形画面、相机跳转和页面布局仍需浏览器生产预览验证。

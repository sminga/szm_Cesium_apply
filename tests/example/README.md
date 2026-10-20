# 示例网站业务测试

## 文件职责

| 文件 | 覆盖行为 |
| --- | --- |
| `terrainCatalogClient.test.js` | 公开目录解析、相对 URL、空目录、HTTP 失败、公开/本地合并和生产模式边界。 |
| `localTerrainFolderLoader.test.js` | 中文/嵌套路径、`layer.json` 校验、`valid_bounds` 优先定位、无效范围回退、瓦片存在性、gzip 文件、多地形拒绝和路径规范化。 |
| `ionAssetLayerManager.test.js` | ion 影像与 3D Tiles 增删、Token 缺失、异步取消、晚到错误忽略和过期资源销毁。 |
| `windControlScale.test.js` | 粒子流速度对数滑块的低速范围、默认值回填、上限限制和小数显示。 |

```powershell
npx vitest run tests/example
```

这些测试不访问真实 Cesium ion、Vercel、Service Worker 或本机目录，而是验证可分离的业务逻辑。修改 `example/app` 或 `example/services` 时，应把不依赖 DOM 的逻辑抽出后在此测试。

Service Worker 注册、文件夹权限、真实 Cesium 加载和页面布局仍需浏览器生产预览验证。

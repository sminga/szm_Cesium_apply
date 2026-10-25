# 示例网站业务层

`example/app/` 负责把 Cesium Viewer、核心风场库、地形目录和页面控件组合成可交互工作台。这里属于网站业务代码，不应放入可复用核心库 `src/`。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `main.js` | 网站入口：创建 Viewer、初始化风场和地形管理器、绑定 DOM、加载示例数据、维护状态栏与图层列表。 |
| `ionAssetLayerManager.js` | 按需加载/释放 Cesium ion 影像与 3D Tiles，并用请求版本号避免异步加载完成后恢复已关闭图层。 |
| `layers/` | 统一场景资源注册、能力适配、地形切换竞态保护和右侧面板渲染，详见该目录 README。 |
| `windControlScale.js` | 在页面滑块位置与核心库使用的 `speedFactor` 浮点值之间转换，并统一处理数值填写框的范围限制、步进对齐和无效值回退。 |
| `favicon.png` | 示例网站图标。 |

## `main.js` 功能分区

虽然当前入口仍集中在一个文件中，但逻辑按以下职责组织：

1. 读取 `VITE_*` 公开配置并创建 Cesium Viewer。
2. 创建 `WindLayerManager`、`TerrainController` 和 `IonAssetLayerManager`。
3. 渲染风场图层、高度控件、地形状态和场景摘要。
4. 绑定顶部模式、左右面板、地图工具、状态栏和参数控件。
5. 连接 `services/` 的公开目录、本地开发服务、浏览器 GeoTIFF 和浏览器文件夹地形能力。
6. 加载示例风场并处理页面卸载时的资源释放。

渲染参数控件遵循“单一参数状态、多个输入入口”：滑块和数值填写框都通过 `main.js` 中同一个提交函数更新 `sharedOptions`，再同步到所有已加载图层。填写框只在提交时校正，避免用户键入中间值时被滑块回写打断；“恢复默认”先同步六项页面状态，再一次性通知图层，减少连续资源更新。

新增复杂业务时，优先抽到独立模块，不要继续把网络客户端、通用解析器或可测试状态机直接写入 `main.js`。

右侧图层面板仅负责呈现 `SceneLayerRegistry` 状态。适配器调用既有资源管理器，不另行拥有 Cesium 对象。只有影像叠加层声明实际排序能力；地形切换由 `terrainActivation.js` 保证失败/过期请求不会改变成功的活动源。具体阶段与能力矩阵见 `docs/统一场景图层管理方案.md`。

## 浏览器 DEM 会话

`main.js` 只负责编排 UI 和地形生命周期，不直接解析 GeoTIFF。用户选择文件后，入口创建 `AbortController` 和 `createBrowserDemTerrainSession()`，等待 Worker 元数据，再通过 `TerrainController.loadProvider()` 接入统一状态机并定位真实范围。

以下操作会释放浏览器 DEM 会话：应用公开/本地目录地形、加载 quantized-mesh 文件夹、启用世界地形、恢复椭球、替换另一个 GeoTIFF和页面卸载。新的 DEM 请求会先取消仍在处理的旧请求，避免晚到结果覆盖用户后续选择。

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

## Vercel 与配置边界

- `main.js` 随 Vite 构建到 `site-dist`，不能依赖开发者绝对路径。
- `VITE_CESIUM_ION_TOKEN` 会进入浏览器包，只能使用限制域名的公开 Token。
- `VITE_ENABLE_LOCAL_TOOLS` 和 `VITE_LOCAL_SERVICE_URL` 只用于开发者本地工具；公开构建默认不请求访客的 localhost。
- GeoTIFF 浏览器会话不使用 `VITE_LOCAL_SERVICE_URL`，也不经过 Vercel Function；模块 Worker 由 Vite 与页面一起发布。
- 所有网络或浏览器能力失败都应转化为可见提示。
- Cesium credit 容器必须保持可见；新增数据提供者时同时检查署名、许可、带宽、缓存和 GPU 资源占用。

## 测试与学习

- `tests/example/ionAssetLayerManager.test.js` 覆盖 ion 图层增删、异步取消和资源销毁。
- `tests/example/browserDemTerrain.test.js` 和 `demRasterMath.test.js` 覆盖浏览器 DEM 会话、投影、瓦片编号、NoData 与资源释放。
- 页面完整交互通过 `npm run build:vercel` 后的生产预览验证。
- 建议先读 `example/index.html` 了解控件，再按 `main()` 调用顺序阅读 `main.js`，最后查看 `services/`。

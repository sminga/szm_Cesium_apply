# 示例网站业务层

`example/app/` 负责把 Cesium Viewer、核心风场库、地形目录和页面控件组合成可交互工作台。这里属于网站业务代码，不应放入可复用核心库 `src/`。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `main.js` | 网站入口：创建 Viewer、初始化风场和地形管理器、绑定 DOM、加载示例数据、维护状态栏与图层列表。 |
| `ionAssetLayerManager.js` | 按需加载/释放 Cesium ion 影像与 3D Tiles，并用请求版本号避免异步加载完成后恢复已关闭图层。 |
| `windControlScale.js` | 在页面滑块的对数位置与核心库使用的 `speedFactor` 浮点值之间转换，使低速范围更容易精细调节。 |
| `favicon.png` | 示例网站图标。 |

## `main.js` 功能分区

虽然当前入口仍集中在一个文件中，但逻辑按以下职责组织：

1. 读取 `VITE_*` 公开配置并创建 Cesium Viewer。
2. 创建 `WindLayerManager`、`TerrainController` 和 `IonAssetLayerManager`。
3. 渲染风场图层、高度控件、地形状态和场景摘要。
4. 绑定顶部模式、左右面板、地图工具、状态栏和参数控件。
5. 连接 `services/` 的公开目录、本地开发服务和浏览器文件夹地形能力。
6. 加载示例风场并处理页面卸载时的资源释放。

新增复杂业务时，优先抽到独立模块，不要继续把网络客户端、通用解析器或可测试状态机直接写入 `main.js`。

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
- 所有网络或浏览器能力失败都应转化为可见提示。
- Cesium credit 容器必须保持可见；新增数据提供者时同时检查署名、许可、带宽、缓存和 GPU 资源占用。

## 测试与学习

- `tests/example/ionAssetLayerManager.test.js` 覆盖 ion 图层增删、异步取消和资源销毁。
- 页面完整交互通过 `npm run build:vercel` 后的生产预览验证。
- 建议先读 `example/index.html` 了解控件，再按 `main()` 调用顺序阅读 `main.js`，最后查看 `services/`。

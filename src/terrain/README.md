# Cesium 地形模块

`src/terrain/` 提供标准 quantized-mesh 加载入口和统一地形状态控制。模块不扫描本机目录；它只消费浏览器能够访问的 HTTP(S) 或同源虚拟 URL。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `createLocalTerrainProvider.js` | 调用 `CesiumTerrainProvider.fromUrl()`，创建指向包含 `layer.json` 目录的 Provider。 |
| `TerrainController.js` | 在椭球、Cesium World Terrain、本地/公开地形和调用方 Provider 之间切换，处理异步竞态、失败回退、进度、瓦片错误和定位。 |

## 使用方法

```js
const controller = new TerrainController(viewer, {
  onStateChange: (state) => renderTerrainStatus(state),
});

await controller.loadLocal({
  name: "山地区域",
  url: "https://cdn.example.com/terrain/mountain/",
  bounds: { west: 100, south: 20, east: 110, north: 30 },
});

await controller.loadProvider({
  name: "浏览器 GeoTIFF",
  bounds: [116.03, 40.15, 116.06, 40.17],
}, browserTerrainProvider);

controller.flyToCurrentTerrain({ duration: 0.8 });
controller.useEllipsoid();
controller.destroy();
```

## 状态和失败处理

- `status` 为 `loading`、`ready` 或 `error`，并保留当前稳定地形类型和名称。
- 新请求会使旧的异步结果失效，较慢请求不能覆盖用户后来选择的地形。
- 加载失败时继续使用最后一个成功 Provider，同时报告本次请求错误。
- Provider 的瓦片错误和待加载数量会通过订阅状态向 UI 汇报。
- `bounds` 有效时才允许定位当前地形。
- `loadProvider()` 接受现成 Provider、Promise 或工厂函数；控制器不拥有外部 Provider 的 Worker、缓存和文件引用，调用方必须在切换或销毁时释放这些资源。

## Vercel 与本地边界

- Vercel 网站可加载随站点发布的地形、对象存储/CDN 地址、访客通过 Service Worker 建立的同源本地文件会话，或浏览器 Worker 动态生成的 GeoTIFF heightmap Provider。
- Python 服务和 `tools/terrain-output` 只用于开发环境，不能作为公开用户唯一数据源。
- 大型地形应评估 CORS、缓存、带宽和对象存储成本。

## 测试与学习

`tests/terrain/TerrainController.test.js` 覆盖竞态、失败回退、监听清理和状态稳定性。公开目录和浏览器文件夹入口分别见 `example/services/terrainCatalogClient.js` 与 `localTerrainFolderLoader.js`。

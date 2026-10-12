# terrain

Cesium 标准地形加载。`createLocalTerrainProvider.js` 接收包含 `layer.json` 的 HTTP 目录，使用 `CesiumTerrainProvider.fromUrl()` 加载 quantized-mesh。

`TerrainController.js` 统一管理椭球、Cesium World Terrain 和本地地形切换，负责异步竞态保护、失败回退、瓦片错误监听、加载进度和覆盖范围定位。


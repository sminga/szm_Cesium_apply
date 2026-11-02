# 多厂商底图模块

本目录负责示例网站的基础底图选择、坐标系适配和 Cesium 影像层生命周期。它只管理位于影像栈底部的基础底图，不管理 Sentinel-2 等专题影像、风场、3D Tiles 或高程地形。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `basemapCatalog.js` | 声明 Cesium、OpenStreetMap、天地图、高德、百度、腾讯、Google、星图和无底图，以及样式、坐标系和所需配置。 |
| `basemapProviders.js` | 读取 `VITE_*` 配置，创建 Cesium Provider，并只在瓦片投影层处理 GCJ-02/BD-09 对齐。 |
| `BasemapManager.js` | 管理一个逻辑底图对应的多个 `ImageryLayer`，处理切换竞态、失败回退、显隐、透明度和资源释放。 |

## 核心原则

- 风场、DEM、SHP、GeoJSON、点位和路线继续使用 WGS84，不能为了迁就某个厂商底图而改写业务数据坐标。
- 天地图使用 CGCS2000 服务；高德和腾讯通过 `GCJ02TilingScheme` 与 Cesium WGS84 场景对齐；百度通过 `BD09TilingScheme` 对齐。
- 天地图影像、矢量和地形晕渲分别匹配 `cia`、`cva`、`cta` 中文注记；可选 `ibo` 境界线。这里的“地形晕渲图”是二维影像，不是 Cesium `terrainProvider`。
- 底图可能由基础层、境界线和注记层组成，但右侧图层管理只显示一个逻辑条目，显隐和透明度会同时作用于全部内部层。
- 新底图全部创建并加入成功后才释放旧底图；失败或旧请求晚到时保留当前成功底图。
- 底图始终位于 Cesium 影像栈底部，切换时不调用 `removeAll()`，因此不会删除 Sentinel-2 等独立影像叠加层。

## 环境变量

在 `example/.env.local` 或 Vercel 环境变量中按需配置：

```text
VITE_CESIUM_ION_TOKEN=
VITE_TIANDITU_TOKEN=
VITE_AMAP_TILE_URL=
VITE_BAIDU_TILE_URL=
VITE_TENCENT_TILE_URL=
VITE_GEOVIS_TILE_URL=
VITE_GEOVIS_TOKEN=
```

高德、百度、腾讯和星图地址必须是部署者有权使用的 HTTPS 瓦片模板。模板可以包含 `{x}`、`{y}`、`{z}`、`{reverseY}`、`{s}` 等 Cesium 占位符；本模块另外把 `{style}` 替换为当前样式值。星图模板需要浏览器 Token 时可使用 `{token}` 或 `{key}`。

所有 `VITE_*` 值都会进入浏览器包。只能使用允许公开到浏览器、限制域名和服务范围的 Token/Key，不能放入私密服务端凭据。生产构建会拒绝指向 `localhost`、`127.0.0.1` 或 `file:` 的厂商瓦片地址。

## 第三方依赖

`@cesium-china/cesium-map@1.0.0` 仅用于高德、百度和腾讯的瓦片投影与百度特殊瓦片编号。包声明 Apache 2.0 License，安装内容包含 `LICENSE.MD`；当前解包大小约 82 KB，没有额外运行时依赖，peer dependency 为 `cesium ^1.118.2`，本项目实际使用 `cesium 1.145.0`。

本项目不使用依赖内置的非官方默认瓦片地址，只向 Provider 传入部署者配置的授权 URL。天地图、OpenStreetMap、Cesium ion、Google ion 和星图仍优先使用 Cesium 原生公开 Provider。

参考资料：Cesium `WebMapTileServiceImageryProvider`、`UrlTemplateImageryProvider` 和 `ImageryLayerCollection` 官方 API 文档，以及 <https://github.com/cesiumchina/cesium-map>。外部资料不能代替本项目测试、生产构建和浏览器验证。

## 使用与扩展

页面入口在 `example/index.html` 的“场景”页，事件编排在 `example/app/main.js`。新增地图服务时：

1. 在 `basemapCatalog.js` 声明服务、样式、坐标说明和必要配置。
2. 在 `basemapProviders.js` 使用 Cesium 公共 Provider 或经过许可检查的最小适配器创建 Provider。
3. 提供明确署名，不把 Token、完整授权 URL 或 Cesium 对象写入右侧图层文案。
4. 增加缺少配置、坐标适配、复合层顺序、失败回退和 Vercel URL 边界测试。
5. 更新本 README、`docs/多厂商底图与坐标系适配.md` 和 `docs/更新日志.md`。

## 常见问题

- 厂商选项显示“未配置”：检查对应 `VITE_*` 变量，修改 Vercel 环境变量后需要重新部署。
- 返回 401/403：检查 Token/Key 权限、允许域名、套餐和服务端授权，不能通过前端绕过。
- 瓦片与风场错位：先确认 URL 返回的真实坐标系和瓦片编号；不要直接移动风场或矢量坐标来补偿底图。
- 样式没有变化：检查自定义 URL 是否包含 `{style}`，以及服务实际需要的样式参数是否与目录定义一致。
- 地图能加载但无署名：不得隐藏 `.cesium-widget-credits`，同时确认 Provider 收到了 `credit`。

## 测试

```powershell
npm test -- tests/example/basemapManager.test.js tests/example/basemapProviders.test.js tests/example/layerAdapters.test.js
npm run build:vercel
```

自动测试不请求真实厂商服务。真实浏览器检查至少覆盖一个无需新增 Key 的底图、Google ion、无底图、专题影像保留、右侧逻辑条目、署名和错误提示。实际 Vercel Preview/Production 仍需在部署域名验证 Token 限制、CORS、配额、缓存和数据许可。

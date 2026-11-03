# Cesium ion 公共资产与场景开关

## 1. 当前范围

场景页不再平铺十个相互重复的 Google/Bing/Earth at Night 影像开关。基础底图采用互斥选择，专题影像与三维内容保持独立开关，世界地形归入“地形”页。

| 类型 | 名称 | ion 资产 ID | 页面位置 | 默认状态 |
| --- | --- | --- | --- | --- |
| 基础底图 | Google Maps 卫星含标签 | `3830183` | 场景 > 基础底图 | 关闭 |
| 专题影像 | Sentinel-2 | `3954` | 场景 > 专题影像 | 关闭 |
| 3D Tiles | Google Photorealistic 3D Tiles | `2275207` | 场景 > 三维内容 | 关闭，高负载 |
| 3D Tiles | Cesium OSM Buildings | `96188` | 场景 > 三维内容 | 关闭 |
| 地形 | Cesium World Terrain | `1` | 地形 > 地形管理 | 关闭 |

Cesium World Imagery 仍通过 `createWorldImageryAsync()` 作为基础底图提供。删除的 Google Maps 等高线/仅标签/道路/卫星、Bing 道路/航空/航空含标签和 Earth at Night 不再出现在 UI，但本次没有删除 Cesium ion 后台资产，也没有改变外部资产权限。

## 2. 精简原因

- 多个不透明影像同时开启时，下层会被完全遮挡，普通用户难以判断哪个开关是真正的底图。
- Google/Bing 的多个道路、标签和卫星变体与新增多厂商基础底图重复，增加网络请求和维护成本。
- Sentinel-2 具有明确专题影像用途，保留为可与任意基础底图叠加的独立层。
- Google Photorealistic 3D Tiles 和 Cesium OSM Buildings 属于三维内容，不应与二维底图混在同一清单。
- Cesium World Terrain 改变 `terrainProvider`，必须和 DEM/quantized-mesh 放在同一个地形职责区域。

## 3. 文件职责

| 文件 | 职责 |
| --- | --- |
| `example/index.html` | 声明 Sentinel-2、两个 3D Tiles 和 World Terrain 开关。 |
| `example/app/main.js` | 绑定开关、更新状态提示、登记右侧图层，并把基础地形与启用的局部 DEM 组合。 |
| `example/app/ionAssetLayerManager.js` | 管理 ion 影像与 3D Tiles 的异步加载、取消、移除和释放。 |
| `example/app/basemaps/` | 管理 Cesium/Google ion 等互斥基础底图，不把底图当普通影像叠加层。 |
| `tests/example/ionAssetLayerManager.test.js` | 验证 ion 影像/3D Tiles 资源生命周期。 |

## 4. 资源生命周期

### 4.1 Sentinel-2

1. 用户打开开关后，`IonAssetLayerManager` 调用 `IonImageryProvider.fromAssetId(3954)`。
2. 成功后加入 Cesium `ImageryLayerCollection`，并登记到右侧“影像叠加”组。
3. 它可以隐藏、调透明度、排序或从场景移除。
4. 切换基础底图不会调用 `removeAll()`，因此 Sentinel-2 保持存在。

### 4.2 3D Tiles

管理器通过 `Cesium3DTileset.fromIonAssetId()` 创建资源。Google Photorealistic 3D Tiles 使用较保守的 `maximumScreenSpaceError` 和缓存上限，以降低公开网站带宽和显存压力，但不能保证低端电脑流畅。

### 4.3 世界地形

World Terrain 由 `TerrainController` 管理，不由 `IonAssetLayerManager` 持有。它与椭球、本地 quantized-mesh 文件夹和公开目录地形同属互斥的“基础地形”；浏览器 GeoTIFF 属于“局部 DEM”，可以在 World Terrain 上方同时启用多份。启用/关闭状态会同步到地形页和右侧两个地形分组。

### 4.4 异步取消

影像和 3D Tiles 每个资产都有独立请求版本号。关闭或销毁后，旧请求晚到不会恢复资源；迟到的 3D Tiles 成功结果会主动销毁。基础底图的异步竞态由 `BasemapManager` 单独处理。

## 5. Token、Vercel 与署名

在 `example/.env.local` 或 Vercel 环境变量中配置：

```text
VITE_CESIUM_ION_TOKEN=由部署维护者提供的浏览器 Token
```

- `VITE_*` 会进入浏览器 JavaScript，不能保存私密服务端密钥。
- Token 应在 Cesium ion 后台限制本地域名、Vercel 预览域名和生产域名，并只授予所需资产权限。
- 未配置 Token 时，Cesium/Google ion、Sentinel-2、3D Tiles 和 World Terrain 会禁用；OpenStreetMap 和无底图仍可用。
- 页面不会要求普通访客输入 Token，也不会把 Token 写入右侧图层 metadata 或错误消息。
- `.cesium-widget-credits` 必须可见，不能通过内联样式或 CSS 隐藏数据提供者署名。

如果仓库历史或旧示例曾包含可用 Token，应由维护者在 Cesium ion 后台检查权限和使用记录，必要时轮换。仅把示例文件改成占位符不能撤销已经暴露的 Token。

## 6. 用户操作

1. 在“场景 > 基础底图”选择 Cesium 或 Google，或者使用 OSM/其他已配置厂商。
2. 需要专题影像时打开 Sentinel-2；切换基础底图后它仍然保留。
3. 按需打开 Cesium OSM Buildings。Google Photorealistic 3D Tiles 数据量大，使用后及时关闭。
4. 进入“地形”页选择 Cesium World Terrain 或 quantized-mesh 作为基础地形；需要本地 GeoTIFF 时可多选加载为局部 DEM，不会替换 World Terrain。
5. 在右侧“图层管理”查看、隐藏、调透明度、定位或移除对应资源。

## 7. 验证

```powershell
npm test -- tests/example/ionAssetLayerManager.test.js tests/example/basemapManager.test.js tests/example/basemapProviders.test.js tests/example/layerAdapters.test.js
npm run build:vercel
```

浏览器桌面检查包括：Google ion 底图、Sentinel-2 开关和右侧登记；切换 OSM/无底图/Google 后专题影像不丢失；World Terrain 在地形页启用和关闭；Cesium credit 可见；页面错误列表为空。

## 8. 已知限制

- ion 资产、许可、可用区域和服务策略可能由提供者调整，维护时需要在 Cesium ion 后台重新核对。
- 真实 Vercel Preview/Production 尚未验证 Token 域名限制、网络可达性、缓存和带宽。
- 本次只检查电脑端，没有检查手机和平板，也没有做 Google Photorealistic 3D Tiles 的长时间全球性能测试。
- 多厂商底图与坐标系边界见 `docs/多厂商底图与坐标系适配.md`。

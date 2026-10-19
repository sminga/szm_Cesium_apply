# Cesium ion 公共资产开关

## 1. 功能目标

“场景”页允许普通网站用户在浏览器中按需组合 Cesium ion 公共影像、3D Tiles 和世界地形。功能随 Vite 静态站点部署到 Vercel，不依赖 Python、Docker、本地服务、开发者电脑路径或访客的 `localhost`。

公共资产仍需要网站部署者提供 `VITE_CESIUM_ION_TOKEN`。这里的“公共”表示资产可通过 ion 目录使用，不表示可以绕过 ion 鉴权、数据许可或署名要求。

## 2. 资产清单

| 类型 | 页面名称 | ion 资产 ID |
| --- | --- | ---: |
| 影像 | Google Maps 等高线 | `3830186` |
| 影像 | Google Maps 仅标签 | `3830185` |
| 影像 | Google Maps 道路 | `3830184` |
| 影像 | Google Maps 卫星含标签 | `3830183` |
| 影像 | Google Maps 卫星 | `3830182` |
| 影像 | Sentinel-2 | `3954` |
| 影像 | Earth at Night | `3812` |
| 影像 | Bing Maps 道路 | `4` |
| 影像 | Bing Maps 航空含标签 | `3` |
| 影像 | Bing Maps 航空 | `2` |
| 3D Tiles | Google Photorealistic 3D Tiles | `2275207` |
| 3D Tiles | Cesium OSM Buildings | `96188` |
| 地形 | Cesium World Terrain | `1` |

资产 ID 来自本次需求提供的 Cesium ion 公共资产列表。若 ion 后台以后调整资产可用性、许可或 ID，需要同时更新页面、本文档和验证记录。

## 3. 文件职责

| 文件 | 职责 |
| --- | --- |
| `example/index.html` | 声明资产开关、资产 ID、显示名称和右侧场景计数。 |
| `example/app/main.js` | 读取 Token、绑定 DOM、显示加载状态、管理底图和调用资产管理器。 |
| `example/app/ionAssetLayerManager.js` | 不依赖 DOM 的 ion 影像/3D Tiles 生命周期与异步竞态管理。 |
| `example/ui/index.css` | 开关列表间距、禁用态和 Cesium credit 位置。 |
| `tests/example/ionAssetLayerManager.test.js` | 使用 Cesium/viewer 替身验证增删、取消、错误和资源释放。 |

## 4. 核心流程

### 4.1 影像

1. `main.js` 从开关的 `data-ion-imagery` 读取资产 ID。
2. `IonAssetLayerManager` 调用 `Cesium.IonImageryProvider.fromAssetId()`。
3. 加载成功后，影像加入当前底图之上的 `ImageryLayerCollection`。
4. 关闭开关时只移除对应影像，不影响底图和其他公共影像。

底图使用独立的 `basemapLayer` 引用，并始终插入影像栈索引 `0`。切换底图不再调用 `removeAll()`，因此不会误删公共影像。

### 4.2 3D Tiles

1. 管理器调用 `Cesium.Cesium3DTileset.fromIonAssetId()`。
2. 成功后把 tileset 加入 `viewer.scene.primitives`。
3. 关闭时从 `PrimitiveCollection` 移除；Cesium 随后释放网络缓存、CPU 对象和 GPU 资源。

Google Photorealistic 3D Tiles 使用较保守的客户端参数：`maximumScreenSpaceError: 24`、`cacheBytes: 256 MiB`、`maximumCacheOverflowBytes: 128 MiB`。这些参数减少公开网站的带宽和显存压力，但不保证所有低端设备都能流畅运行。

### 4.3 异步取消

每个资产维护独立请求版本号。开关变化时版本号递增：

- 旧请求晚到成功：不插入场景；若是 3D Tiles，立即销毁结果。
- 旧请求晚到失败：作为已取消请求忽略，不覆盖当前“已关闭”提示。
- 页面卸载：管理器标记为已释放，清理当前图层，并让进行中的请求自动失效。

## 5. Vercel 配置与安全边界

在 `example/.env.local` 或 Vercel 项目环境变量中配置：

```text
VITE_CESIUM_ION_TOKEN=由部署维护者提供的浏览器 Token
```

注意：

- `VITE_*` 会写入浏览器 JavaScript，不能保存私密服务端密钥。
- 应在 Cesium ion 后台限制本地域名、Vercel 预览域名和生产域名。
- 未配置 Token 时，页面继续使用 OpenStreetMap，ion 公共资产开关全部禁用并显示原因。
- 页面不会要求普通访客输入 Token，也不会连接访客电脑上的本地转换服务。
- Cesium credit 容器必须可见，以展示 Cesium ion 及各数据提供者的署名。

## 6. 用户操作

1. 进入顶部“场景”。
2. 在“公共影像”中打开所需影像；多个影像可以叠加，后打开的位于更上层。
3. 在“三维与地形”中打开 3D Tiles 或世界地形。
4. 不再使用某资产时关闭开关，减少网络请求、GPU 内存和渲染压力。

多个不透明卫星或道路影像同时打开时，下层可能完全被遮挡。这属于 Cesium 影像栈的正常合成结果，不是加载失败。

## 7. 常见错误

### 开关不可用

页面提示“未配置 `VITE_CESIUM_ION_TOKEN`”。检查 Vercel 环境变量是否配置到正确环境，并在修改后重新部署；不要把 Token 硬编码到仓库。

### 加载返回 401 或 403

检查 Token 是否失效、是否包含对应资产访问权限，以及当前预览/生产域名是否在允许列表中。

### 图层打开但看不到变化

检查是否被后打开的不透明影像遮挡，或当前相机位置是否有对应 3D Tiles 数据。可暂时关闭其他影像定位原因。

### 页面内存或帧率压力增大

关闭不需要的 3D Tiles 和影像。Google Photorealistic 3D Tiles 数据量大，移动设备和集成显卡需要单独评估。

## 8. 验证方法

```powershell
node --check example/app/main.js
node --check example/app/ionAssetLayerManager.js
npm test
npm run build:vercel
```

生产预览还应检查：

- 10 个影像、2 个 3D Tiles 和 1 个地形开关均显示。
- Sentinel-2、Cesium OSM Buildings 可开启、关闭并更新右侧计数。
- 切换底图后，已开启公共影像仍保持。
- Token 缺失时开关禁用且提示清楚。
- 工具页不再出现已删除说明。
- Cesium credit 可见，无 Vite 错误覆盖层和浏览器控制台错误。

## 9. 学习顺序

1. 先读 `example/index.html` 中的 `data-ion-imagery` 和 `data-ion-tileset`，理解页面如何声明资产。
2. 再读 `main.js` 的 `toggleIonImagery()`、`toggleIonTileset()` 和 `setBasemap()`，理解 DOM 状态与 Cesium 场景的连接。
3. 然后读 `ionAssetLayerManager.js`，重点关注请求版本号、过期结果和资源释放。
4. 最后读 `tests/example/ionAssetLayerManager.test.js`，用测试理解异步取消边界。

## 10. 已知限制

- 真实 Vercel 预览域名和生产域名尚未验证。
- 本次没有长时间遍历 Google Photorealistic 3D Tiles 的全球城市数据，也没有覆盖不同移动 GPU 的性能。
- 第三方公共资产的许可、可用性、资产 ID 和服务策略可能由提供者调整，维护时需要重新核对 Cesium ion 后台。

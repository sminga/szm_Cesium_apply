# example

可运行的 Cesium 风场工作台。`index.html` 负责页面骨架，`app/main.js` 负责 Cesium、风场和界面交互，`ui/index.css` 负责双侧工作台及响应式样式。

## 启动

在项目根目录运行：

```powershell
npm run dev
```

浏览器打开 Vite 输出的地址。页面启动后会自动加载 `data/wind_3d.json` 作为示例三维风场。

需要访问 `tools/converted`、转换 NetCDF 或合并开发者本地地形时，再启动本地服务：

```powershell
npm run local:server
```

本地服务默认监听 `http://127.0.0.1:8765`。

## 页面布局

### 顶部模式栏

- **风场**：在页面顶部选择并处理 NC 文件，加载二维/三维风场，设置高度范围和渲染参数。
- **场景**：切换基础底图，并按需打开 10 个 Cesium ion 公共影像、Google Photorealistic 3D Tiles、Cesium OSM Buildings 和 Cesium World Terrain。
- **地形**：在页面顶部选择并处理 DEM，或从电脑文件夹直接加载处理后的 quantized-mesh 地形；同时管理公开地形目录、刷新、应用、定位和恢复椭球地形。
- **工具**：保留导航位置，当前不显示说明文字；NC 和 DEM 处理入口分别位于“风场”和“地形”页顶部。

顶部右侧显示当前二维/三维风场数量，并提供定位当前图层和同时开合两侧面板的快捷按钮。

### 左侧参数面板

左侧面板内容随顶部模式切换。风场页保留以下功能：

- 从项目目录或本机文件系统加载二维、三维 NC 文件。
- 显示当前风场速度色带。
- 对三维风场选择全部高度、连续范围或离散单层。
- 调整粒子密度、流动速度、低速透明度、高度拉伸、最大线长和高速区密度。流动速度范围为 `0.01` 到 `5`，步进为 `0.01`；默认值仍为 `0.3`，需要缓慢观察粒子轨迹时可继续向左降低。

### 中央地图

地图右上角提供回到初始视角、放大、缩小和定位当前风场按钮。地图左右边缘的窄按钮用于开合参数面板和图层面板。

### 右侧图层面板

右侧面板始终反映当前场景状态：

- 风场图层支持选择、显隐、定位和删除。
- 二维风场可以直接修改固定显示高度。
- 场景状态显示当前底图、已开启的 ion 影像数量、3D Tiles 数量和地形。

### 底部状态栏

状态栏显示本地服务状态、WebGL 版本、鼠标位置经纬度、相机高度和实时 FPS。

## 响应式行为

- 宽度大于 `900px` 时，参数面板、地图和图层面板组成三列工作区。
- 宽度不大于 `900px` 时，左右面板变为覆盖地图的抽屉，并且一次只打开一个。
- 宽度不大于 `560px` 时，顶部模式栏只显示图标，状态栏隐藏次要坐标信息。
- 触屏设备始终显示图层操作按钮，不依赖鼠标悬停。

## 地形发布流程

1. 在“地形”模式顶部选择并处理 DEM。
2. 在“地形”模式的“地形管理”区域，点击“加载本地文件夹”，选择包含 `layer.json` 和 `.terrain` 瓦片的处理结果；文件只在当前浏览器中读取，不会上传。
3. 在开发环境切换到“地形”模式，确认本地数据可以加载和定位。
4. 将小型数据发布到 `example/public/terrain`，或将大型数据上传到对象存储/CDN。
5. 更新 `example/public/terrain/catalog.json`，再执行 `npm run build:vercel`。
6. 公开用户从“地形”模式选择已发布数据并加载。

DEM 处理需要 Docker Desktop，属于开发者离线流程。更完整的部署边界见 `docs/公开地形与Vercel部署.md`，转换说明见 `tools/terrain/README.md`。

## 环境变量与生产构建

- 复制 `example/.env.example` 为 `example/.env.local`，可配置 `VITE_CESIUM_ION_TOKEN` 和本地服务地址。
- 未配置 ion Token 时默认使用 OpenStreetMap，并禁用场景页全部 ion 公共资产和世界地形开关，同时提供可见错误提示。
- `VITE_*` 会进入浏览器包，Cesium ion Token 必须限制允许域名，不能放置私密服务端密钥。
- Cesium credit 容器必须保持可见，以显示 Bing、Google、Sentinel、OpenStreetMap 和 Cesium ion 数据提供者署名。
- `npm run build:vercel` 构建公开工作台到 `site-dist`；`npm run build` 仍负责 npm 库产物。

## 维护约束

- 不要随意修改业务控件的 `id`；`app/main.js` 使用这些 `id` 绑定事件和更新状态。
- 面板尺寸变化后必须调用 `viewer.resize()`，避免 Cesium 画布比例和拾取位置错误。
- 风场图层列表由 `renderWindLayerList()` 统一渲染，不要维护第二份图层数据。
- 详细布局方案和控件迁移表见 `docs/UI布局改版方案.md`。

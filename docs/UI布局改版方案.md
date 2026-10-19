# Cesium 三维风场 UI 布局改版方案

## 1. 改版目标

参考 `ui_design_test/03.html` 的工作台结构，但不照搬其中的演示内容。当前项目的主要任务是加载二维/三维风场、调整粒子参数、管理底图和地形、执行数据转换，因此界面应满足以下目标：

- 地图始终是主视图，任何面板都不能长期遮挡大面积地图。
- 高频的风场参数放在左侧，数据和图层状态放在右侧。
- 顶部只负责工作模式切换，不堆放具体参数。
- 继续使用现有 DOM `id`，让 `example/app/main.js` 的风场逻辑尽量不改。
- 桌面端采用左右工作区，窄屏采用单侧抽屉，避免把桌面面板按比例压缩。

## 2. 推荐的信息架构

### 顶部栏

顶部栏高度建议为 `48px`，从左到右依次是：

1. 产品标识：风场实验台。
2. 模式切换：风场、场景、地形、工具。
3. 当前数据摘要：二维层数量、三维层数量、服务连接状态。
4. 快捷操作：定位当前图层、收起全部面板。

模式切换控制左侧面板内容。右侧的“图层管理”不跟随模式切换，始终表示当前场景状态。

### 左侧参数面板

宽度建议为 `300px`，负责“创建和修改”：

| 模式 | 面板内容 |
| --- | --- |
| 风场 | 顶部先放 NC 处理、加载二维/三维风场、风速图例、三维高度、粒子参数 |
| 场景 | 底图单选、Cesium ion 公共影像、Google/OSM 3D Tiles 和世界地形开关 |
| 地形 | 顶部先放 DEM 处理；下方放本地文件夹加载、地形目录、刷新、应用、定位和恢复椭球地形 |
| 工具 | 保留导航位置，当前不显示说明内容 |

风场页内部建议使用可折叠分组，默认展开“加载数据”和“渲染参数”，加载三维风场后再显示“三维高度”。

### 中间地图工作区

中间区域只放和视角直接相关的轻量控件：

- 右上：定位、放大、缩小、回到初始视角。
- 左右边缘：面板收起手柄。
- 左下：风速图例的紧凑浮层；左侧风场页打开时也可放在面板内，但不要同时显示两份。
- 地图中央：加载和错误状态提示，沿用 `#status`。

### 右侧图层面板

宽度建议为 `288px`，负责“查看和管理结果”：

- 风场图层列表，保留选择、显隐、定位、删除和三维层高度输入。
- 场景图层列表，包括底图、ion 影像数量、3D Tiles 数量、世界地形和本地地形。
- 每项保持一行主信息和一行次信息；操作按钮只在悬停、键盘聚焦或选中时完整显示。
- 空状态直接提供“加载二维风场”和“加载三维风场”两个动作。

第一阶段不必实现拖拽排序，因为当前 `WindLayerManager` 没有暴露明确的层级排序工作流。待渲染层确实需要排序时再增加，避免只有视觉排序、没有渲染顺序变化。

### 底部状态栏

高度建议为 `28px`，用于持续状态而非命令：

- 左侧：本地服务、Cesium ion、WebGL2 状态。
- 右侧：经度、纬度、相机高度、FPS。

FPS 建议由自定义计数器更新，不直接使用 Cesium 默认调试浮层，以保持整体样式一致。

## 3. 桌面端线框图

```text
+----------------------------------------------------------------------------------+
| 风场实验台 | [风场] [场景] [地形] [工具]       2D 1层 / 3D 2层      [定位] [收起] |
+----------------------+--------------------------------------+--------------------+
| 左侧参数 300px       |                                      | 图层管理 288px     |
|                      |                                      |                    |
| 加载数据             |             Cesium 地图              | 风场图层           |
| [二维风场] [三维风场]|                                      | 眼睛  图层名称  操作|
|                      |                                      | 眼睛  图层名称  操作|
| 风速图例             |                              [视角]  |                    |
|                      |                              [+][-]   | 场景图层           |
| 三维高度             |                                      | 底图 / 建筑 / 地形 |
|                      |                                      |                    |
| 渲染参数             |                                      |                    |
| 粒子 密度 速度 高度  |                                      |                    |
+----------------------+--------------------------------------+--------------------+
| 服务: 已连接  WebGL2: 可用                 经度 / 纬度 / 高度 / FPS               |
+----------------------------------------------------------------------------------+
```

## 4. 窄屏布局

当宽度小于 `900px` 时：

- 顶部模式按钮保留图标，隐藏次要文字和数据摘要。
- 左右面板变为覆盖地图的抽屉，一次只允许打开一个。
- 抽屉宽度使用 `min(340px, calc(100vw - 48px))`。
- 右侧图层入口和左侧参数入口固定在地图两侧边缘。
- 底部状态栏只显示相机高度和 FPS，坐标在点击地图后以临时提示显示。

当宽度小于 `560px` 时，顶部只保留产品图标、当前模式名称和图层入口，不把四个模式标签硬塞在一行中；模式选择改为弹出菜单。

## 5. 视觉方向与设计令牌

界面定位为“气象数据工作台”，颜色来源于风速图例和雷达/气象终端，不使用单一蓝紫色科技风。

```css
:root {
  --app-bg: #081015;
  --map-fallback: #0b171d;
  --surface-1: rgba(14, 27, 34, 0.94);
  --surface-2: #142832;
  --surface-hover: rgba(255, 255, 255, 0.065);
  --border-soft: rgba(196, 218, 226, 0.15);
  --border-strong: rgba(196, 218, 226, 0.28);
  --text-1: #edf5f6;
  --text-2: #9fb2b9;
  --text-3: #667b84;
  --accent-cyan: #63d4c8;
  --accent-yellow: #f0cf65;
  --danger: #f47770;
  --success: #65c99f;
  --header-height: 48px;
  --footer-height: 28px;
  --left-panel-width: 300px;
  --right-panel-width: 288px;
  --radius-control: 5px;
  --radius-panel: 0;
}
```

设计原则：

- 面板是工作区边界，使用直边，不做悬浮大圆角卡片。
- 青绿色表示当前选择和主要操作，黄色只表示地形或需要注意的状态，红色只用于删除和错误。
- 字体优先使用系统中文 UI 字体：`"Segoe UI", "Microsoft YaHei", sans-serif`。
- 参数值使用等宽数字特性 `font-variant-numeric: tabular-nums`，不需要全局使用等宽字体。
- 动效只用于面板开合和状态切换，持续时间控制在 `160ms` 至 `240ms`。

## 6. 现有控件迁移表

为避免重写 `example/app/main.js`，下列 `id` 应原样保留，只移动 DOM 位置：

| 目标区域 | 必须保留的现有元素 |
| --- | --- |
| 顶部摘要 | `#data-summary`、`#zoom` |
| 左侧风场/加载数据 | `#open-2d-catalog`、`#open-3d-catalog`、`#browse-2d-input`、`#browse-3d-input` |
| 左侧风场/图例 | `#speed-gradient`、`#speed-ticks` |
| 左侧风场/三维高度 | `#vertical-controls`、`#height-min`、`#height-max`、`#height-level`、`#apply-height-range` |
| 左侧风场/渲染参数 | `#particles`、`#speed`、`#low-speed-opacity`、`#height`、`#length`、`#density`、`#density-enabled`、`#dynamic` |
| 右侧图层 | `#wind-layer-list`、`#wind-layer-count` |
| 左侧场景 | `#basemap-status`、`[data-basemap]`、`[data-ion-imagery]`、`[data-ion-tileset]`、`#buildings-toggle`、`#terrain-toggle`、`#ion-layer-message` |
| 左侧地形 | `#local-terrain-select`、`#open-local-terrain-catalog`、`#refresh-terrains`、`#load-local-terrain`、`#disable-terrain`、`#layer-message` |
| 左侧风场顶部 | `#convert-file`、`#convert-file-input`、`#conversion-result` |
| 左侧地形顶部 | `#convert-dem`、`#dem-file-input`、`#dem-result` |
| 左侧地形管理 | `#load-local-terrain-folder`、`#local-terrain-folder-input`、`#local-terrain-folder-result`、`#local-terrain-select`、`#open-local-terrain-catalog`、`#refresh-terrains`、`#load-local-terrain`、`#locate-terrain`、`#disable-terrain`、`#layer-message` |
| 全局 | `#cesiumContainer`、`#status`、两个现有 `dialog` |

现有 `.panel-tab` / `.panel-page` 可以继续使用，但建议把顶部模式按钮命名为 `.workspace-tab`，将左侧内容页命名为 `.workspace-page`。如果更名，需要同步修改 `bindTabs()` 中的选择器；其他业务代码无需变化。

## 7. 推荐的 HTML 骨架

以下只展示结构。迁移时把现有 section 放入对应容器，不要重新创建同名 `id`。

```html
<div class="wind-app">
  <header class="app-header">
    <a class="app-brand" aria-label="风场实验台">...</a>
    <nav class="workspace-tabs">...</nav>
    <div id="data-summary" class="header-summary">等待数据</div>
    <button id="zoom" class="icon-button" type="button">...</button>
  </header>

  <div class="app-workspace">
    <aside id="control-panel" class="workspace-panel panel-left">...</aside>

    <main class="map-workspace">
      <div id="cesiumContainer"></div>
      <div id="status" role="status">正在加载示例风场</div>
      <nav class="map-toolbar">...</nav>
      <button class="panel-handle panel-handle-left">...</button>
      <button class="panel-handle panel-handle-right">...</button>
    </main>

    <aside id="layer-panel" class="workspace-panel panel-right">
      <header class="workspace-panel-header">图层管理</header>
      <div id="wind-layer-list" class="wind-layer-list">...</div>
    </aside>
  </div>

  <footer class="app-statusbar">...</footer>
</div>
```

## 8. JavaScript 改动边界

建议保留所有数据加载、风场管理、底图、地形和转换逻辑，只新增一个很薄的 UI 状态层：

```js
const uiState = {
  activeWorkspace: "wind",
  leftPanelOpen: true,
  rightPanelOpen: true,
};

function setWorkspace(name) {
  uiState.activeWorkspace = name;
  document.querySelectorAll("[data-workspace]").forEach((tab) => {
    const active = tab.dataset.workspace === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-workspace-page]").forEach((page) => {
    page.hidden = page.dataset.workspacePage !== name;
  });
}

function setPanelOpen(side, open) {
  uiState[`${side}PanelOpen`] = open;
  document.body.classList.toggle(`${side}-panel-closed`, !open);
  requestAnimationFrame(() => viewer.resize());
}
```

增加坐标和 FPS 时，建议把监听器独立为 `bindStatusBar(viewer)`，不要把显示逻辑混入风场图层代码。

## 9. 分阶段实施

### 第一阶段：只换布局，风险最低

1. 在 `example/index.html` 增加 `.wind-app`、顶部栏、双侧面板和状态栏骨架。
2. 移动现有 section 和控件，保持所有业务 `id` 不变。
3. 重写 `example/ui/index.css` 的页面级布局，保留现有控件样式。
4. 在 `main.js` 中只调整页签选择器，并在面板开合后调用 `viewer.resize()`。

验收标准：现有加载、参数调整、底图、地形、转换和弹窗流程全部可用。

### 第二阶段：补齐工作台交互

1. 增加左右面板开合与窄屏抽屉互斥。
2. 增加地图缩放、回到初始视角按钮。
3. 增加坐标、相机高度和统一样式的 FPS 状态栏。
4. 把右侧风场图层的操作按钮改为悬停或选中时显示。

### 第三阶段：优化状态表达

1. 将底图、建筑、地形同步显示在右侧场景图层区。
2. 为加载中、服务断开、WebGL2 不可用增加明确状态。
3. 记忆面板开合和最后使用的模式，可使用 `localStorage`。
4. 根据实际需求决定是否增加图层拖拽排序。

## 10. 建议修改的文件

| 文件 | 主要职责 | 建议 |
| --- | --- | --- |
| `example/index.html` | 页面结构 | 改成顶部栏 + 左面板 + 地图 + 右面板 + 状态栏 |
| `example/ui/index.css` | 全部界面样式 | 先建立令牌和布局，再迁移现有控件样式 |
| `example/app/main.js` | 业务和交互 | 只新增工作区切换、面板开合、状态栏绑定 |
| `example/ui/workspace.js` | 可选的新文件 | 若不想继续扩大 `main.js`，把纯 UI 状态放在这里 |

不建议修改 `src/` 下的风场库代码。此次改版属于示例应用层，应限制在 `example/` 内。

## 11. 实施时的注意事项

- `#cesiumContainer` 必须跟随工作区尺寸，而不是继续固定覆盖整个 `body`。
- 面板宽度动画结束后要调用 `viewer.resize()`，否则 Cesium 画布可能出现比例或拾取位置不一致。
- 同一个 `id` 只能保留一份；风速图例在左面板和地图浮层之间应二选一或移动同一个节点。
- 移动 `dialog` 不影响现有逻辑，但建议继续放在 `.wind-app` 末尾，避免被面板的 `overflow` 裁切。
- 右侧图层面板不要复制 `windLayers` 数据；继续由现有 `renderLayerList()` 作为单一渲染入口。
- 触屏设备没有 hover，图层操作按钮在窄屏下应始终显示。
- UI 改版后至少验证 `1440x900`、`1024x768`、`768x1024` 和 `390x844` 四个视口。

## 12. 推荐结论

最适合当前项目的方案是保留参考页的“顶栏 + 双侧面板 + 地图中心 + 状态栏”骨架，但把左右职责明确分开：左侧只放设置和工具，右侧只放当前场景与图层结果。第一轮改造应坚持 DOM `id` 兼容，不碰风场核心逻辑；这样可以先得到明显更清晰的工作台布局，再逐步增加面板状态、坐标和图层排序等功能。

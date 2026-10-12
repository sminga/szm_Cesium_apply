# ui

示例工作台的界面样式。目前由 `index.css` 统一管理页面级布局、控件、弹窗和响应式行为。

## 布局组成

- `.app-header`：顶部产品标识、四个模式页签、数据摘要和快捷操作。
- `.app-workspace`：左侧参数面板、中央 Cesium 地图和右侧图层面板。
- `.panel-left`：随模式切换的参数与工具区域。
- `.map-workspace`：Cesium 画布、地图工具条、面板开关和地图状态提示。
- `.panel-right`：风场图层列表和场景状态。
- `.app-statusbar`：服务、WebGL、坐标、相机高度和 FPS。

## 设计令牌

颜色、面板尺寸和过渡时间集中定义在 `:root`。调整主题时优先修改变量，不要在组件中重复添加近似颜色。

主要变量包括：

- `--header-height`、`--footer-height`
- `--left-panel-width`、`--right-panel-width`
- `--surface-1`、`--surface-2`、`--border-soft`
- `--text-1`、`--text-2`、`--text-3`
- `--accent`、`--terrain`、`--danger`、`--success`

## 响应式断点

- `1100px`：略微缩小两侧面板和顶部模式按钮。
- `900px`：三列布局切换为覆盖式抽屉。
- `560px`：顶部页签仅显示图标，精简状态栏和弹窗按钮布局。
- `hover: none`：图层操作按钮保持可见。
- `prefers-reduced-motion: reduce`：关闭非必要过渡动画。

## 修改注意事项

- `#cesiumContainer` 必须填满 `.map-workspace`，不能重新固定到整个 `body`。
- 面板开合状态由 `body.left-panel-closed` 和 `body.right-panel-closed` 控制。
- 页面不使用嵌套卡片；分组主要依靠面板边界和分隔线表达。
- 新增图标优先从现有 `lucide` 依赖导入。
- 弹窗应保留在工作台根节点末尾，避免被面板滚动区域裁切。


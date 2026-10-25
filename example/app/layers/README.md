# 统一场景图层管理

本目录把示例网站中已经加载的底图、影像、风场、3D Tiles、地形源和短时数据任务统一登记到右侧“图层管理”面板。它属于网站业务层，不进入 npm 库的公共 `src/` API。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `layerCapabilities.js` | 定义分组、显示顺序和可见、排序、透明度、定位、激活、移除等能力。 |
| `SceneLayerRegistry.js` | 保存规范化状态，校验动作能力，通知订阅者，并管理组内顺序与清理。 |
| `layerAdapters.js` | 把现有风场、Cesium ion、底图、地形和处理任务转换为统一条目。 |
| `terrainActivation.js` | 以请求版本保护异步地形切换；只有最新成功请求可成为活动源。 |
| `LayerPanelController.js` | 渲染右侧分组折叠栏，处理显隐、定位、透明度、同组排序、地形切换和移除。 |

## 输入、输出与核心流程

调用方输入一份定义，至少包含稳定 `id`、分组 `group`、名称和能力；如支持操作，还提供相应 action adapter。注册中心规范化默认字段后向订阅者发送只读风格的数据快照，快照不会暴露动作函数。动作执行委托给原有业务管理器，成功后才更新显示状态。

```js
registry.register({
  id: "imagery:example",
  group: "imagery",
  name: "示例影像",
  capabilities: { visible: true, opacity: true, remove: true },
  actions: {
    setVisible: (_entry, visible) => { imageryLayer.show = visible; },
    setOpacity: (_entry, opacity) => { imageryLayer.alpha = opacity; },
    remove: () => manager.removeImagery("imagery:example"),
  },
});
```

分组、操作和排序语义由 `docs/统一场景图层管理方案.md` 定义。不要直接把 Cesium 对象放入 metadata 以外的 UI 文本，也不要把 registry 当作 GPU/Worker 资源管理器。

## 顺序语义

- 底图固定在 Cesium 影像集合底部，不参加拖动排序。
- 只有影像叠加层启用拖动与上移/下移；列表越靠上，在 Cesium 影像栈中也越靠上。
- 风场与 3D Tiles 可以同时存在，但 WebGL 深度测试决定遮挡关系，列表顺序不承诺覆盖关系。
- Cesium Globe 同一时刻只有一个 `terrainProvider`。面板保存多个候选地形源，并用单选状态标记当前活动源。
- “数据任务”只表示读取、处理、应用、失败或取消过程，不等同于已经进入场景的图层。

## 生命周期与边界

注册中心不直接创建或销毁 Cesium 对象。`main.js` 通过适配器继续调用 `WindLayerManager`、`IonAssetLayerManager` 和 `TerrainController`，避免产生第二套资源所有权。用户点击“从场景移除”后，底层管理器先释放 GPU、Worker 或网络资源，成功后注册中心才删除条目。

浏览器选择的 DEM 和 quantized-mesh 文件夹默认只在当前会话使用，不上传到 Vercel 或第三方。公开目录和对象存储中的资源仍通过正常 URL 加载。后续接入 SHP、ENVI、TIF 或天地图时，应先定义它属于影像、矢量、3D 内容还是地形，再声明真实支持的能力，不能为了统一外观而提供无效排序。

地形切换按“最新用户选择优先”：异步 Provider 创建被较新请求取代后，旧结果不会改写活动地形；失败时原 Provider 留在场景中，失败候选保留状态供用户重试。DEM 任务重试使用新任务 ID，以隔离旧 Worker 的迟到进度。

## 配置与部署

- 本模块没有额外环境变量、Serverless API 或新依赖。
- 它随 `example/` 站点进入 Vite/Vercel 构建，不要求用户启动本机服务。
- 本机 GeoTIFF/文件夹内容仍只在浏览器当前会话使用；开发者本地 DEM 转换使用已有本地服务，公开部署不提供该转换服务。
- 所有 Cesium ion 数据仍需浏览器可见、限制域名的 Token，并保留 Cesium/数据提供者署名。

## 测试

运行 `npm test -- tests/example/sceneLayerRegistry.test.js tests/example/layerAdapters.test.js tests/example/terrainActivation.test.js`。测试覆盖注册/顺序、影像适配、地形失败回退和过期请求；不连接真实 ion、Vercel 或 Service Worker。页面集成仍需执行 `npm run build:vercel`，并在真实桌面浏览器中检查 Cesium 图层顺序、资源释放、地形互斥、版权署名和错误提示。

## 常见问题与限制

- 想对风场或 3D Tiles 排序：当前不能保证改变真实深度遮挡，因此不显示排序控件。
- 同时激活多个高程地形：Cesium 的 `terrainProvider` 是单值，面板保留多个候选，但只能单选应用。
- 处理任务移除失败或网络中断：底层资源由对应 adapter 管理；取消网络 fetch 不保证已经开始的本地 CTB 子进程立即退出。
- 某类数据没有操作按钮：说明 adapter 没声明/未实现该能力，不应仅为 UI 一致性添加空动作。
- 当前没有 SHP、ENVI、天地图等适配器；扩展前应先确认格式授权、署名、渲染栈顺序和 Vercel 资源路径。

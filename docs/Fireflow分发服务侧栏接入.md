# Fireflow 分发服务侧栏接入

## 功能目标

本功能把实验室 Fireflow 分发 API 接入示例网站左侧“火场服务”页签。第一阶段负责身份、目录、申请、状态和结果附件，不接管 Cesium 地图渲染，也不把机器令牌放进浏览器。

普通用户可以完成以下流程：

1. 从接口返回值选择接收力量和岗位。
2. 恢复当前浏览器上一次有效的身份会话，失效时重新选择。
3. 按岗位和分类读取科研视图的实际 `request_options`，不在页面写死产品编号。
4. 每次点击生成新的幂等键并提交一次申请。
5. 显示 `pending`、`running`、`completed`、`failed` 实际状态。
6. 申请完成后显示产品标题、质量状态和纯文字 `summary`。
7. 在侧栏预览科研图片，按需预览 JSON/CSV/文字，并下载全部附件。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `example/services/fireflowClient.js` | 复用交接包薄客户端，读取环境配置、恢复会话、补齐旧版附件元信息、分类资源、轮询状态和下载附件。 |
| `example/app/FireflowController.js` | 管理侧栏 DOM、身份、目录、申请、轮询暂停/恢复、结果摘要、图片和文字预览。 |
| `example/index.html` | 声明“火场服务”页签、身份区、产品目录、申请状态和结果容器。 |
| `example/ui/index.css` | 结果图片、附件卡、下载按钮和长文本预览样式。 |
| `tests/example/fireflowClient.test.js` | 验证默认关闭、会话、真实字段标识、资源分类、旧附件补齐、状态轮询和错误提示。 |
| `docs/Cesium分发完整对接资料-20261102/` | 服务方提供的 API、真实 HTTP 记录、CA、附件和历史 NC 证据；它是对接依据，不是公开网站数据目录。 |

## 配置与部署

功能默认关闭。只有部署者明确配置以下环境变量时才会请求分发服务：

```dotenv
VITE_FIREFLOW_ENABLED=true
VITE_FIREFLOW_BASE_URL=
```

`VITE_FIREFLOW_BASE_URL` 留空时使用当前页面 `origin`。交接客户端要求同源 HTTPS；`localhost` 开发环境可以使用 HTTP。配置非同源地址会显示可见错误，不会自动关闭 CORS、代理到任意地址或绕过证书校验。

推荐内网部署结构：

```text
浏览器
  -> https://同一个内网站点/
     -> Cesium 静态文件
     -> /api/v1/* 同源转发到 Fireflow
```

当前实验室入口 `https://10.11.203.182:8443/` 使用 Caddy 内部 CA。受控设备需要按单位流程核对并信任根 CA。根证书不能进入 JavaScript 包，也不能通过前端代码静默安装。

## 状态与生命周期

- `terminal_id` 由交接客户端保存在 `localStorage`，用于识别同一浏览器终端。
- 页面另外保存 `session_id`、力量和岗位。初始化时调用身份恢复接口；恢复失败会清除旧会话并要求重新选择。
- 产品目录显式请求 `view=research`，与交接样例、科研图片和完整产品申请选项保持一致，不依赖薄客户端的默认视图。
- 新申请显式生成 `crypto.randomUUID()` 幂等键。一次新点击使用一个新键；客户端不会自动重复 POST。
- 活动任务约每 3 秒读取一次状态。切换到其他页签或销毁页面时只停止浏览器轮询，不会取消后端计算，因为当前 API 没有前端取消任务接口。
- 回到“火场服务”页签时，如果最近任务仍是 `pending` 或 `running`，页面继续查询同一个 `request_id`。
- `running` 可能因服务端租约重新回到 `pending`，页面不把任务状态渲染成不可逆百分比进度。
- `failed` 停止轮询并显示 `last_error` 或 `progress_hint`；`completed` 必须有 `result_product_id` 才能读取产品。

## 新旧附件兼容

候选增强接口可返回 `media_type`、`file_format`、`data_role`、`size_bytes`、`bbox` 等字段；生产旧记录可能只有 `asset_id`、`dataset_id`、`asset_type`、`label` 和 `sort_order`。

前端遇到旧记录时会调用 `GET /api/v1/datasets/{dataset_id}` 补充文件名、格式、大小、哈希和下载地址。补充失败时仍保留原附件下载入口，不伪造用途或地理信息。

资源规则：

- `chart` 或普通图片：侧栏预览。
- `brief_text`、JSON、CSV、文本：用户点击后读取，最多显示前 20,000 个字符。
- `attachment` 或未知类型：只下载。
- `wind_2d`、`wind_3d`：显示后续接入提示并提供下载，第一阶段不自动创建风场图层。
- `map_overlay`：即使声明 `map_ready` 和 `bbox`，第一阶段仍只下载，等待真实地理配准影像验收后再进入 Cesium。

所有服务端文字都通过 `textContent` 写入页面，不执行 HTML。科研图片使用同源数据集 URL；附件预览必须由用户点击触发。

## Vercel 与公开网站边界

当前 Fireflow 只有实验室私网 IP，没有正式公网域名、Vercel 可达路由、正式用户认证、逐对象下载授权或公网数据许可。因此：

- 公开 Vercel 构建必须保持 `VITE_FIREFLOW_ENABLED=false`，除非已有经批准的同源 HTTPS 网关。
- 不能把 `VITE_FIREFLOW_BASE_URL` 直接设为 `10.x` 私网地址来规避架构问题。
- `VITE_*` 会进入浏览器包，不能放机器 Token、私钥或其他服务端秘密。
- 交接资料中的真实图片、CSV、JSON 和 NC 只用于内部研发联调，当前没有公开发布授权，不能复制到 `example/public`、Vercel 或 CDN。

## 当前验证

- `node --check` 已覆盖服务适配层、控制器和 `main.js`。
- Fireflow 定向 Vitest 共 9 项，覆盖配置、会话、原生 `fetch` 绑定、真实选项字段、资源分类、旧记录补齐、轮询和错误提示。
- `npm run build:vercel` 已通过，证明 Unicode 交接目录引用和新增页面可以进入生产构建。
- 真实生产写流程尚未执行；当前只读接口和交接包 fixture 已核验。

## 以后需要解决的问题

1. **生产增强字段上线**：确认正式 `products` 是否返回 `data_role`、`media_type`、`map_ready`、`bbox` 等字段，继续保留旧记录兼容测试。
2. **真实生产申请验收**：双方安排一次获准的真实身份、申请、三态轮询、结果和失败流程，记录实际算法耗时和节点恢复行为。
3. **NetCDF 风场**：当前历史样例是 NetCDF-4/HDF5、单层 U/V、无 W；需由服务端生成项目可读的 NetCDF-3，或另行评估浏览器 HDF5 解析成本。二维产品允许 W 缺失，但不能伪造 `W=0` 的科学含义。
4. **地图专题图**：需要真实 `map_overlay`，包括 EPSG:4326 范围、像素配准、透明/NoData、图例裁剪和版权，再使用 Cesium 影像 Provider 接入图层管理。
5. **公网网关**：若要让 Vercel 用户使用，需要批准域名、私网路由、可信 HTTPS、正式认证、限流审计和大文件分发；本阶段不提供临时绕过方案。
6. **数据许可**：确认图件、观测、CSV、JSON 和 NC 的公开展示、下载、署名和保留期限。
7. **浏览器范围**：本阶段应完成桌面生产预览；移动设备、不同浏览器、长期轮询和大附件内存仍需按后续部署范围验证。

## 推荐阅读顺序

1. `docs/Cesium分发完整对接资料-20261102/01-先读与需求逐项答复.md`
2. `docs/Cesium分发完整对接资料-20261102/02-接收端API契约.md`
3. `example/services/fireflowClient.js`
4. `example/app/FireflowController.js`
5. `tests/example/fireflowClient.test.js`


# Vercel 公开静态资源

`example/public/` 会由 Vite 原样复制到公开网站根路径。这里的内容会被任何网站访问者直接读取，不能存放密钥、个人数据或仅限本机使用的文件。

## 现有内容

| 路径 | 网站路径 | 作用 |
| --- | --- | --- |
| `data/` | `/data/` | 需要稳定 URL 的公开示例数据。 |
| `terrain/` | `/terrain/` | 公开地形目录和可选的小型 quantized-mesh 数据集。 |
| `local-terrain-sw.js` | `/local-terrain-sw.js` | 为访客主动选择的本地地形文件夹提供当前会话内的同源虚拟 URL。 |

## Service Worker 工作方式

1. 页面校验文件夹并创建随机会话 ID。
2. Service Worker 只拦截 `/__local-terrain__/<id>/...`。
3. Cesium 请求 `layer.json` 或瓦片时，Service Worker 向当前页面索取相应 `File`。
4. gzip 瓦片优先通过 `DecompressionStream` 解压；不支持时使用 `Content-Encoding: gzip`。
5. 页面释放会话后，后续请求返回 404，不会持久保存用户文件。

## 修改与验证

- Service Worker 路径、作用域或虚拟前缀变化时同步更新 `localTerrainFolderLoader.js`。
- 修改后执行 `npm test`、`npm run build:vercel`，并在 HTTPS 或本机安全上下文生产预览中验证注册、刷新和释放。
- 生产构建结果应在 `site-dist/` 中包含本目录需要发布的文件。

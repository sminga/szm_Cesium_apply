# config

服务凭据统一通过环境变量读取（见 `serviceTokens.js`）：

- 本地开发：在 `example/.env`（已被 Git 忽略）中写入 `VITE_CESIUM_ION_TOKEN`。
- 线上部署（Vercel）：在项目 Settings -> Environment Variables 中配置同名变量。

不要把真实 token 写入文档或提交记录；token 会随前端代码公开，请在 Cesium ion 控制台配置域名白名单。

# config

旧版示例通过 `serviceTokens.js` 读取服务凭据，当前示例入口已不再依赖该文件。请复制 `example/.env.example` 为 `example/.env.local`，使用 `VITE_CESIUM_ION_TOKEN` 配置 Cesium ion。

`VITE_*` 值会进入浏览器包，只能放置允许公开到浏览器的 Token。应在 Cesium ion 后台限制允许访问的开发、Vercel 预览和生产域名，不要在 `VITE_*` 中保存私密服务端密钥。

`serviceTokens.example.js` 仅为旧版集成保留的字段参考，新代码不应继续导入它。


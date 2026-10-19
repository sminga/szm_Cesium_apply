# 公开静态数据目录

`example/public/data/` 中的文件会按原文件名复制到 Vercel 站点 `/data/` 路径，适合需要稳定 URL 的公开静态资源。

当前 `wind_3d.json` 是历史或兼容用途的数据副本；工作台主要示例由 `example/data/wind_3d.json` 通过 Vite 资产 URL 加载。维护时应避免两个副本无意产生不同内容。

## 使用边界

- 只放置允许公开分发、无需鉴权的数据。
- 不放置 Token、用户上传、临时转换结果或开发者本地路径信息。
- 更新后执行 `npm run build:vercel`，检查 `site-dist/data/`。
- 大文件需要评估部署包体积、首次下载、缓存和带宽；必要时迁移到对象存储/CDN。

需要内容哈希和自动依赖追踪的数据优先放在 `example/data/` 并通过 `import` 或 `new URL(..., import.meta.url)` 引用。

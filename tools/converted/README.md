# 转换后风场目录

`tools/converted/` 保存 `convert_netcdf.py` 或本地 HTTP 服务生成的 `.nc`/`.cdf`。开发模式网页通过 `/api/wind-files` 列出这里的文件。

## 管理规则

- 实际数据默认被 Git 忽略，README 保留在仓库中。
- 文件可能很大，不会自动进入 Vercel 公开站点。
- 输出文件名冲突时本地服务会追加序号，避免覆盖已有结果。
- 确认无用后可人工清理，但不要在其他转换或网页读取进行中删除。
- 需要公开的数据应检查许可和体积，再复制到受控静态目录或上传对象存储/CDN。

查看目录接口前先运行 `npm run local:server`。格式说明和转换命令见 `tools/netcdf/README.md`。

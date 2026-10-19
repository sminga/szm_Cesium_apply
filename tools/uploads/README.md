# 上传临时目录

本地 HTTP 服务把 NC 和 DEM 请求体暂存到 `tools/uploads/netcdf/` 或 `tools/uploads/dem/`，处理完成后在 `finally` 阶段删除输入文件。

## 管理规则

- 临时内容被 Git 忽略，不能作为长期数据存储。
- 服务异常退出时可能留下孤立文件，可在确认没有转换任务运行后清理。
- 不应从网页直接引用这里的路径。
- 目录只属于开发者本机流程，不进入 Vercel 部署。
- 如果磁盘空间不足或文件超过服务限制，上传会失败并返回可读错误。

上传实现和安全限制见 `tools/server/local_service.py`，相关测试见 `tests/tools/test_local_service.py`。

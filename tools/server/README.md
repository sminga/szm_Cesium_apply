# 开发者本地 HTTP 服务

`local_service.py` 使用 Python 标准库 `ThreadingHTTPServer`，把 NetCDF、DEM 和本地目录能力提供给开发模式网页。默认只监听 `127.0.0.1:8765`。

## 启动

```powershell
npm run local:server
```

可直接查看命令参数：

```powershell
py tools/server/local_service.py --help
```

## 接口

| 方法与路径 | 作用 |
| --- | --- |
| `GET /health` | 返回服务状态、风场目录和地形目录。 |
| `GET /api/wind-files` | 列出 `tools/converted` 中的 `.nc`/`.cdf`。 |
| `GET /files/wind/<name>` | 下载转换后的风场文件。 |
| `POST /api/convert/netcdf?filename=...` | 上传并转换 NetCDF。旧 `/convert` 路径保留兼容。 |
| `POST /api/convert/dem?filename=...` | 上传 DEM 并调用 Docker CTB。 |
| `GET /api/terrains` | 检查并列出 `tools/terrain-output` 数据集。 |
| `GET /terrain/<dataset>/...` | 提供 `layer.json` 和 `.terrain` 瓦片。 |

## 安全与文件管理

- 上传大小上限为 1 GB，上传采用流式写入。
- 文件名会清理并校验扩展名；下载路径必须限制在配置根目录内，防止目录穿越。
- 上传临时文件在成功或失败后删除；失败时删除不完整输出。
- `.terrain` 使用长期缓存，目录和元数据使用短缓存并支持 ETag、Last-Modified、HEAD 和 304。
- 默认 CORS 为 `*`，仅适合开发者本地服务；不要把该脚本直接当作公网生产服务。

## Vercel 边界

Vercel 公开站点不会长期运行此进程，也不能访问开发者电脑。需要公开的转换结果应发布到静态资源或对象存储。长时间 Docker 转换不适合直接迁移成普通 Serverless Function。

## 测试和排错

```powershell
py -m unittest tests.tools.test_local_service
```

访问 `http://127.0.0.1:8765/health` 可确认服务是否启动。端口占用、Docker 未运行、输入格式错误和磁盘空间不足会通过 JSON `message` 返回给页面。

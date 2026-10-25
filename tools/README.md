# 本地开发与数据处理工具

`tools/` 保存开发者离线使用的 Python、Docker 和本地 HTTP 服务。它们用于准备风场或地形数据，不属于 Vercel 公开网站运行时，也不能成为普通访客使用网站的前置条件。

## 目录

| 目录 | 作用 |
| --- | --- |
| `netcdf/` | 通用 NetCDF-4/HDF5 风场规范化，以及使用独立 WRF 依赖处理错列网格、曲线坐标和地形跟随高度。 |
| `terrain/` | 检查地形数据集，并通过 Docker/GDAL/CTB 把 DEM 转成 quantized-mesh。 |
| `server/` | 为开发页面提供风场目录、文件下载、转换接口和地形静态托管。 |
| `converted/` | NetCDF 转换结果和开发模式风场目录。 |
| `terrain-output/` | quantized-mesh 输出数据集。 |
| `uploads/` | HTTP 上传过程的临时文件。 |

## 常用命令

```powershell
# 启动开发者本地服务
npm run local:server

# 直接转换 NetCDF
py tools/netcdf/convert_netcdf.py input.nc

# WRF wrfout 使用独立 Conda 环境，详细参数见 tools/netcdf/README.md
python tools/netcdf/convert_wrf.py input_wrfout.nc --time-index 0 --height-step 500

# 直接转换 DEM，需要 Docker Desktop
py tools/terrain/build_quantized_mesh.py input.tif

# 测试 Python 工具
npm run test:python
```

## 与 Vercel 的边界

- 公开构建默认不请求 `127.0.0.1:8765`。
- 本地工具输出如果要提供给网站访客，必须进一步发布到 `example/public`、对象存储或 CDN。
- `tools/converted`、`tools/uploads` 和 `tools/terrain-output` 中的实际数据默认被 Git 忽略，也不会自动进入 Vercel Deployment。
- 不要在这些工具中写死开发者盘符；命令行输入和项目相对目录应可配置。

## 学习顺序

先阅读 `netcdf/README.md` 或 `terrain/README.md` 理解具体格式，再阅读 `server/README.md` 了解网页如何调用。WRF 转换是开发者离线预处理，不由公开 Vercel 网站执行。接口和转换测试位于 `tests/tools/`。

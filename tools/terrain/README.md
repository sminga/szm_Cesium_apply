# DEM 与 quantized-mesh 工具

`tools/terrain/` 把 DEM 离线转换为 Cesium 可加载的 quantized-mesh，并检查现有地形目录是否完整。这是开发者工具，不在 Vercel 公开站点中执行。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `build_quantized_mesh.py` | 调用 Docker 中的 GDAL 和 CTB，重投影 DEM、生成瓦片和 `layer.json`，并在完成后校验输出。 |
| `terrain_dataset.py` | 检查 `layer.json` 格式、bounds、层级、瓦片数量、总大小、法线和水面遮罩等元数据。 |

## 前置条件

1. 安装并启动 Docker Desktop。
2. 确认 `docker info` 成功，而不只是 `docker --version`。
3. 首次使用时拉取镜像：

```powershell
docker pull tumgis/ctb-quantized-mesh:latest
```

Windows 推荐使用 WSL 2 backend。Docker daemon 未运行时，脚本会明确报错并停止。

## 命令行转换

```powershell
py tools/terrain/build_quantized_mesh.py "D:\data\dem.tif"
```

支持 `.tif`、`.tiff`、`.img`、`.asc` 和 `.dem`。默认输出到：

```text
tools/terrain-output/<安全化数据集名称>/
```

处理流程：

1. 检查输入文件、扩展名和 Docker。
2. 把输入临时复制到项目 `tools/terrain-input/`。
3. 在容器内使用 `gdalwarp` 重投影到 EPSG:4326。
4. 使用 `ctb-tile` 生成 Mesh 瓦片和 `layer.json`。
5. 使用 `inspect_terrain_dataset()` 校验结果。
6. 删除临时输入和中间 GeoTIFF；失败时删除不完整输出目录。

输出目录重名时自动追加序号，不覆盖已有数据。

## 网页开发入口

```powershell
npm run local:server
npm run dev
```

在开发模式“地形”页顶部使用“选择并处理 DEM”。处理完成后，可以：

- 点击“加载本地文件夹”直接检查结果。
- 通过本地服务地形目录加载。
- 小型数据复制到 `example/public/terrain/`。
- 大型数据上传对象存储/CDN，并更新公开 `catalog.json`。

公开 Vercel 网站默认禁用 DEM 转换，因为 Docker/GDAL/CTB 长任务不适合静态网站或普通 Serverless 请求。

## DEM 准备要求

- 推荐 GeoTIFF，并确保 CRS 正确。
- 数据范围和分辨率越大，耗时、内存、磁盘和瓦片数量越高。
- 多个 DEM 应先按业务需求拼接或分别处理。
- 输出磁盘必须有足够空间，Docker 需保持运行至完成。

## 常见错误

| 现象 | 原因与处理 |
| --- | --- |
| 找不到 `docker` | 安装 Docker Desktop，重启终端并检查 PATH。 |
| `Cannot connect to Docker daemon` | 启动 Docker Desktop，等待完成后运行 `docker info`。 |
| 镜像拉取失败 | 检查 Docker Hub 网络、代理和磁盘空间。 |
| 输出缺少 `layer.json` | 检查 DEM CRS、输入完整性、Docker 日志和磁盘空间。 |
| 页面加载失败 | 确认数据集校验通过，并使用 HTTP、公开 URL 或浏览器文件夹会话，不能使用 Windows 文件路径。 |

## 测试与学习

```powershell
py -m unittest tests.tools.test_terrain_dataset
```

单元测试不实际运行 Docker。真实转换需要代表性 DEM 做端到端验证。学习时先读 `terrain_dataset.py` 理解合格输出，再读 `build_quantized_mesh.py` 的 Docker 命令，最后阅读 `docs/公开地形与Vercel部署.md` 理解发布流程。

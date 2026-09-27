# terrain

DEM 处理工具。依赖 Docker Desktop 和 `tumgis/ctb-quantized-mesh` 镜像，先用 GDAL 转为 EPSG:4326，再调用 CTB 生成标准 quantized-mesh 和 `layer.json`。

命令行示例：

```powershell
py tools/terrain/build_quantized_mesh.py "D:\data\dem.tif"
```
当前脚本支持的输入格式为：
.tif
.tiff
.img
.asc
.dem

# 使用前需要安装Docker Desktop



要完成“本地 DEM 转换为 Cesium 可加载的 quantized-mesh 地形”，需要在 Windows 上安装并运行 Docker Desktop，然后让项目中的脚本通过 Docker 调用 `tumgis/ctb-quantized-mesh:latest` 镜像进行转换。具体步骤如下。

## 1. 安装 Docker Desktop
1. 确认是否已安装 Docker
在 Windows 上，推荐使用 Docker Desktop for Windows。
检查开始菜单或 C:\Program Files\Docker 目录下是否有 Docker Desktop。
如果未安装，请前往官网下载并安装：https://www.docker.com/products/docker-desktop/
⚠️ 注意：Windows 版 Docker Desktop 通常需要启用 WSL 2 或 Hyper-V。安装过程中请确保勾选相关选项，并在安装完成后 重启电脑。


----
在 Windows 上安装完整的 **Docker Desktop**，不要只安装 Docker 命令行工具。

安装时建议选择：

- 使用 **WSL 2 backend**
- 启用 Windows Subsystem for Linux
- 启用 Virtual Machine Platform

如果电脑没有 WSL 2，可以用管理员 PowerShell 执行：

```powershell
wsl --install
```

然后重启电脑。

启动 Windows 后，打开 Docker Desktop，等待界面显示 Docker 已经运行。Docker Desktop 必须保持打开，后续脚本才能调用 Docker。

## 2. 检查 Docker 是否可用

打开 PowerShell，执行：

```powershell
docker --version
```

正常情况下会看到类似：

```text
Docker version 27.x.x
```

然后执行：

```powershell
docker info
```

如果 Docker 正常运行，会显示服务器、容器、镜像等信息。

如果出现下面这类错误：

```text
error during connect
Cannot connect to the Docker daemon
```

说明 Docker Desktop 没有启动完成。需要先打开 Docker Desktop，并等待它完全启动后再执行命令。

注意：仅仅看到 `docker --version` 有输出还不够，必须确保 `docker info` 也能够正常执行，因为真正进行 DEM 转换的是 Docker daemon。

## 3. 拉取 DEM 转换镜像

第一次使用前，在 PowerShell 中执行：

```powershell
docker pull tumgis/ctb-quantized-mesh:latest
```

这个命令会下载项目默认使用的镜像。

下载完成后，可以用下面的命令检查镜像是否存在：

```powershell
docker images
```

列表中应该能看到：

```text
tumgis/ctb-quantized-mesh
```

如果下载失败，常见原因包括：

- Docker Desktop 没有启动
- 网络无法访问 Docker Hub
- 公司网络或校园网络设置了代理
- Docker Desktop 的代理没有配置正确
- 磁盘空间不足

可以先测试 Docker 是否能运行普通容器：

```powershell
docker run --rm hello-world
```

如果 `hello-world` 也运行失败，说明 Docker 本身还没有配置好，不是项目脚本的问题。

## 4. 启动项目的本地服务

进入项目目录：

```powershell
cd "D:\AAAcode\CesiumLearn\Cesium-learn\Cesium-Learn\OtherPeopleS\cesium-wind-layer-3d"
```

启动本地服务：

```powershell
npm run local:server
```

正常情况下会启动：

```text
http://127.0.0.1:8765
```

这个服务主要负责：

- 接收 GUI 上传的 DEM 文件
- 调用 Python DEM 处理脚本
- 调用 Docker 容器完成格式转换
- 托管转换后的 `.terrain` 文件
- 提供本地地形列表
- 提供本地风场文件列表

这个 PowerShell 窗口需要保持运行，不要关闭。

## 5. 启动前端页面

再打开一个新的 PowerShell 窗口，同样进入项目目录：

```powershell
cd "D:\AAAcode\CesiumLearn\Cesium-learn\Cesium-Learn\OtherPeopleS\cesium-wind-layer-3d"
```

启动 Vite 前端：

```powershell
npm run dev
```

浏览器打开：

```text
http://localhost:3000/
```

不能直接双击 HTML 文件打开，因为浏览器的 `file://` 模式无法正确访问本地地形瓦片和服务接口。

## 6. 通过 GUI 处理 DEM

打开网页后，进入本地地形相关工具区域。

点击类似以下名称的按钮：

```text
选择并处理 DEM
```

然后选择本地 DEM 文件。

当前脚本支持的输入格式为：

```text
.tif
.tiff
.img
.asc
.dem
```

例如：

```text
D:\data\sample_dem.tif
```

选择文件后，网页会把文件发送给本地服务，服务再调用：

```text
tools\terrain\build_quantized_mesh.py
```

脚本会自动执行以下操作：

1. 将原始 DEM 临时复制到：

```text
tools\terrain-input\
```

2. 使用 Docker 中的 `gdalwarp` 将数据转换到 EPSG:4326。

3. 使用 `ctb-tile` 生成 Cesium quantized-mesh 地形瓦片。

4. 将结果保存到：

```text
tools\terrain-output\<数据集名称>\
```

5. 检查输出目录中是否存在：

```text
layer.json
```

6. 删除临时输入文件和中间 GeoTIFF 文件。

处理成功后，网页应提示类似：

```text
DEM 处理成功
输出目录：tools/terrain-output/sample_dem/
```

实际的绝对路径通常类似：

```text
D:\AAAcode\CesiumLearn\Cesium-learn\Cesium-Learn\OtherPeopleS\cesium-wind-layer-3d\tools\terrain-output\sample_dem\
```

## 7. 检查是否转换成功

处理完成后，打开输出目录：

```powershell
explorer ".\tools\terrain-output"
```

进入对应的数据集目录，例如：

```text
tools\terrain-output\sample_dem\
```

至少应检查以下文件：

```text
layer.json
```

以及若干 `.terrain` 瓦片文件。

可以用 PowerShell 检查：

```powershell
Test-Path ".\tools\terrain-output\sample_dem\layer.json"
```

如果返回：

```text
True
```

说明基本输出结构已经生成。

也可以查看目录内容：

```powershell
Get-ChildItem ".\tools\terrain-output\sample_dem" -Recurse
```

如果目录中只有日志或空目录，没有 `layer.json` 和 `.terrain` 文件，说明处理失败，需要查看本地服务窗口中的错误信息。

## 8. 在 Cesium 中加载处理后的地形

DEM 处理成功后，回到网页 GUI：

1. 点击刷新本地地形列表。
2. 选择刚才生成的地形数据集。
3. 点击加载本地地形。
4. Cesium 应该切换到对应的本地 quantized-mesh 地形。

本地地形一般通过以下地址访问：

```text
http://127.0.0.1:8765/terrain/<数据集名称>/
```

网页不能直接从 Windows 文件夹读取 `.terrain` 文件，必须通过 `local_service.py` 提供 HTTP 服务。

## 9. 命令行备用方式

如果 GUI 暂时不能使用，也可以直接通过命令行处理 DEM。

在项目根目录执行：

```powershell
py tools/terrain/build_quantized_mesh.py "D:\data\dem.tif"
```

例如：

```powershell
py tools/terrain/build_quantized_mesh.py "D:\AAAcode\data\mountain.tif"
```

处理成功后，输出目录默认位于：

```text
tools\terrain-output\mountain\
```

然后启动本地服务：

```powershell
npm run local:server
```

再在网页中刷新地形列表并加载。

## 10. DEM 文件准备要求

为了提高成功率，建议注意以下事项：

- DEM 最好是单个文件。
- DEM 应该带有正确的坐标参考系 CRS。
- 如果没有 CRS，脚本可能无法正确判断地理位置。
- 数据最好是 GeoTIFF 格式，即 `.tif` 或 `.tiff`。
- 多个 DEM 瓦片需要先拼接，或者逐个处理。
- DEM 范围越大、分辨率越高，处理时间越长。
- 文件路径尽量使用英文、数字和下划线，避免特殊符号。
- 输出目录所在磁盘需要有足够空间。
- Docker Desktop 需要保持运行到处理完成。

## 11. 常见错误

### 错误一：找不到 Docker

如果看到：

```text
docker command not found
```

或者：

```text
无法将“docker”项识别为 cmdlet
```

说明 Docker Desktop 没有安装，或者 Docker 没有加入 PATH。

解决方法：

1. 安装 Docker Desktop。
2. 重启 PowerShell。
3. 再执行：

```powershell
docker --version
```

### 错误二：Docker daemon 未运行

如果看到：

```text
Cannot connect to the Docker daemon
```

解决方法：

1. 打开 Docker Desktop。
2. 等待状态变为 Running。
3. 执行：

```powershell
docker info
```

### 错误三：镜像下载失败

执行：

```powershell
docker pull tumgis/ctb-quantized-mesh:latest
```

如果失败，可以检查：

```powershell
docker run --rm hello-world
```

如果网络问题持续存在，需要在 Docker Desktop 的设置中配置代理，或者换用可以访问 Docker Hub 的网络环境。

### 错误四：提示缺少 `layer.json`

这通常说明转换过程没有完整执行，可能原因包括：

- 输入 DEM 无法读取
- DEM 坐标系缺失或错误
- Docker 镜像执行失败
- CTB 工具处理失败
- 磁盘空间不足
- DEM 文件损坏

需要查看运行 `npm run local:server` 的 PowerShell 窗口，里面会有具体错误日志。

### 错误五：网页能打开，但地形加载失败

检查以下内容：

```powershell
npm run local:server
```

是否仍在运行。

然后访问：

```text
http://127.0.0.1:8765/health
```

如果返回健康状态，说明本地服务正常。

还需要确认：

```text
tools/terrain-output/<名称>/layer.json
```

确实存在，并且浏览器访问的是：

```text
http://localhost:3000/
```

而不是直接双击 HTML 文件。

## 推荐的完整启动顺序

以后每次使用时，可以按照这个顺序：

```powershell
cd "D:\AAAcode\CesiumLearn\Cesium-learn\Cesium-Learn\OtherPeopleS\cesium-wind-layer-3d"
docker info
npm run local:server
```

然后打开第二个 PowerShell：

```powershell
cd "D:\AAAcode\CesiumLearn\Cesium-learn\Cesium-Learn\OtherPeopleS\cesium-wind-layer-3d"
npm run dev
```

最后浏览器访问：

```text
http://localhost:3000/
```

然后在 GUI 中选择：

```text
选择并处理 DEM
```

处理成功后，到：

```text
tools/terrain-output/<数据集名称>/
```

确认存在 `layer.json`，再点击刷新地形列表并加载。

目前这台机器之前没有检测到 Docker，因此尚未完成真实 DEM 转换的端到端验证。你需要先安装并启动 Docker Desktop，再按照上述流程操作。
# NetCDF 风场转换工具

浏览器加载器直接支持 NetCDF-3 Classic 和 64 位偏移格式。`convert_netcdf.py` 使用 xarray、NumPy 和 netCDF4，把 NetCDF-4/HDF5 或变量命名不统一的数据整理为项目约定的 NetCDF-3 风场。

## 安装和基本使用

```powershell
py -m pip install xarray numpy netCDF4
py tools/netcdf/convert_netcdf.py "D:\data\wind.nc"
```

默认输出到 `tools/converted/<输入名>_wind3d.nc`。也可显式指定变量：

```powershell
py tools/netcdf/convert_netcdf.py input.nc `
  --u eastward_wind --v northward_wind --w upward_air_velocity `
  --lon longitude --lat latitude --lev height --time-index 0
```

## WRF-ARW wrfout 专用流程

`convert_netcdf.py` **不能直接转换 WRF `wrfout`**。WRF 的 U/V/W 位于不同的错列网格，地理经纬度是二维曲线网格，垂直坐标也会随地形变化。请使用独立的 `convert_wrf.py`，它调用 `wrf-python` 的 `uvmet`、`wa` 和 `z` 诊断：把 U/V 去错列并旋转到地理东/北方向，把 W 去错列到质量点，再将三分量插值到统一的海拔高度（MSL）和规则经纬度网格。

推荐在 WSL2/Linux Conda 环境安装当前 WRF 专用依赖，避免把 WRF 的 Python 扩展混装到项目网页依赖中：

```bash
conda create -n cesium-wrf -c conda-forge python=3.11 wrf-python=1.4.2 netcdf4 xarray numpy scipy
conda activate cesium-wrf
```

截至 2026-10-22，conda-forge 的 `wrf-python` 当前版本为 1.4.2，win-64 只保留较旧的 1.3.4.1 构建（Python 3.11）。推荐 WSL2/Linux 使用 1.4.2；若必须原生 Windows，可尝试锁定 `python=3.11 wrf-python=1.3.4.1`，但本项目未验证该组合。不要改用通用转换器对错列变量直接求平均，因为那样无法正确处理风向旋转、垂直层高度和曲线网格。

转换用户提供的 WRF 文件示例：

```powershell
python tools/netcdf/convert_wrf.py `
  "C:\桌面\AAA正进行\毛铂涵 改进\wrfout_d01_2024-04-03_08-00-00(1).nc" `
  --time-index 0 --height-step 500 `
  -o "tools/converted/wrfout_d01_2024-04-03_08-00-00_wind3d.nc"
```

WSL2 中可使用以下实际路径形式：

```bash
cd /mnt/d/AAAcode/CesiumLearn/Cesium-learn/cesium-wind-layer-3d
python tools/netcdf/convert_wrf.py \
  "/mnt/c/桌面/AAA正进行/毛铂涵 改进/wrfout_d01_2024-04-03_08-00-00(1).nc" \
  --time-index 0 --height-step 500 \
  -o "/mnt/d/Book/03 李占胜老师/wrfout_d01_2024-04-03_08-00-00_wind3d.nc"
```

- `--time-index` 选择 WRF 文件里的时次；该示例用第一个时次。一个输入文件若包含多个 `Time`，可多次运行并为每个结果指定不同输出文件。
- `--height-step` 指定共同 MSL 高度层间隔，单位米，默认 500 米。程序取所有网格柱都覆盖的高度交集，因此复杂地形下最低输出层可能高于地表附近；这避免把不存在的风速高度伪造为零。
- `--nx`、`--ny` 可设定规则经纬网分辨率，默认分别采用源 WRF 的水平网格宽、高。分辨率降低可缩小输出数据和浏览器纹理负担。
- 经度、纬度先覆盖源域外接范围，再对曲线网格做线性插值。凸包之外及垂直覆盖无效的位置会被剔除，最后只保留最大的完整有效矩形，因为当前浏览器加载器要求规则、无缺测的经纬度网格。
- 输出包含 `lon`、`lat`、`lev` 以及等尺寸 `U/V/W(lev,lat,lon)`，使用 NetCDF-3 64-bit offset。转换成功后可放入 `tools/converted/` 并在开发页面“风场”面板加载。
- 输出默认不覆盖已存在文件；需明确传入 `--overwrite` 才会覆盖。

该脚本是开发者离线预处理工具，不会把数据上传到网站。公开 Vercel 网站无法调用本机 Conda、Python 或 `tools/converted/`；若要向公众发布结果，需要将输出作为公开静态文件或对象存储/CDN 资源发布，并按数据体积评估带宽和缓存。

## 转换规则

- 自动识别常见经度、纬度、高度、U、V、W 名称。
- 输出维度顺序统一为 `(lev, lat, lon)`。
- 缺少 W 时使用零填充。
- Pa/s 的 W/omega 会被拒绝，因为它不是 m/s 垂直速度。
- 单层高度缺测哨兵值会按 `0 m` 处理，也可使用 `--single-level-height 200` 指定。
- 可显式启用 `--repair-constant-latitude-stripes` 修复整行恒定且与相邻纬度突变的异常条带；该修复不会默认开启。

## 网页入口

运行 `npm run local:server` 后，开发模式“风场”页顶部的“选择并处理 NC”会上传文件并调用同一转换函数。公开 Vercel 网站默认禁用该按钮，因为普通访客不能访问开发者 Python 环境。

## 错误和验证

- 找不到变量时使用显式参数，不要根据上下文猜测物理量。
- 转换后应在开发页面加载，检查范围、高度、速度和异常条带。
- 自动测试：`py -m unittest tests.tools.test_convert_netcdf`。
- WRF 转换算法测试：`py -m unittest tests.tools.test_convert_wrf`；需要实际转换时另需 `wrf-python`、`netCDF4`、SciPy 等 Conda 依赖。
- 浏览器读取规则见 `src/data/README.md`，异常风场诊断见 `docs/Wind3D异常诊断与修复.md`。

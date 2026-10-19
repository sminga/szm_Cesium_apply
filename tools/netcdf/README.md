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
- 浏览器读取规则见 `src/data/README.md`，异常风场诊断见 `docs/Wind3D异常诊断与修复.md`。

**NetCDF 转换**
浏览器加载器仅支持读取 NetCDF-3 Classic 和 64 位偏移格式的文件。在示例 UI 中打开 NetCDF-4/HDF5 或非标准格式的文件前，需要先进行转换。

```bash
py -m pip install xarray numpy netCDF4
py tools\netcdf\convert_netcdf.py "D:\data\wind.nc"
```

默认输出文件名为 `<输入文件名>_wind3d.nc`。转换器能够自动识别常见的经度（longitude）、纬度（latitude）、高度（height）、U、V 和 W 变量名；如需自定义映射，可使用显式参数：

```bash
py tools\netcdf\convert_netcdf.py input.nc `
  --u eastward_wind --v northward_wind --w upward_air_velocity `
  --lon longitude --lat latitude --lev height --time-index 0
```

输出变量的维度顺序为 `(lev, lat, lon)`。若缺少 W 分量，将自动用零填充。如果 W/omega 字段的单位是 Pa/s（垂直气压速度），转换器会拒绝处理，因为它不是以 m/s 为单位的垂直速度，需要先做物理量纲转换。

**浏览器 GUI 服务**
在项目根目录下运行可复用的本地服务：

```bash
npm run local:server
```

该服务接收用户在示例“工具”选项卡中选择的文件，调用上述转换器，并返回包含输出文件绝对路径的 JSON 结果。输出文件保存在 `tools/converted/`，上传临时文件位于 `tools/uploads/` 并在处理后删除。服务还会把 `tools/converted/` 作为网页风场目录提供给 GUI。

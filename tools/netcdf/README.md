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

单层数据有时会把 `9.96921e+36` 一类缺测哨兵值写进 `height`，却没有声明 `_FillValue`。转换器会把这种单层高度按 `0 m` 处理，也可以显式指定显示高度：

```bash
py tools\netcdf\convert_netcdf.py input.nc --single-level-height 200
```

如果源数据包含“跨越全部经度、U/V/W 每个分量在整行完全恒定，并且与上下相邻纬度行发生大幅突变”的异常条带，可以显式启用插值修复。该选项不会默认开启，避免把真实的均匀风场误判为坏数据：

```bash
py tools\netcdf\convert_netcdf.py input.nc `
  --repair-constant-latitude-stripes `
  --stripe-jump-threshold 5
```

修复会在控制台逐条报告处理的高度索引和纬度索引。应先检查原始数据和转换日志，再决定是否使用该选项。

**浏览器 GUI 服务**
在项目根目录下运行可复用的本地服务：

```bash
npm run local:server
```

该服务接收用户在示例“工具”选项卡中选择的文件，调用上述转换器，并返回包含输出文件绝对路径的 JSON 结果。输出文件保存在 `tools/converted/`，上传临时文件位于 `tools/uploads/` 并在处理后删除。服务还会把 `tools/converted/` 作为网页风场目录提供给 GUI。

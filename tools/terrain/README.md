# terrain

DEM 处理工具。依赖 Docker Desktop 和 `tumgis/ctb-quantized-mesh` 镜像，先用 GDAL 转为 EPSG:4326，再调用 CTB 生成标准 quantized-mesh 和 `layer.json`。

命令行示例：

```powershell
py tools/terrain/build_quantized_mesh.py "D:\data\dem.tif"
```


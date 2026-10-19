# quantized-mesh 地形输出目录

`tools/terrain-output/` 保存 `build_quantized_mesh.py` 生成的标准 Cesium 地形。每个数据集是独立子目录，至少应包含 `layer.json` 和分级 `.terrain` 瓦片。

```text
terrain-output/
  dataset-name/
    layer.json
    0/0/0.terrain
    1/...
```

## 使用与检查

- 启动 `npm run local:server` 后，通过 `/api/terrains` 查看有效数据集。
- 开发页面也可以使用“加载本地文件夹”直接选择某个处理完成的目录，不上传文件。
- `terrain_dataset.py` 会检查格式、瓦片数量、层级、范围和总大小。
- 转换过程可能产生 `.tmp` 等中间内容；只有通过检查并包含有效 `layer.json` 的目录才应作为可用结果。

## 发布边界

实际地形数据被 Git 忽略，不会自动部署到 Vercel。小型数据可整理后发布到 `example/public/terrain/<name>/`；大型数据应上传对象存储/CDN，并配置 HTTPS、CORS 和缓存。

不要把正在生成的数据集当作稳定资源，也不要在转换运行中人工移动或删除目录。

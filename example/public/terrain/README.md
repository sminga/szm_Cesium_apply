# 公开地形目录

`catalog.json` 是公开网站读取的地形清单。每个条目至少包含 `name` 和 `url`，并可提供 `bounds`、`minLevel`、`maxLevel`、`tileCount`、`size`、`hasVertexNormals`、`hasWaterMask` 和 `description`。

小型数据集可以放在 `example/public/terrain/<dataset>/`，目录内保留 `layer.json` 和 quantized-mesh 瓦片，并在清单中使用相对地址 `./<dataset>/`。Vite 构建后这些文件会发布到网站 `/terrain/` 路径。

大型地形不应直接放入 Vercel Deployment。请发布到支持 HTTPS、跨域和长期缓存的对象存储或 CDN，再在 `catalog.json` 中填写绝对 HTTPS URL。发布前可使用 `tools/terrain/terrain_dataset.py` 和本地服务验证数据结构。

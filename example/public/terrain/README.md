# 公开地形目录

`catalog.json` 是公开网站读取的地形清单。每个条目至少包含 `name` 和 `url`，并可提供 `bounds`、`minLevel`、`maxLevel`、`tileCount`、`size`、`hasVertexNormals`、`hasWaterMask` 和 `description`。

## 清单示例

```json
{
  "version": 1,
  "name": "公开地形目录",
  "terrains": [
    {
      "name": "演示山地",
      "url": "./mountain/",
      "bounds": [100, 20, 110, 30],
      "description": "小型公开演示数据"
    }
  ]
}
```

相对 URL 以 `catalog.json` 的网站地址为基准解析，因此能同时适配 Vercel 预览域名和正式域名。

## 发布方式

小型数据集可以放在 `example/public/terrain/<dataset>/`，目录内保留 `layer.json` 和 quantized-mesh 瓦片，并在清单中使用相对地址 `./<dataset>/`。Vite 构建后这些文件会发布到网站 `/terrain/` 路径。

大型地形不应直接放入 Vercel Deployment。请发布到支持 HTTPS、跨域和长期缓存的对象存储或 CDN，再在 `catalog.json` 中填写绝对 HTTPS URL。发布前可使用 `tools/terrain/terrain_dataset.py` 和本地服务验证数据结构。

## 验证和常见问题

1. 执行 `npm run build:vercel`，确认 `site-dist/terrain/catalog.json` 存在。
2. 使用生产预览打开“地形”页，刷新目录并加载条目。
3. 检查对象存储是否允许站点域名跨域访问，并正确返回 `layer.json` 和 `.terrain`。
4. 如果目录条目不显示，检查 JSON 是否有效且每项都有非空 `name` 和 `url`。
5. 如果目录可见但瓦片失败，检查 URL、TMS 路径、gzip 响应头、CORS 和数据集完整性。

目录读取实现见 `example/services/terrainCatalogClient.js`，地形切换状态见 `src/terrain/TerrainController.js`，完整部署说明见 `docs/公开地形与Vercel部署.md`。

# 公开地形与 Vercel 部署

## 功能边界

公开网站只读取浏览器可访问的静态资源或 HTTPS 服务，不会默认访问访客电脑上的 `127.0.0.1`。Python、Docker、NetCDF 转换和 DEM 转 quantized-mesh 仍是开发者离线工具，使用者需要在项目开发环境中运行 `npm run local:server`。

离线处理结果如需提供给公开用户，必须进一步发布到 `example/public/terrain`、对象存储或 CDN，并加入公开地形目录。Vercel 网站不会运行本项目的 Python 转换服务，也不会持久保存转换输出。

## 公开地形目录

页面默认读取 `example/public/terrain/catalog.json`。Vite 构建会将该文件发布为相对于站点入口的 `terrain/catalog.json`，目录项中的相对 URL 会基于目录文件地址解析，因此兼容 Vercel 预览域名、生产域名和自定义域名。

目录结构示例：

```json
{
  "version": 1,
  "name": "公开地形目录",
  "terrains": [
    {
      "name": "演示山区",
      "url": "./demo-mountain/",
      "bounds": [100, 20, 110, 30],
      "minLevel": 0,
      "maxLevel": 12,
      "hasVertexNormals": false,
      "hasWaterMask": false,
      "description": "公开演示数据"
    }
  ]
}
```

每个有效条目至少需要 `name` 和 `url`。`bounds` 使用 `[west, south, east, north]`，可让页面的“定位”按钮飞到数据覆盖范围。

浏览器直接选择本地 quantized-mesh 文件夹时，页面会从该目录的 `layer.json` 自动提取定位范围。部分 CTB 数据将标准 `bounds` 写成全球范围，以描述从根瓦片开始的可用金字塔，并另外使用 `valid_bounds` 保存局部 DEM 的真实覆盖范围；页面会优先使用合法的 `valid_bounds`。公开 `catalog.json` 不会自动读取远端 `layer.json` 来补全清单元数据，因此公开目录仍应显式填写真实数据覆盖范围的 `bounds`。

小型数据集可放在 `example/public/terrain/<dataset>/`，其中包含 `layer.json` 和 `.terrain` 瓦片。大型数据集不建议进入 Vercel Deployment，应放到支持 HTTPS、CORS 和长期缓存的对象存储或 CDN，并在目录中使用绝对 HTTPS URL。

## 开发者本地目录

运行 `npm run dev` 时，本地工具会自动启用。页面在公开目录之外，还会尝试通过 `http://127.0.0.1:8765/api/terrains` 合并 `tools/terrain-output` 中的数据。相同 URL 的条目只保留一份，本地服务未启动时不会阻断公开地形目录。

如需调整本地服务地址，在 `example/.env.local` 中配置：

```text
VITE_LOCAL_SERVICE_URL=http://127.0.0.1:8765
```

`VITE_ENABLE_LOCAL_TOOLS=true` 可以在生产模式构建中显式开启本地工具，但不应在公开 Vercel 站点启用。公开浏览器无法可靠访问开发者的 Python/Docker 服务，这种配置只适合受控内网或生产模式本机验收。

## Cesium ion Token

没有 Cesium ion Token 时，页面默认使用 OpenStreetMap，Cesium 影像、OSM 建筑物和 Cesium World Terrain 会提示缺少配置。需要这些功能时，在 `example/.env.local` 或 Vercel 项目环境变量中设置：

```text
VITE_CESIUM_ION_TOKEN=your_browser_token
```

`VITE_*` 环境变量会进入浏览器包，因此这里只能使用允许公开给浏览器的 Cesium ion Token。请在 Cesium ion 后台限制允许的本地域名、Vercel 预览域名和生产域名，不要将私密服务端密钥放入 `VITE_*`。

## Vercel 构建

仓库保留两类独立构建：

```powershell
npm run build
npm run build:vercel
```

`npm run build` 继续生成 npm 库的 `dist` 产物。`npm run build:vercel` 使用 `vite.example.config.js` 构建公开工作台到 `site-dist`。`vercel.json` 已把后者设为部署构建命令和输出目录。

部署前至少执行：

```powershell
npm test
npm run test:python
npm run build
npm run build:vercel
```

构建通过只说明生产资源可以生成；仍需在 Vercel 预览部署中检查底图网络、公开地形 URL、CORS、缓存和实际下载体积。

## 发布流程

1. 在开发环境运行 `npm run local:server`，用本地 Python/Docker 工具处理和检查地形。
2. 使用地形校验工具确认 `layer.json`、瓦片模板、覆盖范围、层级和 `.terrain` 文件有效。
3. 将小型结果复制到 `example/public/terrain/<dataset>/`，或将大型结果上传到对象存储/CDN。
4. 在 `example/public/terrain/catalog.json` 添加目录条目。
5. 执行 `npm run build:vercel`，确认 `site-dist/terrain/catalog.json` 和所需静态数据存在。
6. 创建 Vercel 预览部署，使用真实域名验证加载、定位、失败提示和浏览器网络请求。

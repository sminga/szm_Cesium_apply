# 示例网站服务与数据入口

`example/services/` 封装浏览器与数据来源之间的通信，避免页面入口直接处理 URL、上传协议、目录合并和本地文件会话。

## 文件职责

| 文件 | 运行环境 | 作用 |
| --- | --- | --- |
| `localServiceClient.js` | 仅开发模式或显式开启 | 检查本地 Python 服务、列出转换后风场、上传 NC/DEM、读取本地地形目录。 |
| `terrainCatalogClient.js` | Vercel 与开发环境 | 读取公开 `terrain/catalog.json`，解析相对 URL，并可在开发模式合并本地服务目录。 |
| `localTerrainFolderLoader.js` | 支持 Service Worker 的浏览器 | 校验访客选择的 quantized-mesh 文件夹，注册临时同源会话，并把 `File` 按需交给 Service Worker。 |

## 公开地形目录

```js
const result = await listAvailableTerrains({
  localEnabled: import.meta.env.DEV,
  localLoader: listLocalTerrains,
});
```

公开目录始终优先。开发者本地目录加载失败时保留公开结果并返回 `localWarning`；相同 URL 只保留第一条记录。

## 浏览器本地地形

```js
const session = await createLocalTerrainSession(fileInput.files);
await terrainController.loadLocal({
  name: session.name,
  url: session.url,
  bounds: session.bounds,
});

// 切换地形或页面销毁时释放文件引用和 Service Worker 会话。
await session.dispose();
```

文件不会上传到 Vercel 或本地 Python 服务。页面保存用户选择得到的 `File`，`example/public/local-terrain-sw.js` 只拦截 `/__local-terrain__/` 前缀并按需取回文件。

## 错误和安全边界

- `localServiceClient.js` 默认地址是 `127.0.0.1:8765`，生产代码只有显式开启时才能调用。
- 文件夹加载拒绝缺少 `layer.json`、非 quantized-mesh、没有瓦片、上级路径模板或一次选择多个有效地形。
- 公开目录条目必须有 `name` 和 `url`；无效条目被忽略，目录结构错误会抛出可读异常。
- 页面负责捕获异常并显示给用户，不能只输出控制台。

## 测试与学习

`tests/example/` 分别测试公开目录、浏览器文件夹和 ion 资产管理。建议先读 `terrainCatalogClient.js`，再读 `localTerrainFolderLoader.js`，最后对照 `public/local-terrain-sw.js` 理解页面与 Service Worker 的文件传递。

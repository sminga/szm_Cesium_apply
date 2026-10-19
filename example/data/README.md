# Vite 跟踪的示例风场数据

`wind_3d.json` 是工作台首次打开时使用的三维演示数据。`main.js` 通过 `new URL(..., import.meta.url)` 引用它，使 Vite 在生产构建中生成带哈希的资源 URL。

## 数据用途和结构

- 用于确认页面、Cesium、核心风场库和 Shader 管线能够完成基础启动。
- 数据结构与 `WindData3D` 一致，包含 U/V/W、网格尺寸、经纬度范围和高度层。
- 该文件体积较大，会影响公开网站首次下载；它不是用户上传目录。

## 修改要求

- 替换数据时检查许可、范围、单位、数组长度和缺测值。
- 必须执行 `npm run build:vercel`，确认数据进入 `site-dist/assets` 且生产预览能够加载。
- 不要在此目录写入用户选择的文件、转换中间文件或私密数据。
- 大型长期数据应评估对象存储/CDN，而不是无限增加 Vercel Deployment 体积。

学习数据格式可先阅读 `src/data/README.md` 和 `types/index.d.ts` 中的 `WindData3D`。

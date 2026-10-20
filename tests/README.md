# 自动化测试

`tests/` 按被测功能域组织 JavaScript/Vitest 和 Python/unittest 测试。测试目录结构应尽量对应源码或网站功能，方便从实现定位回归保护。

## 目录

| 目录 | 覆盖范围 |
| --- | --- |
| `core/` | 配置合并、风速计算等基础函数。 |
| `data/` | NetCDF 规范化和速度加权粒子播种。 |
| `layers/` | 高度模式、二维切片和 W 清零。 |
| `shaders/` | Shader 源码中的屏幕空间长度、除零和零向量保护。 |
| `terrain/` | 地形切换竞态、失败回退、进度和监听释放。 |
| `example/` | 公开目录、浏览器本地地形、ion 资产生命周期和页面控件数值换算。 |
| `tools/` | NetCDF 转换、本地 HTTP 服务和地形数据集检查。 |

## 运行方法

```powershell
npm test
npm run test:python
```

Vitest 单文件示例：

```powershell
npx vitest run tests/example/localTerrainFolderLoader.test.js
```

Python 单文件示例：

```powershell
py -m unittest tests.tools.test_terrain_dataset
```

## 新增测试规则

- 测试放在与被测职责最接近的目录，文件名使用 `<功能>.test.js` 或 `test_<功能>.py`。
- 修复错误时先增加能复现问题的测试，再验证更正后的行为。
- 浏览器 API、Cesium 和网络请求优先使用最小替身，避免测试依赖真实 Token、外网或开发者绝对路径。
- Vercel 构建、Service Worker 和视觉交互不能完全由单元测试覆盖，仍需生产构建与浏览器验证。
- 测试生成的缓存、临时文件和大数据不能提交到源码目录。

学习时先阅读目标模块 README，再阅读对应测试；测试中的输入和断言通常是理解边界行为的最短路径。

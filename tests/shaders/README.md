# Shader 源码回归测试

`tests/shaders/` 检查无法方便地在 Node.js 单元测试中直接运行的 WebGL2 Shader 关键约束。测试通过读取导出的 GLSL 字符串，确认容易引发严重视觉回归的数学分支仍然存在；它不能代替真实 GPU、Cesium 相机和浏览器截图验证。

## 当前覆盖

- `segmentDraw.test.js`：确认近景使用 `lineLength` 目标像素长度，三维相机拉远后会平滑回落到真实投影长度，并保留数值边界保护。
- 确认零长度投影线段不会执行无效归一化。
- 确认速度范围为零时不会发生除零。

## 运行方法

```powershell
npx vitest run tests/shaders/segmentDraw.test.js
```

## 实现边界

- 测试不创建 WebGL context，也不访问外网、Cesium ion Token 或本地服务，适合在 Vercel 构建前快速运行。
- GLSL 编译仍由 `npm run build:vercel` 间接检查。
- 相机近景、区域视角和全球视角的实际线长必须通过浏览器视觉验证；尤其要检查相机拉远时线段随地理投影缩短，而不是维持固定像素长度。

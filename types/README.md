# TypeScript 类型声明

`types/index.d.ts` 描述 npm 包公开 API，供 TypeScript 项目获得类型检查和编辑器提示。它不是独立实现，必须与 `src/index.js` 的实际导出保持一致。

## 类型分组

- 风场数据：`WindBounds`、`WindComponent`、`WindSpeed`、`WindData3D`。
- 渲染配置：`WindLayerOptions`、`WindLayer2DOptions`、`NumberRange`。
- NetCDF：`NetCDFLoadOptions`、`NetCDFLoadResult` 和三个加载函数。
- 图层：`WindLayer3D`、`WindLayer2D`、`ManagedWindLayer`、`WindLayerManager`。
- 地形：`TerrainBounds`、`TerrainEntry`、`TerrainProviderEntry`、`TerrainControllerState`、`TerrainController`；`loadProvider()` 允许应用调用方创建的 Cesium `TerrainProvider`。

## 使用示例

```ts
import type { WindData3D, WindLayerOptions } from "cesium-wind-layer-3d";
import { WindLayer3D } from "cesium-wind-layer-3d";

const options: Partial<WindLayerOptions> = { speedFactor: 0.3 };
const layer = new WindLayer3D(viewer, windData as WindData3D, options);
```

## 同步要求

- `src/index.js` 新增、删除或重命名公开导出时必须同步修改本文件。
- 方法参数、返回值、可选字段和枚举值必须与运行时代码一致。
- 示例网站内部专用类不应自动加入 npm 包类型，除非它已经成为稳定公共 API。
- `npm run build` 会把 `types/index.d.ts` 复制到发布包；修改后应执行构建并检查生成目录。

建议先读 `src/README.md` 理解公共边界，再使用本文件查看完整类型签名。

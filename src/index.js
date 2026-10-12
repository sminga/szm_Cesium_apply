/**
 * 项目公共入口。
 * 保留原有 WindLayer3D API，同时导出二维风场、多图层管理和 NetCDF 数据工具。
 */
export { DefaultOptions, WindLayer3D } from "./wind-3d/WindLayer3D.js";
export { WindLayer2D, createWindData2D } from "./wind-2d/WindLayer2D.js";
export { WindLayerManager } from "./layers/WindLayerManager.js";
export { resolveVerticalSelection } from "./core/verticalSelection.js";
export { createLocalTerrainProvider } from "./terrain/createLocalTerrainProvider.js";
export { TerrainController } from "./terrain/TerrainController.js";
export {
  detectNetCDFFormat,
  normalizeNetCDFReader,
  parseNetCDF3,
  loadNetCDF3File,
} from "./data/netcdfLoader.js";

export { WindLayer3D as default } from "./wind-3d/WindLayer3D.js";

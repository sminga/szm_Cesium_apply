/**
 * 二维风场图层。
 * 从输入风场中提取一个水平层、令垂直速度为零，并在指定绝对高度上运行粒子。
 */
import { computeSpeedFromComponents } from "../core/utils.js";
import { WindLayer3D } from "../wind-3d/WindLayer3D.js";

function clampIndex(index, length) {
  return Math.min(length - 1, Math.max(0, Number.isInteger(index) ? index : 0));
}

export function createWindData2D(windData, sourceLevelIndex = 0) {
  const { nx, ny, nz = 1 } = windData;
  const layerSize = nx * ny;
  const levelIndex = clampIndex(sourceLevelIndex, nz);
  const offset = levelIndex * layerSize;
  const duplicate = (source) => {
    const slice = source.array.slice(offset, offset + layerSize);
    const result = new Float32Array(layerSize * 2);
    result.set(slice, 0);
    result.set(slice, layerSize);
    return result;
  };
  const u = duplicate(windData.u);
  const v = duplicate(windData.v);
  const w = new Float32Array(layerSize * 2);
  return {
    u: { array: u },
    v: { array: v },
    w: { array: w },
    speed: computeSpeedFromComponents(u, v, w),
    nx,
    ny,
    nz: 2,
    bounds: { ...windData.bounds },
    levels: [0, 1],
    sourceLevel: windData.levels?.[levelIndex] ?? 0,
  };
}

export class WindLayer2D extends WindLayer3D {
  constructor(viewer, windData, options = {}) {
    const fixedHeight = Number.isFinite(options.fixedHeight) ? options.fixedHeight : 1000;
    super(viewer, createWindData2D(windData, options.sourceLevelIndex), {
      ...options,
      verticalMode: "fixed",
      fixedHeight,
    });
    this.kind = "2d";
  }

  setHeight(height) {
    this.updateOptions({ verticalMode: "fixed", fixedHeight: Number(height) });
  }
}

export default WindLayer2D;

import type { Viewer } from "cesium";

export interface WindBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface WindComponent {
  array: Float32Array;
}

export interface WindSpeed {
  array: Float32Array;
  min: number;
  max: number;
}

export interface WindData3D {
  u: WindComponent;
  v: WindComponent;
  w: WindComponent;
  speed?: WindSpeed;
  nx: number;
  ny: number;
  nz: number;
  bounds: WindBounds;
  levels: number[];
}

export interface NumberRange {
  min: number;
  max: number;
}

export interface WindLayerOptions {
  particlesTextureSize: number;
  dropRate: number;
  dropRateBump: number;
  speedFactor: number;
  lineWidth: NumberRange;
  lineLength: NumberRange;
  heightScale: number;
  colors: string[];
  flipY: boolean;
  useViewerBounds: boolean;
  domain?: NumberRange;
  displayRange?: NumberRange;
  dynamic: boolean;
}

export const DefaultOptions: WindLayerOptions;

export class WindLayer3D {
  constructor(
    viewer: Viewer,
    windData: WindData3D,
    options?: Partial<WindLayerOptions>
  );

  show: boolean;
  readonly viewer: Viewer;
  readonly scene: import("cesium").Scene;

  updateWindData(data: WindData3D): void;
  updateOptions(options: Partial<WindLayerOptions>): void;
  zoomTo(duration?: number): void;
  isDestroyed(): boolean;
  destroy(): void;
}

export default WindLayer3D;
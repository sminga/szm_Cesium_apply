import type { TerrainProvider, Viewer } from "cesium";

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
  lowSpeedOpacity: number;
  densityBySpeed: boolean;
  densityExponent: number;
  densityFloor: number;
  verticalMode: "all" | "range" | "level" | "fixed";
  heightRange?: NumberRange;
  selectedLevel?: number;
  fixedHeight?: number;
  dynamic: boolean;
}

export interface WindLayer2DOptions extends WindLayerOptions {
  fixedHeight: number;
  sourceLevelIndex?: number;
}

export interface NetCDFLoadOptions {
  timeIndex?: number;
  maxBytes?: number;
  variables?: Partial<Record<"lon" | "lat" | "level" | "u" | "v" | "w", string>>;
}

export interface NetCDFLoadResult {
  windData: WindData3D;
  metadata: {
    format: string;
    variables: Record<string, string | undefined>;
    timeIndex: number;
    warnings: string[];
  };
}

export function detectNetCDFFormat(data: ArrayBuffer | ArrayBufferView): "netcdf3" | "netcdf4" | "unknown";
export function parseNetCDF3(data: ArrayBuffer | ArrayBufferView, options?: NetCDFLoadOptions): NetCDFLoadResult;
export function loadNetCDF3File(file: File, options?: NetCDFLoadOptions): Promise<NetCDFLoadResult>;

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

export class WindLayer2D extends WindLayer3D {
  constructor(viewer: Viewer, windData: WindData3D, options?: Partial<WindLayer2DOptions>);
  readonly kind: "2d";
  setHeight(height: number): void;
}

export interface ManagedWindLayer {
  id: string;
  kind: "2d" | "3d";
  name: string;
  source?: string;
  layer: WindLayer2D | WindLayer3D;
}

export class WindLayerManager {
  constructor(viewer: Viewer);
  add2D(windData: WindData3D, options?: Partial<WindLayer2DOptions>, metadata?: Partial<ManagedWindLayer>): ManagedWindLayer;
  add3D(windData: WindData3D, options?: Partial<WindLayerOptions>, metadata?: Partial<ManagedWindLayer>): ManagedWindLayer;
  get(id: string): ManagedWindLayer | undefined;
  list(): ManagedWindLayer[];
  setVisible(id: string, visible: boolean): void;
  updateOptions(id: string, options: Partial<WindLayerOptions>): void;
  remove(id: string): boolean;
  clear(kind?: "2d" | "3d"): void;
  destroy(): void;
}

export function createWindData2D(windData: WindData3D, sourceLevelIndex?: number): WindData3D;
export function createLocalTerrainProvider(url: string, options?: {
  requestVertexNormals?: boolean;
  requestWaterMask?: boolean;
}): Promise<TerrainProvider>;

export interface TerrainBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface TerrainEntry {
  name?: string;
  url: string;
  bounds?: TerrainBounds | [number, number, number, number];
}

export interface TerrainControllerState {
  status: "loading" | "ready" | "error";
  type: "ellipsoid" | "world" | "local";
  name: string;
  url?: string;
  bounds?: TerrainBounds;
  requestedType?: "world" | "local";
  requestedName?: string;
  pendingTiles: number;
  tileErrorCount: number;
  warning?: string;
  error?: Error;
}

export class TerrainController {
  constructor(viewer: Viewer, options?: {
    ellipsoidTerrainProvider?: TerrainProvider;
    createWorldTerrain?: (options: {
      requestVertexNormals?: boolean;
      requestWaterMask?: boolean;
    }) => Promise<TerrainProvider>;
    createLocalTerrain?: (url: string, options?: {
      requestVertexNormals?: boolean;
      requestWaterMask?: boolean;
    }) => Promise<TerrainProvider>;
    onStateChange?: (state: TerrainControllerState) => void;
  });

  getState(): TerrainControllerState;
  subscribe(listener: (state: TerrainControllerState) => void): () => void;
  loadWorld(options?: {
    name?: string;
    bounds?: TerrainBounds | [number, number, number, number];
    requestVertexNormals?: boolean;
    requestWaterMask?: boolean;
  }): Promise<{ applied: boolean; reason?: "superseded" | "error"; error?: Error }>;
  loadLocal(terrain: string | TerrainEntry, options?: {
    requestVertexNormals?: boolean;
    requestWaterMask?: boolean;
  }): Promise<{ applied: boolean; reason?: "superseded" | "error"; error?: Error }>;
  useEllipsoid(): TerrainControllerState;
  flyToCurrentTerrain(options?: { duration?: number }): boolean;
  destroy(): void;
}

export default WindLayer3D;

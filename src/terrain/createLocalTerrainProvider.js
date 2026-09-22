/**
 * 标准 quantized-mesh 地形加载入口。
 * 输入应指向包含 layer.json 的本地 HTTP 目录。
 */
import { CesiumTerrainProvider } from "cesium";

export function createLocalTerrainProvider(url, options = {}) {
  if (!url) throw new Error("缺少本地地形 URL");
  return CesiumTerrainProvider.fromUrl(url, {
    requestVertexNormals: options.requestVertexNormals ?? true,
    requestWaterMask: options.requestWaterMask ?? false,
  });
}

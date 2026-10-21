import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  root: "example",
  plugins: [cesium()],
  // GeoTIFF Worker 会按压缩格式拆分解码模块。ES Worker 支持 Rollup code-splitting，
  // 默认 IIFE 输出不支持多 chunk，会导致 Vercel 生产构建在 worker 阶段失败。
  worker: { format: "es" },
  build: {
    outDir: "../site-dist",
    emptyOutDir: true,
  },
});

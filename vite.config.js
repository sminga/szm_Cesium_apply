import { defineConfig } from "vite";
import { fileURLToPath } from "url";

export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.js", import.meta.url)),
      name: "CesiumWindLayer3D",
      formats: ["es", "cjs"],
      fileName: (format) =>
        format === "es" ? "cesium-wind-layer-3d.js" : "cesium-wind-layer-3d.cjs",
    },
    rollupOptions: {
      external: ["cesium"],
      output: {
        globals: { cesium: "Cesium" },
      },
    },
  },
});
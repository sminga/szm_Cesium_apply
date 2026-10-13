import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  root: "example",
  plugins: [cesium()],
  build: {
    outDir: "../site-dist",
    emptyOutDir: true,
  },
});

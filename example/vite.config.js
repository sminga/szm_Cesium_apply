import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  // 示例文件都在 example/ 目录下，而 `vite --config example/vite.config.js`
  // 默认以 CWD（包根目录）为 root，会把 index.html 找错位置，这里显式指向本目录。
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [cesium()],
  server: { port: 3000, open: true },
});
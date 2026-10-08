import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  // 示例文件都在 example/ 目录下，而 `vite --config example/vite.config.js`
  // 默认以 CWD（包根目录）为 root，会把 index.html 找错位置，这里显式指向本目录。
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [cesium()],
  build: {
    // vite-plugin-cesium 只有在显式设置 build.outDir 时才会把 cesium 静态资源
    // 拷贝到 root 下的输出目录，否则会拷到 CWD/dist，导致部署后 /cesium/ 404。
    outDir: "dist",
  },
  server: { port: 3000, open: true },
});
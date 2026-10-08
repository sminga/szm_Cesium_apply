/**
 * 服务凭据：统一从 Vite 环境变量读取。
 * - 本地开发：在 example/.env 中写入 VITE_CESIUM_ION_TOKEN 等（该文件已被 Git 忽略）。
 * - 线上部署（Vercel）：在项目 Settings -> Environment Variables 中配置同名变量。
 * 注意：VITE_ 前缀变量会打包进前端代码，token 本身是公开的，请在 Cesium ion
 * 控制台为 token 配置域名白名单以防盗用。
 */
export const SERVICE_TOKENS = Object.freeze({
  cesiumIon: import.meta.env.VITE_CESIUM_ION_TOKEN ?? "",
  tianditu: import.meta.env.VITE_TIANDITU_TOKEN ?? "",
  mapbox: import.meta.env.VITE_MAPBOX_TOKEN ?? "",
});

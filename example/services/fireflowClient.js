/**
 * Fireflow 分发服务的浏览器适配层。
 *
 * 交接包中的 FireflowClient 只负责同源 HTTP 请求；本模块补充网站需要的
 * 配置开关、会话恢复、资源分类和可取消轮询。默认关闭服务请求，避免公开
 * Vercel 构建意外访问实验室私网地址。真正的机器令牌仍只能留在服务端。
 */
export { FireflowClient } from "../../docs/Cesium分发完整对接资料-20261102/fireflow-service-client.mjs";

import { FireflowClient } from "../../docs/Cesium分发完整对接资料-20261102/fireflow-service-client.mjs";

export const FIREFLOW_SESSION_STORAGE_KEY = "fireflow-cesium-session-v1";

export function getFireflowConfig(env = import.meta.env) {
  const enabled = env.VITE_FIREFLOW_ENABLED === "true";
  const baseUrl = env.VITE_FIREFLOW_BASE_URL?.trim() || "";
  return Object.freeze({ enabled, baseUrl, timeoutMs: 10000 });
}

export function createFireflowClient(config = getFireflowConfig()) {
  if (!config.enabled) return null;
  return new FireflowClient({
    baseUrl: config.baseUrl || globalThis.location?.origin,
    pageOrigin: globalThis.location?.origin,
    // 交接薄客户端会把 fetch 保存为实例方法后通过 this.fetch() 调用。
    // Chromium 的原生 window.fetch 脱离 Window 绑定时会抛出 Illegal invocation，
    // 因此在适配边界显式绑定；测试注入的普通函数则保持原样。
    fetchImpl: globalThis.fetch?.bind(globalThis),
    timeoutMs: config.timeoutMs,
  });
}

export function readStoredFireflowSession(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(FIREFLOW_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.session_id || !value?.receiver_type || !value?.role_id) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeStoredFireflowSession(session, storage = globalThis.localStorage) {
  if (!session?.session_id || !session?.receiver_type || !session?.role_id) return;
  storage?.setItem(FIREFLOW_SESSION_STORAGE_KEY, JSON.stringify({
    session_id: session.session_id,
    terminal_id: session.terminal_id,
    receiver_type: session.receiver_type,
    role_id: session.role_id,
    selected_at: session.selected_at,
  }));
}

export function clearStoredFireflowSession(storage = globalThis.localStorage) {
  storage?.removeItem(FIREFLOW_SESSION_STORAGE_KEY);
}

export async function restoreFireflowSession(client, stored) {
  if (!client || !stored?.session_id) return null;
  const result = await client.api(`/api/v1/identity-selections/${encodeURIComponent(stored.session_id)}`);
  if (!result?.session_id) throw new Error("INVALID_SESSION_RESPONSE");
  client.sessionId = result.session_id;
  return result;
}

export function classifyFireflowAsset(asset = {}) {
  const role = asset.data_role || "attachment";
  if (role === "brief_text") return "text";
  if (role === "map_overlay" && asset.map_ready === true && Array.isArray(asset.bbox) && asset.bbox.length === 4) {
    return "map_overlay";
  }
  if (role === "wind_2d" || role === "wind_3d") return "wind";
  if (role === "chart" || asset.media_type?.startsWith("image/")) return "image";
  return "download";
}

function mediaTypeForFormat(format = "") {
  const value = format.toLowerCase();
  if (value === "png") return "image/png";
  if (value === "jpg" || value === "jpeg") return "image/jpeg";
  if (value === "json") return "application/json";
  if (value === "csv") return "text/csv";
  if (value === "txt") return "text/plain";
  if (value === "nc" || value.startsWith("netcdf")) return "application/x-netcdf";
  return "application/octet-stream";
}

/** 兼容现网旧产品只返回 asset_id/dataset_id 的情况。 */
export async function enrichFireflowProduct(client, product) {
  const assets = await Promise.all((product?.assets || []).map(async (asset) => {
    if (asset.file_name && asset.media_type && Number.isFinite(asset.size_bytes)) return asset;
    try {
      const metadata = await client.api(`/api/v1/datasets/${encodeURIComponent(asset.dataset_id)}`);
      const format = asset.file_format || metadata.format || "";
      return {
        ...asset,
        file_name: asset.file_name || metadata.file_name,
        size_bytes: Number.isFinite(asset.size_bytes) ? asset.size_bytes : metadata.size_bytes,
        sha256: asset.sha256 || metadata.sha256,
        file_format: format,
        media_type: asset.media_type || mediaTypeForFormat(format),
        content_url: asset.content_url || metadata.content_url,
      };
    } catch (error) {
      return { ...asset, metadata_error: describeFireflowError(error) };
    }
  }));
  return { ...product, assets };
}

export function describeFireflowError(error) {
  const message = error?.message || String(error);
  if (/SAME_ORIGIN_REQUIRED|HTTPS_REQUIRED|INVALID_SERVICE_URL/.test(message)) {
    return "分发服务必须与当前页面使用同源 HTTPS 地址。";
  }
  if (/AbortError|aborted/i.test(message)) return "请求已取消。";
  if (/HTTP_401|HTTP_403/.test(message)) return "当前身份没有访问该分发功能的权限。";
  if (/HTTP_404|HTTP_409|SESSION/.test(message)) return "身份会话已失效，请重新选择接收力量和岗位。";
  if (/HTTP_5\d\d/.test(message)) return "分发服务暂时不可用，请稍后重试。";
  return message;
}

/**
 * 轮询一个已创建的申请。AbortSignal 只停止浏览器轮询，不会取消服务端计算，
 * 这与交接契约中的无前端取消接口保持一致。
 */
export async function pollFireflowRequest(client, requestId, {
  intervalMs = 3000,
  signal,
  onUpdate,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!client || !requestId) throw new Error("REQUEST_ID_REQUIRED");
  while (true) {
    if (signal?.aborted) throw signal.reason || new DOMException("请求已取消", "AbortError");
    const status = await client.requestStatus(requestId);
    onUpdate?.(status);
    if (status.status === "completed" || status.status === "failed") return status;
    await sleep(intervalMs);
  }
}

export async function fetchFireflowAsset(client, asset, { signal } = {}) {
  if (!client || !asset?.dataset_id) throw new Error("DATASET_ID_REQUIRED");
  const response = await fetch(client.datasetUrl(asset.dataset_id), {
    method: "GET",
    credentials: "same-origin",
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error(`FIREFLOW_HTTP_${response.status}`);
  return response;
}

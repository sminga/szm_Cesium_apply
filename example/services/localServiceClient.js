/**
 * 本地 Python 服务的浏览器客户端。
 * 统一负责风场目录、NetCDF 转换、DEM 转换和地形目录请求。
 */
const DEFAULT_SERVICE_URL = "http://127.0.0.1:8765";

async function requestJson(path, options = {}) {
  const serviceUrl = options.serviceUrl ?? DEFAULT_SERVICE_URL;
  let response;
  try {
    response = await fetch(new URL(path, serviceUrl), options.fetchOptions);
  } catch {
    throw new Error("本地服务未启动，请先运行 npm run local:server");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.message || `本地服务返回 HTTP ${response.status}`);
  }
  return result;
}

async function uploadFile(path, file, options = {}) {
  if (!file) throw new Error("没有选择需要处理的文件");
  const endpoint = new URL(path, options.serviceUrl ?? DEFAULT_SERVICE_URL);
  endpoint.searchParams.set("filename", file.name);
  return requestJson(endpoint, {
    ...options,
    fetchOptions: {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    },
  });
}

export function checkLocalService(serviceUrl = DEFAULT_SERVICE_URL) {
  return requestJson("/health", { serviceUrl }).catch(() => null);
}

export function listConvertedWindFiles(options = {}) {
  return requestJson("/api/wind-files", options);
}

export async function fetchWindFile(entry) {
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`读取 ${entry.name} 失败：HTTP ${response.status}`);
  return new File([await response.blob()], entry.name, { type: "application/x-netcdf" });
}

export function convertNetCDFFile(file, options = {}) {
  return uploadFile("/api/convert/netcdf", file, options);
}

export function convertDEMFile(file, options = {}) {
  return uploadFile("/api/convert/dem", file, options);
}

export function listLocalTerrains(options = {}) {
  return requestJson("/api/terrains", options);
}

// 保留旧示例使用过的函数名。
export const checkNetCDFService = async (serviceUrl = DEFAULT_SERVICE_URL) => Boolean(await checkLocalService(serviceUrl));

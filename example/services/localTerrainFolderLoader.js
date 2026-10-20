/**
 * 将浏览器选择的 quantized-mesh 地形文件夹验证为 Cesium 可读取的虚拟目录。
 * 文件不会上传；实际的虚拟 URL 请求由 example/public/local-terrain-sw.js 响应。
 */

export const LOCAL_TERRAIN_PREFIX = "/__local-terrain__/";

let sessionSequence = 0;
const pageSessions = new Map();
let brokerBound = false;

function asFileArray(fileList) {
  return Array.from(fileList ?? []).filter((file) => file && typeof file.name === "string");
}

export function normalizeRelativePath(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}

function dirname(path) {
  const normalized = normalizeRelativePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function relativeTo(path, root) {
  const normalized = normalizeRelativePath(path);
  if (!root) return normalized;
  const prefix = `${root}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

function filePath(file) {
  return normalizeRelativePath(file.webkitRelativePath || file.relativePath || file.name);
}

function tileFilesInRoot(records, root) {
  return records.filter((record) => {
    const relative = relativeTo(record.path, root);
    return relative && /\.terrain$/i.test(relative);
  });
}

function validateLayer(layer, path) {
  if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
    throw new Error(`${path} 顶层必须是 JSON 对象`);
  }
  if (typeof layer.format !== "string" || !layer.format.startsWith("quantized-mesh-1.")) {
    throw new Error(`${path} format 不是 quantized-mesh`);
  }
  if (!Array.isArray(layer.tiles) || !layer.tiles.length || layer.tiles.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${path} 缺少有效的 tiles 模板`);
  }
  for (const template of layer.tiles) {
    const cleanPath = template.split("?", 1)[0].replace(/\\/g, "/");
    if (cleanPath.split("/").includes("..")) {
      throw new Error(`${path} tiles 模板包含非法上级路径`);
    }
  }
  return layer;
}

async function readLayer(record) {
  let text;
  try {
    text = await record.file.text();
  } catch (error) {
    throw new Error(`${record.path} 无法读取：${error.message || error}`);
  }
  try {
    return validateLayer(JSON.parse(text), record.path);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${record.path} 不是有效的 JSON`);
    throw error;
  }
}

function normalizeBounds(value) {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const values = value.map(Number);
  if (!values.every(Number.isFinite)) return undefined;
  const [west, south, east, north] = values;
  if (west < -180 || east > 180 || south < -90 || north > 90) return undefined;
  if (west >= east || south >= north) return undefined;
  return { west, south, east, north };
}

function boundsFromLayer(layer) {
  // 部分 CTB 输出为了让 Cesium 从全球根瓦片逐级查找局部数据，会把标准 bounds
  // 写成整个地球，而把 DEM 的真实有效覆盖范围写入 valid_bounds。前者适合瓦片
  // 可用性描述，却不适合“定位当前地形”；否则相机会飞到全球视角。优先使用合法的
  // valid_bounds，并在旧数据没有该字段时回退到 bounds，保持已有数据集兼容。
  return normalizeBounds(layer.valid_bounds) ?? normalizeBounds(layer.bounds);
}

function topFolderName(records) {
  const first = records[0]?.path || "";
  return first.split("/")[0] || "本地地形";
}

/**
 * 检查浏览器 FileList，返回待注册的地形目录信息。
 * 允许 layer.json 位于选择目录的子目录中，但拒绝多个有效地形以免静默加载错误数据。
 */
export async function inspectLocalTerrainFiles(fileList) {
  const files = asFileArray(fileList).map((file) => ({ file, path: filePath(file) }));
  if (!files.length) throw new Error("没有选择地形文件夹");

  const candidates = files.filter((record) => record.path.toLowerCase().endsWith("layer.json"));
  if (!candidates.length) throw new Error("未找到 layer.json，请选择已经处理完成的 quantized-mesh 地形文件夹");

  const valid = [];
  const errors = [];
  for (const candidate of candidates) {
    try {
      const layer = await readLayer(candidate);
      const root = dirname(candidate.path);
      const tiles = tileFilesInRoot(files, root);
      if (!tiles.length) throw new Error(`${candidate.path} 所在目录没有 .terrain 瓦片`);
      valid.push({ candidate, layer, root, tiles });
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }

  if (valid.length > 1) {
    throw new Error(`发现多个有效地形目录：${valid.map((item) => item.candidate.path).join("、")}；请一次只选择一个地形根目录`);
  }
  if (!valid.length) throw new Error(errors[0] || "没有找到可用的 quantized-mesh 地形目录");

  const selected = valid[0];
  const relativeFiles = selected.files ?? files
    .map((record) => ({ ...record, relativePath: relativeTo(record.path, selected.root) }))
    .filter((record) => record.relativePath);
  const layerRelativePath = relativeTo(selected.candidate.path, selected.root);
  const totalBytes = relativeFiles.reduce((sum, record) => sum + (Number(record.file.size) || 0), 0);
  const levelValues = selected.tiles
    .map((record) => relativeTo(record.path, selected.root)?.split("/")[0])
    .filter((value) => /^\d+$/.test(value))
    .map(Number);

  return {
    folderName: topFolderName(files),
    layer: selected.layer,
    layerPath: layerRelativePath || "layer.json",
    rootPath: selected.root,
    files: relativeFiles,
    tileCount: selected.tiles.length,
    totalBytes,
    bounds: boundsFromLayer(selected.layer),
    minLevel: Number.isFinite(selected.layer.minzoom)
      ? Number(selected.layer.minzoom)
      : (levelValues.length ? Math.min(...levelValues) : undefined),
    maxLevel: Number.isFinite(selected.layer.maxzoom)
      ? Number(selected.layer.maxzoom)
      : (levelValues.length ? Math.max(...levelValues) : undefined),
    name: selected.layer.name || `${topFolderName(files)} 地形`,
  };
}

function workerTarget(registration) {
  return registration.active || registration.waiting || registration.installing || navigator.serviceWorker.controller;
}

function bindPageFileBroker() {
  if (brokerBound || !navigator.serviceWorker) return;
  brokerBound = true;
  navigator.serviceWorker.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type !== "local-terrain-file-request") return;
    const file = pageSessions.get(String(message.id))?.get(normalizeRelativePath(message.path));
    event.ports?.[0]?.postMessage(file
      ? { ok: true, file }
      : { ok: false, message: "本地地形文件会话已释放" });
  });
}

function sendWorkerMessage(registration, message) {
  const target = workerTarget(registration);
  if (!target) throw new Error("本地地形服务尚未就绪，请稍后重试");
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => reject(new Error("本地地形服务响应超时")), 10000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      if (event.data?.ok === false) reject(new Error(event.data.message || "本地地形服务失败"));
      else resolve(event.data);
    };
    target.postMessage(message, [channel.port2]);
  });
}

async function registerWorker(options = {}) {
  if (!navigator.serviceWorker) throw new Error("当前浏览器不支持本地文件夹地形加载");
  const scriptUrl = options.scriptUrl || new URL("/local-terrain-sw.js", window.location.origin).href;
  const registration = await navigator.serviceWorker.register(scriptUrl, { scope: "/" });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 1500);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
  if (!navigator.serviceWorker.controller) {
    throw new Error("本地地形服务首次启用后需要刷新页面，请刷新后重新选择文件夹");
  }
  return registration;
}

/**
 * 注册一个本地地形会话，并返回可直接交给 TerrainController 的同源 URL。
 */
export async function createLocalTerrainSession(fileList, options = {}) {
  const inspection = await inspectLocalTerrainFiles(fileList);
  const registration = await registerWorker(options);
  const id = `${Date.now().toString(36)}-${(++sessionSequence).toString(36)}`;
  bindPageFileBroker();
  pageSessions.set(id, new Map(
    inspection.files.map((record) => [record.relativePath, record.file]),
  ));
  try {
    await sendWorkerMessage(registration, {
      type: "register-terrain",
      id,
    });
  } catch (error) {
    pageSessions.delete(id);
    throw error;
  }
  const layerUrl = new URL(`${LOCAL_TERRAIN_PREFIX}${encodeURIComponent(id)}/`, window.location.origin).href;
  let disposed = false;
  return {
    ...inspection,
    id,
    url: layerUrl,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      pageSessions.delete(id);
      try {
        await sendWorkerMessage(registration, { type: "dispose-terrain", id });
      } catch {
        // 页面关闭或 Service Worker 更新时，释放失败不会影响地形切换。
      }
    },
  };
}


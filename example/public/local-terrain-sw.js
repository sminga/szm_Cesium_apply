const PREFIX = "/__local-terrain__/";
const sessions = new Map();

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}

function reply(port, payload) {
  port?.postMessage(payload);
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const message = event.data || {};
  const port = event.ports?.[0];
  if (message.type === "register-terrain") {
    // 会话只保存已经按地形根目录规范化的相对路径。页面可以选择性传入 File；
    // 当前实现主要由页面按需回传 File，避免注册时复制大型地形目录的全部对象。
    const files = new Map();
    for (const item of message.files || []) {
      if (item?.file && item.path) files.set(normalizePath(item.path), item.file);
    }
    sessions.set(String(message.id), files);
    reply(port, { ok: true, fileCount: files.size });
    return;
  }
  if (message.type === "dispose-terrain") {
    sessions.delete(String(message.id));
    reply(port, { ok: true });
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(PREFIX)) return;
  // CesiumTerrainProvider 仍按普通 HTTP URL 请求 layer.json 和瓦片。仅拦截
  // 本项目预留前缀，其他静态资源、公开地形和第三方请求继续走原网络链路。
  event.respondWith(serveTerrain(url, event.request, event.clientId));
});

async function requestFileFromPage(clientId, id, path) {
  // Service Worker 重启后内存 Map 会丢失，但页面仍持有用户授权得到的 File。
  // 这里通过 MessageChannel 向发起请求的页面按需取回文件，使刷新前的会话可继续
  // 服务 Cesium；页面已关闭或释放会话时返回 null，最终由 fetch 返回明确的 404。
  let client = clientId ? await self.clients.get(clientId) : null;
  if (!client) [client] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (!client) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.ok ? event.data.file : null);
    };
    client.postMessage({ type: "local-terrain-file-request", id, path }, [channel.port2]);
  });
}

async function serveTerrain(url, request, clientId) {
  const parts = url.pathname.slice(PREFIX.length).split("/");
  const id = decodeURIComponent(parts.shift() || "");
  const relativePath = normalizePath(parts.map((part) => decodeURIComponent(part)).join("/"));
  const session = sessions.get(id);
  const file = session?.get(relativePath)
    || await requestFileFromPage(clientId, id, relativePath);
  if (!file) return new Response("本地地形文件不存在", { status: 404 });
  session?.set(relativePath, file);

  const headers = new Headers();
  let body = file;
  if (relativePath.toLowerCase() === "layer.json") {
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", "no-store");
  } else if (/\.terrain$/i.test(relativePath)) {
    headers.set("Content-Type", "application/vnd.quantized-mesh");
    headers.set("Cache-Control", "no-store");
    const prefix = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (prefix[0] === 0x1f && prefix[1] === 0x8b) {
      // 本地 Python 服务会通过 Content-Encoding 告知浏览器 gzip。对于浏览器 File，
      // 优先在 Service Worker 内解压，保证 Cesium 得到 quantized-mesh 原始字节；
      // 旧浏览器没有 DecompressionStream 时再退回标准 Content-Encoding 处理。
      if (typeof DecompressionStream === "function") {
        body = file.stream().pipeThrough(new DecompressionStream("gzip"));
      } else {
        headers.set("Content-Encoding", "gzip");
      }
    }
  } else {
    headers.set("Content-Type", file.type || "application/octet-stream");
  }

  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(body, { status: 200, headers });
}


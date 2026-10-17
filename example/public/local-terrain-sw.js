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
  event.respondWith(serveTerrain(url, event.request, event.clientId));
});

async function requestFileFromPage(clientId, id, path) {
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


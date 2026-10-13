const DEFAULT_CATALOG_URL = "./terrain/catalog.json";

function normalizeTerrain(entry, baseUrl, source) {
  if (!entry || typeof entry !== "object") return null;
  const name = String(entry.name || "").trim();
  const url = String(entry.url || "").trim();
  if (!name || !url) return null;

  let resolvedUrl;
  try {
    resolvedUrl = new URL(url, baseUrl).href;
  } catch {
    return null;
  }

  return {
    ...entry,
    name,
    url: resolvedUrl,
    source,
  };
}

export async function listPublishedTerrains(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const catalogUrl = options.catalogUrl ?? DEFAULT_CATALOG_URL;
  const response = await fetchImpl(catalogUrl, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`公开地形目录读取失败：HTTP ${response.status}`);
  }

  const catalog = await response.json().catch(() => {
    throw new Error("公开地形目录不是有效的 JSON");
  });
  if (!Array.isArray(catalog.terrains)) {
    throw new Error("公开地形目录缺少 terrains 数组");
  }

  const baseUrl = response.url || new URL(catalogUrl, globalThis.location?.href).href;
  return {
    ok: true,
    source: "published",
    directory: catalog.name || "公开地形目录",
    terrains: catalog.terrains
      .map((entry) => normalizeTerrain(entry, baseUrl, "published"))
      .filter(Boolean),
  };
}

export async function listAvailableTerrains(options = {}) {
  const publishedLoader = options.publishedLoader ?? listPublishedTerrains;
  const published = await publishedLoader(options.publishedOptions);
  const sources = [published.directory];
  const terrains = [...published.terrains];
  let localWarning;

  if (options.localEnabled && options.localLoader) {
    try {
      const local = await options.localLoader(options.localOptions);
      sources.push(local.directory || "开发者本地目录");
      terrains.push(...local.terrains.map((entry) => ({ ...entry, source: "local" })));
    } catch (error) {
      localWarning = error.message || String(error);
    }
  }

  const uniqueTerrains = [];
  const seen = new Set();
  for (const terrain of terrains) {
    const key = terrain.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueTerrains.push(terrain);
  }

  return {
    ok: true,
    directory: sources.join("；"),
    terrains: uniqueTerrains,
    localWarning,
  };
}

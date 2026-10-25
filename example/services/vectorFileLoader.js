import shp from "shpjs";

const MAX_VECTOR_BYTES = 50 * 1024 * 1024;
const MAX_VECTOR_FEATURES = 100_000;
const SHAPEFILE_EXTENSIONS = new Set([".zip", ".shp", ".dbf", ".prj", ".cpg", ".shx"]);

function assertCoordinate(position, label) {
  if (!Array.isArray(position) || position.length < 2
    || !Number.isFinite(Number(position[0])) || !Number.isFinite(Number(position[1]))) {
    throw new TypeError(`${label} 中包含无效坐标`);
  }
}

function transformPosition(position, transform) {
  assertCoordinate(position, "TopoJSON");
  if (!transform) return position.slice();
  const scale = transform.scale;
  const translate = transform.translate;
  if (!Array.isArray(scale) || !Array.isArray(translate)
    || scale.length < 2 || translate.length < 2) {
    throw new TypeError("TopoJSON transform 缺少有效的 scale 或 translate");
  }
  return [
    position[0] * scale[0] + translate[0],
    position[1] * scale[1] + translate[1],
    ...position.slice(2),
  ];
}

function createArcDecoder(topology) {
  const decoded = new Map();
  return (signedIndex) => {
    const reversed = signedIndex < 0;
    const index = reversed ? ~signedIndex : signedIndex;
    if (!Number.isInteger(index) || index < 0 || index >= topology.arcs.length) {
      throw new RangeError(`TopoJSON 引用了不存在的 arc：${signedIndex}`);
    }
    if (!decoded.has(index)) {
      const rawArc = topology.arcs[index];
      if (!Array.isArray(rawArc)) throw new TypeError(`TopoJSON arc ${index} 格式无效`);
      let x = 0;
      let y = 0;
      const arc = rawArc.map((position) => {
        assertCoordinate(position, `TopoJSON arc ${index}`);
        if (topology.transform) {
          x += Number(position[0]);
          y += Number(position[1]);
          return transformPosition([x, y, ...position.slice(2)], topology.transform);
        }
        return position.slice();
      });
      decoded.set(index, arc);
    }
    const arc = decoded.get(index);
    return reversed ? arc.slice().reverse() : arc;
  };
}

function joinArcs(indices, decodeArc) {
  const joined = [];
  for (const index of indices) {
    const arc = decodeArc(index);
    joined.push(...(joined.length ? arc.slice(1) : arc));
  }
  return joined;
}

function geometryToGeoJson(geometry, topology, decodeArc) {
  if (!geometry) return null;
  switch (geometry.type) {
    case "Point":
      return { type: "Point", coordinates: transformPosition(geometry.coordinates, topology.transform) };
    case "MultiPoint":
      return { type: "MultiPoint", coordinates: geometry.coordinates.map((point) => transformPosition(point, topology.transform)) };
    case "LineString":
      return { type: "LineString", coordinates: joinArcs(geometry.arcs, decodeArc) };
    case "MultiLineString":
      return { type: "MultiLineString", coordinates: geometry.arcs.map((arcs) => joinArcs(arcs, decodeArc)) };
    case "Polygon":
      return { type: "Polygon", coordinates: geometry.arcs.map((ring) => joinArcs(ring, decodeArc)) };
    case "MultiPolygon":
      return { type: "MultiPolygon", coordinates: geometry.arcs.map((polygon) => polygon.map((ring) => joinArcs(ring, decodeArc))) };
    case "GeometryCollection":
      return {
        type: "GeometryCollection",
        geometries: geometry.geometries.map((child) => geometryToGeoJson(child, topology, decodeArc)),
      };
    default:
      throw new TypeError(`暂不支持 TopoJSON 几何类型：${geometry.type || "未知"}`);
  }
}

function collectTopologyGeometries(geometry, objectName, topology, decodeArc, features) {
  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries ?? []) {
      collectTopologyGeometries(child, objectName, topology, decodeArc, features);
    }
    return;
  }
  const geojsonGeometry = geometryToGeoJson(geometry, topology, decodeArc);
  features.push({
    type: "Feature",
    ...(geometry.id === undefined ? {} : { id: geometry.id }),
    properties: { ...(geometry.properties ?? {}), topologyObject: objectName },
    geometry: geojsonGeometry,
  });
}

/**
 * 把 TopoJSON 1.x 的 Topology 转为 Cesium 可加载的 GeoJSON FeatureCollection。
 * TopoJSON 的弧线采用 delta 编码和反向索引；转换时缓存解码弧线，避免重复累计。
 */
export function topoJsonToGeoJson(topology) {
  if (topology?.type !== "Topology" || !topology.objects || !Array.isArray(topology.arcs)) {
    throw new TypeError("JSON 不是有效的 TopoJSON Topology 对象");
  }
  const decodeArc = createArcDecoder(topology);
  const features = [];
  for (const [name, object] of Object.entries(topology.objects)) {
    if (!object || typeof object.type !== "string") throw new TypeError(`TopoJSON 对象 ${name} 格式无效`);
    collectTopologyGeometries(object, name, topology, decodeArc, features);
    if (features.length > MAX_VECTOR_FEATURES) {
      throw new RangeError(`矢量要素超过 ${MAX_VECTOR_FEATURES} 条限制`);
    }
  }
  return { type: "FeatureCollection", features };
}

function featureCount(geojson) {
  if (geojson.type === "FeatureCollection") return geojson.features.length;
  if (geojson.type === "Feature") return 1;
  return 1;
}

function extensionOf(name = "") {
  const match = /\.[^.]+$/.exec(name.toLowerCase());
  return match?.[0] ?? "";
}

function baseNameOf(name = "") {
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

function normalizeFiles(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter(Boolean);
  if (typeof input.arrayBuffer === "function" || typeof input.text === "function") return [input];
  if (typeof input.length === "number") return Array.from(input).filter(Boolean);
  return [];
}

function isGeoJsonType(type) {
  return [
    "FeatureCollection",
    "Feature",
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
  ].includes(type);
}

function normalizeShapefileResult(result) {
  const items = Array.isArray(result) ? result : [result];
  const features = [];
  for (const item of items) {
    if (!item || !isGeoJsonType(item.type)) throw new TypeError("Shapefile 解析结果不是有效 GeoJSON");
    if (item.type === "FeatureCollection") features.push(...item.features);
    else if (item.type === "Feature") features.push(item);
    else features.push({ type: "Feature", properties: {}, geometry: item });
  }
  return { type: "FeatureCollection", features };
}

async function readBuffer(file, label) {
  if (typeof file.arrayBuffer !== "function") throw new TypeError(`${label} 不支持浏览器 ArrayBuffer 读取`);
  return file.arrayBuffer();
}

async function loadShapefileFiles(files) {
  const names = files.map((file) => file.name || "未命名文件");
  const unsupported = files.find((file) => !SHAPEFILE_EXTENSIONS.has(extensionOf(file.name)));
  if (unsupported) throw new TypeError(`不支持的 Shapefile 文件类型：${unsupported.name}`);
  if (files.some((file) => extensionOf(file.name) === ".zip")) {
    if (files.length !== 1 || extensionOf(files[0].name) !== ".zip") {
      throw new TypeError("ZIP Shapefile 请单独选择一个 .zip 文件");
    }
    return { result: await shp(await readBuffer(files[0], files[0].name)), name: files[0].name };
  }

  const groups = new Map();
  for (const file of files) {
    const key = baseNameOf(file.name);
    if (!groups.has(key)) groups.set(key, {});
    groups.get(key)[extensionOf(file.name).slice(1)] = file;
  }
  const results = [];
  for (const [baseName, group] of groups) {
    if (!group.shp) throw new TypeError(`Shapefile 组 ${baseName} 缺少 .shp 文件`);
    const input = { shp: await readBuffer(group.shp, group.shp.name) };
    for (const extension of ["dbf", "prj", "cpg"]) {
      if (group[extension]) input[extension] = await readBuffer(group[extension], group[extension].name);
    }
    results.push(await shp(input));
  }
  return { result: results.length === 1 ? results[0] : results, name: names.join(", ") };
}

function inputSize(files) {
  return files.reduce((total, file) => total + Number(file.size || 0), 0);
}

/**
 * 在浏览器本地读取 GeoJSON/TopoJSON/Shapefile，拒绝超大文件和过多要素；不会发起上传请求。
 * 返回的 GeoJSON 可以直接交给 Cesium.GeoJsonDataSource.load。
 */
export async function loadVectorFile(input) {
  const files = normalizeFiles(input);
  if (!files.length) throw new TypeError("请选择 GeoJSON、TopoJSON 或 Shapefile 文件");
  if (inputSize(files) > MAX_VECTOR_BYTES) throw new RangeError("矢量文件超过 50 MiB 限制，请先简化或拆分数据");
  const firstExtension = extensionOf(files[0].name);
  if ([".zip", ".shp", ".dbf", ".prj", ".cpg", ".shx"].includes(firstExtension)) {
    const loaded = await loadShapefileFiles(files);
    const geojson = normalizeShapefileResult(loaded.result);
    const count = featureCount(geojson);
    if (count > MAX_VECTOR_FEATURES) throw new RangeError(`矢量要素超过 ${MAX_VECTOR_FEATURES} 条限制`);
    return { geojson, featureCount: count, format: "Shapefile", name: loaded.name };
  }
  if (files.length !== 1) throw new TypeError("GeoJSON 或 TopoJSON 请单独选择一个 JSON 文件");
  const file = files[0];
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError("文件不是有效 JSON，请确认已选择 GeoJSON 或 TopoJSON 文件");
  }
  const geojson = parsed?.type === "Topology" ? topoJsonToGeoJson(parsed) : parsed;
  if (!geojson || !["FeatureCollection", "Feature", "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"].includes(geojson.type)) {
    throw new TypeError("JSON 内容不是受支持的 GeoJSON 或 TopoJSON 对象");
  }
  const count = featureCount(geojson);
  if (count > MAX_VECTOR_FEATURES) throw new RangeError(`矢量要素超过 ${MAX_VECTOR_FEATURES} 条限制`);
  return { geojson, featureCount: count, format: parsed.type === "Topology" ? "TopoJSON" : "GeoJSON", name: file.name };
}

export const VECTOR_FILE_LIMITS = Object.freeze({
  maxBytes: MAX_VECTOR_BYTES,
  maxFeatures: MAX_VECTOR_FEATURES,
  shapefileExtensions: [...SHAPEFILE_EXTENSIONS],
});

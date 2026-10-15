/**
 * NetCDF-3 风场加载器。
 * 负责识别常见坐标和风速变量、选择单个时间切片，并将数据规范化为 WindData3D。
 */
import { NetCDFReader } from "netcdfjs";
import { computeSpeedFromComponents } from "../core/utils.js";

const VARIABLE_CANDIDATES = {
  lon: ["lon", "longitude", "x"],
  lat: ["lat", "latitude", "y"],
  level: ["lev", "level", "height", "altitude", "z"],
  time: ["time", "valid_time", "forecast_time", "datetime"],
  u: ["u", "u_wind", "eastward_wind", "ugrd", "uwnd"],
  v: ["v", "v_wind", "northward_wind", "vgrd", "vwnd"],
  w: ["w", "w_wind", "vertical_velocity", "upward_air_velocity", "dzdt"],
};

const STANDARD_NAMES = {
  lon: ["longitude"],
  lat: ["latitude"],
  level: ["height", "altitude"],
  time: ["time"],
  u: ["eastward_wind"],
  v: ["northward_wind"],
  w: ["upward_air_velocity"],
};

const INVALID_HEIGHT_ABS_LIMIT = 1e30;

function flatten(values, result = []) {
  for (const value of values ?? []) {
    if (Array.isArray(value) || ArrayBuffer.isView(value)) flatten(value, result);
    else result.push(value);
  }
  return result;
}

function attributesToMap(variable) {
  return new Map((variable?.attributes ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
}

function findVariable(reader, role, override) {
  if (override) {
    const exact = reader.variables.find((variable) => variable.name === override);
    if (!exact) throw new Error(`NetCDF 中不存在变量 ${override}`);
    return exact;
  }

  const candidates = VARIABLE_CANDIDATES[role];
  const byName = new Map(reader.variables.map((variable) => [variable.name.toLowerCase(), variable]));
  for (const candidate of candidates) {
    if (byName.has(candidate)) return byName.get(candidate);
  }

  const standards = STANDARD_NAMES[role] ?? [];
  return reader.variables.find((variable) => {
    const attributes = attributesToMap(variable);
    const standardName = String(attributes.get("standard_name") ?? "").toLowerCase();
    return standards.includes(standardName);
  });
}

function getAttributeNumber(variable, name, fallback) {
  const value = attributesToMap(variable).get(name.toLowerCase());
  const scalar = Array.isArray(value) ? value[0] : value;
  return Number.isFinite(Number(scalar)) ? Number(scalar) : fallback;
}

function assertVerticalUnits(variable) {
  if (!variable) return;
  const units = String(attributesToMap(variable).get("units") ?? "").trim().toLowerCase();
  if (/^(pa|hpa|mbar|millibar|bar)$/.test(units)) {
    throw new Error(`垂直坐标 ${variable.name} 的单位是 ${units}，请先转换为米制高度`);
  }
}

function assertVerticalWindUnits(variable) {
  if (!variable) return;
  const units = String(attributesToMap(variable).get("units") ?? "").trim().toLowerCase();
  if (units.includes("pa/s") || units.includes("pa s")) {
    throw new Error(`垂直风速 ${variable.name} 的单位是 ${units}，请先转换为 m/s`);
  }
}

function readNumericVariable(reader, variable) {
  const raw = flatten(reader.getDataVariable(variable));
  const scale = getAttributeNumber(variable, "scale_factor", 1);
  const offset = getAttributeNumber(variable, "add_offset", 0);
  const fillValues = ["_fillvalue", "missing_value"]
    .map((name) => getAttributeNumber(variable, name, undefined))
    .filter(Number.isFinite);
  const result = new Float64Array(raw.length);

  for (let index = 0; index < raw.length; index++) {
    const value = Number(raw[index]);
    if (!Number.isFinite(value) || fillValues.some((fill) => value === fill)) {
      result[index] = Number.NaN;
    } else {
      result[index] = value * scale + offset;
    }
  }
  return result;
}

function dimensionNames(reader, variable) {
  return variable.dimensions.map((id) => reader.dimensions[id]?.name);
}

function assertCoordinate(values, label) {
  if (values.length === 0) throw new Error(`${label}坐标为空`);
  if (!values.every(Number.isFinite)) throw new Error(`${label}坐标包含缺测值`);
}

function normalizeLevelValues(values, warnings) {
  const invalid = values.some((value) => !Number.isFinite(value) || Math.abs(value) >= INVALID_HEIGHT_ABS_LIMIT);
  if (!invalid) return values;
  if (values.length === 1) {
    warnings.push("单层高度是缺测哨兵值，已按 0 m 处理");
    return [0];
  }
  throw new Error("高度坐标包含缺测值或异常哨兵值，请先清洗数据");
}

function sortedIndices(values, transform = (value) => value) {
  return Array.from(values, (value, index) => ({ value: transform(value), index }))
    .sort((left, right) => left.value - right.value);
}

function validateRegularGrid(sorted, label) {
  if (sorted.length < 3) return;
  const firstStep = sorted[1].value - sorted[0].value;
  const tolerance = Math.max(Math.abs(firstStep) * 0.01, 1e-6);
  for (let index = 2; index < sorted.length; index++) {
    const step = sorted[index].value - sorted[index - 1].value;
    if (Math.abs(step - firstStep) > tolerance) {
      throw new Error(`${label}必须是规则等间距网格`);
    }
  }
}

function createDimensionPlan(reader, variable, coordinateNames, timeIndex) {
  const names = dimensionNames(reader, variable);
  const sizes = variable.dimensions.map((id) => reader.dimensions[id]?.size ?? 0);
  const roles = names.map((name, index) => {
    if (name === coordinateNames.lon) return "x";
    if (name === coordinateNames.lat) return "y";
    if (name === coordinateNames.level) return "z";
    if (VARIABLE_CANDIDATES.time.includes(name?.toLowerCase())) return "time";
    if (sizes[index] === 1) return "singleton";
    throw new Error(`变量 ${variable.name} 包含无法处理的维度 ${name}=${sizes[index]}`);
  });

  for (const role of ["x", "y"]) {
    if (!roles.includes(role)) throw new Error(`变量 ${variable.name} 缺少${role === "x" ? "经度" : "纬度"}维度`);
  }

  const selected = roles.map((role, index) => {
    if (role === "time") {
      if (timeIndex < 0 || timeIndex >= sizes[index]) {
        throw new Error(`时间索引 ${timeIndex} 超出 0..${sizes[index] - 1}`);
      }
      return timeIndex;
    }
    return role === "singleton" ? 0 : undefined;
  });
  return { names, sizes, roles, selected };
}

function stridesFor(sizes) {
  const strides = new Array(sizes.length);
  let stride = 1;
  for (let index = sizes.length - 1; index >= 0; index--) {
    strides[index] = stride;
    stride *= sizes[index];
  }
  return strides;
}

function reorderWindComponent(raw, plan, xOrder, yOrder, zOrder) {
  const strides = stridesFor(plan.sizes);
  const result = new Float32Array(xOrder.length * yOrder.length * zOrder.length);
  let target = 0;

  for (const z of zOrder) {
    for (const y of yOrder) {
      for (const x of xOrder) {
        let source = 0;
        for (let dimension = 0; dimension < plan.roles.length; dimension++) {
          const role = plan.roles[dimension];
          const coordinate = role === "x" ? x : role === "y" ? y : role === "z" ? z : plan.selected[dimension];
          source += (coordinate ?? 0) * strides[dimension];
        }
        const value = raw[source];
        if (!Number.isFinite(value)) throw new Error("风速数据包含缺测值、NaN 或无穷值，请先清洗数据");
        result[target++] = value;
      }
    }
  }
  return result;
}

function duplicateSingleLevel(component) {
  const duplicated = new Float32Array(component.length * 2);
  duplicated.set(component, 0);
  duplicated.set(component, component.length);
  return duplicated;
}

export function detectNetCDFFormat(data) {
  const bytes = data instanceof Uint8Array
    ? data
    : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, Math.min(data.byteLength ?? data.length, 8));
  if (bytes[0] === 0x43 && bytes[1] === 0x44 && bytes[2] === 0x46 && (bytes[3] === 1 || bytes[3] === 2)) {
    return "netcdf3";
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x48 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "netcdf4";
  }
  return "unknown";
}

export function normalizeNetCDFReader(reader, options = {}) {
  const timeIndex = options.timeIndex ?? 0;
  const warnings = [];
  const variables = {
    lon: findVariable(reader, "lon", options.variables?.lon),
    lat: findVariable(reader, "lat", options.variables?.lat),
    level: findVariable(reader, "level", options.variables?.level),
    u: findVariable(reader, "u", options.variables?.u),
    v: findVariable(reader, "v", options.variables?.v),
    w: findVariable(reader, "w", options.variables?.w),
  };
  for (const role of ["lon", "lat", "u", "v"]) {
    if (!variables[role]) throw new Error(`无法自动识别 ${role.toUpperCase()} 变量`);
  }
  assertVerticalUnits(variables.level);
  assertVerticalWindUnits(variables.w);

  const lonValues = Array.from(readNumericVariable(reader, variables.lon));
  const latValues = Array.from(readNumericVariable(reader, variables.lat));
  const rawLevelValues = variables.level
    ? Array.from(readNumericVariable(reader, variables.level))
    : [0];
  assertCoordinate(lonValues, "经度");
  assertCoordinate(latValues, "纬度");
  const levelValues = normalizeLevelValues(rawLevelValues, warnings);

  const longitudeOrder = sortedIndices(lonValues, (value) => ((value + 180) % 360 + 360) % 360 - 180);
  const latitudeOrder = sortedIndices(latValues);
  const levelOrder = sortedIndices(levelValues);
  validateRegularGrid(longitudeOrder, "经度");
  validateRegularGrid(latitudeOrder, "纬度");

  const coordinateNames = {
    lon: variables.lon.name,
    lat: variables.lat.name,
    level: variables.level?.name,
  };
  const xOrder = longitudeOrder.map((entry) => entry.index);
  const yOrder = latitudeOrder.map((entry) => entry.index);
  const sourceZOrder = variables.level ? levelOrder.map((entry) => entry.index) : [0];
  const readComponent = (variable) => {
    if (!variable) return undefined;
    const plan = createDimensionPlan(reader, variable, coordinateNames, timeIndex);
    const zOrder = plan.roles.includes("z") ? sourceZOrder : [0];
    return reorderWindComponent(readNumericVariable(reader, variable), plan, xOrder, yOrder, zOrder);
  };

  let u = readComponent(variables.u);
  let v = readComponent(variables.v);
  let w = readComponent(variables.w);
  if (u.length !== v.length) throw new Error("U/V 分量的网格尺寸不一致");
  if (!w) w = new Float32Array(u.length);
  if (w.length !== u.length) throw new Error("W 分量的网格尺寸与 U/V 不一致");

  let levels = levelOrder.map((entry) => entry.value);
  let nz = levels.length;
  if (nz === 1) {
    u = duplicateSingleLevel(u);
    v = duplicateSingleLevel(v);
    w = duplicateSingleLevel(w);
    levels = [levels[0], levels[0] + 1];
    nz = 2;
    warnings.push("单层数据已复制为两个相邻高度层");
  }
  if (!variables.w) warnings.push("未找到垂直风速 W，已使用 0 m/s");

  const speed = computeSpeedFromComponents(u, v, w);
  return {
    windData: {
      u: { array: u },
      v: { array: v },
      w: { array: w },
      speed,
      nx: longitudeOrder.length,
      ny: latitudeOrder.length,
      nz,
      bounds: {
        west: longitudeOrder[0].value,
        south: latitudeOrder[0].value,
        east: longitudeOrder.at(-1).value,
        north: latitudeOrder.at(-1).value,
      },
      levels,
    },
    metadata: {
      format: "NetCDF-3",
      variables: Object.fromEntries(Object.entries(variables).map(([role, variable]) => [role, variable?.name])),
      timeIndex,
      warnings,
    },
  };
}

export function parseNetCDF3(data, options = {}) {
  const format = detectNetCDFFormat(data);
  if (format === "netcdf4") {
    throw new Error("该文件是 NetCDF-4/HDF5，请先使用 tools/netcdf/convert_netcdf.py 转换为 NetCDF-3");
  }
  if (format !== "netcdf3") throw new Error("文件不是受支持的 NetCDF-3 格式");
  return normalizeNetCDFReader(new NetCDFReader(data), options);
}

export async function loadNetCDF3File(file, options = {}) {
  if (!file) throw new Error("没有选择文件");
  const maxBytes = options.maxBytes ?? 150 * 1024 * 1024;
  if (file.size > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 的浏览器加载上限`);
  return parseNetCDF3(await file.arrayBuffer(), options);
}

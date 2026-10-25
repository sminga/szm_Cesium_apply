import { describe, expect, it, vi } from "vitest";

const { loadVectorFileMock } = vi.hoisted(() => ({ loadVectorFileMock: vi.fn() }));
vi.mock("../../example/services/vectorFileLoader.js", () => ({
  loadVectorFile: loadVectorFileMock,
  VECTOR_FILE_LIMITS: { maxBytes: 50 * 1024 * 1024, maxFeatures: 100_000, shapefileExtensions: [] },
}));

import { formatCoordinate, SceneToolsController, setOptions } from "../../example/app/sceneToolsController.js";

describe("scene tools helpers", () => {
  it("formats coordinate values with an explicit height source", () => {
    expect(formatCoordinate({ longitude: 120.12345678, latitude: 30.12345678, height: 21.25 }, "地形表面"))
      .toBe("经度 120.123457° · 纬度 30.123457° · 高度 21.3 m（地形表面）");
  });

  it("falls back from depth picking to the public terrain ray API", () => {
    const terrainPosition = { x: 1, y: 2, z: 3 };
    const controller = Object.create(SceneToolsController.prototype);
    controller.viewer = {
      scene: {
        pickPositionSupported: true,
        pickPosition: () => { throw new Error("depth unavailable"); },
        globe: { pick: () => terrainPosition },
      },
      camera: { getPickRay: () => ({}), pickEllipsoid: () => null },
    };
    expect(controller.pickSurface({ x: 10, y: 20 })).toEqual({ position: terrainPosition, source: "地形表面" });
  });

  it("samples route vertices using distance divided by configured speed", () => {
    const controller = Object.create(SceneToolsController.prototype);
    controller.Cesium = { Cartesian3: { distance: (left, right) => Math.hypot(right.x - left.x, right.y - left.y) } };
    const first = { x: 0, y: 0 };
    const second = { x: 3, y: 4 };
    const third = { x: 13, y: 4 };
    expect(controller.routeSamples({ positions: [first, second, third] }, 5)).toEqual([
      { position: first, seconds: 0 },
      { position: second, seconds: 1 },
      { position: third, seconds: 3 },
    ]);
  });

  it("retains the initial GLB position property so playback can start", async () => {
    const modelPosition = { id: "initial-model-position" };
    const route = {
      id: "route-1",
      name: "测试路线",
      positions: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }],
      modelEntity: null,
      modelUrl: "",
      modelFileName: "",
    };
    const controller = Object.create(SceneToolsController.prototype);
    controller.routes = new Map([[route.id, route]]);
    controller.selectedRouteId = route.id;
    controller.playbackRouteId = "";
    controller.viewer = { entities: { add: vi.fn(() => ({ position: modelPosition })) } };
    controller.Cesium = { ConstantPositionProperty: class { constructor(position) { this.position = position; } } };
    controller.sceneLayers = { update: vi.fn() };
    controller.render = vi.fn();

    vi.stubGlobal("document", {
      getElementById: (id) => id === "scene-model-file"
        ? { value: "" }
        : { className: "", querySelector: () => null },
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-model");
    try {
      await controller.loadModelFile({ name: "test.glb", size: 12 });
      expect(route.modelEntity.position).toBe(modelPosition);
      expect(route.positionProperty).toBe(modelPosition);
      expect(createObjectURL).toHaveBeenCalledOnce();
    } finally {
      createObjectURL.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("prefers a newly selected record over the previous select value", () => {
    const options = [];
    const select = {
      value: "old",
      replaceChildren() { options.length = 0; },
      append(option) { options.push(option); },
    };
    const records = [{ id: "old", name: "旧点" }, { id: "new", name: "新点" }];
    vi.stubGlobal("document", { createElement: () => ({}) });
    try {
      const selectedId = setOptions(select, records, "暂无点位", "new");
      expect(selectedId).toBe("new");
      expect(select.value).toBe("new");
      expect(options.map((option) => option.value)).toEqual(["old", "new"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("copies a live FileList before clearing the file input", async () => {
    const file = { name: "内蒙古自治区.shp", size: 10, arrayBuffer: vi.fn() };
    let inputCleared = false;
    const liveFileList = {
      0: file,
      get length() { return inputCleared ? 0 : 1; },
    };
    const input = {};
    Object.defineProperty(input, "value", {
      get: () => inputCleared ? "" : "selected",
      set: () => { inputCleared = true; },
    });
    const status = {
      className: "",
      querySelector: (selector) => selector === "b"
        ? { textContent: "" }
        : { textContent: "" },
    };
    const dataSource = { name: "" };
    loadVectorFileMock.mockResolvedValueOnce({
      geojson: { type: "FeatureCollection", features: [] },
      featureCount: 0,
      format: "Shapefile",
      name: "内蒙古自治区.shp",
    });
    const controller = Object.create(SceneToolsController.prototype);
    controller.destroyed = false;
    controller.vectorLayers = new Map();
    controller.viewer = {
      dataSources: { add: vi.fn(async () => dataSource) },
    };
    controller.Cesium = {
      GeoJsonDataSource: { load: vi.fn(async () => dataSource) },
      Color: { CYAN: { withAlpha: () => ({}) } },
    };
    controller.sceneLayers = { register: vi.fn() };
    vi.stubGlobal("document", { getElementById: (id) => id === "scene-vector-file" ? input : status });
    try {
      await controller.loadVector(liveFileList);
      expect(loadVectorFileMock).toHaveBeenCalledWith([file]);
      expect(controller.sceneLayers.register).toHaveBeenCalledOnce();
      expect(inputCleared).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      loadVectorFileMock.mockReset();
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const { shpMock } = vi.hoisted(() => ({ shpMock: vi.fn() }));
vi.mock("shpjs", () => ({ default: shpMock }));

import { loadVectorFile, topoJsonToGeoJson, VECTOR_FILE_LIMITS } from "../../example/services/vectorFileLoader.js";

describe("browser vector file loader", () => {
  afterEach(() => shpMock.mockReset());

  it("loads a Shapefile ZIP through shpjs and normalizes the result", async () => {
    shpMock.mockResolvedValueOnce({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { name: "zip" }, geometry: { type: "Point", coordinates: [1, 2] } }],
    });
    const buffer = new ArrayBuffer(8);
    const result = await loadVectorFile({
      name: "roads.zip",
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    });
    expect(result).toMatchObject({ format: "Shapefile", featureCount: 1, name: "roads.zip" });
    expect(result.geojson.type).toBe("FeatureCollection");
    expect(shpMock).toHaveBeenCalledWith(buffer);
  });

  it("combines same-base Shapefile companion files into one parser input", async () => {
    shpMock.mockResolvedValueOnce({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }],
    });
    const files = ["roads.shp", "roads.dbf", "roads.prj", "roads.cpg"].map((name, index) => ({
      name,
      size: 4,
      arrayBuffer: async () => new Uint8Array([index]).buffer,
    }));
    const result = await loadVectorFile(files);
    expect(result.format).toBe("Shapefile");
    expect(shpMock).toHaveBeenCalledWith({
      shp: expect.any(ArrayBuffer),
      dbf: expect.any(ArrayBuffer),
      prj: expect.any(ArrayBuffer),
      cpg: expect.any(ArrayBuffer),
    });
  });

  it("rejects an incomplete Shapefile group", async () => {
    await expect(loadVectorFile({
      name: "roads.dbf",
      size: 1,
      arrayBuffer: async () => new ArrayBuffer(1),
    })).rejects.toThrow("缺少 .shp");
  });

  it("decodes transformed arcs and point coordinates into GeoJSON", () => {
    const topology = {
      type: "Topology",
      transform: { scale: [0.1, 0.1], translate: [100, 20] },
      arcs: [[[0, 0], [10, 0], [0, 10]]],
      objects: {
        roads: {
          type: "GeometryCollection",
          geometries: [
            { type: "LineString", arcs: [0], properties: { name: "road" } },
            { type: "Point", coordinates: [5, 4], properties: { name: "station" } },
          ],
        },
      },
    };

    expect(topoJsonToGeoJson(topology)).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "road", topologyObject: "roads" },
          geometry: { type: "LineString", coordinates: [[100, 20], [101, 20], [101, 21]] },
        },
        {
          type: "Feature",
          properties: { name: "station", topologyObject: "roads" },
          geometry: { type: "Point", coordinates: [100.5, 20.4] },
        },
      ],
    });
  });

  it("reverses negative arc references using TopoJSON's complemented index", () => {
    const geojson = topoJsonToGeoJson({
      type: "Topology",
      arcs: [[[0, 0], [1, 0], [1, 1]]],
      objects: { reverse: { type: "LineString", arcs: [-1] } },
    });
    expect(geojson.features[0].geometry.coordinates).toEqual([[1, 1], [1, 0], [0, 0]]);
  });

  it("joins adjacent arcs without duplicating their shared endpoint", () => {
    const geojson = topoJsonToGeoJson({
      type: "Topology",
      arcs: [[[0, 0], [1, 0]], [[1, 0], [2, 0]]],
      objects: { road: { type: "LineString", arcs: [0, 1] } },
    });
    expect(geojson.features[0].geometry.coordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it("reads GeoJSON and identifies TopoJSON in browser File objects", async () => {
    const content = JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [1, 2] } });
    const result = await loadVectorFile({ name: "one.geojson", size: content.length, text: async () => content });
    expect(result).toMatchObject({ format: "GeoJSON", featureCount: 1, geojson: { type: "Feature" } });

    const topo = JSON.stringify({ type: "Topology", arcs: [], objects: { points: { type: "Point", coordinates: [1, 2] } } });
    const topoResult = await loadVectorFile({ name: "one.json", size: topo.length, text: async () => topo });
    expect(topoResult).toMatchObject({ format: "TopoJSON", featureCount: 1 });
  });

  it("rejects malformed JSON and files larger than the browser limit", async () => {
    await expect(loadVectorFile({ size: 1, text: async () => "{" })).rejects.toThrow("有效 JSON");
    await expect(loadVectorFile({ size: VECTOR_FILE_LIMITS.maxBytes + 1, text: async () => "{}" })).rejects.toThrow("50 MiB");
    expect(() => topoJsonToGeoJson({ type: "Topology", arcs: [], objects: { bad: { type: "Unknown" } } })).toThrow("几何类型");
  });
});

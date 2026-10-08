# cesium-wind-layer-3d

A WebGL2-based 3D wind field layer for CesiumJS, using 3D textures and GPU particle advection (GPGPU) for high-performance dynamic wind visualization.

> **Note:** This is a **3D wind field** package, built upon the 2D wind layer package [`cesium-wind-layer`](https://www.npmjs.com/package/cesium-wind-layer) by adding the vertical `w` component for true 3D wind field visualization. This package uses `(u, v, w)` three-component 3D grid data with particles advecting in 3D space.

## Features

- WebGL2 native 3D textures (`sampler3D`) for wind field storage with hardware trilinear interpolation
- GPU particle advection (Runge-Kutta 2) with millions of particles in real-time
- Speed-adaptive line width/length with color ramp mapping
- Runtime dynamic data replacement, parameter adjustment, and visibility control
- Supports both 2D and 3D scene modes
- Local NetCDF-3 loading in the browser, with zero-filled W when it is missing
- Continuous speed colors and speed-weighted particle density

## Installation

```bash
npm install cesium-wind-layer-3d
```

`cesium` is a peer dependency. Ensure CesiumJS (^1.142.0) is installed.

## Quick Start

```js
import * as Cesium from "cesium";
import { WindLayer3D } from "cesium-wind-layer-3d";

const viewer = new Cesium.Viewer("container");

const windData = {
  u: { array: uArray },   // Float32Array(nx*ny*nz)
  v: { array: vArray },
  w: { array: wArray },
  nx, ny, nz,
  bounds: { west, south, east, north },
  levels: [500, 1500, 3000, 5500], // height per level (meters), ascending
};

const layer = new WindLayer3D(viewer, windData, {
  colors: ["rgb(175,240,91)", "rgb(110,64,170)"],
  particlesTextureSize: 256,
});

layer.zoomTo(2);
```

## Data Contract

### WindData3D

| Field | Type | Description |
|-------|------|-------------|
| `u` / `v` / `w` | `{ array: Float32Array }` | East/North/Vertical wind components (m/s), length `nx*ny*nz` |
| `speed` | `{ array, min, max }` | Optional, computed from u/v/w if missing |
| `nx` / `ny` / `nz` | `number` | Longitude/Latitude/Vertical grid dimensions |
| `bounds` | `{ west, south, east, north }` | Data extent (degrees) |
| `levels` | `number[]` | Height per level (meters), ascending, length `nz` |

Array layout: `index = (z * ny + y) * nx + x`, x=longitude (west→east), y=latitude (south→north), z=level (low→high).

### Load NetCDF-3

```js
import { loadNetCDF3File, WindLayer3D } from "cesium-wind-layer-3d";

const { windData, metadata } = await loadNetCDF3File(file);
const layer = new WindLayer3D(viewer, windData);
console.log(metadata.warnings);
```

The loader recognizes common `lon/lat/lev` and `U/V/W` names, sorts coordinates
in ascending order, and rearranges data to `(lev, lat, lon)`. Missing W is filled
with `0 m/s`; pressure levels must be converted to metric heights first. The
default browser file limit is 150 MB. Convert NetCDF-4/HDF5 before loading:

```powershell
py -m pip install xarray numpy netCDF4
py tools\convert_netcdf.py "D:\data\wind.nc"
```

See [`tools/NETCDF.md`](tools/NETCDF.md) for variable mapping and time options.

### GUI NetCDF-4 conversion

Start the localhost conversion service before using the converter on the
example's Tools tab:

```powershell
npm run local:server
```

The service listens only on `127.0.0.1:8765`. Converted files are saved under
`tools/converted/`, and the GUI reports the full output path. The browser client
is `example/services/localServiceClient.js`; the reusable service is
`tools/server/local_service.py`.

### Cesium service configuration

Example credentials are provided via environment variables: put `VITE_CESIUM_ION_TOKEN`
in a Git-ignored `example/.env` for local development, and set the same variable in
Vercel Project Settings -> Environment Variables for deployment. Additional services
(Tianditu, etc.) follow the same pattern, e.g. `VITE_TIANDITU_TOKEN`.

## Options (WindLayerOptions)

| Field | Default | Description |
|-------|---------|-------------|
| `particlesTextureSize` | `128` | Particle texture size, total particles = size² |
| `dropRate` | `0.003` | Base drop rate |
| `dropRateBump` | `0.01` | Speed-dependent drop increment |
| `speedFactor` | `1.0` | Speed scaling factor |
| `lineWidth` | `{ min: 1, max: 2 }` | Line width range (pixels) |
| `lineLength` | `{ min: 20, max: 100 }` | Line length range |
| `heightScale` | `1` | Height exaggeration |
| `colors` | `["white"]` | Color ramp (CSS color array) |
| `flipY` | `false` | Flip Y axis |
| `useViewerBounds` | `false` | Seed particles in viewport bounds |
| `domain` | `undefined` | Color ramp domain |
| `displayRange` | `undefined` | Display range |
| `lowSpeedOpacity` | `0.72` | Minimum opacity for low-speed streamlines |
| `densityBySpeed` | `true` | Seed more particles in high-speed regions |
| `densityExponent` | `1.5` | Strength of speed-weighted density |
| `densityFloor` | `0.15` | Minimum sampling weight retained in low-speed regions |
| `dynamic` | `true` | Enable dynamic updates |

## API

| Method | Description |
|--------|-------------|
| `show` | Read/write property for visibility control |
| `updateWindData(data)` | Replace wind data at runtime |
| `updateOptions(options)` | Update options at runtime |
| `zoomTo(duration?)` | Fly to data extent |
| `destroy()` | Destroy all resources |
| `isDestroyed()` | Check if destroyed |

## Example

```bash
git clone https://github.com/lby0102/cesium-wind-layer-3d.git
cd cesium-wind-layer-3d
npm install
npm run dev
```

Browser will show global 3D wind particle animation (example uses programmatically generated data, no external data files needed).

## Browser Requirements

- WebGL2 (enabled by default in CesiumJS 1.104+)
- Requires `EXT_color_buffer_float` (floating-point texture rendering) and native 3D texture support

## License

MIT

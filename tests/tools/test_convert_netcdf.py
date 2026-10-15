import sys
import unittest
from pathlib import Path

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools.netcdf.convert_netcdf import (  # noqa: E402
    prepare_coordinate,
    repair_constant_latitude_stripes,
)


class NetCDFConverterTests(unittest.TestCase):
    def test_invalid_single_height_uses_configured_fallback(self):
        dataset = xr.Dataset(coords={"height": ("height", [9.969209968386869e36])})

        height, order, note = prepare_coordinate(
            dataset, "height", "lev", single_level_height=120.0,
        )

        self.assertEqual(height.values.tolist(), [120.0])
        self.assertEqual(order.tolist(), [0])
        self.assertIn("120 m", note)

    def test_repairs_large_full_width_constant_latitude_run(self):
        u_values = np.zeros((1, 6, 4), dtype=np.float32)
        v_values = np.zeros_like(u_values)
        w_values = np.zeros_like(u_values)
        u_values[:, 0:2, :] = np.arange(4, dtype=np.float32)
        u_values[:, 2:4, :] = 15.0
        u_values[:, 4:, :] = np.arange(4, dtype=np.float32) + 4.0
        v_values[:, 0:2, :] = np.arange(4, dtype=np.float32) * 0.1
        v_values[:, 4:, :] = np.arange(4, dtype=np.float32) * 0.1
        components = [
            xr.DataArray(values, dims=("lev", "lat", "lon"), name=name)
            for values, name in zip((u_values, v_values, w_values), ("U", "V", "W"), strict=True)
        ]

        repairs = repair_constant_latitude_stripes(components, jump_threshold=5.0)

        self.assertEqual(repairs, [(0, 2, 3)])
        np.testing.assert_allclose(
            components[0].values[0, 2], np.arange(4, dtype=np.float32) + 4 / 3, atol=1e-6,
        )
        np.testing.assert_allclose(
            components[0].values[0, 3], np.arange(4, dtype=np.float32) + 8 / 3, atol=1e-6,
        )

    def test_does_not_repair_small_constant_variation(self):
        values = np.zeros((1, 5, 3), dtype=np.float32)
        values[:, 2, :] = 0.5
        components = [
            xr.DataArray(values.copy(), dims=("lev", "lat", "lon"), name=name)
            for name in ("U", "V", "W")
        ]

        repairs = repair_constant_latitude_stripes(components, jump_threshold=5.0)

        self.assertEqual(repairs, [])
        np.testing.assert_allclose(components[0].values, values)


if __name__ == "__main__":
    unittest.main()

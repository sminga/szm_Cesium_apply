import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools.netcdf.convert_wrf import (  # noqa: E402
    common_height_levels,
    interpolate_vertical,
    largest_valid_rectangle,
)


class WRFConverterTests(unittest.TestCase):
    def test_common_msl_levels_use_domain_wide_overlap(self):
        height = np.array([
            [[100, 200], [300, 400]],
            [[1100, 1200], [1300, 1400]],
            [[2100, 2200], [2300, 2400]],
        ], dtype=np.float32)

        levels = common_height_levels(height, 500)

        self.assertEqual(levels.tolist(), [500.0, 1000.0, 1500.0, 2000.0])

    def test_interpolates_each_column_to_requested_height(self):
        height = np.array([0, 1000, 2000], dtype=np.float32)[:, None, None]
        height = np.broadcast_to(height, (3, 2, 2))
        field = height * 2 + 10

        actual = interpolate_vertical(field, height, 750)

        np.testing.assert_allclose(actual, np.full((2, 2), 1510, dtype=np.float32))

    def test_masks_columns_below_or_above_vertical_coverage(self):
        height = np.array([
            [[0, 1000]],
            [[1000, 2000]],
            [[2000, 3000]],
        ], dtype=np.float32)
        field = height.copy()

        actual = interpolate_vertical(field, height, 500)

        self.assertTrue(np.isfinite(actual[0, 0]))
        self.assertTrue(np.isnan(actual[0, 1]))

    def test_finds_largest_complete_rectangle_for_browser_grid(self):
        mask = np.ones((5, 6), dtype=bool)
        mask[0, 0:2] = False
        mask[1, 0] = False
        mask[3:, 5] = False

        y0, y1, x0, x1 = largest_valid_rectangle(mask)

        self.assertEqual(int(mask[y0:y1, x0:x1].sum()), (y1 - y0) * (x1 - x0))
        self.assertGreaterEqual((y1 - y0) * (x1 - x0), 16)

    def test_rejects_non_monotonic_column_heights(self):
        height = np.array([0, 1000, 900], dtype=np.float32)[:, None, None]
        with self.assertRaisesRegex(ValueError, "不是逐列递增"):
            interpolate_vertical(height, height, 500)


if __name__ == "__main__":
    unittest.main()

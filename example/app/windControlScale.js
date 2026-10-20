const SPEED_FACTOR_MIN = 0.05;
const SPEED_FACTOR_MAX = 5;
export const SPEED_SLIDER_MIN = 0;
export const SPEED_SLIDER_MAX = 200;

/**
 * 把对数滑块位置转换为实际粒子推进倍率。
 * 滑块位置按 0.05～5 的比例范围映射，因此低速端比线性滑块拥有更多可用行程，
 * 同时数值填写框始终显示和编辑真实 speedFactor，不暴露内部滑块刻度。
 */
export function speedFactorFromSlider(sliderValue) {
  const position = Math.min(
    SPEED_SLIDER_MAX,
    Math.max(SPEED_SLIDER_MIN, Number(sliderValue) || SPEED_SLIDER_MIN),
  );
  const ratio = position / SPEED_SLIDER_MAX;
  const factor = SPEED_FACTOR_MIN * (SPEED_FACTOR_MAX / SPEED_FACTOR_MIN) ** ratio;
  return Math.min(SPEED_FACTOR_MAX, Math.max(SPEED_FACTOR_MIN, factor));
}

/**
 * 把实际推进倍率还原为滑块位置，供初始值和后续状态同步使用。
 */
export function speedSliderFromFactor(speedFactor) {
  const factor = Math.min(
    SPEED_FACTOR_MAX,
    Math.max(SPEED_FACTOR_MIN, Number(speedFactor) || SPEED_FACTOR_MIN),
  );
  const ratio = Math.log(factor / SPEED_FACTOR_MIN)
    / Math.log(SPEED_FACTOR_MAX / SPEED_FACTOR_MIN);
  return Math.round(ratio * SPEED_SLIDER_MAX);
}

/**
 * 控件步进为 0.01；去掉无意义的尾随零，同时保留 0.05 等低速精度。
 */
export function formatSpeedFactor(speedFactor) {
  return Number(speedFactor.toFixed(2)).toString();
}

/**
 * 把填写框值限制到参数范围并对齐到合法步进。
 * number 输入在用户键入过程中可能暂时为空或不完整，调用方应只在提交时使用该函数；
 * 无效值返回 fallback，避免数值框和滑块互相写入 NaN。
 */
export function normalizeParameterValue(value, { min, max, step }, fallback) {
  if (String(value).trim() === "") return fallback;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  const clampedValue = Math.min(max, Math.max(min, numericValue));
  const steppedValue = min + Math.round((clampedValue - min) / step) * step;
  const precision = Math.max(
    (String(min).split(".")[1] || "").length,
    (String(step).split(".")[1] || "").length,
  );
  return Number(Math.min(max, Math.max(min, steppedValue)).toFixed(precision));
}

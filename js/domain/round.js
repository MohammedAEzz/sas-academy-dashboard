/**
 * Python 3 round-half-to-even, used so forecast figures match forecast.json.
 */
export function roundDigits(value, digits) {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const factor = 10 ** digits;
  const scaled = Math.abs(value) * factor;
  const floor = Math.floor(scaled + 1e-12);
  const fraction = scaled - floor;
  let rounded;
  if (fraction > 0.5 + 1e-8) rounded = floor + 1;
  else if (fraction < 0.5 - 1e-8) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1;
  return (sign * rounded) / factor;
}

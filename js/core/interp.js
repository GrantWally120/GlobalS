// Cubic Hermite interpolation between two SGP4 keyframes (position + velocity at each end).
//
// Exact at the keyframes and C¹ across them. For a circular LEO orbit the error is at most
// r·ω⁴·h⁴/384: ≈0.4 m for keyframes 60 s apart, ≈30 m at 180 s, ≈19 km at 900 s (used only at
// ≥181× warp, where satellites cross the screen in a blink). Linear interpolation would be ~435 m
// off after just 10 s, and two-body extrapolation drifts by kilometres because it ignores J2.

/**
 * Basis weights for s ∈ [0, 1] over an interval of `hSec` seconds.
 * Velocities are per second, so the tangent weights carry the factor h.
 */
export function hermiteBasis(s, hSec, out = new Float64Array(4)) {
  const s2 = s * s;
  const s3 = s2 * s;
  out[0] = 2 * s3 - 3 * s2 + 1;
  out[1] = (s3 - 2 * s2 + s) * hSec;
  out[2] = -2 * s3 + 3 * s2;
  out[3] = (s3 - s2) * hSec;
  return out;
}

/** out[i] = b0·P0[i] + b1·V0[i] + b2·P1[i] + b3·V1[i] for every component. */
export function hermiteInto(out, P0, V0, P1, V1, b, count = out.length) {
  const [b0, b1, b2, b3] = b;
  for (let i = 0; i < count; i++) out[i] = b0 * P0[i] + b1 * V0[i] + b2 * P1[i] + b3 * V1[i];
  return out;
}

/** Derivative weights (velocity) for the same interval — used to orient follow-camera frames. */
export function hermiteBasisDerivative(s, hSec, out = new Float64Array(4)) {
  const s2 = s * s;
  out[0] = (6 * s2 - 6 * s) / hSec;
  out[1] = 3 * s2 - 4 * s + 1;
  out[2] = (-6 * s2 + 6 * s) / hSec;
  out[3] = 3 * s2 - 2 * s;
  return out;
}

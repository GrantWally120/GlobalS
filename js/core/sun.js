// The Sun: direction, sub-solar point, altitude for an observer, and darkness windows.
// Uses satellite.js 7.1.0's low-precision apparent Sun (≈0.01°, valid 1950–2050).

import { gmstFromMs, jdFromMs, sunPos } from './sat.js';
import { DEG, eciToEcf, unit } from './frames.js';
import { lookAngles } from './look.js';

export const AU_KM = 149_597_870.7;

/** Sun position, ECI (equator/equinox of date), in AU. */
export function sunEciAu(tMs) {
  return sunPos(jdFromMs(tMs)).rsun;
}

/** Unit vector toward the Sun in ECI. */
export const sunDirEci = (tMs) => unit(sunEciAu(tMs));

/** Unit vector toward the Sun in ECF (Earth-fixed). */
export const sunDirEcf = (tMs) => eciToEcf(sunDirEci(tMs), gmstFromMs(tMs));

/** Point on Earth with the Sun at the zenith. Geodetic, because the ellipsoid normal is geodetic. */
export function subsolarPoint(tMs) {
  const s = sunDirEcf(tMs);
  return { latDeg: Math.asin(s.z) / DEG, lonDeg: Math.atan2(s.y, s.x) / DEG };
}

/** Geometric altitude/azimuth of the Sun's centre for an observer (no refraction), degrees. */
export function sunAltAz(obs, tMs) {
  const au = sunEciAu(tMs);
  const ecf = eciToEcf({ x: au.x * AU_KM, y: au.y * AU_KM, z: au.z * AU_KM }, gmstFromMs(tMs));
  const la = lookAngles(obs, ecf);
  return { altDeg: la.elDeg, azDeg: la.azDeg };
}

export const sunAltDeg = (obs, tMs) => sunAltAz(obs, tMs).altDeg;

/** Standard altitudes of the Sun's centre (degrees). */
export const SUN_ALT = { rise: -0.833, civil: -6, nautical: -12, astronomical: -18 };

/**
 * Intervals in [t0, t1] when the Sun is below `altDeg` (default −6°: dark enough to see satellites).
 * Samples every 10 minutes, then bisects each boundary to 1 s.
 * @returns {{start: number, end: number}[]}
 */
export function darkWindows(obs, t0, t1, altDeg = SUN_ALT.civil, stepMs = 600_000) {
  const below = (t) => sunAltDeg(obs, t) < altDeg;
  const refine = (a, b) => {
    const fa = below(a);
    while (b - a > 1000) {
      const m = (a + b) / 2;
      if (below(m) === fa) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const out = [];
  let prevT = t0;
  let prev = below(t0);
  let start = prev ? t0 : null;
  for (let t = Math.min(t0 + stepMs, t1); ; t = Math.min(t + stepMs, t1)) {
    const cur = below(t);
    if (cur !== prev) {
      const edge = refine(prevT, t);
      if (cur) start = edge;
      else {
        out.push({ start, end: edge });
        start = null;
      }
    }
    prev = cur;
    prevT = t;
    if (t >= t1) break;
  }
  if (start !== null) out.push({ start, end: t1 });
  return out;
}

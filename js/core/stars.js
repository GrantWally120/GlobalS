// Real stars: catalogue positions, precession to the date, and colour from B−V.

import { jdFromMs } from './sat.js';

const ARCSEC = Math.PI / 648000;

/** Unit vector (ECI, equator/equinox of the catalogue) for right ascension / declination. */
export function raDecToUnit(raRad, decRad, out = [0, 0, 0], o = 0) {
  const c = Math.cos(decRad);
  out[o] = c * Math.cos(raRad);
  out[o + 1] = c * Math.sin(raRad);
  out[o + 2] = Math.sin(decRad);
  return out;
}

/**
 * IAU 1976 precession matrix (Lieske 1977), J2000 mean equator/equinox → mean equator/equinox of
 * date, row-major 3×3. In 2026 this moves stars by ≈0.37°; nutation (≤17″), aberration (≤20″)
 * and proper motion are deliberately ignored — far below what the globe can show.
 */
export function precessionMatrix(tMs) {
  const T = (jdFromMs(tMs) - 2451545.0) / 36525;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * ARCSEC;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * ARCSEC;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * ARCSEC;
  const cz = Math.cos(zeta), sz = Math.sin(zeta);
  const cZ = Math.cos(z), sZ = Math.sin(z);
  const ct = Math.cos(theta), st = Math.sin(theta);
  // P = R3(−z) · R2(θ) · R3(−ζ)
  return [
    cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st,
    sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st,
    st * cz, -st * sz, ct,
  ];
}

/** Apply a row-major 3×3 matrix to [x, y, z]. */
export function mat3Apply(m, [x, y, z]) {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/** d3-celestial stores RA as GeoJSON longitude in −180…180°. */
export const lonToRaDeg = (lon) => (lon < 0 ? lon + 360 : lon);

/**
 * Colour of a star from its B−V index: temperature (Ballesteros 2012) → Planckian locus
 * (Kim et al. 2002) → linear sRGB, normalised and softened toward white so it reads as starlight.
 * @returns {[number, number, number]} linear RGB in 0…1
 */
export function bvToRgb(bv) {
  const b = Number.isFinite(bv) ? Math.min(2.0, Math.max(-0.4, bv)) : 0.6;
  const T = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  const t = Math.min(25000, Math.max(1667, T));
  const x = t <= 4000
    ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039;
  let y;
  if (t <= 2222) y = -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683;
  else if (t <= 4000) y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  else y = 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  const X = x / y;
  const Z = (1 - x - y) / y;
  let r = 3.2406 * X - 1.5372 - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 + 0.0415 * Z;
  let bl = 0.0557 * X - 0.204 + 1.057 * Z;
  const m = Math.max(r, g, bl);
  r = Math.max(0, r / m);
  g = Math.max(0, g / m);
  bl = Math.max(0, bl / m);
  const soften = (c) => 0.45 * c + 0.55;
  return [soften(r), soften(g), soften(bl)];
}

/** Point radius in CSS px: area ∝ flux, so radius ∝ 10^(−0.2·m). */
export const magToSize = (mag) => Math.min(7, Math.max(1, 3.2 * 10 ** (-0.2 * (mag - 1))));

/** Opacity so faint stars recede without vanishing. */
export const magToAlpha = (mag) => Math.min(1, Math.max(0.15, 10 ** (-0.4 * (mag - 4))));

/**
 * Flatten d3-celestial's stars.6.json into typed arrays (J2000 unit vectors, magnitudes, colours).
 * @param {object} geojson FeatureCollection of Point features with properties { mag, bv }
 */
export function starBuffers(geojson, maxMag = 6.5) {
  const feats = geojson.features.filter((f) => Number.isFinite(f.properties?.mag) && f.properties.mag <= maxMag);
  const n = feats.length;
  const pos = new Float64Array(n * 3);
  const mag = new Float32Array(n);
  const color = new Float32Array(n * 3);
  feats.forEach((f, i) => {
    const [lon, lat] = f.geometry.coordinates;
    raDecToUnit((lonToRaDeg(lon) * Math.PI) / 180, (lat * Math.PI) / 180, pos, i * 3);
    mag[i] = f.properties.mag;
    const rgb = bvToRgb(Number.parseFloat(f.properties.bv));
    color.set(rgb, i * 3);
  });
  return { count: n, pos, mag, color };
}

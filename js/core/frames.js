// Coordinate frames — the ONLY place where Earth-centred axes are mapped to three.js scene axes.
//
// TEME/ECI and ECF use z = north. three.js uses y = up. We map (x, y, z) → (X, Y, Z) = (x, z, −y),
// i.e. M = Rx(−90°). det(M) = +1, so handedness is preserved, and M·Rz(θ)·M⁻¹ = Ry(θ):
// rotating the Earth group by +GMST about scene Y is exactly the ECF → ECI rotation SGP4 uses.
// Scene unit = one WGS-84 equatorial radius; all math stays in km and double precision.

export const ER_KM = 6378.137; // WGS-84 equatorial radius (km)
export const WGS84_F = 1 / 298.257223563;
export const WGS84_B = ER_KM * (1 - WGS84_F); // polar radius, 6356.752314 km
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** Earth's rotation rate relative to the mean equinox (rad/s), the rate of IAU-82 GMST. */
export const OMEGA_EARTH = 7.292115146706979e-5;
export const DEG = Math.PI / 180;
export const TWO_PI = 2 * Math.PI;

/** Earth-centred km → scene units, written into `out` at offset `o`. */
export function toScene(x, y, z, out = [0, 0, 0], o = 0) {
  out[o] = x / ER_KM;
  out[o + 1] = z / ER_KM;
  out[o + 2] = -y / ER_KM;
  return out;
}

/** Scene units → Earth-centred km. */
export function fromScene(X, Y, Z) {
  return { x: X * ER_KM, y: -Z * ER_KM, z: Y * ER_KM };
}

/** Rotate a vector about the z (north) axis by `theta` radians. */
export function rotZ(v, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y, z: v.z };
}

/** ECF → ECI (TEME) at Greenwich sidereal angle `gmst`. */
export const ecfToEci = (v, gmst) => rotZ(v, gmst);
/** ECI (TEME) → ECF at Greenwich sidereal angle `gmst`. */
export const eciToEcf = (v, gmst) => rotZ(v, -gmst);

/** Geodetic (WGS-84) → ECF km. */
export function geodeticToEcf(latRad, lonRad, hKm = 0) {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const N = ER_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (N + hKm) * cosLat * Math.cos(lonRad),
    y: (N + hKm) * cosLat * Math.sin(lonRad),
    z: (N * (1 - WGS84_E2) + hKm) * sinLat,
  };
}

/**
 * ECF km → geodetic { lat, lon (rad), h (km) } on WGS-84.
 * Iterative, using whichever height formula is well-conditioned, so it stays accurate over the
 * poles (where satellite.js's `R / cos(lat)` form loses precision) and on the equator.
 */
export function ecfToGeodetic({ x, y, z }) {
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat);
    const c = Math.cos(lat);
    const N = ER_KM / Math.sqrt(1 - WGS84_E2 * s * s);
    h = Math.abs(c) > 0.7 ? p / c - N : z / s - N * (1 - WGS84_E2);
    lat = Math.atan2(z, p * (1 - (WGS84_E2 * N) / (N + h)));
  }
  return { lat, lon, h };
}

/** Unit vector along the local vertical (ellipsoid normal) at a geodetic position, in ECF. */
export function geodeticNormal(latRad, lonRad) {
  const c = Math.cos(latRad);
  return { x: c * Math.cos(lonRad), y: c * Math.sin(lonRad), z: Math.sin(latRad) };
}

/** Geodetic degrees (+ height km) straight to scene units, for markers on the Earth group. */
export function geodeticToScene(latDeg, lonDeg, hKm = 0, out = [0, 0, 0], o = 0) {
  const e = geodeticToEcf(latDeg * DEG, lonDeg * DEG, hKm);
  return toScene(e.x, e.y, e.z, out, o);
}

/** Angle wrapped into [0, 2π). */
export const wrapTwoPi = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
/** Angle wrapped into [−π, π). */
export const wrapPi = (a) => wrapTwoPi(a + Math.PI) - Math.PI;

export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const norm = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const unit = (a) => {
  const n = norm(a);
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};
export const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

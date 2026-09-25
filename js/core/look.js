// Topocentric look angles from a ground observer (azimuth from true north, clockwise).

import { DEG, OMEGA_EARTH, geodeticToEcf } from './frames.js';

/**
 * A ground observer with everything the hot loops need precomputed.
 * @param {number} latDeg geodetic latitude (WGS-84)
 * @param {number} lonDeg east longitude
 * @param {number} hKm height above the ellipsoid
 */
export function makeObserver(latDeg, lonDeg, hKm = 0, name = '') {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return {
    name,
    latDeg,
    lonDeg,
    hKm,
    lat,
    lon,
    ecf: geodeticToEcf(lat, lon, hKm),
    sLat: Math.sin(lat),
    cLat: Math.cos(lat),
    sLon: Math.sin(lon),
    cLon: Math.cos(lon),
  };
}

/** South-East-Zenith components of an ECF vector relative to the observer. */
function sez(obs, dx, dy, dz) {
  return {
    s: obs.sLat * obs.cLon * dx + obs.sLat * obs.sLon * dy - obs.cLat * dz,
    e: -obs.sLon * dx + obs.cLon * dy,
    z: obs.cLat * obs.cLon * dx + obs.cLat * obs.sLon * dy + obs.sLat * dz,
  };
}

/**
 * Azimuth/elevation/range of an ECF position (km). If an ECF velocity (km/s, rotating frame) is
 * given, the range-rate is included (positive = receding).
 */
export function lookAngles(obs, rEcf, vEcf) {
  const dx = rEcf.x - obs.ecf.x;
  const dy = rEcf.y - obs.ecf.y;
  const dz = rEcf.z - obs.ecf.z;
  const t = sez(obs, dx, dy, dz);
  const rangeKm = Math.sqrt(t.s * t.s + t.e * t.e + t.z * t.z);
  let az = Math.atan2(t.e, -t.s);
  if (az < 0) az += 2 * Math.PI;
  const out = { azDeg: az / DEG, elDeg: Math.asin(t.z / rangeKm) / DEG, rangeKm };
  if (vEcf) out.rangeRateKms = (dx * vEcf.x + dy * vEcf.y + dz * vEcf.z) / rangeKm;
  return out;
}

/** Elevation only (degrees) — the pass finder's hot path. */
export function elevationDeg(obs, rEcf) {
  const dx = rEcf.x - obs.ecf.x;
  const dy = rEcf.y - obs.ecf.y;
  const dz = rEcf.z - obs.ecf.z;
  const up = obs.cLat * obs.cLon * dx + obs.cLat * obs.sLon * dy + obs.sLat * dz;
  return Math.asin(up / Math.sqrt(dx * dx + dy * dy + dz * dz)) / DEG;
}

/**
 * Velocity in the rotating ECF frame from an inertial (TEME) velocity already rotated into ECF
 * axes: v_ecf = R·v_eci − ω × r_ecf.
 */
export function inertialToRotatingVelocity(vRotatedAxes, rEcf) {
  return {
    x: vRotatedAxes.x + OMEGA_EARTH * rEcf.y,
    y: vRotatedAxes.y - OMEGA_EARTH * rEcf.x,
    z: vRotatedAxes.z,
  };
}

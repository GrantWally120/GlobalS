// Orbit-level facts and sampled geometry for one satellite.

import { DEG, ER_KM, eciToEcf, ecfToGeodetic, geodeticToEcf } from './frames.js';
import { elevationDeg, makeObserver } from './look.js';
import { gmstFromMs, propagateMs } from './sat.js';

/** SGP4 works in WGS-72 Earth radii (satellite.js `earthRadius`). */
const SGP4_RE_KM = 6378.135;

/** Mean motion in revolutions per day (from SGP4's un-Kozai'd mean motion, rad/min). */
export const revsPerDay = (rec) => (rec.satrec.no * 1440) / (2 * Math.PI);

/** Orbital period in seconds. */
export const periodSec = (rec) => ((2 * Math.PI) / rec.satrec.no) * 60;

/** Semi-major axis and apogee/perigee altitudes above the equatorial radius (km). */
export function apsides(rec) {
  const s = rec.satrec;
  return { aKm: s.a * SGP4_RE_KM, apogeeKm: s.alta * SGP4_RE_KM, perigeeKm: s.altp * SGP4_RE_KM };
}

/**
 * Orbit regime: LEO (apogee < 2,000 km), GEO (geostationary: ~1 rev/day, e < 0.01, i < 15°),
 * GSO (other geosynchronous), HEO (e ≥ 0.25), otherwise MEO.
 */
export function orbitClass(rec) {
  const n = revsPerDay(rec);
  const e = rec.satrec.ecco;
  const iDeg = rec.satrec.inclo / DEG;
  const { apogeeKm } = apsides(rec);
  if (n > 0.99 && n < 1.01) return e < 0.01 && iDeg < 15 ? 'GEO' : 'GSO';
  if (e >= 0.25) return 'HEO';
  if (apogeeKm < 2000) return 'LEO';
  return 'MEO';
}

/**
 * One revolution of positions in ECI (km), centred on `tMs` — the orbit's shape in space.
 * @returns {Float64Array} xyz triples; failed samples are skipped.
 */
export function sampleOrbitEci(rec, tMs, samples) {
  const P = periodSec(rec) * 1000;
  const n = samples ?? (rec.satrec.ecco > 0.3 ? 720 : 360);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const pv = propagateMs(rec, tMs - P / 2 + (P * i) / n);
    if (pv) out.push(pv.r.x, pv.r.y, pv.r.z);
  }
  return Float64Array.from(out);
}

/**
 * Sub-satellite points (geodetic) between t0 and t1.
 * @returns {{t: number, latDeg: number, lonDeg: number, hKm: number}[]}
 */
export function sampleGroundTrack(rec, t0, t1, stepMs) {
  const step = stepMs ?? Math.min(20_000, (periodSec(rec) * 1000) / 180);
  const out = [];
  for (let t = t0; t <= t1 + 1e-6; t += step) {
    const pv = propagateMs(rec, t);
    if (!pv) continue;
    const g = ecfToGeodetic(eciToEcf(pv.r, gmstFromMs(t)));
    out.push({ t, latDeg: g.lat / DEG, lonDeg: g.lon / DEG, hKm: g.h });
  }
  return out;
}

/** Point reached from (lat, lon) after travelling angular distance `c` on bearing `az` (sphere). */
export function destination(latRad, lonRad, azRad, c) {
  const lat = Math.asin(Math.sin(latRad) * Math.cos(c) + Math.cos(latRad) * Math.sin(c) * Math.cos(azRad));
  const lon = lonRad + Math.atan2(Math.sin(azRad) * Math.sin(c) * Math.cos(latRad),
    Math.cos(c) - Math.sin(latRad) * Math.sin(lat));
  return { lat, lon };
}

/**
 * Footprint: the ring of ground points that see the satellite at exactly `minElDeg` elevation.
 * Solved with the same look-angle function the pass finder uses, so an observer enters the
 * footprint at the very moment a pass "rises".
 * @param {{x: number, y: number, z: number}} satEcf satellite position, km
 * @returns {{latDeg: number, lonDeg: number}[]} ring (closed: last point equals first)
 */
export function footprintRing(satEcf, minElDeg = 0, points = 90) {
  const sub = ecfToGeodetic(satEcf);
  const r = Math.hypot(satEcf.x, satEcf.y, satEcf.z);
  // Spherical horizon angle is an upper bound for the search.
  const cMax = Math.acos(Math.min(1, ER_KM / r)) + 0.05;
  const ring = [];
  for (let k = 0; k <= points; k++) {
    const az = (2 * Math.PI * (k % points)) / points;
    const elAt = (c) => {
      const p = destination(sub.lat, sub.lon, az, c);
      return elevationDeg(makeObserverFast(p.lat, p.lon), satEcf);
    };
    let lo = 0;
    let hi = cMax;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (elAt(mid) > minElDeg) lo = mid;
      else hi = mid;
    }
    const p = destination(sub.lat, sub.lon, az, (lo + hi) / 2);
    ring.push({ latDeg: p.lat / DEG, lonDeg: p.lon / DEG });
  }
  return ring;
}

/** Observer at sea level from radians, skipping makeObserver's degree bookkeeping. */
function makeObserverFast(lat, lon) {
  const o = makeObserver(0, 0, 0);
  o.lat = lat;
  o.lon = lon;
  o.sLat = Math.sin(lat);
  o.cLat = Math.cos(lat);
  o.sLon = Math.sin(lon);
  o.cLon = Math.cos(lon);
  o.ecf = geodeticToEcf(lat, lon, 0);
  return o;
}

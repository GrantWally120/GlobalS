// Deterministic DEMO satellites for local development and performance tests — never deployed as
// data. Shells mimic real constellations (inclination, altitude, planes) so the globe looks
// plausible, but every name carries "DEMO" and the app shows a DEMO DATA badge.

const MU = 398600.4418; // km³/s²
const RE = 6378.137;

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean motion (rev/day) of a circular orbit at `altKm`. */
export const revsPerDayAt = (altKm) => 86400 / (2 * Math.PI * Math.sqrt((RE + altKm) ** 3 / MU));

const SHELLS = [
  // name prefix, planes, per plane, inclination, altitude (km), weight
  ['STARLINK-DEMO', 72, 22, 53.0, 550, 1],
  ['STARLINK-DEMO', 36, 20, 43.0, 540, 1],
  ['STARLINK-DEMO', 28, 20, 97.6, 560, 1],
  ['ONEWEB-DEMO', 18, 36, 87.9, 1200, 1],
  ['KUIPER-DEMO', 34, 10, 51.9, 630, 1],
  ['NAVSTAR-DEMO', 6, 5, 55.0, 20180, 1],
  ['GALILEO-DEMO', 3, 8, 56.0, 23222, 1],
  ['GLONASS-DEMO', 3, 8, 64.8, 19130, 1],
];

/**
 * @param {number} count approximate number of objects wanted
 * @param {string} epoch OMM EPOCH for every generated object
 * @returns {object[]} OMM records (NORAD ids 900000+; names contain "DEMO")
 */
export function syntheticOmms(count = 6000, epoch = '2026-09-24T12:00:00.000000', seed = 7) {
  const rand = mulberry32(seed);
  const out = [];
  let id = 900000;
  const push = (name, n, e, i, raan, argp, m, bstar) => {
    out.push({
      OBJECT_NAME: name, OBJECT_ID: `DEMO-${id}`, NORAD_CAT_ID: id++, EPOCH: epoch,
      MEAN_MOTION: +n.toFixed(8), ECCENTRICITY: +e.toFixed(7), INCLINATION: +i.toFixed(4),
      RA_OF_ASC_NODE: +(((raan % 360) + 360) % 360).toFixed(4), ARG_OF_PERICENTER: +argp.toFixed(4),
      MEAN_ANOMALY: +(((m % 360) + 360) % 360).toFixed(4), BSTAR: bstar, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
    });
  };
  const shellTotal = SHELLS.reduce((s, [, p, k]) => s + p * k, 0);
  const scale = Math.min(1, (count * 0.8) / shellTotal);
  for (const [prefix, planes, perPlane, inc, alt] of SHELLS) {
    const nPlanes = Math.max(1, Math.round(planes * Math.sqrt(scale)));
    const nPer = Math.max(1, Math.round(perPlane * Math.sqrt(scale)));
    for (let p = 0; p < nPlanes; p++) {
      for (let k = 0; k < nPer; k++) {
        push(`${prefix}-${String(out.length + 1).padStart(4, '0')}`, revsPerDayAt(alt + (rand() - 0.5) * 4),
          0.0001 + rand() * 0.0004, inc, (360 * p) / nPlanes, rand() * 360, (360 * k) / nPer + (p * 360) / (nPlanes * nPer),
          alt < 2000 ? 1e-4 : 0);
      }
    }
  }
  // Geostationary belt.
  for (let k = 0; k < Math.round(count * 0.05); k++) {
    push(`GEO-DEMO-${k + 1}`, 1.00273791, rand() * 0.0005, rand() * 0.1, rand() * 360, rand() * 360, rand() * 360, 0);
  }
  // Scattered LEO payloads and a few Molniya-like orbits fill the rest.
  while (out.length < count) {
    const alt = 350 + rand() ** 2 * 1200;
    if (rand() < 0.01) {
      push(`MOLNIYA-DEMO-${out.length}`, 2.00607, 0.72, 63.4, rand() * 360, 270, rand() * 360, 0);
      continue;
    }
    push(`DEMO SAT ${out.length}`, revsPerDayAt(alt), rand() * 0.01, rand() < 0.4 ? 97 + rand() * 2 : rand() * 100,
      rand() * 360, rand() * 360, rand() * 360, 1e-4);
  }
  return out.slice(0, count);
}

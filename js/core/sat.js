// The only doorway to SGP4 in GlobalS: a thin facade over the vendored satellite.js 7.1.0 modules.
//
// satellite.js's own index.js is intentionally NOT used — it re-exports WASM runtimes whose
// `#wasm-*` imports only resolve inside Node. The files imported here are pure ES modules with
// relative imports, so this facade works unchanged in browsers, module workers and Node tests.
//
// Conventions for all of js/core: times are UTC milliseconds (Number), distances km,
// velocities km/s, angles radians unless a name ends in Deg.

import { json2satrec, twoline2satrec } from '../../vendor/satellite.js/dist/io.js';
import { gstime, sgp4 } from '../../vendor/satellite.js/dist/propagation.js';
import { checkForDecay } from '../../vendor/satellite.js/dist/propagation/check-for-decay.js';
import { SatRecError } from '../../vendor/satellite.js/dist/propagation/SatRec.js';

export { eciToEcf, ecfToEci, ecfToLookAngles, geodeticToEcf } from '../../vendor/satellite.js/dist/transforms.js';
export { sunPos } from '../../vendor/satellite.js/dist/sun.js';
export { shadowFraction } from '../../vendor/satellite.js/dist/shadow.js';
export { json2satrec, twoline2satrec, gstime, sgp4, checkForDecay, SatRecError };

export const MS_PER_MIN = 60_000;
export const MS_PER_DAY = 86_400_000;
/** Julian Date of the Unix epoch (1970-01-01T00:00:00Z). */
export const JD_UNIX_EPOCH = 2_440_587.5;

const EPOCH_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z?$/;

/**
 * Exact UTC milliseconds for an OMM EPOCH such as "2026-09-20T11:22:17.431104".
 * Keeps the sub-millisecond digits as a fraction, which `Date` would silently drop.
 * @returns {number} NaN when the string is not a valid OMM epoch.
 */
export function epochToMs(epoch) {
  const m = EPOCH_RE.exec(String(epoch).trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s, frac = ''] = m;
  const whole = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  return frac ? whole + Number(`0.${frac}`) * 1000 : whole;
}

/** EPOCH rewritten as "YYYY-MM-DDTHH:MM:SS.sssZ", the only form every JS engine must parse identically. */
export function normalizeEpoch(epoch) {
  const ms = epochToMs(epoch);
  return Number.isFinite(ms) ? new Date(Math.floor(ms)).toISOString() : String(epoch);
}

/**
 * Initialise SGP4 from one OMM record (CelesTrak `FORMAT=json`).
 * @returns {{satrec: object, id: number, name: string, cospar: string, epochMs: number} | null}
 */
export function recFromOmm(omm) {
  if (!omm || omm.NORAD_CAT_ID === undefined || omm.EPOCH === undefined) return null;
  const epochMs = epochToMs(omm.EPOCH);
  const id = Number(omm.NORAD_CAT_ID);
  if (!Number.isFinite(epochMs) || !Number.isInteger(id)) return null;
  let satrec;
  try {
    satrec = json2satrec({ ...omm, EPOCH: normalizeEpoch(omm.EPOCH) });
  } catch {
    return null;
  }
  if (!satrec || satrec.error) return null;
  return {
    satrec,
    id,
    name: String(omm.OBJECT_NAME ?? '').trim(),
    cospar: String(omm.OBJECT_ID ?? '').trim(),
    epochMs,
  };
}

/**
 * Initialise SGP4 from a two-line element set. `id` must already be decoded (Alpha-5 aware).
 * @returns {{satrec: object, id: number, name: string, cospar: string, epochMs: number} | null}
 */
export function recFromTle(name, line1, line2, id) {
  let satrec;
  try {
    satrec = twoline2satrec(line1, line2);
  } catch {
    return null;
  }
  if (!satrec || satrec.error || !Number.isFinite(satrec.jdsatepoch)) return null;
  const epochMs = (satrec.jdsatepoch - JD_UNIX_EPOCH) * MS_PER_DAY;
  return { satrec, id, name: String(name ?? '').trim(), cospar: cosparFromTle(line1), epochMs };
}

function cosparFromTle(line1) {
  const raw = line1.substring(9, 17).trim(); // e.g. "98067A"
  const m = /^(\d{2})(\d{3})([A-Z]{1,3})$/.exec(raw);
  if (!m) return raw;
  const yy = Number(m[1]);
  return `${yy < 57 ? 2000 + yy : 1900 + yy}-${m[2]}${m[3]}`;
}

/** Minutes since the element epoch, the time argument SGP4 expects. */
export const tsinceMin = (rec, tMs) => (tMs - rec.epochMs) / MS_PER_MIN;

/**
 * Propagate to time `tMs`. Returns TEME position (km) and velocity (km/s), or null when SGP4
 * reports an error or the community decay check says the object has re-entered.
 */
export function propagateMs(rec, tMs) {
  const pv = sgp4(rec.satrec, tsinceMin(rec, tMs));
  if (!pv || !pv.position || checkForDecay(rec.satrec)) return null;
  const { position: r, velocity: v } = pv;
  if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.z)) return null;
  return { r, v };
}

/** Julian Date (UTC ≈ UT1; |UT1−UTC| ≤ 0.9 s) for a UTC millisecond timestamp. */
export const jdFromMs = (tMs) => tMs / MS_PER_DAY + JD_UNIX_EPOCH;

/** Greenwich Mean Sidereal Time (IAU-82, the model SGP4's TEME frame is defined with), radians. */
export const gmstFromMs = (tMs) => gstime(jdFromMs(tMs));

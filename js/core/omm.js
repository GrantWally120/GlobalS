// Orbital element records: validation, TLE parsing (Alpha-5 aware), de-duplication.

import { epochToMs } from './sat.js';

/** The OMM fields GlobalS keeps. json2satrec reads the last eleven; name/COSPAR are for people. */
export const OMM_FIELDS = [
  'OBJECT_NAME', 'OBJECT_ID', 'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION',
  'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
];

const EPOCH_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

/**
 * Sanity-check one OMM record. Returns null if usable, otherwise a short reason.
 * @param {object} o
 */
export function validateOmm(o) {
  if (!o || typeof o !== 'object') return 'not an object';
  const id = Number(o.NORAD_CAT_ID);
  if (!Number.isInteger(id) || id < 1 || id >= 1e9) return 'bad NORAD_CAT_ID';
  if (typeof o.EPOCH !== 'string' || !EPOCH_RE.test(o.EPOCH) || !Number.isFinite(epochToMs(o.EPOCH))) return 'bad EPOCH';
  const n = Number(o.MEAN_MOTION);
  if (!(n > 0 && n < 20)) return 'bad MEAN_MOTION';
  const e = Number(o.ECCENTRICITY);
  if (!(e >= 0 && e < 1)) return 'bad ECCENTRICITY';
  const inc = Number(o.INCLINATION);
  if (!(inc >= 0 && inc <= 180)) return 'bad INCLINATION';
  for (const k of ['RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY']) {
    const v = Number(o[k]);
    if (!(v >= 0 && v <= 360)) return `bad ${k}`;
  }
  for (const k of ['BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT']) {
    if (!Number.isFinite(Number(o[k] ?? 0))) return `bad ${k}`;
  }
  if (o.EPHEMERIS_TYPE !== undefined && Number(o.EPHEMERIS_TYPE) !== 0) return 'not an SGP4 element set';
  return null;
}

/** Keep only the fields GlobalS uses (numbers stay exactly as published). */
export function compactOmm(o) {
  const out = {};
  for (const k of OMM_FIELDS) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/** When two records share a catalog number, keep the one with the newest epoch. */
export function dedupeById(records) {
  const best = new Map();
  for (const r of records) {
    const id = Number(r.NORAD_CAT_ID);
    const prev = best.get(id);
    if (!prev || epochToMs(r.EPOCH) > epochToMs(prev.EPOCH)) best.set(id, r);
  }
  return [...best.values()];
}

const ALPHA5 = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // A=10 … Z=33, skipping I and O

/**
 * Catalog number from a TLE's 5-character field, including the Alpha-5 scheme used for
 * numbers ≥ 100000 ("A0000" = 100000, "Z9999" = 339999).
 * @returns {number} NaN when the field is invalid
 */
export function decodeAlpha5(field) {
  const s = String(field).trim().toUpperCase();
  if (/^\d{1,5}$/.test(s)) return Number(s);
  const m = /^([A-HJ-NP-Z])(\d{4})$/.exec(s);
  if (!m) return NaN;
  return (ALPHA5.indexOf(m[1]) + 10) * 10000 + Number(m[2]);
}

/** Modulo-10 checksum of a TLE line (digits count their value, '-' counts 1). */
export function tleChecksum(line) {
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += ch.charCodeAt(0) - 48;
    else if (ch === '-') sum += 1;
  }
  return sum % 10;
}

/**
 * Parse 2-line or 3-line element text (CelesTrak, Space-Track, N2YO, …).
 * @returns {{sets: {name: string, line1: string, line2: string, id: number, checksumOk: boolean}[], errors: string[]}}
 */
export function parseTleText(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const sets = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.startsWith('1 ')) continue;
    const l2 = lines[i + 1];
    if (!l2 || !l2.startsWith('2 ')) {
      errors.push(`line ${i + 1}: line 1 without a matching line 2`);
      continue;
    }
    const prev = i > 0 ? lines[i - 1] : '';
    const name = prev && !prev.startsWith('1 ') && !prev.startsWith('2 ') ? prev.replace(/^0 /, '').trim() : '';
    const id = decodeAlpha5(l.substring(2, 7));
    if (!Number.isFinite(id) || id !== decodeAlpha5(l2.substring(2, 7))) {
      errors.push(`line ${i + 1}: catalog numbers on lines 1 and 2 differ or are invalid`);
      i++;
      continue;
    }
    const checksumOk = tleChecksum(l) === Number(l[68]) && tleChecksum(l2) === Number(l2[68]);
    sets.push({ name: name || `CATALOG ${id}`, line1: l.slice(0, 69), line2: l2.slice(0, 69), id, checksumOk });
    i++;
  }
  return { sets, errors };
}

/**
 * Recognise what a user dropped in: an OMM JSON array/object, or TLE text.
 * @returns {'omm'|'tle'|null}
 */
export function sniffFormat(text) {
  const s = String(text).trimStart();
  if (s.startsWith('[') || s.startsWith('{')) return 'omm';
  if (/^(.*\n)?1 [0-9A-Z ]{5}[A-Z ] /m.test(s)) return 'tle';
  return null;
}

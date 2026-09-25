// Time utilities: sidereal time, time zones, and URL time parameters. All instants are UTC ms.

import { wrapTwoPi } from './frames.js';
import { gmstFromMs, jdFromMs } from './sat.js';

export { gmstFromMs, jdFromMs };

/** Local (apparent-mean) sidereal time at east longitude `lonRad`, radians in [0, 2π). */
export const lstRad = (tMs, lonRad) => wrapTwoPi(gmstFromMs(tMs) + lonRad);

/** Radians of hour angle → hours in [0, 24). */
export const radToHours = (r) => (wrapTwoPi(r) * 12) / Math.PI;

/** Hours → "HH:MM:SS" (wraps at 24 h; rounds to the nearest second without printing "24:00:00"). */
export function hoursToHms(hours) {
  let s = Math.round((((hours % 24) + 24) % 24) * 3600) % 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const dtfCache = new Map();
function partsFormatter(timeZone) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of instant `tMs` in an IANA time zone. */
export function zonedParts(tMs, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(tMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out; // { year, month, day, hour, minute, second }
}

/** Offset of `timeZone` from UTC at instant `tMs`, in minutes (Asia/Manila → +480). */
export function tzOffsetMinutes(tMs, timeZone) {
  const p = zonedParts(tMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(tMs / 1000) * 1000) / 60000);
}

/** Wall-clock time in `timeZone` → UTC ms. Two passes resolve DST transitions. */
export function zonedToUtcMs(year, month, day, hour = 0, minute = 0, second = 0, timeZone = 'UTC') {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let t = guess - tzOffsetMinutes(guess, timeZone) * 60000;
  t = guess - tzOffsetMinutes(t, timeZone) * 60000;
  return t;
}

/** "UTC+8", "UTC−3:30", "UTC" for an offset in minutes. */
export function formatUtcOffset(minutes) {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parse a time given in a URL or input field. Accepts "now" and ISO 8601 dates/times with an
 * optional Z or ±hh:mm offset; a time without an offset is read in `timeZone`.
 * @returns {number} UTC ms, or NaN.
 */
export function parseTimeParam(value, nowMs, timeZone = 'UTC') {
  const s = String(value ?? '').trim();
  if (!s || s.toLowerCase() === 'now') return nowMs;
  const m = ISO_RE.exec(s);
  if (!m) return NaN;
  const [, y, mo, d, h = '0', mi = '0', sec = '0', frac = '', zone] = m;
  const ms = frac ? Number(`0.${frac}`) * 1000 : 0;
  if (!zone) return zonedToUtcMs(+y, +mo, +d, +h, +mi, +sec, timeZone) + ms;
  const base = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) + ms;
  if (zone === 'Z') return base;
  const zm = /([+-])(\d{2}):?(\d{2})/.exec(zone);
  const off = (Number(zm[2]) * 60 + Number(zm[3])) * (zm[1] === '+' ? 1 : -1);
  return base - off * 60000;
}

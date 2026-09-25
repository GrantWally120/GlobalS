// Human-readable formatting shared by the UI (pure; tested in Node).

import { formatUtcOffset, tzOffsetMinutes, zonedParts } from './time.js';

const nf = new Intl.NumberFormat('en-US');
export const fmtInt = (n) => (Number.isFinite(n) ? nf.format(Math.round(n)) : '—');
export const fmtNum = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '—');
export const fmtKm = (km, digits = 0) => (Number.isFinite(km) ? `${nf.format(Number(km.toFixed(digits)))} km` : '—');
export const fmtDeg = (deg, digits = 1) => (Number.isFinite(deg) ? `${deg.toFixed(digits)}°` : '—');
export const fmtLat = (deg, digits = 3) => (Number.isFinite(deg) ? `${Math.abs(deg).toFixed(digits)}° ${deg >= 0 ? 'N' : 'S'}` : '—');
export const fmtLon = (deg, digits = 3) => (Number.isFinite(deg) ? `${Math.abs(deg).toFixed(digits)}° ${deg >= 0 ? 'E' : 'W'}` : '—');

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** 16-point compass direction for an azimuth. */
export const compass = (azDeg) => POINTS[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];

/** "5 min 42 s", "11 h 24 min", "2 d 3 h". */
export function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.round(Math.abs(sec));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`;
}

/** "just now", "12 min ago", "3 h ago", "2.4 days ago". */
export function fmtAge(hours) {
  if (!Number.isFinite(hours)) return '—';
  if (hours < 0.02) return 'just now';
  if (hours < 1) return `${Math.round(hours * 60)} min ago`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h ago`;
  return `${(hours / 24).toFixed(1)} days ago`;
}

/** Warp rate label: "Paused", "1×", "60×", "−10×". */
export function fmtRate(rate) {
  if (rate === 0) return 'Paused';
  const a = Math.abs(rate);
  return `${rate < 0 ? '−' : ''}${a >= 1 ? nf.format(a) : a}×`;
}

const pad = (n) => String(n).padStart(2, '0');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "HH:MM:SS" in a time zone. */
export function fmtClock(tMs, timeZone = 'UTC') {
  const p = zonedParts(tMs, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** "HH:MM" in a time zone. */
export function fmtHm(tMs, timeZone = 'UTC') {
  const p = zonedParts(tMs, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "Thu 25 Sep 2026" in a time zone. */
export function fmtDate(tMs, timeZone = 'UTC') {
  const p = zonedParts(tMs, timeZone);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return `${DOW[dow]} ${p.day} ${MON[p.month - 1]} ${p.year}`;
}

/** "Thu 25 Sep" (no year). */
export function fmtDayShort(tMs, timeZone = 'UTC') {
  return fmtDate(tMs, timeZone).replace(/ \d{4}$/, '');
}

/** Value for <input type="datetime-local"> in a time zone. */
export function dateTimeLocalValue(tMs, timeZone = 'UTC') {
  const p = zonedParts(tMs, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** "UTC+8" for a time zone at an instant. */
export const zoneLabel = (tMs, timeZone) => formatUtcOffset(tzOffsetMinutes(tMs, timeZone));

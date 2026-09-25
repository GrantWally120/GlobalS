// Finds GlobalS's orbital data and measures how far the device clock is off.
//
// Order: this site's own ./data/ (GitHub Pages) → the public GlobalS feed (when running from
// elsewhere, e.g. a local copy) → DEMO fixtures on localhost or with ?data=fixtures.

import { FEED_URL } from '../config.js';

/** Service-worker responses served from cache carry this header, so their Date is ignored. */
export const FROM_CACHE_HEADER = 'x-globals-from-cache';

/**
 * Device clock error from a same-origin response's Date header (1 s resolution).
 * Returns 0 when within the measurement noise, unknowable, or implausible (a cached response).
 */
export function clockOffsetFrom(res, sentAt, receivedAt) {
  if (res.headers.get(FROM_CACHE_HEADER)) return 0;
  const server = Date.parse(res.headers.get('date') ?? '');
  if (!Number.isFinite(server)) return 0;
  const offset = server + 500 - (sentAt + receivedAt) / 2; // true instant is ~0.5 s after the whole second
  if (Math.abs(offset) < 2000 || Math.abs(offset) > 30 * 60e3) return 0;
  return offset;
}

/**
 * @param {URLSearchParams} params
 * @returns {Promise<{source: 'site'|'feed'|'demo', base: string, manifest: object, clockOffsetMs: number} | null>}
 */
export async function resolveData(params, { isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) } = {}) {
  const here = location.href;
  const candidates = [];
  if (params.get('data') === 'fixtures') candidates.push(['demo', './fixtures/data/']);
  else {
    candidates.push(['site', './data/']);
    if (!here.startsWith(FEED_URL.replace(/data\/$/, ''))) candidates.push(['feed', FEED_URL]);
    if (isLocal) candidates.push(['demo', './fixtures/data/']);
  }
  for (const [source, dir] of candidates) {
    const base = new URL(dir, here).href;
    const sentAt = Date.now();
    try {
      const res = await fetch(new URL('manifest.json', base), { cache: 'no-cache' });
      const receivedAt = Date.now();
      if (!res.ok) continue;
      const manifest = await res.json();
      if (!manifest?.files?.catalog) continue;
      return {
        source: manifest.demo ? 'demo' : source,
        base,
        manifest,
        clockOffsetMs: source === 'feed' ? 0 : clockOffsetFrom(res, sentAt, receivedAt),
      };
    } catch {
      // try the next source
    }
  }
  return null;
}

/** Age of the data in hours, from the manifest's generation time. */
export const dataAgeHours = (manifest, nowMs) => (nowMs - Date.parse(manifest.generatedAt)) / 3600e3;

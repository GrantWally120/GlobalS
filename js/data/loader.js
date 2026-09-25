// Finds GlobalS's orbital data and measures how far the device clock is off.
//
// Order: this site's own ./data/ (GitHub Pages) → the GlobalS data feed (the single-file version,
// local copies) → DEMO fixtures on localhost or with ?data=fixtures.

import { FEED_URLS } from '../config.js';

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

/** Where to look for data, in order: [source, folder URL]. */
export function dataCandidates(params, { isLocal, single, here }) {
  const candidates = [];
  if (params.get('data') === 'fixtures') return [['demo', './fixtures/data/']];
  if (!single) candidates.push(['site', './data/']); // a file:// page can't read its own folder
  for (const url of FEED_URLS) if (!here.startsWith(url.replace(/data\/$/, ''))) candidates.push(['feed', url]);
  if (isLocal) candidates.push(['demo', './fixtures/data/']);
  return candidates;
}

/**
 * @param {URLSearchParams} params
 * @returns {Promise<{source: 'site'|'feed'|'demo', base: string, manifest: object, clockOffsetMs: number, clockChecked: boolean} | null>}
 */
export async function resolveData(params, {
  isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname),
  single = !!globalThis.GLOBALS_SINGLE,
  here = location.href,
  fetchImpl = globalThis.fetch,
} = {}) {
  for (const [source, dir] of dataCandidates(params, { isLocal, single, here })) {
    const base = new URL(dir, here).href;
    const sentAt = Date.now();
    try {
      const res = await fetchImpl(new URL('manifest.json', base), { cache: 'no-cache', signal: AbortSignal.timeout(12_000) });
      const receivedAt = Date.now();
      if (!res.ok) continue;
      const manifest = await res.json();
      if (!manifest?.files?.catalog) continue;
      // Only a same-origin response lets us read its Date header (and not one the service worker kept).
      const clockChecked = source !== 'feed' && !res.headers.get(FROM_CACHE_HEADER) && Number.isFinite(Date.parse(res.headers.get('date') ?? ''));
      return {
        source: manifest.demo ? 'demo' : source,
        base,
        manifest,
        clockOffsetMs: clockChecked ? clockOffsetFrom(res, sentAt, receivedAt) : 0,
        clockChecked,
      };
    } catch {
      // unreachable or too slow: try the next source
    }
  }
  return null;
}

/** Age of the data in hours, from the manifest's generation time. */
export const dataAgeHours = (manifest, nowMs) => (nowMs - Date.parse(manifest.generatedAt)) / 3600e3;

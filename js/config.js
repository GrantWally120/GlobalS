// GlobalS configuration — the few numbers and names worth changing live here.

export const APP_NAME = 'GlobalS';
export const APP_VERSION = '2.0.0';

/** Source code, issues and the full credits (ATTRIBUTION.md). */
export const REPO_URL = 'https://github.com/GrantWally120/GlobalS';

/**
 * The GlobalS data feed, refreshed every 6 hours by .github/workflows/publish.yml. Used by the
 * downloadable single-file version and local copies; tried in order. (All three allow requests
 * from any page — CelesTrak itself doesn't, so browsers can't read it directly.)
 */
export const FEED_URLS = [
  'https://raw.githubusercontent.com/GrantWally120/GlobalS/data/',
  'https://cdn.jsdelivr.net/gh/GrantWally120/GlobalS@data/',
  'https://grantwally120.github.io/GlobalS/data/',
];

/** Default observer: Cebu City, Philippines (Wikipedia: 10°17′35″N 123°54′07″E, 34 m). */
export const DEFAULT_OBSERVER = {
  name: 'Cebu City',
  latDeg: 10.29306,
  lonDeg: 123.90194,
  hKm: 0.034,
  timeZone: 'Asia/Manila',
};

/** Colours are sRGB hex (converted to linear for WebGL); `alpha` dims crowded constellations. */
export const CATEGORY_STYLE = {
  stations: { color: '#ffb547', alpha: 1, size: 1.5 },
  gnss: { color: '#5cffb1', alpha: 1, size: 1.2 },
  weather: { color: '#ffe066', alpha: 1, size: 1.1 },
  science: { color: '#ff5fa8', alpha: 1, size: 1.1 },
  amateur: { color: '#ff8a4c', alpha: 1, size: 1.0 },
  starlink: { color: '#4ff0ff', alpha: 0.55, size: 0.85 },
  oneweb: { color: '#7aa7ff', alpha: 0.7, size: 0.9 },
  kuiper: { color: '#c38bff', alpha: 0.8, size: 0.9 },
  megacon: { color: '#9ec9ff', alpha: 0.7, size: 0.9 },
  geo: { color: '#d8eef7', alpha: 0.9, size: 1.0 },
  other: { color: '#7f9bb3', alpha: 0.75, size: 0.9 },
};

export const ORBIT_CLASSES = ['LEO', 'MEO', 'GEO', 'GSO', 'HEO'];

export const PASS_DEFAULTS = {
  minElDeg: 10, // rise/set threshold; 10° clears most buildings and trees
  days: 7, // selected satellite: how far ahead to predict
  sunAltMaxDeg: -6, // sky counts as dark once the Sun is 6° below the horizon (civil dusk)
  tonightNights: 2,
};

/** Data-age thresholds for the top-bar badge (hours) and element-set warnings (days). */
export const DATA_AGE = { amberHours: 8, redHours: 48 };
export const ELEMENT_AGE_WARN_DAYS = { nearEarth: 3, deepSpace: 14 };

/** Satellites currently above this elevation count as "overhead". */
export const OVERHEAD_MIN_EL = 0;

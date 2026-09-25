// Settings (saved in this browser only) and a small event bus.

import { DEFAULT_OBSERVER, PASS_DEFAULTS } from '../config.js';

const KEY = 'globals.settings.v1';

const DEFAULTS = {
  observer: { ...DEFAULT_OBSERVER },
  minElDeg: PASS_DEFAULTS.minElDeg,
  style: 'holo',
  show: { paths: true, labels: true, stars: true, constellations: false, grid: true, borders: true, atmosphere: true },
  hiddenCats: [],
  radarMode: 'sky',
};

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = { ...out[k], ...v };
    else if (k in out) out[k] = v;
  }
  return out;
}

function load() {
  try {
    return merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // private mode or storage disabled: settings last for this visit only
  }
}

export function resetSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

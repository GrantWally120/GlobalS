// Pass prediction: when a satellite rises above, culminates in, and sets below an observer's sky,
// and whether it can be seen with the naked eye.
//
// Structure follows Skyfield's find_events (maxima first): sample elevation on a grid fine enough
// to resolve every orbit's elevation hump, refine each hump's peak (golden section), then bisect
// the rise/set crossings of the minimum elevation. Grazing passes shorter than the grid step are
// still found because the peak, not the threshold crossing, is detected first.

import { eciToEcf } from './frames.js';
import { elevationDeg, lookAngles } from './look.js';
import { periodSec } from './orbit.js';
import { gmstFromMs, propagateMs, shadowFraction } from './sat.js';
import { sunAltDeg, sunEciAu } from './sun.js';

const DAY = 86_400_000;

/** Grid step (s): fine enough to resolve every elevation maximum. */
export function autoStepSec(rec) {
  if (rec.satrec.ecco > 0.1) return 30; // eccentric orbits have short, fast perigee passes
  return Math.min(300, Math.max(20, periodSec(rec) / 100));
}

/** Elevation (degrees) at time t; −90 if the satellite can't be propagated. */
export function elevationAt(rec, obs, t) {
  const pv = propagateMs(rec, t);
  if (!pv) return -90;
  return elevationDeg(obs, eciToEcf(pv.r, gmstFromMs(t)));
}

/** Azimuth/elevation/range at time t, or null. */
export function lookAt(rec, obs, t) {
  const pv = propagateMs(rec, t);
  if (!pv) return null;
  return lookAngles(obs, eciToEcf(pv.r, gmstFromMs(t)));
}

function bisect(f, a, b, tolMs) {
  let fa = f(a);
  while (b - a > tolMs) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm > 0 === fa > 0) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
}

function goldenMax(f, a, b, tolMs) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > tolMs) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/**
 * Passes of `rec` over `obs` that overlap [t0, t1].
 * @param {object} opts
 * @param {number} [opts.minEl=10] elevation (deg) that defines rise and set
 * @param {number} [opts.stepSec] override the sampling grid
 * @param {number} [opts.tolMs=100] precision of the returned times
 * @returns {{alwaysUp?: boolean, neverUp?: boolean, passes: object[]}}
 *   Each pass: { rise, max, set } as {t, azDeg, elDeg} (rise/set null when outside the scan),
 *   plus durationSec and inProgress (true when it had already risen at t0).
 */
export function findPasses(rec, obs, t0, t1, { minEl = 10, stepSec, tolMs = 100 } = {}) {
  const el = (t) => elevationAt(rec, obs, t);
  const dt = (stepSec ?? autoStepSec(rec)) * 1000;
  const P = periodSec(rec) * 1000;
  // Scan half an orbit beyond each end, and keep widening while the satellite is still up there,
  // so passes that began long before t0 (hours-long HEO passes) keep their true peak and rise.
  const widen = Math.min(P / 4, DAY / 4);
  let ts = t0 - Math.min(P / 2, DAY);
  let te = t1 + Math.min(P / 2, DAY);
  for (let k = 0; k < 8 && el(ts) >= minEl; k++) ts -= widen;
  for (let k = 0; k < 8 && el(te) >= minEl; k++) te += widen;
  const n = Math.ceil((te - ts) / dt) + 1;
  const T = new Float64Array(n);
  const E = new Float64Array(n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    T[i] = ts + i * dt;
    E[i] = el(T[i]);
    if (E[i] < lo) lo = E[i];
    if (E[i] > hi) hi = E[i];
  }
  if (lo >= minEl) return { alwaysUp: true, passes: [] };

  const found = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(E[i] > E[i - 1] && E[i] >= E[i + 1])) continue;
    const tMax = goldenMax(el, T[i - 1], T[i + 1], tolMs);
    const eMax = el(tMax);
    if (eMax < minEl) continue;

    let rise = null;
    if (E[i] < minEl) rise = bisect((t) => el(t) - minEl, T[i - 1], tMax, tolMs);
    else {
      let j = i;
      while (j > 0 && E[j - 1] >= minEl) j--;
      if (j > 0) rise = bisect((t) => el(t) - minEl, T[j - 1], T[j], tolMs);
    }
    let set = null;
    if (E[i] < minEl) set = bisect((t) => el(t) - minEl, tMax, T[i + 1], tolMs);
    else {
      let k = i;
      while (k < n - 1 && E[k + 1] >= minEl) k++;
      if (k < n - 1) set = bisect((t) => el(t) - minEl, T[k], T[k + 1], tolMs);
    }

    // A second maximum inside the same above-threshold stretch (double culmination) is the same
    // pass: keep the higher peak.
    const prev = found.at(-1);
    if (prev && prev.riseT === rise && prev.setT === set) {
      if (eMax > prev.maxEl) Object.assign(prev, { maxT: tMax, maxEl: eMax });
      continue;
    }
    found.push({ riseT: rise, setT: set, maxT: tMax, maxEl: eMax });
  }

  const passes = [];
  for (const p of found) {
    if (p.setT !== null && p.setT < t0) continue;
    if (p.riseT !== null && p.riseT > t1) continue;
    const point = (t) => {
      if (t === null) return null;
      const la = lookAt(rec, obs, t);
      return { t, azDeg: la.azDeg, elDeg: la.elDeg, rangeKm: la.rangeKm };
    };
    const max = point(p.maxT);
    max.elDeg = p.maxEl;
    passes.push({
      rise: point(p.riseT),
      max,
      set: point(p.setT),
      durationSec: p.riseT !== null && p.setT !== null ? (p.setT - p.riseT) / 1000 : null,
      inProgress: p.riseT !== null ? p.riseT < t0 : true,
    });
  }
  return { neverUp: hi < minEl && passes.length === 0, passes };
}

/** Is the satellite in sunlight (Sun's centre above Earth's limb as seen from it)? */
export function isSunlit(rEci, tMs) {
  return shadowFraction(sunEciAu(tMs), rEci) < 0.5;
}

/**
 * Samples across a pass for the radar chart and visibility: every `stepMs` from rise to set.
 * `lit`: satellite sunlit; `dark`: observer's Sun altitude below `sunAltMax`.
 */
export function passTrack(rec, obs, pass, { stepMs = 5000, sunAltMax = -6 } = {}) {
  const start = pass.rise?.t ?? pass.max.t;
  const end = pass.set?.t ?? pass.max.t;
  const out = [];
  const add = (t) => {
    const pv = propagateMs(rec, t);
    if (!pv) return;
    const la = lookAngles(obs, eciToEcf(pv.r, gmstFromMs(t)));
    out.push({ t, azDeg: la.azDeg, elDeg: la.elDeg, lit: isSunlit(pv.r, t), dark: sunAltDeg(obs, t) < sunAltMax });
  };
  for (let t = start; t < end; t += stepMs) add(t);
  add(end);
  return out;
}

/**
 * Naked-eye visibility of a pass: the stretch where the satellite is sunlit AND the observer's sky
 * is dark (Sun below −6° by default). Transitions are refined to 1 s. Magnitudes are not estimated:
 * public orbital data carries no brightness information.
 * @returns {{kind: 'visible'|'daylight'|'eclipsed', start?: object, end?: object, maxElDeg?: number}}
 */
export function passVisibility(rec, obs, pass, { sunAltMax = -6, stepMs = 5000 } = {}) {
  const track = passTrack(rec, obs, pass, { stepMs, sunAltMax });
  const vis = (s) => s.lit && s.dark;
  const first = track.findIndex(vis);
  if (first < 0) {
    const anyLitInDaylight = track.some((s) => s.lit && !s.dark);
    return { kind: anyLitInDaylight ? 'daylight' : 'eclipsed', track };
  }
  let last = first;
  for (let i = first; i < track.length; i++) if (vis(track[i])) last = i;
  const visibleAt = (t) => {
    const pv = propagateMs(rec, t);
    return pv && isSunlit(pv.r, t) && sunAltDeg(obs, t) < sunAltMax ? 1 : -1;
  };
  const refine = (a, b) => bisect(visibleAt, a, b, 1000);
  const startT = first > 0 ? refine(track[first - 1].t, track[first].t) : track[first].t;
  const endT = last < track.length - 1 ? refine(track[last].t, track[last + 1].t) : track[last].t;
  const maxElDeg = Math.max(...track.slice(first, last + 1).map((s) => s.elDeg));
  return {
    kind: 'visible',
    start: { t: startT, ...pick(lookAt(rec, obs, startT)) },
    end: { t: endT, ...pick(lookAt(rec, obs, endT)) },
    maxElDeg,
    track,
  };
}

const pick = (la) => (la ? { azDeg: la.azDeg, elDeg: la.elDeg } : {});

/**
 * Naked-eye passes for many satellites in [t0, t1], searching only while the sky is dark.
 * @param {object[]} recs
 * @param {{start: number, end: number}[]} darkWindows from sun.darkWindows()
 */
export function visiblePasses(recs, obs, darkWins, { minEl = 10, sunAltMax = -6 } = {}) {
  const out = [];
  for (const rec of recs) {
    for (const w of darkWins) {
      const { passes } = findPasses(rec, obs, w.start, w.end, { minEl });
      for (const p of passes) {
        const v = passVisibility(rec, obs, p, { sunAltMax });
        if (v.kind === 'visible') out.push({ id: rec.id, name: rec.name, pass: p, visibility: v });
      }
    }
  }
  const seen = new Set();
  return out
    .filter((x) => {
      const key = `${x.id}:${Math.round(x.pass.max.t / 1000)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.visibility.start.t - b.visibility.start.t);
}

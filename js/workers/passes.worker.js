// Pass predictions off the main thread: one satellite's passes, or tonight's naked-eye passes.

import { makeObserver } from '../core/look.js';
import { findPasses, passVisibility, visiblePasses } from '../core/passes.js';
import { recFromAny } from '../core/sat.js';
import { darkWindows } from '../core/sun.js';
import { serve } from './rpc.js';

const observer = (o) => makeObserver(o.latDeg, o.lonDeg, o.hKm);
const compactTrack = (track) => track.map((s) => [s.t, s.azDeg, s.elDeg, s.lit ? 1 : 0, s.dark ? 1 : 0]);

serve({
  passes(m) {
    const rec = recFromAny(m.record);
    if (!rec) throw new Error('These orbital elements could not be initialised.');
    const obs = observer(m.obs);
    const res = findPasses(rec, obs, m.t0, m.t1, { minEl: m.minEl });
    const passes = res.passes.map((p) => {
      const v = passVisibility(rec, obs, p, { sunAltMax: m.sunAltMax });
      return {
        ...p,
        visibility: { kind: v.kind, start: v.start ?? null, end: v.end ?? null, maxElDeg: v.maxElDeg ?? null },
        track: compactTrack(v.track),
      };
    });
    return { alwaysUp: !!res.alwaysUp, neverUp: !!res.neverUp, passes };
  },

  tonight(m) {
    const obs = observer(m.obs);
    const wins = darkWindows(obs, m.t0, m.t1, m.sunAltMax);
    const recs = m.records.map(recFromAny).filter(Boolean);
    const found = visiblePasses(recs, obs, wins, { minEl: m.minEl, sunAltMax: m.sunAltMax });
    return {
      windows: wins,
      passes: found.map((x) => ({
        id: x.id,
        name: x.name,
        rise: x.pass.rise,
        max: x.pass.max,
        set: x.pass.set,
        visibility: { kind: x.visibility.kind, start: x.visibility.start, end: x.visibility.end, maxElDeg: x.visibility.maxElDeg },
        track: compactTrack(x.visibility.track),
      })),
    };
  },
});

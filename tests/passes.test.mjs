import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeObserver } from '../js/core/look.js';
import { findPasses, isSunlit, passVisibility } from '../js/core/passes.js';
import { propagateMs, recFromOmm } from '../js/core/sat.js';
import { CEBU, near, nearAngle, readJson } from './helpers.mjs';

const REF = readJson('tests/fixtures/ref/skyfield.json');
const OMMS = readJson('tests/fixtures/omm/ref-objects.json');
const obs = makeObserver(CEBU.latDeg, CEBU.lonDeg, CEBU.hKm);
const recOf = (id) => recFromOmm(OMMS.find((o) => o.NORAD_CAT_ID === id));

for (const key of ['passes10', 'passes0']) {
  test(`pass times over Cebu match Skyfield (${key === 'passes10' ? '≥10°' : '≥0°'})`, () => {
    for (const ref of REF[key]) {
      const rec = recOf(ref.id);
      const res = findPasses(rec, obs, ref.t0, ref.t1, { minEl: ref.minElDeg, tolMs: 10 });
      if (ref.gridMinElDeg >= ref.minElDeg) {
        assert.ok(res.alwaysUp, `${ref.name} is always above ${ref.minElDeg}°`);
        continue;
      }
      assert.equal(res.passes.length, ref.passes.length, `${ref.name}: number of passes`);
      res.passes.forEach((p, i) => {
        const r = ref.passes[i];
        const label = `${ref.name} pass ${i + 1}`;
        if (r.rise != null) {
          near(p.rise.t, r.rise, 1000, `${label} rise time (ms)`);
          nearAngle(p.rise.azDeg, r.riseAzDeg, 0.05, `${label} rise azimuth`);
        }
        if (r.set != null) {
          near(p.set.t, r.set, 1000, `${label} set time (ms)`);
          nearAngle(p.set.azDeg, r.setAzDeg, 0.05, `${label} set azimuth`);
        }
        if (r.max != null) {
          near(p.max.elDeg, r.maxElDeg, 0.02, `${label} max elevation`);
          near(p.max.t, r.max, 5000, `${label} culmination time (ms)`);
        }
      });
    }
  });
}

test('sunlit/eclipse transitions match Skyfield is_sunlit within 2 s', () => {
  for (const ref of REF.sunlit) {
    const rec = recOf(ref.id);
    const lit = (t) => isSunlit(propagateMs(rec, t).r, t);
    assert.equal(lit(ref.t0), ref.litAtStart, `${ref.name} lit at start`);
    const ours = [];
    let prev = lit(ref.t0);
    for (let t = ref.t0 + 20_000; t < ref.t1; t += 20_000) {
      const cur = lit(t);
      if (cur !== prev) {
        let a = t - 20_000;
        let b = t;
        while (b - a > 10) {
          const m = (a + b) / 2;
          if (lit(m) === prev) a = m;
          else b = m;
        }
        ours.push({ ms: (a + b) / 2, lit: cur });
      }
      prev = cur;
    }
    assert.equal(ours.length, ref.transitions.length, `${ref.name}: number of transitions`);
    ours.forEach((o, i) => {
      assert.equal(o.lit, ref.transitions[i].lit);
      near(o.ms, ref.transitions[i].ms, 2000, `${ref.name} transition ${i}`);
    });
  }
});

test('a pass in progress at t0 is reported with its real rise time', () => {
  const rec = recOf(90001);
  const first = REF.passes10.find((p) => p.id === 90001).passes[0];
  const mid = (first.rise + first.set) / 2;
  const { passes } = findPasses(rec, obs, mid, mid + 3600e3, { minEl: 10 });
  assert.ok(passes[0].inProgress);
  near(passes[0].rise.t, first.rise, 1000, 'rise before the window');
});

test('hours-long Molniya passes that began before the window keep their true peak', () => {
  const rec = recOf(90005);
  const p1 = REF.passes10.find((p) => p.id === 90005).passes[0];
  const late = p1.set - 1800e3; // 30 min before set, ~10 h after the peak
  const { passes } = findPasses(rec, obs, late, late + 600e3, { minEl: 10 });
  assert.equal(passes.length, 1);
  near(passes[0].max.elDeg, p1.maxElDeg, 0.02, 'peak elevation');
  near(passes[0].rise.t, p1.rise, 1000, 'rise');
});

test('geostationary over 124°E is always up from Cebu; visibility classifies passes', () => {
  const geo = recOf(90004);
  assert.ok(findPasses(geo, obs, REF.passes10[0].t0, REF.passes10[0].t0 + 86400e3).alwaysUp);
  const iss = recOf(90001);
  const { passes } = findPasses(iss, obs, REF.passes10[0].t0, REF.passes10[0].t0 + 3 * 86400e3, { minEl: 10 });
  const kinds = new Set(passes.map((p) => passVisibility(iss, obs, p).kind));
  for (const k of kinds) assert.ok(['visible', 'daylight', 'eclipsed'].includes(k));
});

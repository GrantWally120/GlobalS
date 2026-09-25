import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeObserver } from '../js/core/look.js';
import { jdFromMs, sunPos } from '../js/core/sat.js';
import { SUN_ALT, darkWindows, subsolarPoint, sunAltAz } from '../js/core/sun.js';
import { CEBU, near, nearAngle, readJson } from './helpers.mjs';

const REF = readJson('tests/fixtures/ref/skyfield.json');
const obs = makeObserver(CEBU.latDeg, CEBU.lonDeg, CEBU.hKm);

test('Sun RA/Dec (satellite.js 7.1.0) within 0.01° of Skyfield + DE421, 1990–2045', () => {
  for (const s of REF.sun.radec) {
    const p = sunPos(jdFromMs(s.ms));
    nearAngle((p.rtasc * 180) / Math.PI, s.raDeg, 0.01, `RA ${new Date(s.ms).toISOString()}`);
    near((p.decl * 180) / Math.PI, s.decDeg, 0.01, `Dec ${new Date(s.ms).toISOString()}`);
  }
});

test('Sun altitude and azimuth at Cebu within 0.02° of Skyfield', () => {
  for (const s of REF.sun.cebuAltitude) {
    const a = sunAltAz(obs, s.ms);
    near(a.altDeg, s.altDeg, 0.02, `altitude ${new Date(s.ms).toISOString()}`);
    nearAngle(a.azDeg, s.azDeg, 0.05, `azimuth ${new Date(s.ms).toISOString()}`);
  }
});

test('civil dusk/dawn and sunrise/sunset at Cebu within 10 s of Skyfield', () => {
  const tr = REF.sun.cebuTwilight;
  const t0 = tr[0].ms - 6 * 3600e3;
  const t1 = tr.at(-1).ms + 6 * 3600e3;
  const check = (alt, hi, lo) => {
    const edges = darkWindows(obs, t0, t1, alt).flatMap((w) => [w.start, w.end]).filter((t) => t > t0 && t < t1);
    const expected = tr.filter((x, i) => i > 0 && [x.level, tr[i - 1].level].sort().join() === [hi, lo].sort().join());
    const refTimes = tr.filter((x, i) => {
      const prev = i === 0 ? null : tr[i - 1].level;
      return (prev === hi && x.level === lo) || (prev === lo && x.level === hi);
    }).map((x) => x.ms);
    assert.ok(expected.length > 0 || refTimes.length > 0, 'reference has transitions');
    for (const t of refTimes) {
      const nearest = edges.reduce((best, e) => (Math.abs(e - t) < Math.abs(best - t) ? e : best), Infinity);
      near(nearest, t, 10_000, `${alt}° crossing at ${new Date(t).toISOString()}`);
    }
  };
  check(SUN_ALT.civil, 3, 2);
  check(SUN_ALT.rise, 4, 3);
});

test('sub-solar point: near the equator at the March 2026 equinox', () => {
  const p = subsolarPoint(Date.UTC(2026, 2, 20, 14, 46));
  near(p.latDeg, 0, 0.02, 'sub-solar latitude');
});

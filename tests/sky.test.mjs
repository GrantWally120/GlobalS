import assert from 'node:assert/strict';
import { test } from 'node:test';
import { azElToXY, passSegments } from '../js/core/radar.js';
import { bvToRgb, magToAlpha, magToSize, mat3Apply, precessionMatrix, raDecToUnit, starBuffers } from '../js/core/stars.js';
import { near, nearAngle, readJson } from './helpers.mjs';

const REF = readJson('tests/fixtures/ref/skyfield.json');
const DEG = Math.PI / 180;

test('IAU-1976 precession J2000 → 2026-09-25 agrees with Skyfield (IAU 2006) within 1″', () => {
  const P = precessionMatrix(REF.stars.ms);
  for (const s of REF.stars.stars) {
    const [x, y, z] = mat3Apply(P, raDecToUnit(s.raJ2000Deg * DEG, s.decJ2000Deg * DEG));
    const ra = ((Math.atan2(y, x) / DEG) + 360) % 360;
    const dec = Math.asin(z) / DEG;
    near(dec, s.decDateDeg, 1 / 3600, `${s.name} Dec`);
    nearAngle(ra, s.raDateDeg, 1 / 3600 / Math.max(Math.cos(dec * DEG), 0.01), `${s.name} RA`);
  }
});

test('star catalogue loads 5,000+ naked-eye stars with sensible colours and sizes', () => {
  const buf = starBuffers(readJson('assets/stars/stars.6.json'));
  assert.ok(buf.count > 5000, `${buf.count} stars`);
  const hot = bvToRgb(-0.3);
  const cool = bvToRgb(1.8);
  assert.ok(hot[2] > hot[0], 'hot stars are bluish');
  assert.ok(cool[0] > cool[2], 'cool stars are reddish');
  assert.ok(magToSize(-1.46) > magToSize(3) && magToSize(3) >= magToSize(6));
  assert.ok(magToAlpha(0) === 1 && magToAlpha(6) < magToAlpha(4));
});

test('radar: zenith at centre, north up, east LEFT in sky mode and RIGHT in map mode', () => {
  const [zx, zy] = azElToXY(123, 90, 100);
  near(zx, 0, 1e-9, 'zenith x');
  near(zy, 0, 1e-9, 'zenith y');
  const [nx, ny] = azElToXY(0, 0, 100);
  near(nx, 0, 1e-9, 'north x');
  near(ny, -100, 1e-9, 'north at top');
  near(azElToXY(90, 0, 100, 'sky')[0], -100, 1e-9, 'east on the left (looking up)');
  near(azElToXY(90, 0, 100, 'map')[0], 100, 1e-9, 'east on the right (map)');
});

test('radar: pass samples split into visible / daylight / shadow runs that join up', () => {
  const s = (lit, dark) => ({ azDeg: 0, elDeg: 20, lit, dark });
  const runs = passSegments([s(true, false), s(true, false), s(true, true), s(true, true), s(false, true)]);
  assert.deepEqual(runs.map((r) => r.kind), ['daylight', 'visible', 'shadow']);
  assert.equal(runs[1].samples[0], runs[0].samples.at(-1), 'runs share their boundary sample');
});

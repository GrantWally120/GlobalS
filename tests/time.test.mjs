import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SimClock } from '../js/core/clock.js';
import { hermiteBasis, hermiteInto } from '../js/core/interp.js';
import { keyPair, neededKeys, spacingSec } from '../js/core/keyframes.js';
import { propagateMs, recFromOmm } from '../js/core/sat.js';
import {
  formatUtcOffset, gmstFromMs, hoursToHms, lstRad, parseTimeParam, tzOffsetMinutes, zonedToUtcMs,
} from '../js/core/time.js';
import { near, readJson } from './helpers.mjs';

test('sidereal time helpers', () => {
  assert.equal(hoursToHms(18.697374558), '18:41:51'); // 18h 41m 50.548s
  assert.equal(hoursToHms(23.99999), '00:00:00');
  const t = Date.UTC(2026, 8, 25, 12);
  near(lstRad(t, 0), gmstFromMs(t), 1e-12, 'LST at Greenwich = GMST');
});

test('time zones: Manila is UTC+8 all year; New York observes DST', () => {
  assert.equal(tzOffsetMinutes(Date.UTC(2026, 0, 1), 'Asia/Manila'), 480);
  assert.equal(tzOffsetMinutes(Date.UTC(2026, 6, 1), 'Asia/Manila'), 480);
  assert.equal(tzOffsetMinutes(Date.UTC(2026, 0, 15), 'America/New_York'), -300);
  assert.equal(tzOffsetMinutes(Date.UTC(2026, 6, 15), 'America/New_York'), -240);
  assert.equal(zonedToUtcMs(2026, 9, 25, 20, 0, 0, 'Asia/Manila'), Date.UTC(2026, 8, 25, 12));
  assert.equal(formatUtcOffset(480), 'UTC+8');
  assert.equal(formatUtcOffset(-210), 'UTC−3:30');
});

test('parseTimeParam understands ISO, offsets, local times and "now"', () => {
  const now = 1_790_000_000_000;
  assert.equal(parseTimeParam('now', now), now);
  assert.equal(parseTimeParam('2026-09-25T12:00:00Z', now), Date.UTC(2026, 8, 25, 12));
  assert.equal(parseTimeParam('2026-09-25T20:00+08:00', now), Date.UTC(2026, 8, 25, 12));
  assert.equal(parseTimeParam('2026-09-25T20:00', now, 'Asia/Manila'), Date.UTC(2026, 8, 25, 12));
  assert.equal(parseTimeParam('2026-09-25', now, 'UTC'), Date.UTC(2026, 8, 25));
  assert.ok(Number.isNaN(parseTimeParam('yesterday', now)));
});

test('keyframe grid: spacing by warp, aligned pairs, prefetch follows time direction', () => {
  assert.equal(spacingSec(1), 60);
  assert.equal(spacingSec(0), 60);
  assert.equal(spacingSec(-60), 60);
  assert.equal(spacingSec(120), 180);
  assert.equal(spacingSec(-3600), 900);
  const t = Date.UTC(2026, 8, 25, 12, 0, 30);
  const { ta, tb } = keyPair(t, 1);
  assert.equal(ta, Date.UTC(2026, 8, 25, 12, 0, 0));
  assert.equal(tb, Date.UTC(2026, 8, 25, 12, 1, 0));
  assert.deepEqual(neededKeys(t, 10), [ta, tb, tb + 60000]);
  assert.deepEqual(neededKeys(t, -10), [ta, tb, ta - 60000]);
});

test('Hermite interpolation between SGP4 keyframes: exact at ends, sub-metre at 60 s spacing', () => {
  const omm = readJson('tests/fixtures/omm/ref-objects.json').find((o) => o.OBJECT_NAME === 'REF-ISS');
  const rec = recFromOmm(omm);
  const worst = {};
  for (const hSec of [60, 180, 900]) {
    let maxErr = 0;
    for (let k = 0; k < 20; k++) {
      const ta = Date.UTC(2026, 8, 24, 12) + k * 3_700_000;
      const tb = ta + hSec * 1000;
      const a = propagateMs(rec, ta);
      const b = propagateMs(rec, tb);
      const P0 = [a.r.x, a.r.y, a.r.z];
      const V0 = [a.v.x, a.v.y, a.v.z];
      const P1 = [b.r.x, b.r.y, b.r.z];
      const V1 = [b.v.x, b.v.y, b.v.z];
      for (const s of [0, 0.25, 0.5, 0.75, 1]) {
        const out = hermiteInto(new Float64Array(3), P0, V0, P1, V1, hermiteBasis(s, hSec));
        const truth = propagateMs(rec, ta + s * hSec * 1000).r;
        const err = Math.hypot(out[0] - truth.x, out[1] - truth.y, out[2] - truth.z);
        if (s === 0 || s === 1) near(err, 0, 1e-9, 'exact at keyframes');
        maxErr = Math.max(maxErr, err);
      }
    }
    worst[hSec] = maxErr;
  }
  assert.ok(worst[60] < 0.001, `60 s spacing: ${worst[60] * 1000} m`);
  assert.ok(worst[180] < 0.05, `180 s spacing: ${worst[180] * 1000} m`);
  assert.ok(worst[900] < 25, `900 s spacing: ${worst[900]} km`);
});

test('SimClock: continuity across rate changes, pause, jump, live detection, warp steps', () => {
  let perf = 0;
  let wall = Date.UTC(2026, 8, 25, 12);
  const c = new SimClock({ perfNow: () => perf, wallNow: () => wall });
  assert.ok(c.isLive());
  perf += 1000;
  wall += 1000;
  assert.equal(c.now(), wall);
  c.setRate(60);
  perf += 1000;
  wall += 1000;
  assert.equal(c.now(), wall - 1000 + 60_000);
  assert.ok(!c.isLive());
  c.pause();
  const frozen = c.now();
  perf += 5000;
  assert.equal(c.now(), frozen);
  c.play();
  assert.equal(c.rate, 60);
  c.jump(Date.UTC(2030, 0, 1));
  assert.equal(c.now(), Date.UTC(2030, 0, 1));
  c.backToNow();
  assert.ok(c.isLive());
  assert.equal(c.nextRate(+1), 10);
  assert.equal(c.nextRate(-1), 0);
  c.setRate(3600);
  assert.equal(c.nextRate(+1), 3600);
  c.setRate(-10);
  assert.equal(c.nextRate(-1), -60);
});

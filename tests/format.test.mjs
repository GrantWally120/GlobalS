import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compass, dateTimeLocalValue, fmtAge, fmtClock, fmtDate, fmtDuration, fmtInt, fmtKm, fmtLat, fmtLon, fmtRate, zoneLabel,
} from '../js/core/format.js';

test('numbers, coordinates and directions', () => {
  assert.equal(fmtInt(16764), '16,764');
  assert.equal(fmtKm(35786.4), '35,786 km');
  assert.equal(fmtLat(10.29306), '10.293° N');
  assert.equal(fmtLon(-172.5, 1), '172.5° W');
  assert.equal(compass(0), 'N');
  assert.equal(compass(349), 'N');
  assert.equal(compass(22.5), 'NNE');
  assert.equal(compass(190.67), 'S');
  assert.equal(compass(286), 'WNW');
});

test('durations, ages and warp rates', () => {
  assert.equal(fmtDuration(42), '42 s');
  assert.equal(fmtDuration(349), '5 min 49 s');
  assert.equal(fmtDuration(300), '5 min');
  assert.equal(fmtDuration(41052), '11 h 24 min');
  assert.equal(fmtAge(0.2), '12 min ago');
  assert.equal(fmtAge(3.2), '3.2 h ago');
  assert.equal(fmtAge(60), '2.5 days ago');
  assert.equal(fmtRate(0), 'Paused');
  assert.equal(fmtRate(3600), '3,600×');
  assert.equal(fmtRate(-10), '−10×');
});

test('clocks and dates in Manila time', () => {
  const t = Date.UTC(2026, 8, 25, 13, 5, 9);
  assert.equal(fmtClock(t, 'Asia/Manila'), '21:05:09');
  assert.equal(fmtDate(t, 'Asia/Manila'), 'Fri 25 Sep 2026');
  assert.equal(fmtDate(Date.UTC(2026, 8, 25, 17), 'Asia/Manila'), 'Sat 26 Sep 2026');
  assert.equal(dateTimeLocalValue(t, 'Asia/Manila'), '2026-09-25T21:05:09');
  assert.equal(zoneLabel(t, 'Asia/Manila'), 'UTC+8');
});

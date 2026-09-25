import assert from 'node:assert/strict';
import { test } from 'node:test';
import { epochToMs, gmstFromMs, jdFromMs, normalizeEpoch, propagateMs, recFromOmm, recFromTle } from '../js/core/sat.js';
import { near, readJson } from './helpers.mjs';

const REF = readJson('tests/fixtures/ref/skyfield.json');
const OMMS = readJson('tests/fixtures/omm/ref-objects.json');

test('epochToMs keeps sub-millisecond digits that Date would drop', () => {
  // float64 resolves ~0.24 µs at 1.8e12 ms, so compare to 1 µs
  near(epochToMs('2026-09-24T12:00:00.123456') - Date.UTC(2026, 8, 24, 12, 0, 0), 123.456, 1e-3, 'fraction');
  assert.equal(epochToMs('2026-09-24T12:00:00Z'), Date.UTC(2026, 8, 24, 12, 0, 0));
  assert.ok(Number.isNaN(epochToMs('24 Sep 2026')));
  assert.equal(normalizeEpoch('2025-03-26T05:19:34.116960'), '2025-03-26T05:19:34.116Z');
});

test('Julian Date and IAU-82 GMST match Skyfield/sgp4 (J2000.0 → 18.697374558 h)', () => {
  near(jdFromMs(Date.UTC(2000, 0, 1, 12)), 2451545.0, 1e-9, 'JD(J2000)');
  near((gmstFromMs(Date.UTC(2000, 0, 1, 12)) * 12) / Math.PI, 18.697374558, 1e-9, 'GMST(J2000) hours');
  for (const g of REF.gmst) near(gmstFromMs(g.ms), g.gmstRad, 1e-9, `GMST ${g.iso}`);
});

test('OMM epochs parse to the same instant Skyfield uses (µs)', () => {
  for (const sat of REF.satellites) {
    const omm = OMMS.find((o) => o.NORAD_CAT_ID === sat.id);
    const rec = recFromOmm(omm);
    near(rec.epochMs, sat.skyfieldEpochMs, 0.001, `${sat.name} epoch ms`);
  }
});

test('propagateMs matches python-sgp4 TEME states within 1 mm and 1 µm/s', () => {
  for (const sat of REF.satellites) {
    const rec = recFromOmm(OMMS.find((o) => o.NORAD_CAT_ID === sat.id));
    assert.equal(rec.id, sat.id);
    for (const st of sat.states) {
      const pv = propagateMs(rec, st.ms);
      assert.ok(pv, `${sat.name} propagates`);
      ['x', 'y', 'z'].forEach((k, i) => {
        near(pv.r[k], st.r[i], 1e-6, `${sat.name} r.${k}`);
        near(pv.v[k], st.v[i], 1e-9, `${sat.name} v.${k}`);
      });
    }
  }
});

test('six-digit catalog numbers survive the OMM path', () => {
  const rec = recFromOmm(OMMS.find((o) => o.OBJECT_NAME === 'REF-SIXDIGIT'));
  assert.equal(rec.id, 100123);
  assert.equal(rec.satrec.satnum, '100123');
});

test('invalid OMM records are rejected instead of throwing', () => {
  assert.equal(recFromOmm(null), null);
  assert.equal(recFromOmm({ NORAD_CAT_ID: 5 }), null);
  assert.equal(recFromOmm({ ...OMMS[0], EPOCH: 'not a date' }), null);
  assert.equal(recFromOmm({ ...OMMS[0], ECCENTRICITY: 1.5 }), null);
});

test('TLE records carry the epoch and COSPAR designator', () => {
  const l1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
  const l2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';
  const rec = recFromTle('ISS (ZARYA)', l1, l2, 25544);
  near(rec.epochMs, Date.UTC(2019, 5, 5, 12, 12, 58), 1, 'TLE epoch');
  assert.equal(rec.cospar, '1998-067A');
  assert.equal(rec.name, 'ISS (ZARYA)');
});

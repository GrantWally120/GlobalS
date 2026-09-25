import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eciToEcf } from '../js/core/frames.js';
import { elevationDeg, makeObserver } from '../js/core/look.js';
import { apsides, footprintRing, orbitClass, periodSec, revsPerDay, sampleGroundTrack, sampleOrbitEci } from '../js/core/orbit.js';
import { gmstFromMs, propagateMs, recFromOmm } from '../js/core/sat.js';
import { near, readJson } from './helpers.mjs';

const OMMS = readJson('tests/fixtures/omm/ref-objects.json');
const rec = (name) => recFromOmm(OMMS.find((o) => o.OBJECT_NAME === name));

test('period, mean motion and orbit class', () => {
  const iss = rec('REF-ISS');
  near(revsPerDay(iss), 15.50103472, 0.01, 'rev/day (Brouwer vs Kozai differ slightly)');
  near(periodSec(iss) / 60, 1440 / 15.50103472, 0.1, 'ISS period (min)');
  assert.equal(orbitClass(iss), 'LEO');
  assert.equal(orbitClass(rec('REF-SSO')), 'LEO');
  assert.equal(orbitClass(rec('REF-GPS')), 'MEO');
  assert.equal(orbitClass(rec('REF-GEO124')), 'GEO');
  assert.equal(orbitClass(rec('REF-MOLNIYA')), 'HEO');
  const a = apsides(iss);
  assert.ok(a.perigeeKm > 380 && a.apogeeKm < 440, `ISS-like apsides ${a.perigeeKm}–${a.apogeeKm} km`);
  const g = apsides(rec('REF-GEO124'));
  near((g.apogeeKm + g.perigeeKm) / 2, 35786, 30, 'GEO altitude');
});

test('orbit samples span one revolution; ground track stays on the surface', () => {
  const iss = rec('REF-ISS');
  const t = Date.UTC(2026, 8, 24, 12);
  const pts = sampleOrbitEci(iss, t);
  assert.equal(pts.length, 361 * 3);
  near(pts[0], pts[pts.length - 3], 50, 'orbit closes (x) within 50 km');
  const track = sampleGroundTrack(iss, t, t + 3600e3);
  assert.ok(track.length > 150);
  // Geodetic latitude exceeds the 51.64° inclination by up to ~0.19° (the ellipsoid is flattened),
  // and height above the ellipsoid grows toward high latitudes.
  for (const p of track) assert.ok(p.hKm > 400 && p.hKm < 450 && Math.abs(p.latDeg) <= 51.64 + 0.2, `${p.latDeg} ${p.hKm}`);
  assert.ok(Math.max(...track.map((p) => Math.abs(p.latDeg))) > 51.64, 'reaches beyond the inclination (geodetic)');
});

test('footprint ring: every point sees the satellite at exactly the minimum elevation', () => {
  const iss = rec('REF-ISS');
  const t = Date.UTC(2026, 8, 24, 13);
  const ecf = eciToEcf(propagateMs(iss, t).r, gmstFromMs(t));
  for (const minEl of [0, 10]) {
    const ring = footprintRing(ecf, minEl, 36);
    assert.equal(ring.length, 37);
    for (const p of ring) near(elevationDeg(makeObserver(p.latDeg, p.lonDeg, 0), ecf), minEl, 0.01, 'edge elevation');
  }
});

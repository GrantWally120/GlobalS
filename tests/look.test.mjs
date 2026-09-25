import { test } from 'node:test';
import { DEG, eciToEcf } from '../js/core/frames.js';
import { elevationDeg, lookAngles, makeObserver } from '../js/core/look.js';
import { gmstFromMs, propagateMs, recFromOmm } from '../js/core/sat.js';
import { ecfToLookAngles } from '../vendor/satellite.js/dist/transforms.js';
import { CEBU, near, nearAngle, readJson, rng } from './helpers.mjs';

const REF = readJson('tests/fixtures/ref/skyfield.json');
const OMMS = readJson('tests/fixtures/omm/ref-objects.json');
const obs = makeObserver(CEBU.latDeg, CEBU.lonDeg, CEBU.hKm, 'Cebu City');

test('lookAngles equals satellite.js ecfToLookAngles', () => {
  const r = rng(5);
  const gd = { latitude: obs.lat, longitude: obs.lon, height: obs.hKm };
  for (let i = 0; i < 300; i++) {
    const p = { x: (r() - 0.5) * 9e4, y: (r() - 0.5) * 9e4, z: (r() - 0.5) * 9e4 };
    const a = lookAngles(obs, p);
    const b = ecfToLookAngles(gd, p);
    nearAngle(a.azDeg, b.azimuth / DEG, 1e-9, 'azimuth');
    near(a.elDeg, b.elevation / DEG, 1e-9, 'elevation');
    near(a.rangeKm, b.rangeSat, 1e-7, 'range (satellite.js rounds the WGS-84 polar radius to 0.1 mm)');
    near(elevationDeg(obs, p), a.elDeg, 1e-12, 'elevationDeg shortcut');
  }
});

test('look angles from Cebu match Skyfield for every reference object', () => {
  for (const sat of REF.satellites) {
    const rec = recFromOmm(OMMS.find((o) => o.NORAD_CAT_ID === sat.id));
    for (const st of sat.states) {
      const { r } = propagateMs(rec, st.ms);
      const la = lookAngles(obs, eciToEcf(r, gmstFromMs(st.ms)));
      // Skyfield rotates with UT1 (UT1−UTC ≈ 0.1 s) and GlobalS with UTC: allow 0.01°.
      near(la.elDeg, st.altDeg, 0.01, `${sat.name} elevation`);
      if (st.altDeg < 89) nearAngle(la.azDeg, st.azDeg, 0.01 / Math.max(Math.cos(st.altDeg * DEG), 0.05), `${sat.name} azimuth`);
      near(la.rangeKm, st.rangeKm, 0.1, `${sat.name} range`);
    }
  }
});

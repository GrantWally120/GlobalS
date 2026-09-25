import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geography } from '../js/core/geo.js';
import { rasterizeRings, sampleMask, unwrapRing } from '../js/core/landmask.js';
import { readJson } from './helpers.mjs';

const W = 2048;
const H = 1024;
const geo = geography(readJson('assets/geo/countries-50m.json'));
const t0 = performance.now();
const mask = rasterizeRings(geo.landRings, W, H);
const ms = performance.now() - t0;

test('land mask: the right places are land and sea (incl. Cebu and Bohol)', () => {
  const land = (lat, lon) => sampleMask(mask, W, H, lat, lon);
  for (const [name, lat, lon] of [['Cebu (inland)', 10.35, 123.83], ['Bohol', 9.85, 124.15], ['Luzon', 16.5, 121.0],
    ['Congo basin', -2, 23], ['Amguema, Chukotka (east of 180°)', 67.75, -178.7], ['Sahara', 23, 10],
    ['South Pole', -89.95, 0], ['Antarctic interior', -80, 120], ['Greenland', 72, -40]]) {
    assert.ok(land(lat, lon), `${name} should be land`);
  }
  for (const [name, lat, lon] of [['Gulf of Guinea', 0, 0], ['Southern Ocean', -60, 0], ['Philippine Sea', 15, 130],
    ['Caspian Sea', 42, 50.5], ['Mid-Pacific', 0, -150], ['Bering Sea', 58, -178]]) {
    assert.ok(!land(lat, lon), `${name} should be water`);
  }
});

test('land mask: ~29% of Earth\'s surface is land and no seam artefacts streak across rows', () => {
  let area = 0;
  let landArea = 0;
  for (let j = 0; j < H; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180;
    const w = Math.cos((lat * Math.PI) / 180);
    let rowLand = 0;
    for (let i = 0; i < W; i++) rowLand += mask[j * W + i] ? 1 : 0;
    area += w * W;
    landArea += w * rowLand;
    if (lat > -60 && lat < 84) assert.ok(rowLand / W < 0.9, `row at ${lat.toFixed(2)}° is ${(100 * rowLand / W).toFixed(0)}% land`);
  }
  const frac = landArea / area;
  assert.ok(frac > 0.28 && frac < 0.305, `land fraction ${(100 * frac).toFixed(1)}%`);
  assert.ok(ms < 2000, `rasterised in ${ms.toFixed(0)} ms`);
});

test('unwrapRing: seam crossings become continuous; pole-circling rings close on the pole', () => {
  const seam = unwrapRing([[179, 10], [-179, 10], [-179, 11], [179, 11], [179, 10]]);
  assert.deepEqual(seam.map((p) => p[0]), [179, 181, 181, 179, 179]);
  const cap = unwrapRing([[-180, -70], [-90, -72], [0, -70], [90, -72], [180, -70]]);
  assert.deepEqual(cap.slice(-2), [[180, -90], [-180, -90]]);
});

test('coastlines and borders exclude the artificial seam and pole edges', () => {
  assert.ok(geo.coast.length / 4 > 50_000, `${geo.coast.length / 4} coast segments`);
  assert.ok(geo.borders.length / 4 > 15_000, `${geo.borders.length / 4} border segments`);
  for (let i = 0; i < geo.coast.length; i += 4) {
    assert.ok(!(geo.coast[i + 1] < -89.9 && geo.coast[i + 3] < -89.9), 'no segments along the South Pole cut');
  }
});

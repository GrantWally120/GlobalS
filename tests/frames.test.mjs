import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEG, ER_KM, WGS84_B, ecfToEci, ecfToGeodetic, fromScene, geodeticNormal, geodeticToEcf, geodeticToScene, toScene,
} from '../js/core/frames.js';
import { eciToGeodetic } from '../vendor/satellite.js/dist/transforms.js';
import { near, rng } from './helpers.mjs';

// three.js Object3D.rotation.y = θ applies Ry(θ): (x, y, z) → (x cosθ + z sinθ, y, −x sinθ + z cosθ).
const rotY = ([x, y, z], t) => [x * Math.cos(t) + z * Math.sin(t), y, -x * Math.sin(t) + z * Math.cos(t)];

test('scene mapping is a proper rotation (right-handed axes stay right-handed)', () => {
  const X = toScene(ER_KM, 0, 0);
  const Y = toScene(0, ER_KM, 0);
  const Z = toScene(0, 0, ER_KM);
  const cross = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  cross.forEach((c, i) => near(c, Z[i], 1e-15, 'x̂ × ŷ = ẑ'));
});

test('toScene/fromScene round-trip', () => {
  const r = rng(1);
  for (let i = 0; i < 200; i++) {
    const v = { x: (r() - 0.5) * 9e4, y: (r() - 0.5) * 9e4, z: (r() - 0.5) * 9e4 };
    const s = toScene(v.x, v.y, v.z);
    const back = fromScene(...s);
    for (const k of ['x', 'y', 'z']) near(back[k], v[k], 1e-9, k);
  }
});

test('Earth group rotation.y = GMST is exactly ECF → ECI', () => {
  const r = rng(2);
  for (let i = 0; i < 200; i++) {
    const v = { x: (r() - 0.5) * 2e4, y: (r() - 0.5) * 2e4, z: (r() - 0.5) * 2e4 };
    const theta = r() * 2 * Math.PI;
    const viaEci = toScene(...Object.values(ecfToEci(v, theta)));
    const viaGroup = rotY(toScene(v.x, v.y, v.z), theta);
    viaEci.forEach((c, k) => near(viaGroup[k], c, 1e-12, 'component'));
  }
});

test('landmarks land on the axes the globe texture expects', () => {
  const s0 = geodeticToScene(0, 0);
  near(s0[0], 1, 1e-12, 'lat 0 lon 0 → +X');
  const s90 = geodeticToScene(0, 90);
  near(s90[2], -1, 1e-12, 'lon 90°E → −Z (three.js SphereGeometry u = 0.75)');
  const np = geodeticToScene(90, 0);
  near(np[1], WGS84_B / ER_KM, 1e-12, 'north pole → +Y at the polar radius');
});

test('geodetic ↔ ECF round-trip is exact from the ground to beyond GEO, including the poles', () => {
  const r = rng(3);
  const cases = [[90, 0, 0], [-90, 45, 400], [89.9999, 10, 20000], [0, 180, 35786], [10.29306, 123.90194, 0.034]];
  for (let i = 0; i < 300; i++) cases.push([(r() - 0.5) * 180, (r() - 0.5) * 360, r() * 50000 - 10]);
  for (const [lat, lon, h] of cases) {
    const g = ecfToGeodetic(geodeticToEcf(lat * DEG, lon * DEG, h));
    near(g.lat / DEG, lat, 1e-9, 'lat');
    if (Math.abs(lat) < 89.99) near(((g.lon / DEG - lon + 540) % 360) - 180, 0, 1e-9, 'lon');
    near(g.h, h, 1e-6, 'height km');
  }
});

test('ecfToGeodetic agrees with satellite.js away from the poles', () => {
  const r = rng(4);
  for (let i = 0; i < 200; i++) {
    const lat = (r() - 0.5) * 160;
    const lon = (r() - 0.5) * 360;
    const h = r() * 40000;
    const e = geodeticToEcf(lat * DEG, lon * DEG, h);
    const ours = ecfToGeodetic(e);
    const theirs = eciToGeodetic(e, 0);
    near(ours.lat, theirs.latitude, 1e-9, 'lat rad');
    near(ours.h, theirs.height, 1e-5, 'height km');
  }
});

test('geodetic normal is a unit vector perpendicular to the ellipsoid', () => {
  const n = geodeticNormal(30 * DEG, 40 * DEG);
  near(Math.hypot(n.x, n.y, n.z), 1, 1e-15, '|n|');
  near(Math.asin(n.z) / DEG, 30, 1e-12, 'normal latitude = geodetic latitude');
});

// Shared helpers for GlobalS's node:test suites (no npm — run with `node --test "tests/**/*.test.mjs"`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);

export const readText = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
export const readJson = (rel) => JSON.parse(readText(rel));

/** Assert |actual − expected| ≤ tol with a readable message. */
export function near(actual, expected, tol, what = 'value') {
  const d = Math.abs(actual - expected);
  assert.ok(Number.isFinite(actual) && d <= tol, `${what}: got ${actual}, expected ${expected} (|Δ| = ${d}, tol ${tol})`);
}

/** Smallest signed difference between two angles in degrees, in (−180, 180]. */
export const angDiffDeg = (a, b) => {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
};

/** Assert two angles (degrees) agree within tol, handling wrap-around. */
export function nearAngle(actual, expected, tol, what = 'angle') {
  const d = Math.abs(angDiffDeg(actual, expected));
  assert.ok(d <= tol, `${what}: got ${actual}°, expected ${expected}° (|Δ| = ${d}°, tol ${tol}°)`);
}

/** Deterministic pseudo-random numbers for property tests. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The default GlobalS observer used by the Skyfield references. */
export const CEBU = { latDeg: 10.29306, lonDeg: 123.90194, hKm: 0.034 };

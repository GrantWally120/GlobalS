// SGP4 conformance: the vendored satellite.js against David Vallado's C++ verification output
// (tcppver.out, "Revisiting Spacetrack Report #3", AIAA 2006-6753), using the same procedure and
// tolerance as python-sgp4's own test suite (both files ship in the sgp4 2.27 sdist, MIT).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sgp4, twoline2satrec } from '../js/core/sat.js';
import { readText } from './helpers.mjs';

const TOL = 2e-7; // km and km/s — python-sgp4 uses the same bound against the C++ output

function referenceBlocks() {
  const blocks = [];
  for (const line of readText('tests/fixtures/sgp4-verification/tcppver.out').split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.includes('xx')) blocks.push({ satnum: Number(line.trim().split(/\s+/)[0]), rows: [] });
    else blocks.at(-1).rows.push(line.trim().split(/\s+/).slice(0, 7).map(Number));
  }
  return blocks;
}

function generate(satrec, line2, errors) {
  const rows = [];
  const state = (t) => {
    const pv = sgp4(satrec, t);
    if (!pv) return null;
    const { position: r, velocity: v } = pv;
    return [t, r.x, r.y, r.z, v.x, v.y, v.z];
  };
  const first = state(0);
  if (!first) {
    errors.push(satrec.error);
    return null; // tcppver.out repeats the previous satellite's line here
  }
  rows.push(first);
  const [tstart, tend, tstep] = line2.slice(69).trim().split(/\s+/).map(Number);
  let t = tstart;
  while (t <= tend) {
    if (t === 0 && tstart === 0) {
      t += tstep;
      continue;
    }
    const s = state(t);
    if (!s) {
      errors.push(satrec.error);
      return rows;
    }
    rows.push(s);
    t += tstep;
  }
  if (t - tend < tstep - 1e-6) {
    const s = state(tend);
    if (!s) {
      errors.push(satrec.error);
      return rows;
    }
    rows.push(s);
  }
  return rows;
}

test('satellite.js reproduces Vallado verification output within 2e-7 km, km/s', () => {
  const lines = readText('tests/fixtures/sgp4-verification/SGP4-VER.TLE').split(/\r?\n/);
  const blocks = referenceBlocks();
  const errors = [];
  let compared = 0;
  let k = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('1 ')) continue;
    const line1 = lines[i];
    const line2 = lines[++i];
    const satrec = twoline2satrec(line1, line2.slice(0, 69));
    const block = blocks[k++];
    assert.equal(block.satnum, Number(line1.substring(2, 7)), 'reference block order');
    const rows = generate(satrec, line2, errors);
    if (rows === null) {
      assert.equal(block.rows.length, 1, `satellite ${block.satnum}: error at epoch`);
      continue;
    }
    assert.equal(rows.length, block.rows.length, `satellite ${block.satnum}: number of output lines`);
    rows.forEach((row, j) => {
      row.forEach((value, c) => {
        const d = Math.abs(value - block.rows[j][c]);
        assert.ok(d < TOL, `satellite ${block.satnum} line ${j} column ${c}: |Δ| = ${d}`);
      });
      compared++;
    });
  }
  assert.equal(k, blocks.length, 'every reference block consumed');
  assert.deepEqual(errors, [1, 1, 6, 6, 4, 3, 6], 'SGP4 error codes for the deliberately broken cases');
  assert.ok(compared > 500, `compared ${compared} states`);
});

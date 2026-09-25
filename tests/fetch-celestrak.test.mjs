// The CelesTrak relay, exercised against a mocked network (no requests leave the machine).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GROUPS, run } from '../tools/fetch-celestrak.mjs';
import { readJson } from './helpers.mjs';

const REF = readJson('tests/fixtures/omm/ref-objects.json');
const NOW = Date.UTC(2026, 8, 25, 0, 0, 0);
const PREV = 'https://example.test/GlobalS/data';

// active = all REF objects; each small group gets one or two of them.
const groupData = {
  active: REF,
  stations: [REF[0]],
  visual: [REF[0], REF[1]],
  'gps-ops': [REF[2]],
  weather: [REF[1]],
};

function mockNet({ gp = () => null, previous = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith('https://celestrak.org/')) {
      const group = new URL(url).searchParams.get('GROUP');
      const custom = gp(group, calls.filter((c) => c.includes(`GROUP=${group}&`)).length);
      if (custom) return custom;
      const data = groupData[group];
      return data ? new Response(JSON.stringify(data), { status: 200 }) : new Response('No GP data found', { status: 200 });
    }
    if (previous && url.startsWith(PREV)) {
      const file = new URL(url).pathname.split('/').pop();
      return previous[file] ? new Response(JSON.stringify(previous[file])) : new Response('nope', { status: 404 });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

const quiet = () => {};
const sleeps = [];
const sleep = async (ms) => { sleeps.push(ms); };
const out = () => mkdtempSync(join(tmpdir(), 'globals-data-'));
const gpCalls = (calls) => calls.filter((c) => c.startsWith('https://celestrak.org/'));

async function freshDeployment() {
  const dir = out();
  const { fetchImpl } = mockNet();
  const manifest = await run({ out: dir, fetchImpl, sleep, now: () => NOW, log: quiet });
  const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return { manifest, previous: { 'manifest.json': manifest, 'catalog.json': read('catalog.json'), 'groups.json': read('groups.json') } };
}

test('fresh run: every group requested once, 2 s apart, output de-duplicated and versioned', async () => {
  sleeps.length = 0;
  const dir = out();
  const { fetchImpl, calls } = mockNet();
  const m = await run({ out: dir, fetchImpl, sleep, now: () => NOW, log: quiet });
  assert.equal(gpCalls(calls).length, GROUPS.length);
  assert.equal(sleeps.filter((s) => s === 2000).length, GROUPS.length - 1);
  assert.equal(m.groups.active.status, 'fresh');
  assert.equal(m.groups['glo-ops'].status, 'invalid', 'a group with no data is marked, not fatal');
  const catalog = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8'));
  assert.equal(catalog.length, REF.length, 'union of groups de-duplicated by NORAD id');
  assert.ok(catalog.every((o) => !('EPHEMERIS_TYPE' in o)), 'only the needed fields are kept');
  const groups = JSON.parse(readFileSync(join(dir, 'groups.json'), 'utf8'));
  assert.deepEqual(groups.stations, [90001]);
  assert.match(m.files.catalog, /^catalog\.json\?v=[0-9a-f]{12}$/);
  assert.equal(m.counts.objects, REF.length);
});

test('reuse guard: nothing is downloaded when the deployed data is under 2 hours old', async () => {
  const { previous } = await freshDeployment();
  const { fetchImpl, calls } = mockNet({ previous });
  const m = await run({ out: out(), previous: PREV, fetchImpl, sleep, now: () => NOW + 3600e3, log: quiet });
  assert.equal(gpCalls(calls).length, 0, 'CelesTrak not contacted');
  assert.equal(m.groups.active.status, 'reused');
  assert.equal(m.counts.objects, REF.length);
});

test('--force ignores the reuse guard', async () => {
  const { previous } = await freshDeployment();
  const { fetchImpl, calls } = mockNet({ previous });
  await run({ out: out(), previous: PREV, force: true, fetchImpl, sleep, now: () => NOW + 3600e3, log: quiet });
  assert.equal(gpCalls(calls).length, GROUPS.length);
});

test('HTTP 403 trips the circuit breaker; every group falls back to the previous deployment', async () => {
  const { previous } = await freshDeployment();
  const { fetchImpl, calls } = mockNet({ previous, gp: () => new Response('Forbidden', { status: 403 }) });
  const m = await run({ out: out(), previous: PREV, fetchImpl, sleep, now: () => NOW + 3 * 3600e3, log: quiet });
  assert.equal(gpCalls(calls).length, 1, 'stopped after the first 403');
  assert.equal(m.groups.active.status, 'fallback');
  assert.equal(m.groups.active.reason, 'blocked');
  assert.equal(m.counts.objects, REF.length, 'no data lost');
});

test('a 5xx is retried once after ≥30 s; a 4xx is never retried', async () => {
  sleeps.length = 0;
  const { fetchImpl, calls } = mockNet({
    gp: (g, n) => {
      if (g === 'active' && n === 1) return new Response('busy', { status: 503 });
      if (g === 'science') return new Response('bad', { status: 400 });
      return null;
    },
  });
  const m = await run({ out: out(), fetchImpl, sleep, now: () => NOW, log: quiet });
  assert.equal(m.groups.active.status, 'fresh');
  assert.ok(sleeps.some((s) => s >= 30_000), 'backed off before retrying');
  assert.equal(gpCalls(calls).filter((c) => c.includes('GROUP=science&')).length, 1);
  assert.equal(m.groups.science.status, 'invalid');
});

test('invalid records are dropped and counted; a shrunken catalogue is rejected', async () => {
  const bad = [...REF, { ...REF[0], NORAD_CAT_ID: 55555, ECCENTRICITY: 1.3 }, { ...REF[0], NORAD_CAT_ID: 55556, EPOCH: 'yesterday' }];
  const one = mockNet({ gp: (g) => (g === 'active' ? new Response(JSON.stringify(bad)) : null) });
  const m1 = await run({ out: out(), fetchImpl: one.fetchImpl, sleep, now: () => NOW, log: quiet });
  assert.equal(m1.dropped.invalid, 2);
  assert.equal(m1.counts.objects, REF.length);

  const { previous } = await freshDeployment();
  const tiny = mockNet({ previous, gp: (g) => (g === 'active' ? new Response(JSON.stringify(REF.slice(0, 2))) : null) });
  const m2 = await run({ out: out(), previous: PREV, fetchImpl: tiny.fetchImpl, sleep, now: () => NOW + 3 * 3600e3, log: quiet });
  assert.equal(m2.groups.active.status, 'fallback', 'fewer than half the previous objects');
  assert.equal(m2.counts.objects, REF.length);
});

// The service worker's caching rules, run in Node against an in-memory Cache API and a scripted
// network. (Browser-level behaviour — install prompts, real offline reloads — is checked by hand.)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { stamp } from '../tools/stamp-sw.mjs';
import { readText } from './helpers.mjs';

const ORIGIN = 'https://example.test';
const APP = `${ORIGIN}/GlobalS/`;
const SHELL_FILES = ['index.html', 'js/main.js', 'css/globals.css'];

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A stamped sw.js for a tiny site (or the unstamped source when dev = true). */
function swSource({ dev = false } = {}) {
  if (dev) return readText('sw.js');
  const dir = mkdtempSync(join(tmpdir(), 'globals-sw-'));
  dirs.push(dir);
  for (const f of [...SHELL_FILES, 'assets/textures/earth-day.jpg']) {
    mkdirSync(join(dir, ...f.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...f.split('/')), `content of ${f}`);
  }
  writeFileSync(join(dir, 'sw.js'), readText('sw.js'));
  const { version } = stamp(dir);
  return { src: readFileSync(join(dir, 'sw.js'), 'utf8'), version };
}

class MemoryCache {
  constructor() { this.entries = new Map(); }
  static key(req) { return typeof req === 'string' ? req : req.url; }
  async match(req) {
    const e = this.entries.get(MemoryCache.key(req));
    return e ? new Response(e.body, { status: e.status, headers: e.headers }) : undefined;
  }
  async put(req, res) {
    const body = await res.arrayBuffer();
    this.entries.set(MemoryCache.key(req), { body, status: res.status, headers: [...res.headers] });
  }
  async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
  async delete(req) { return this.entries.delete(MemoryCache.key(req)); }
  async addAll(requests) {
    for (const r of requests) {
      const res = await this.fetch(r);
      if (!res.ok) throw new TypeError(`addAll: ${r.url} → ${res.status}`);
      await this.put(r, res);
    }
  }
}

/**
 * Load the worker into a fresh sandbox. `net(url, request)` plays the network: return a Response,
 * a Promise, or throw for "offline".
 */
function boot(src, net) {
  const listeners = {};
  const stores = new Map();
  const log = { fetched: [], skipWaiting: 0, claimed: 0 };
  const fetchImpl = async (input) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    log.fetched.push(url);
    return net(url, input);
  };
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        const c = new MemoryCache();
        c.fetch = fetchImpl;
        stores.set(name, c);
      }
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const sandbox = {
    location: new URL(`${APP}sw.js`),
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    skipWaiting: () => { log.skipWaiting++; },
    clients: { claim: async () => { log.claimed++; } },
    caches, fetch: fetchImpl, Request, Response, Headers, URL, Promise, console,
    setTimeout: (fn, _ms, ...args) => setTimeout(fn, 0, ...args), // the 4 s manifest timeout, instantly
  };
  sandbox.self = sandbox;
  vm.runInNewContext(src, sandbox);

  async function extendable(type, props = {}) {
    const waits = [];
    const ev = { ...props, waitUntil: (p) => waits.push(p) };
    for (const fn of listeners[type] ?? []) fn(ev);
    await Promise.all(waits);
    return ev;
  }
  async function request(url, { mode = 'cors', method = 'GET' } = {}) {
    const waits = [];
    let responded = null;
    const ev = {
      request: { url, mode, method },
      respondWith: (p) => { responded = Promise.resolve(p); },
      waitUntil: (p) => waits.push(p),
    };
    for (const fn of listeners.fetch ?? []) fn(ev);
    if (!responded) return { handled: false };
    const settled = await responded.then((res) => ({ res }), (error) => ({ error }));
    // Background work (cache writes) normally finishes at once; a stalled download never does.
    await Promise.race([Promise.allSettled(waits), new Promise((r) => { setTimeout(r, 50); })]);
    return { handled: true, ...settled };
  }
  return { stores, log, caches, install: () => extendable('install'), activate: () => extendable('activate'), message: (data) => extendable('message', { data }), request };
}

const ok = (body, headers = {}) => new Response(body, { status: 200, headers });
const offline = () => { throw new TypeError('Failed to fetch'); };
const text = async (res) => res.text();

async function installed(net = (url) => ok(`net:${url}`)) {
  const { src, version } = swSource();
  const sw = boot(src, net);
  await sw.install();
  await sw.activate();
  return { sw, version };
}

test('install downloads every app file into the versioned shell cache', async () => {
  const { sw, version } = await installed();
  const shell = sw.stores.get(`globals-shell-${version}`);
  assert.deepEqual([...shell.entries.keys()].sort(), [...SHELL_FILES, 'version.json'].map((f) => APP + f).sort());
  assert.equal(sw.log.claimed, 1);
});

test('activation removes old app and imagery caches but keeps data and other sites\' caches', async () => {
  const { src, version } = swSource();
  const sw = boot(src, (url) => ok(url));
  for (const name of ['globals-shell-0000', 'globals-tex-0000', 'globals-data', 'someone-elses-cache']) await (await sw.caches.open(name)).put(`${APP}x`, ok('x'));
  await sw.install();
  await sw.activate();
  assert.deepEqual(new Set(await sw.caches.keys()), new Set([`globals-shell-${version}`, 'globals-data', 'someone-elses-cache']));
});

test('every launch URL opens the cached app page, even offline', async () => {
  const { sw } = await installed();
  const net = sw.log.fetched.length;
  for (const url of [APP, `${APP}?source=pwa`, `${APP}?tab=passes`, `${APP}index.html`]) {
    const r = await sw.request(url, { mode: 'navigate' });
    assert.ok(r.handled, url);
    assert.match(await text(r.res), /index\.html/);
  }
  assert.equal(sw.log.fetched.length, net, 'no network needed');
  assert.equal((await sw.request(`${APP}ATTRIBUTION.md`, { mode: 'navigate' })).handled, false);
});

test('app files come from the cache; foreign and non-GET requests are left alone', async () => {
  const { sw } = await installed();
  const net = sw.log.fetched.length;
  const r = await sw.request(`${APP}js/main.js`);
  assert.equal(await text(r.res), `net:${APP}js/main.js`); // what install downloaded
  assert.equal(sw.log.fetched.length, net);
  assert.equal((await sw.request('https://celestrak.org/NORAD/elements/gp.php')).handled, false);
  assert.equal((await sw.request(`${ORIGIN}/OtherApp/index.html`)).handled, false);
  assert.equal((await sw.request(`${APP}js/main.js`, { method: 'POST' })).handled, false);
});

test('data manifest: the network wins, and the kept snapshot answers when it fails or stalls', async () => {
  let mode = 'online';
  const { sw } = await installed((url) => {
    if (!url.includes('/data/')) return ok(`net:${url}`);
    if (mode === 'offline') offline();
    if (mode === 'stalled') return new Promise(() => {});
    if (mode === 'missing') return new Response('nope', { status: 404 });
    return ok(url.includes('manifest') ? '{"version":"new"}' : `data:${url}`);
  });
  let r = await sw.request(`${APP}data/manifest.json`);
  assert.equal(await text(r.res), '{"version":"new"}');
  assert.equal(r.res.headers.get('x-globals-from-cache'), null);

  mode = 'missing';
  r = await sw.request(`${APP}data/manifest.json`);
  assert.equal(r.res.status, 404, 'nothing kept yet: pass the answer on');

  mode = 'online';
  await sw.message({
    type: 'KEEP_DATA', manifestUrl: `${APP}data/manifest.json`, manifest: { version: 'kept', files: {} },
    files: [`${APP}data/catalog.json?v=kept`, `${APP}data/groups.json?v=kept`],
  });
  for (mode of ['offline', 'stalled', 'missing']) {
    r = await sw.request(`${APP}data/manifest.json`);
    assert.deepEqual(JSON.parse(await text(r.res)), { version: 'kept', files: {} }, mode);
    assert.equal(r.res.headers.get('x-globals-from-cache'), '1', `${mode}: marked as cached so its Date isn't trusted`);
  }
});

test('catalogue files: cache-first by version, falling back to the kept snapshot', async () => {
  let online = true;
  const { sw } = await installed((url) => {
    if (!online) offline();
    return ok(`data:${url}`);
  });
  const v1 = `${APP}data/catalog.json?v=1`;
  const v2 = `${APP}data/catalog.json?v=2`;
  await sw.message({ type: 'KEEP_DATA', manifestUrl: `${APP}data/manifest.json`, manifest: { files: {} }, files: [v1] });

  const before = sw.log.fetched.length;
  let r = await sw.request(v1);
  assert.equal(await text(r.res), `data:${v1}`);
  assert.equal(sw.log.fetched.length, before, 'a versioned file is never downloaded twice');

  online = false;
  r = await sw.request(v2);
  assert.equal(await text(r.res), `data:${v1}`, 'new version unreachable: use the snapshot');
  assert.equal(r.res.headers.get('x-globals-from-cache'), '1');
  r = await sw.request(`${APP}data/groups.json?v=2`);
  assert.ok(r.error, 'nothing to fall back to: fail like the network did');

  online = true;
  r = await sw.request(v2);
  assert.equal(await text(r.res), `data:${v2}`);
  assert.ok(sw.stores.get('globals-data').entries.has(v2), 'downloaded versions are cached');
});

test('KEEP_DATA keeps exactly one consistent snapshot and ignores anything outside data/', async () => {
  const { sw } = await installed((url) => ok(`data:${url}`));
  const snap = (v) => ({
    type: 'KEEP_DATA', manifestUrl: `${APP}data/manifest.json`, manifest: { version: v, files: {} },
    files: [`${APP}data/catalog.json?v=${v}`, `${APP}data/groups.json?v=${v}`],
  });
  await sw.message(snap('a'));
  await sw.message(snap('b'));
  const data = sw.stores.get('globals-data');
  assert.deepEqual([...data.entries.keys()].sort(), [`${APP}data/catalog.json?v=b`, `${APP}data/groups.json?v=b`, `${APP}data/manifest.json`]);

  await sw.message({ ...snap('c'), files: ['https://evil.test/data/catalog.json'] });
  await sw.message({ ...snap('c'), manifestUrl: `${APP}js/main.js` });
  assert.deepEqual(JSON.parse(await text(await data.match(`${APP}data/manifest.json`))).version, 'b');
});

test('a failed download never replaces the kept snapshot', async () => {
  let fail = false;
  const { sw } = await installed((url) => (fail && url.includes('v=b') ? new Response('', { status: 503 }) : ok(`data:${url}`)));
  const snap = (v) => ({ type: 'KEEP_DATA', manifestUrl: `${APP}data/manifest.json`, manifest: { version: v, files: {} }, files: [`${APP}data/catalog.json?v=${v}`] });
  await sw.message(snap('a'));
  fail = true;
  await sw.message(snap('b'));
  const data = sw.stores.get('globals-data');
  assert.ok(data.entries.has(`${APP}data/catalog.json?v=a`));
  assert.equal(JSON.parse(await text(await data.match(`${APP}data/manifest.json`))).version, 'a');
});

test('NASA imagery is downloaded once, then served from its own cache', async () => {
  const { sw } = await installed();
  const url = `${APP}assets/textures/earth-day.jpg`;
  await sw.request(url);
  const n = sw.log.fetched.filter((u) => u === url).length;
  const r = await sw.request(url);
  assert.equal(await text(r.res), `net:${url}`);
  assert.equal(sw.log.fetched.filter((u) => u === url).length, n);
});

test('the update button reaches the waiting worker', async () => {
  const { sw } = await installed();
  await sw.message({ type: 'SKIP_WAITING' });
  assert.equal(sw.log.skipWaiting, 1);
});

test('an unstamped (development) worker caches nothing and handles nothing', async () => {
  const sw = boot(swSource({ dev: true }), (url) => ok(url));
  await sw.install();
  await sw.activate();
  assert.deepEqual(await sw.caches.keys(), []);
  assert.equal((await sw.request(APP, { mode: 'navigate' })).handled, false);
  assert.equal((await sw.request(`${APP}data/manifest.json`)).handled, false);
  assert.equal(sw.log.fetched.length, 0);
});

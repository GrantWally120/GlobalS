// GlobalS service worker: once the app has been opened online, it starts and runs offline.
//
// Caches
//   globals-shell-<VERSION>      every app file, downloaded at install. VERSION is a hash of those
//                                files, so a data-only deploy never makes anyone re-download the app.
//   globals-data                 the orbital data the app last loaded successfully (one consistent
//                                snapshot: manifest + the catalogue files it names).
//   globals-tex-<TEX_VERSION>    NASA imagery, cached the first time the photoreal globe is shown.
//
// VERSION, TEX_VERSION and PRECACHE are filled in at deploy time by tools/stamp-sw.mjs. Unstamped
// (a development checkout) the worker stays out of the way and every request goes to the network.

const VERSION = '__VERSION__';
const TEX_VERSION = '__TEX_VERSION__';
const PRECACHE = [/*__PRECACHE__*/];

const DEV = VERSION.startsWith('__');
const SHELL = `globals-shell-${VERSION}`;
const DATA = 'globals-data';
const TEX = `globals-tex-${TEX_VERSION}`;
const FROM_CACHE = 'x-globals-from-cache'; // same name as FROM_CACHE_HEADER in js/data/loader.js
const MANIFEST_TIMEOUT_MS = 4000;

const ROOT = new URL('./', self.location.href); // the app's folder, where this file lives
const DATA_ROOT = new URL('data/', ROOT).href;
const SHELL_PATHS = new Set(PRECACHE);
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  if (DEV) return;
  // cache: 'reload' skips the HTTP cache, so a new version never mixes in files from the last one.
  event.waitUntil(caches.open(SHELL).then((cache) =>
    cache.addAll(PRECACHE.map((path) => new Request(new URL(path, ROOT), { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = DEV ? new Set() : new Set([SHELL, DATA, TEX]);
    for (const key of await caches.keys()) {
      if (key.startsWith('globals-') && !keep.has(key)) await caches.delete(key);
    }
    if (!DEV) await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'SKIP_WAITING') self.skipWaiting();
  else if (msg?.type === 'KEEP_DATA' && !DEV) event.waitUntil(keepData(msg).catch(() => {}));
});

self.addEventListener('fetch', (event) => {
  if (DEV) return;
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const path = url.pathname.slice(ROOT.pathname.length);

  if (request.mode === 'navigate') {
    if (path === '' || path === 'index.html') event.respondWith(appPage(request));
    return;
  }
  if (path === 'data/manifest.json') event.respondWith(dataManifest(event));
  else if (path.startsWith('data/')) event.respondWith(dataFile(event, url));
  else if (path.startsWith('assets/textures/')) event.respondWith(texture(event, url));
  else if (SHELL_PATHS.has(path)) event.respondWith(shellFile(request, path));
});

/** Every launch URL (./, ?source=pwa, ?tab=…) gets the cached app page. */
async function appPage(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(new URL('index.html', ROOT).href, MATCH);
  if (!hit) return fetch(request);
  // A navigation can't be answered with a response that was itself redirected.
  return hit.redirected ? new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: hit.headers }) : hit;
}

async function shellFile(request, path) {
  const cache = await caches.open(SHELL);
  return (await cache.match(new URL(path, ROOT).href, MATCH)) ?? fetch(request);
}

/** The cached copy says so in a header, so the page doesn't read its old Date as the current time. */
function fromCache(res) {
  const headers = new Headers(res.headers);
  headers.set(FROM_CACHE, '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Network first — it says whether newer data exists — but never wait more than 4 s for it. */
async function dataManifest(event) {
  const network = fetch(event.request);
  event.waitUntil(network.then(() => {}, () => {}));
  const timeout = new Promise((resolve) => { setTimeout(resolve, MANIFEST_TIMEOUT_MS, null); });
  const res = await Promise.race([network, timeout]).catch(() => null);
  if (res?.ok) return res;
  const cached = await (await caches.open(DATA)).match(new URL('manifest.json', DATA_ROOT).href, MATCH);
  if (cached) return fromCache(cached);
  return res ?? network; // nothing cached yet: all we can do is wait for the network
}

/**
 * Catalogue files are named by version (catalog.json?v=…), so a cached copy is always right.
 * If a new version can't be downloaded, fall back to the cached snapshot rather than nothing.
 */
async function dataFile(event, url) {
  const cache = await caches.open(DATA);
  const versioned = url.searchParams.has('v');
  if (versioned) {
    const hit = await cache.match(url.href, MATCH);
    if (hit) return hit;
  }
  try {
    const res = await fetch(event.request);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (versioned) event.waitUntil(cache.put(url.href, res.clone()).catch(() => {}));
    return res;
  } catch (err) {
    for (const req of await cache.keys()) {
      if (new URL(req.url).pathname === url.pathname) return fromCache(await cache.match(req, MATCH));
    }
    throw err;
  }
}

async function texture(event, url) {
  const cache = await caches.open(TEX);
  const hit = await cache.match(url.href, MATCH);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.ok) event.waitUntil(cache.put(url.href, res.clone()).catch(() => {}));
  return res;
}

/**
 * The page reports the data it has just loaded successfully; keep exactly that snapshot for
 * offline starts. The files are normally still in the HTTP cache, so this rarely downloads anything.
 */
async function keepData({ manifestUrl, manifest, files }) {
  const inData = (u) => typeof u === 'string' && u.startsWith(DATA_ROOT);
  if (!inData(manifestUrl) || !manifest?.files || !Array.isArray(files) || !files.every(inData)) return;
  const cache = await caches.open(DATA);
  for (const file of files) {
    if (await cache.match(file, MATCH)) continue;
    const res = await fetch(file);
    if (!res.ok) return; // incomplete: keep the previous snapshot
    await cache.put(file, res);
  }
  await cache.put(manifestUrl, new Response(JSON.stringify(manifest), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  }));
  const keep = new Set([manifestUrl, ...files]);
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

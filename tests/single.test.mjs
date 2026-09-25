// The downloadable single-file build (tools/build-single.mjs) and where the app looks for data.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FEED_URLS } from '../js/config.js';
import { dataCandidates, resolveData } from '../js/data/loader.js';
import { buildSingle } from '../tools/build-single.mjs';
import { stage } from '../tools/stage-site.mjs';

const built = buildSingle();
const bundleJson = /<script type="application\/json" id="globals-bundle">([\s\S]*?)<\/script>/.exec(built.html)?.[1];
const bundle = JSON.parse(bundleJson);
const deps = (src) => [...src.matchAll(/\uFDD0M:([\w./-]+)/g)].map((m) => m[1]);

test('single file: one self-contained page, no module or network loading left', () => {
  const { html } = built;
  for (const gone of ['type="importmap"', 'rel="modulepreload"', 'rel="manifest"', 'src="js/main.js"', 'href="css/globals.css"', 'apple-touch-icon']) {
    assert.ok(!html.includes(gone), `${gone} should be gone`);
  }
  assert.ok(html.includes('<link rel="icon" href="data:image/svg+xml;base64,'));
  assert.match(html, /<style>\n[\s\S]*--cyan/);
  assert.ok(!bundleJson.includes('<'), 'no "<" inside the bundle, so it can never close its <script>');
  assert.equal(html.match(/<script type="application\/json" id="globals-bundle">/g).length, 1);
  assert.ok(built.stats.bytes < 16 * 1048576, `${(built.stats.bytes / 1048576).toFixed(1)} MB`);
  assert.equal(bundle.build, built.build);
  assert.equal(buildSingle().html, html, 'deterministic');
});

test('single file: modules load dependencies first, and every import points inside the bundle', () => {
  const check = (order, what) => {
    const seen = new Set();
    for (const p of order) {
      const src = bundle.modules[p];
      assert.ok(src !== undefined, `${what}: ${p} missing from the bundle`);
      for (const d of deps(src)) assert.ok(seen.has(d), `${what}: ${p} imports ${d} before it is loaded`);
      seen.add(p);
    }
  };
  check(bundle.page, 'page');
  assert.equal(bundle.page.at(-1), bundle.entry);
  assert.equal(bundle.entry, 'js/main.js');
  assert.deepEqual(Object.keys(bundle.workers), ['js/workers/passes.worker.js', 'js/workers/propagator.worker.js']);
  for (const [w, order] of Object.entries(bundle.workers)) {
    check(order, w);
    assert.equal(order.at(-1), w);
    assert.ok(!order.some((p) => p.startsWith('vendor/three/')), `${w} must not load three.js`);
  }
  for (const [p, src] of Object.entries(bundle.modules)) {
    assert.ok(!/^[ \t]*(?:import|export)\b[^;'"]*?\sfrom\s*['"](?!\uFDD0M:)/m.test(src), `${p}: an import was not rewritten`);
    assert.ok(!/import\.meta\.url/.test(src), `${p}: import.meta.url would point at a blob: URL`);
  }
  const main = bundle.modules['js/main.js'];
  assert.ok(main.includes("new URL('\uFDD0W:js/workers/propagator.worker.js')"));
  assert.ok(main.includes("new URL('\uFDD0W:js/workers/passes.worker.js')"));
});

test('single file: a checkout with Windows (CRLF) line endings builds the identical file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'globals-crlf-'));
  try {
    const dir = join(tmp, 'site');
    stage(dir);
    for (const f of ['index.html', 'css/globals.css', 'js/main.js', 'js/workers/propagator.worker.js',
      'vendor/three/examples/jsm/controls/OrbitControls.js', 'assets/icons/icon.svg']) {
      const p = join(dir, ...f.split('/'));
      writeFileSync(p, readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    assert.equal(buildSingle(dir).html, built.html);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the small starter file (e.g. in Google Drive) loads this build from the app branch', () => {
  const starter = readFileSync(new URL('../launcher/GlobalS.html', import.meta.url), 'utf8');
  const marker = new RegExp(/GlobalS single-file build (\w+)/.source);
  assert.equal(marker.exec(built.html)?.[1], built.build, 'the build carries the marker the starter checks for');
  assert.ok(starter.includes('/GlobalS single-file build (\\w+)/'), 'the starter checks for that marker');
  assert.ok(starter.includes("'https://raw.githubusercontent.com/GrantWally120/GlobalS/app/GlobalS.html'"));
  assert.ok(Buffer.byteLength(starter) < 8000, 'small enough to hand around');
});

test('single file: the map, stars and NASA imagery are embedded', () => {
  const { assets } = bundle;
  assert.deepEqual(Object.keys(assets).sort(), [
    'assets/geo/countries-50m.json', 'assets/stars/constellations.lines.json', 'assets/stars/stars.6.json',
    'assets/textures/earth-day.jpg', 'assets/textures/earth-night.jpg',
  ]);
  assert.equal(JSON.parse(assets['assets/stars/stars.6.json'].text).features.length, 5044);
  for (const t of ['assets/textures/earth-day.jpg', 'assets/textures/earth-night.jpg']) {
    assert.match(assets[t].dataUrl, /^data:image\/jpeg;base64,\/9j\//, `${t} is a JPEG`);
  }
});

test('data sources: the web app reads its own site first; the single file goes straight to the feed', () => {
  const params = new URLSearchParams();
  const site = dataCandidates(params, { isLocal: false, single: false, here: 'https://grantwally120.github.io/GlobalS/' });
  assert.deepEqual(site.map(([s]) => s), ['site', 'feed', 'feed']);
  assert.ok(!site.some(([, u]) => u.startsWith('https://grantwally120.github.io/')), 'the site is not its own feed');
  const file = dataCandidates(params, { isLocal: false, single: true, here: 'file:///C:/Users/Grant/Downloads/GlobalS.html' });
  assert.deepEqual(file.map(([, u]) => u), FEED_URLS);
  assert.equal(FEED_URLS[0], 'https://raw.githubusercontent.com/GrantWally120/GlobalS/data/');
  const local = dataCandidates(params, { isLocal: true, single: false, here: 'http://localhost:8080/' });
  assert.deepEqual(local.map(([s]) => s), ['site', 'feed', 'feed', 'feed', 'demo']);
  assert.deepEqual(dataCandidates(new URLSearchParams('data=fixtures'), { isLocal: false, single: true, here: 'x' }), [['demo', './fixtures/data/']]);
});

test('data sources: an unreachable or broken feed falls through to the next one', async () => {
  const manifest = { version: 'v1', files: { catalog: 'catalog.json?v=v1' } };
  const tried = [];
  const fetchImpl = async (url) => {
    tried.push(String(url));
    if (String(url).startsWith(FEED_URLS[0])) throw new TypeError('Failed to fetch'); // e.g. rate-limited
    return new Response(JSON.stringify(manifest), { headers: { date: new Date(0).toUTCString() } });
  };
  const data = await resolveData(new URLSearchParams(), { isLocal: false, single: true, here: 'file:///x/GlobalS.html', fetchImpl });
  assert.deepEqual(tried, [`${FEED_URLS[0]}manifest.json`, `${FEED_URLS[1]}manifest.json`]);
  assert.equal(data.source, 'feed');
  assert.equal(data.base, FEED_URLS[1]);
  assert.equal(data.clockChecked, false, "a cross-origin feed can't tell us the time");
  assert.equal(data.clockOffsetMs, 0, 'a wrong-looking Date from a feed is ignored');
  const none = await resolveData(new URLSearchParams(), { isLocal: false, single: true, here: 'file:///x', fetchImpl: async () => new Response('', { status: 404 }) });
  assert.equal(none, null);
});

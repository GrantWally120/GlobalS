// Deploy tooling: staging, service-worker stamping, the module-graph checker, and the manifest.
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { FROM_CACHE_HEADER } from '../js/data/loader.js';
import { checkSite } from '../tools/check-imports.mjs';
import { checkTarget, siteFiles, stage } from '../tools/stage-site.mjs';
import { readPrecache, stamp } from '../tools/stamp-sw.mjs';
import { readJson, readText } from './helpers.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const made = [];
const tmp = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `globals-${name}-`));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function stagedAndStamped() {
  const dir = join(tmp('site'), '_site');
  stage(dir);
  return { dir, ...stamp(dir) };
}

test('the staged site holds the app and nothing else', () => {
  const files = siteFiles();
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'js/main.js', 'css/globals.css',
    'vendor/three/build/three.module.js', 'vendor/three/LICENSE', 'assets/geo/countries-50m.json', 'assets/icons/icon-512.png']) {
    assert.ok(files.includes(f), `${f} should be published`);
  }
  for (const f of files) {
    assert.ok(!/^(tests|tools|fixtures|\.github|data)\//.test(f), `${f} should not be published`);
    assert.ok(!/(^|\/)\./.test(f), `${f}: no dotfiles`);
  }
  assert.ok(!files.includes('vendor/vendor-lock.json'));
  assert.ok(!files.includes('README.md'));
});

test('staging refuses to wipe the repository or a folder containing it', () => {
  assert.throws(() => checkTarget(ROOT), /Refusing/);
  assert.throws(() => checkTarget(resolve(ROOT, '..')), /Refusing/);
  assert.throws(() => checkTarget('/'), /Refusing/);
  assert.equal(checkTarget(join(ROOT, '_site')), join(ROOT, '_site'));
});

test('stamping fills in the version and a precache list without data or imagery', () => {
  const { dir, version, texVersion, precache } = stagedAndStamped();
  const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
  assert.match(version, /^[0-9a-f]{16}$/);
  assert.match(texVersion, /^[0-9a-f]{12}$/);
  assert.ok(!sw.includes('__VERSION__') && !sw.includes('__PRECACHE__') && !sw.includes('__TEX_VERSION__'));
  assert.ok(sw.includes(`const VERSION = '${version}';`));
  assert.deepEqual(readPrecache(sw), precache);
  assert.ok(precache.includes('index.html') && precache.includes('version.json') && precache.includes('js/main.js'));
  assert.ok(!precache.includes('sw.js'));
  assert.ok(!precache.some((p) => p.startsWith('data/') || p.startsWith('assets/textures/')));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')), { version, texVersion, files: precache.length });
  assert.equal(readPrecache(readText('sw.js')), null, 'the committed sw.js stays unstamped');
});

test('the deployed site is complete: every module, worker and asset resolves and is precached', () => {
  const { dir } = stagedAndStamped();
  const { problems, modules, workerModules } = checkSite(dir, { precache: true });
  assert.deepEqual(problems, []);
  assert.ok(modules.includes('vendor/three/build/three.core.js'));
  assert.ok(workerModules.includes('js/workers/propagator.worker.js') && workerModules.includes('js/workers/passes.worker.js'));
  assert.ok(!workerModules.some((m) => m.startsWith('vendor/three/')), 'workers must not load three.js');
});

test('the version tracks app files only: data deploys keep it, code changes move it', () => {
  const a = stagedAndStamped();
  const b = stagedAndStamped();
  assert.equal(a.version, b.version, 'deterministic');
  assert.equal(readFileSync(join(a.dir, 'sw.js'), 'utf8'), readFileSync(join(b.dir, 'sw.js'), 'utf8'));

  const c = join(tmp('site'), '_site');
  stage(c);
  mkdirSync(join(c, 'data'));
  writeFileSync(join(c, 'data', 'manifest.json'), '{"version":"x"}');
  writeFileSync(join(c, 'assets', 'textures', 'earth-day.jpg'), 'different imagery');
  const withData = stamp(c);
  assert.equal(withData.version, a.version, 'data and imagery do not change the app version');
  assert.notEqual(withData.texVersion, a.texVersion, 'imagery has its own version');

  const d = join(tmp('site'), '_site');
  stage(d);
  appendFileSync(join(d, 'css', 'globals.css'), '\n/* changed */\n');
  assert.notEqual(stamp(d).version, a.version);
});

test('a stamped service worker cannot be stamped again', () => {
  const { dir } = stagedAndStamped();
  const before = readFileSync(join(dir, 'sw.js'), 'utf8');
  assert.throws(() => stamp(dir), /already stamped/);
  assert.equal(readFileSync(join(dir, 'sw.js'), 'utf8'), before);
});

test('the repository itself passes the module-graph check', () => {
  assert.deepEqual(checkSite(ROOT).problems, []);
});

test('the module-graph check catches the mistakes a bundler would', () => {
  const dir = tmp('bad');
  const put = (p, text) => {
    mkdirSync(join(dir, ...p.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...p.split('/')), text);
  };
  put('index.html', `<script type="importmap">{"imports":{"three":"./vendor/three.js"}}</script>
<script type="module" src="js/main.js"></script>`);
  put('sw.js', "const VERSION = '__VERSION__';\nconst TEX_VERSION = '__TEX_VERSION__';\nconst PRECACHE = [/*__PRECACHE__*/];\n");
  put('vendor/three.js', 'export const x = 1;\n');
  put('vendor/satellite.js/dist/index.js', 'export {};\n');
  put('js/main.js', `import * as THREE from 'three';
import { a } from './missing.js';
import {
  b,
} from './core/pure.js';
const w = new Worker(new URL('./w.worker.js', import.meta.url), { type: 'module' });
fetch('assets/nope.json');
`);
  put('js/core/pure.js', "import { x } from 'three';\nexport const b = x;\n");
  put('js/w.worker.js', "import 'three';\nimport '../vendor/satellite.js/dist/index.js';\n");
  const { problems } = checkSite(dir);
  const has = (re) => assert.ok(problems.some((p) => re.test(p)), `expected a problem matching ${re}:\n${problems.join('\n')}`);
  has(/missing module: js\/missing\.js/);
  has(/js\/core\/pure\.js: js\/core must stay pure/);
  has(/js\/w\.worker\.js: bare import 'three' in code a worker loads/);
  has(/imports vendor\/satellite\.js\/dist\/index\.js/);
  has(/missing asset: assets\/nope\.json/);
  assert.ok(!problems.some((p) => /js\/main\.js: bare import 'three'/.test(p)), 'the page may use the import map');
  // --precache on an unstamped worker, and on a precache list that misses a module
  assert.ok(checkSite(dir, { precache: true }).problems.some((p) => /not stamped/.test(p)));
  stamp(dir);
  const sw = readFileSync(join(dir, 'sw.js'), 'utf8').replace(/^ {2}"js\/core\/pure\.js",\n/m, '');
  writeFileSync(join(dir, 'sw.js'), sw);
  assert.ok(checkSite(dir, { precache: true }).problems.some((p) => /js\/core\/pure\.js is used by the app but not precached/.test(p)));
});

test('manifest: installable, scoped, and its shortcuts open real tabs', () => {
  const m = readJson('manifest.webmanifest');
  const html = readText('index.html');
  const base = new URL('https://grantwally120.github.io/GlobalS/');
  const scope = new URL(m.scope, base).href;
  assert.equal(scope, base.href);
  assert.equal(new URL(m.id, new URL(m.start_url, base).origin).href, base.href, 'id resolves to the app folder');
  for (const u of [m.start_url, ...m.shortcuts.map((s) => s.url), ...m.file_handlers.map((f) => f.action)]) {
    assert.ok(new URL(u, base).href.startsWith(scope), `${u} is inside the scope`);
  }
  for (const s of m.shortcuts) {
    const tab = new URL(s.url, base).searchParams.get('tab');
    assert.ok(html.includes(`data-tab="${tab}"`), `shortcut tab ${tab} exists`);
  }
  assert.equal(m.display, 'standalone');
  assert.ok(html.includes('<link rel="manifest" href="manifest.webmanifest">'));
  assert.ok(existsSync(join(ROOT, 'assets/icons/icon-maskable-512.png')));
});

test('service worker and loader agree on the from-cache header', () => {
  assert.ok(readText('sw.js').includes(`const FROM_CACHE = '${FROM_CACHE_HEADER}';`));
});

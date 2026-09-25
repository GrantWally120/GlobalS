#!/usr/bin/env node
// Checks GlobalS's module graph without a browser (there's no bundler to catch mistakes):
//   - every import, worker script, and asset path resolves to a file that exists
//   - bare specifiers ('three') resolve through index.html's import map, and never appear in code a
//     worker loads: import maps don't apply inside workers, so the worker would fail to start
//   - js/core stays pure (only core and the vendored satellite.js / topojson-client), and
//     satellite.js's index.js, which drags in WASM runtimes that only load in Node, is never imported
//   - manifest icons exist and their pixel sizes match what the manifest claims
//   - with --precache, on a stamped staged site: everything the app loads is available offline
//
//   node tools/check-imports.mjs [--root .] [--precache]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPrecache } from './stamp-sw.mjs';

const STATIC_IMPORT = /^[ \t]*(?:import|export)\s+(?:[^;'"`]*?\sfrom\s*)?(['"])([^'"\n]+)\1/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const URL_FROM_MODULE = /new\s+URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const ASSET_LITERAL = /(['"`])((?:assets|css|js|vendor)\/[\w./-]+\.(?:json|js|css|png|jpg|jpeg|svg|webmanifest))\1/g;
const FORBIDDEN = new Map([
  ['vendor/satellite.js/dist/index.js', 'pulls in WASM runtimes whose imports only resolve in Node; import the individual modules via js/core/sat.js'],
]);
const PURE = ['js/core/', 'vendor/satellite.js/', 'vendor/topojson-client/'];
const RUNTIME_CACHED = (p) => p.startsWith('assets/textures/') || p.startsWith('data/');

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

/**
 * @param {string} root site or repository root (where index.html lives)
 * @param {{precache?: boolean}} [opts]
 * @returns {{problems: string[], modules: string[], workerModules: string[], assets: string[]}}
 */
export function checkSite(root, { precache = false } = {}) {
  const problems = [];
  const read = (p) => readFileSync(join(root, ...p.split('/')));
  const exists = (p) => existsSync(join(root, ...p.split('/')));
  const html = read('index.html').toString('utf8');

  // ---- index.html: import map, scripts, links ----
  let importMap = {};
  const mapTag = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  if (mapTag) {
    try {
      importMap = JSON.parse(mapTag[1]).imports ?? {};
    } catch (err) {
      problems.push(`index.html: import map is not valid JSON (${err.message})`);
    }
  }
  const htmlRefs = [];
  const entries = [];
  for (const [, tag, attrText] of html.matchAll(/<(script|link)\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...attrText.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const ref = tag === 'script' ? attrs.src : attrs.href;
    if (!ref || /^[a-z]+:/i.test(ref)) continue;
    const path = posix.normalize(ref);
    htmlRefs.push(path);
    if ((tag === 'script' && attrs.type === 'module') || attrs.rel === 'modulepreload') entries.push(path);
  }
  for (const target of Object.values(importMap)) {
    const path = posix.normalize(target);
    if (!path.endsWith('/')) htmlRefs.push(path); // "three/addons/" style prefixes are folders
    else if (!exists(path)) problems.push(`index.html: import map folder ${path} is missing`);
  }
  if (!exists('sw.js')) problems.push('sw.js is missing (js/ui/install.js registers it)');

  // ---- manifest ----
  const manifestRefs = [];
  if (exists('manifest.webmanifest')) {
    try {
      const m = JSON.parse(read('manifest.webmanifest').toString('utf8'));
      const icons = [...(m.icons ?? []), ...(m.shortcuts ?? []).flatMap((s) => s.icons ?? [])];
      for (const icon of icons) {
        const p = posix.normalize(icon.src);
        manifestRefs.push(p);
        if (!exists(p)) continue;
        const size = p.endsWith('.png') ? pngSize(read(p)) : null;
        if (size && icon.sizes && !icon.sizes.split(/\s+/).includes(size)) problems.push(`manifest.webmanifest: ${p} is ${size}, not ${icon.sizes}`);
      }
      for (const key of ['name', 'short_name', 'start_url', 'display']) if (!m[key]) problems.push(`manifest.webmanifest: missing "${key}"`);
      for (const need of ['192x192', '512x512']) {
        if (!m.icons?.some((i) => i.sizes === need && i.type === 'image/png' && (i.purpose ?? 'any').includes('any'))) problems.push(`manifest.webmanifest: needs a ${need} PNG icon to be installable`);
      }
    } catch (err) {
      problems.push(`manifest.webmanifest: not valid JSON (${err.message})`);
    }
  } else if (htmlRefs.includes('manifest.webmanifest')) {
    problems.push('manifest.webmanifest is linked from index.html but missing');
  }
  for (const p of [...htmlRefs, ...manifestRefs]) if (!exists(p)) problems.push(`missing file: ${p} (referenced by index.html or the manifest)`);

  // ---- module graph ----
  const modules = new Set();
  const workerModules = new Set();
  const workerEntries = [];
  const assets = new Set();

  function resolveSpec(spec, from, inWorker) {
    if (spec.startsWith('./') || spec.startsWith('../')) return posix.normalize(posix.join(posix.dirname(from), spec));
    if (spec.startsWith('/') || /^[a-z]+:/i.test(spec)) {
      problems.push(`${from}: absolute import '${spec}' — use a relative path so the app works from any folder`);
      return null;
    }
    if (inWorker) {
      problems.push(`${from}: bare import '${spec}' in code a worker loads — import maps don't apply in workers`);
      return null;
    }
    if (importMap[spec]) return posix.normalize(importMap[spec]);
    const prefix = Object.keys(importMap).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (prefix) return posix.normalize(importMap[prefix] + spec.slice(prefix.length));
    problems.push(`${from}: bare import '${spec}' is not in the import map`);
    return null;
  }

  function visit(start, inWorker) {
    const seen = inWorker ? workerModules : modules;
    const stack = [start];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      if (file.startsWith('../')) {
        problems.push(`${file}: resolves outside the site`);
        continue;
      }
      if (!exists(file)) {
        problems.push(`missing module: ${file}`);
        continue;
      }
      const src = read(file).toString('utf8');
      const specs = [...src.matchAll(STATIC_IMPORT), ...src.matchAll(DYNAMIC_IMPORT)].map((m) => m[2]);
      for (const spec of specs) {
        const target = resolveSpec(spec, file, inWorker);
        if (!target) continue;
        if (FORBIDDEN.has(target)) problems.push(`${file}: imports ${target}, which ${FORBIDDEN.get(target)}`);
        if (file.startsWith('js/core/') && !PURE.some((dir) => target.startsWith(dir))) {
          problems.push(`${file}: js/core must stay pure, but imports ${target}`);
        }
        stack.push(target);
      }
      for (const m of src.matchAll(URL_FROM_MODULE)) {
        const target = posix.normalize(posix.join(posix.dirname(file), m[2]));
        if (/\.worker\.js$/.test(target)) workerEntries.push(target);
        else assets.add(target);
      }
      if (file.startsWith('js/')) for (const m of src.matchAll(ASSET_LITERAL)) assets.add(posix.normalize(m[2]));
    }
  }

  if (!entries.length) problems.push('index.html: no <script type="module"> entry point found');
  for (const e of entries) visit(e, false);
  for (const w of workerEntries) visit(w, true);
  for (const a of assets) if (!exists(a)) problems.push(`missing asset: ${a} (referenced from JavaScript)`);

  // ---- offline cache ----
  if (precache) {
    const list = exists('sw.js') ? readPrecache(read('sw.js').toString('utf8')) : null;
    if (!list) {
      problems.push('sw.js is not stamped (run tools/stamp-sw.mjs on the staged site)');
    } else {
      const cached = new Set(list);
      for (const p of list) if (!exists(p)) problems.push(`precache lists ${p}, which is not in the site`);
      const needed = new Set([...modules, ...workerModules, ...htmlRefs, ...manifestRefs, ...assets, 'index.html']);
      for (const p of needed) if (!RUNTIME_CACHED(p) && !cached.has(p)) problems.push(`${p} is used by the app but not precached — it would fail offline`);
    }
  }

  return { problems, modules: [...modules].sort(), workerModules: [...workerModules].sort(), assets: [...assets].sort() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const i = process.argv.indexOf('--root');
  const root = i > 0 ? process.argv[i + 1] : '.';
  const { problems, modules, workerModules, assets } = checkSite(root, { precache: process.argv.includes('--precache') });
  for (const p of problems) console.error(`✗ ${p}`);
  const summary = `${modules.length} page modules, ${workerModules.length} worker modules, ${assets.length} assets`;
  if (problems.length) {
    console.error(`${problems.length} problem(s) in ${root} (${summary})`);
    process.exit(1);
  }
  console.log(`✓ ${root}: ${summary}${process.argv.includes('--precache') ? ', all precached' : ''}`);
}

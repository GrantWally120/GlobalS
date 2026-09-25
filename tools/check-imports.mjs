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
//
// moduleGraph() is also what tools/build-single.mjs bundles from.

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
 * Every import-like reference in one module's source, with the exact span to rewrite:
 * { kind: 'import', spec, start, end } covers the quoted specifier of a static or dynamic import;
 * { kind: 'url', spec, start, end } covers a whole `new URL('…', import.meta.url)` expression.
 */
export function scanModule(src) {
  const refs = [];
  for (const m of src.matchAll(STATIC_IMPORT)) {
    const literal = m[1] + m[2] + m[1];
    const start = m.index + m[0].length - literal.length;
    refs.push({ kind: 'import', spec: m[2], start, end: start + literal.length });
  }
  for (const m of src.matchAll(DYNAMIC_IMPORT)) {
    const literal = m[1] + m[2] + m[1];
    const start = m.index + m[0].indexOf(literal);
    refs.push({ kind: 'import', spec: m[2], start, end: start + literal.length });
  }
  for (const m of src.matchAll(URL_FROM_MODULE)) refs.push({ kind: 'url', spec: m[2], start: m.index, end: m.index + m[0].length });
  return refs.sort((a, b) => a.start - b.start);
}

/**
 * The app's module graph as index.html loads it.
 * @param {string} root site or repository root (where index.html lives)
 * @returns {{
 *   problems: string[], importMap: Record<string,string>, htmlRefs: string[], entries: string[], scripts: string[],
 *   info: Map<string, {source: string, refs: Array<{kind, spec, start, end, target: string|null}>}>,
 *   modules: string[], workerEntries: string[], workerModules: string[], assets: string[],
 *   order: (entry: string) => string[],
 * }}
 */
export function moduleGraph(root) {
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
  const scripts = [];
  for (const [, tag, attrText] of html.matchAll(/<(script|link)\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...attrText.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const ref = tag === 'script' ? attrs.src : attrs.href;
    if (!ref || /^[a-z]+:/i.test(ref)) continue;
    const path = posix.normalize(ref);
    htmlRefs.push(path);
    if (tag === 'script' && attrs.type === 'module') scripts.push(path);
    if ((tag === 'script' && attrs.type === 'module') || attrs.rel === 'modulepreload') entries.push(path);
  }
  for (const target of Object.values(importMap)) {
    const path = posix.normalize(target);
    if (!path.endsWith('/')) htmlRefs.push(path); // "three/addons/" style prefixes are folders
    else if (!exists(path)) problems.push(`index.html: import map folder ${path} is missing`);
  }

  // ---- modules ----
  const info = new Map();
  const modules = new Set();
  const workerModules = new Set();
  const workerEntries = [];
  const assets = new Set();

  function resolveSpec(spec, from) {
    if (spec.startsWith('./') || spec.startsWith('../')) return posix.normalize(posix.join(posix.dirname(from), spec));
    if (spec.startsWith('/') || /^[a-z]+:/i.test(spec)) return null;
    if (importMap[spec]) return posix.normalize(importMap[spec]);
    const prefix = Object.keys(importMap).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    return prefix ? posix.normalize(importMap[prefix] + spec.slice(prefix.length)) : null;
  }

  function scan(file) {
    if (info.has(file)) return info.get(file);
    let entry = null;
    if (file.startsWith('../')) problems.push(`${file}: resolves outside the site`);
    else if (!exists(file)) problems.push(`missing module: ${file}`);
    else {
      const source = read(file).toString('utf8');
      const refs = scanModule(source).map((r) => ({
        ...r,
        target: r.kind === 'import' ? resolveSpec(r.spec, file) : posix.normalize(posix.join(posix.dirname(file), r.spec)),
      }));
      entry = { source, refs };
      if (file.startsWith('js/')) for (const m of source.matchAll(ASSET_LITERAL)) assets.add(posix.normalize(m[2]));
    }
    info.set(file, entry);
    return entry;
  }

  function visit(start, inWorker) {
    const seen = inWorker ? workerModules : modules;
    const stack = [start];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const mod = scan(file);
      if (!mod) continue;
      for (const r of mod.refs) {
        if (r.kind === 'url') {
          if (/\.worker\.js$/.test(r.target)) workerEntries.includes(r.target) || workerEntries.push(r.target);
          else assets.add(r.target);
          continue;
        }
        const bare = !r.spec.startsWith('./') && !r.spec.startsWith('../');
        if (r.spec.startsWith('/') || /^[a-z]+:/i.test(r.spec)) {
          problems.push(`${file}: absolute import '${r.spec}' — use a relative path so the app works from any folder`);
          continue;
        }
        if (bare && inWorker) {
          problems.push(`${file}: bare import '${r.spec}' in code a worker loads — import maps don't apply in workers`);
          continue;
        }
        if (!r.target) {
          problems.push(`${file}: bare import '${r.spec}' is not in the import map`);
          continue;
        }
        if (FORBIDDEN.has(r.target)) problems.push(`${file}: imports ${r.target}, which ${FORBIDDEN.get(r.target)}`);
        if (file.startsWith('js/core/') && !PURE.some((dir) => r.target.startsWith(dir))) {
          problems.push(`${file}: js/core must stay pure, but imports ${r.target}`);
        }
        stack.push(r.target);
      }
    }
  }

  if (!entries.length) problems.push('index.html: no <script type="module"> entry point found');
  for (const e of entries) visit(e, false);
  for (let i = 0; i < workerEntries.length; i++) visit(workerEntries[i], true);
  for (const a of assets) if (!exists(a)) problems.push(`missing asset: ${a} (referenced from JavaScript)`);

  /** Dependencies before dependents (depth-first post-order); throws on an import cycle. */
  function order(entry) {
    const out = [];
    const state = new Map(); // 1 = in progress, 2 = done
    const walk = (file, path) => {
      if (state.get(file) === 2) return;
      if (state.get(file) === 1) throw new Error(`import cycle: ${[...path, file].join(' → ')}`);
      state.set(file, 1);
      for (const r of info.get(file)?.refs ?? []) if (r.kind === 'import' && r.target) walk(r.target, [...path, file]);
      state.set(file, 2);
      out.push(file);
    };
    walk(entry, []);
    return out;
  }

  return {
    problems, importMap, htmlRefs, entries, scripts, info, order, workerEntries,
    modules: [...modules].sort(), workerModules: [...workerModules].sort(), assets: [...assets].sort(),
  };
}

/**
 * @param {string} root site or repository root (where index.html lives)
 * @param {{precache?: boolean}} [opts]
 * @returns {{problems: string[], modules: string[], workerModules: string[], assets: string[]}}
 */
export function checkSite(root, { precache = false } = {}) {
  const read = (p) => readFileSync(join(root, ...p.split('/')));
  const exists = (p) => existsSync(join(root, ...p.split('/')));
  const g = moduleGraph(root);
  const { problems, htmlRefs, modules, workerModules, assets } = g;
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

  // ---- import cycles (the single-file build loads modules leaves-first) ----
  for (const e of [...g.entries, ...g.workerEntries]) {
    try {
      g.order(e);
    } catch (err) {
      problems.push(err.message);
    }
  }

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

  return { problems, modules, workerModules, assets };
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

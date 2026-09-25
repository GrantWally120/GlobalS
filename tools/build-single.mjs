#!/usr/bin/env node
// Builds dist/GlobalS.html: the whole app in one file you download and double-click.
//   node tools/build-single.mjs [--out dist/GlobalS.html]
//
// A double-clicked page opens as file://, where browsers refuse module scripts, module workers
// and fetch() of neighbouring files. So:
//   - Every module's source is embedded as-is except its import specifiers, which become
//     placeholders. A small loader swaps them for blob: URLs at start-up, dependencies first, so
//     import/export keep the browser's own semantics — nothing is transformed.
//   - Each worker starts as a classic blob: script that builds its own module graph the same way:
//     file:// pages may not start module workers from blob: URLs, but a worker may import blob:
//     URLs it created itself. Messages that arrive while it loads are held and replayed.
//   - The map, stars and NASA imagery are embedded and served to the app through a fetch() shim.
//   - Orbital data comes from the GlobalS data feed (see FEED_URLS in js/config.js).
// Zero dependencies; the output is deterministic.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleGraph } from './check-imports.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = '﷐M:'; // placeholder: blob: URL of a module (U+FDD0 never occurs in real source)
const WORKER = '﷐W:'; // placeholder: blob: URL of a worker's classic start-up script
const TYPES = { '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

/** "\r\n" → "\n". A Git for Windows checkout may have CRLF line endings; this way it builds the same file as CI. */
const lf = (text) => text.replace(/\r\n/g, '\n');

/** Source with every import specifier (and worker URL) replaced by a placeholder. */
function linkable(path, mod) {
  let out = mod.source;
  for (const r of [...mod.refs].reverse()) {
    let replacement;
    if (r.kind === 'import') replacement = `'${MODULE}${r.target}'`;
    else if (/\.worker\.js$/.test(r.target)) replacement = `new URL('${WORKER}${r.target}')`;
    else throw new Error(`${path}: new URL('${r.spec}', import.meta.url) is only supported for workers in the single-file build`);
    out = out.slice(0, r.start) + replacement + out.slice(r.end);
  }
  return out;
}

// The loader. It runs as a classic inline script, so it must be plain ES2020 without imports.
// workerBoot is stringified into each worker's start-up script.
function workerBoot(table, entry) {
  const held = [];
  const hold = (e) => { held.push(e); };
  self.onmessage = hold;
  const urls = {};
  const link = (src) => src.replace(/﷐M:([\w./-]+)/g, (_, p) => urls[p]);
  for (const [path, src] of table) urls[path] = URL.createObjectURL(new Blob([link(src)], { type: 'text/javascript' }));
  import(urls[entry]).then(() => {
    if (self.onmessage === hold) self.onmessage = null;
    for (const e of held) self.dispatchEvent(new MessageEvent('message', { data: e.data }));
  }, (err) => { setTimeout(() => { throw err; }); });
}

function pageBoot() {
  const bundle = JSON.parse(document.getElementById('globals-bundle').textContent);
  globalThis.GLOBALS_SINGLE = { build: bundle.build };
  // Embedded files, served to fetch() at the paths the app asks for.
  const base = new URL('.', location.href).href;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const abs = new URL(href, location.href).href;
    const asset = abs.startsWith(base) && bundle.assets[abs.slice(base.length).split(/[?#]/)[0]];
    if (!asset) return nativeFetch(input, init);
    if (asset.text !== undefined) return Promise.resolve(new Response(asset.text, { headers: { 'content-type': asset.type } }));
    return nativeFetch(asset.dataUrl);
  };
  const blobUrl = (src) => URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const urls = { M: {}, W: {} };
  for (const [entry, order] of Object.entries(bundle.workers)) {
    const table = order.map((p) => [p, bundle.modules[p]]);
    urls.W[entry] = blobUrl(`(${workerBoot})(${JSON.stringify(table)}, ${JSON.stringify(entry)});`);
  }
  const link = (src) => src.replace(/﷐([MW]):([\w./-]+)/g, (_, kind, p) => urls[kind][p]);
  for (const p of bundle.page) urls.M[p] = blobUrl(link(bundle.modules[p]));
  import(urls.M[bundle.entry]).catch((err) => {
    const box = document.getElementById('bootError');
    if (box) {
      box.hidden = false;
      box.textContent = `GlobalS couldn't start: ${err.message}. Try opening this file in Microsoft Edge or Google Chrome.`;
    }
    throw err;
  });
}

/** JSON that is safe inside <script>: no "<" (so no </script> or <!--) and no raw U+FDD0. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/﷐/g, '\\ufdd0');

/**
 * @returns {{ html: string, build: string, stats: { modules: number, assets: number, bytes: number } }}
 */
export function buildSingle(root = ROOT) {
  const g = moduleGraph(root);
  if (g.problems.length) throw new Error(`fix the module graph first:\n  ${g.problems.join('\n  ')}`);
  if (g.scripts.length !== 1) throw new Error(`expected one <script type="module"> in index.html, found ${g.scripts.length}`);
  const entry = g.scripts[0];
  const page = g.order(entry);
  const workers = Object.fromEntries([...g.workerEntries].sort().map((w) => [w, g.order(w)]));
  const modules = {};
  for (const p of [...new Set([...page, ...Object.values(workers).flat()])].sort()) modules[p] = lf(linkable(p, g.info.get(p)));

  const read = (p) => readFileSync(join(root, ...p.split('/')));
  const assets = {};
  for (const p of g.assets) {
    const type = TYPES[extname(p).toLowerCase()];
    if (!type) throw new Error(`don't know how to embed ${p}`);
    assets[p] = type === 'application/json'
      ? { type, text: lf(read(p).toString('utf8')) }
      : { type, dataUrl: `data:${type};base64,${read(p).toString('base64')}` };
  }

  const payload = { entry, page, workers, modules, assets };
  const build = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
  const bundle = scriptJson({ build, ...payload });

  let html = lf(read('index.html').toString('utf8'));
  const css = lf(read('css/globals.css').toString('utf8'));
  const icon = `data:image/svg+xml;base64,${Buffer.from(lf(read('assets/icons/icon.svg').toString('utf8'))).toString('base64')}`;
  const edits = [
    [/[ \t]*<link rel="manifest"[^>]*>\n/, ''],
    [/[ \t]*<link rel="apple-touch-icon"[^>]*>\n/, ''],
    [/[ \t]*<link rel="modulepreload"[^>]*>\n/g, ''],
    [/[ \t]*<script type="importmap">[\s\S]*?<\/script>\n/, ''],
    [/<link rel="icon" href="assets\/icons\/icon\.svg"/, `<link rel="icon" href="${icon}"`],
    [/<link rel="stylesheet" href="css\/globals\.css">/, () => `<style>\n${css.replace(/<\/style/gi, '<\\/style')}</style>`],
    [/<script type="module" src="js\/main\.js"><\/script>/, () => [
      `<script type="application/json" id="globals-bundle">${bundle}</script>`,
      `<script>\n"use strict";\n${lf(String(workerBoot))}\n(${lf(String(pageBoot))})();\n</script>`,
    ].join('\n')],
  ];
  for (const [re, replacement] of edits) {
    if (!re.test(html)) throw new Error(`index.html changed: no match for ${re}`);
    re.lastIndex = 0;
    html = html.replace(re, replacement);
  }
  html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="generator" content="GlobalS single-file build ${build}">`);
  return { html, build, stats: { modules: Object.keys(modules).length, assets: Object.keys(assets).length, bytes: Buffer.byteLength(html) } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const i = process.argv.indexOf('--out');
  const out = i > 0 ? process.argv[i + 1] : join(ROOT, 'dist', 'GlobalS.html');
  const { html, build, stats } = buildSingle();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`Built ${out}: ${stats.modules} modules, ${stats.assets} embedded files, ${(stats.bytes / 1048576).toFixed(1)} MB, build ${build}`);
}

#!/usr/bin/env node
// Stamps the service worker of a staged site (tools/stage-site.mjs) for offline use:
//   PRECACHE     every app file (not orbital data, NASA imagery or sw.js itself)
//   VERSION      hash of those files' contents — unchanged by data-only deploys, so the 6-hourly
//                data refresh never makes anyone re-download the app
//   TEX_VERSION  hash of the NASA imagery, which is cached separately and only when used
// and writes version.json (shown in the Data tab). Deterministic: same files, same output.
//   node tools/stamp-sw.mjs _site

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const isData = (p) => p.startsWith('data/');
const isTexture = (p) => p.startsWith('assets/textures/');
const GENERATED = new Set(['sw.js', 'version.json']);

function walk(dir, base, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

/** sha256 over "path NUL sha256(content) LF" for each path, in sorted order. */
export function contentHash(root, paths) {
  const h = createHash('sha256');
  for (const p of [...paths].sort()) {
    const fileHash = createHash('sha256').update(readFileSync(join(root, ...p.split('/')))).digest('hex');
    h.update(`${p}\0${fileHash}\n`);
  }
  return h.digest('hex');
}

function replaceOnce(text, re, value, what) {
  const hits = text.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`))?.length ?? 0;
  if (hits !== 1) throw new Error(`sw.js: expected exactly one ${what} placeholder, found ${hits}. Was it already stamped?`);
  return text.replace(re, () => value);
}

/** Stamp `root`/sw.js in place. Returns { version, texVersion, precache }. */
export function stamp(root) {
  const files = walk(resolve(root), resolve(root));
  if (!files.includes('sw.js') || !files.includes('index.html')) throw new Error(`${root} doesn't look like a staged GlobalS site.`);
  const shell = files.filter((p) => !GENERATED.has(p) && !isData(p) && !isTexture(p));
  const textures = files.filter(isTexture);
  const version = contentHash(root, shell).slice(0, 16);
  const texVersion = textures.length ? contentHash(root, textures).slice(0, 12) : 'none';
  const precache = [...shell, 'version.json'].sort();

  let sw = readFileSync(join(root, 'sw.js'), 'utf8');
  sw = replaceOnce(sw, /^const VERSION = '__VERSION__';$/m, `const VERSION = '${version}';`, 'VERSION');
  sw = replaceOnce(sw, /^const TEX_VERSION = '__TEX_VERSION__';$/m, `const TEX_VERSION = '${texVersion}';`, 'TEX_VERSION');
  sw = replaceOnce(sw, /^const PRECACHE = \[\/\*__PRECACHE__\*\/\];$/m,
    `const PRECACHE = [\n${precache.map((p) => `  ${JSON.stringify(p)},`).join('\n')}\n];`, 'PRECACHE');
  writeFileSync(join(root, 'version.json'), `${JSON.stringify({ version, texVersion, files: precache.length })}\n`);
  writeFileSync(join(root, 'sw.js'), sw);
  return { version, texVersion, precache };
}

/** Read the precache list back out of a stamped sw.js (null if unstamped). */
export function readPrecache(swText) {
  const m = /^const PRECACHE = (\[[\s\S]*?\n\]);$/m.exec(swText);
  if (!m) return null;
  return JSON.parse(m[1].replace(/,\n\]$/, '\n]'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node tools/stamp-sw.mjs <staged-site-dir>');
    process.exit(2);
  }
  const { version, texVersion, precache } = stamp(root);
  console.log(`Stamped ${root}/sw.js: version ${version}, textures ${texVersion}, ${precache.length} files precached`);
}

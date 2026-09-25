#!/usr/bin/env node
// Vendors GlobalS's third-party files straight from the npm registry — no npm, no node_modules.
//
//   node tools/vendor.mjs          download pinned tarballs, verify sha512, extract the allowlisted files
//   node tools/vendor.mjs --check  verify the files on disk still match vendor/vendor-lock.json (offline)
//
// Only maintainers ever run this; the app itself just serves the committed files.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = join(ROOT, 'vendor', 'vendor-lock.json');
const REGISTRY = 'https://registry.npmjs.org';

// satellite.js: only the non-WASM closure of the modules GlobalS uses. dist/index.js is deliberately
// excluded because it re-exports the WASM runtimes, whose `#wasm-*` imports only resolve in Node.
const SATJS_FILES = [
  'common-types', 'constants', 'dopplerFactor', 'ext', 'io', 'propagation', 'shadow', 'sun', 'transforms',
  'propagation/SatRec', 'propagation/check-for-decay', 'propagation/dpper', 'propagation/dscom',
  'propagation/dsinit', 'propagation/dspace', 'propagation/gstime', 'propagation/initl',
  'propagation/propagate', 'propagation/sgp4', 'propagation/sgp4init',
].map((f) => `dist/${f}.js`);

export const PACKAGES = [
  {
    name: 'three', version: '0.186.1', license: 'MIT', dest: 'vendor/three',
    files: [
      'LICENSE', 'build/three.module.js', 'build/three.core.js',
      'examples/jsm/controls/OrbitControls.js',
      'examples/jsm/lines/Line2.js', 'examples/jsm/lines/LineGeometry.js', 'examples/jsm/lines/LineMaterial.js',
      'examples/jsm/lines/LineSegments2.js', 'examples/jsm/lines/LineSegmentsGeometry.js',
    ],
  },
  { name: 'satellite.js', version: '7.1.0', license: 'MIT', dest: 'vendor/satellite.js', files: ['LICENSE.md', ...SATJS_FILES] },
  { name: 'topojson-client', version: '3.1.0', license: 'ISC', dest: 'vendor/topojson-client', files: ['LICENSE', 'src/*.js'] },
  {
    name: 'world-atlas', version: '2.0.2', license: 'ISC (data: Natural Earth, public domain)', dest: 'assets/geo',
    files: ['LICENSE', 'countries-50m.json'],
  },
  {
    name: 'd3-celestial', version: '0.7.35', license: 'BSD-3-Clause', dest: 'assets/stars', strip: 'data/',
    files: ['LICENSE', 'data/stars.6.json', 'data/constellations.lines.json', 'data/constellations.json'],
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${esc}$`);
}

/** Minimal ustar/pax reader: returns Map(path -> Buffer) of regular files. */
export function readTar(buf) {
  const files = new Map();
  let off = 0;
  let paxPath = null;
  const str = (a, b) => buf.toString('utf8', a, b).replace(/\0.*$/s, '');
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = str(off, off + 100);
    const size = parseInt(str(off + 124, off + 136).trim() || '0', 8);
    const type = String.fromCharCode(buf[off + 156] || 48);
    const prefix = str(off + 345, off + 500);
    const dataStart = off + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'x') { // pax extended header: "len key=value\n" records
      const text = data.toString('utf8');
      const m = text.match(/\d+ path=([^\n]*)\n/);
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === 'g') continue;
    const full = paxPath ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    if (type === '0' || type === '\0' || type === '7') files.set(full, Buffer.from(data));
  }
  return files;
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'GlobalS-vendor/1.0' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function vendorPackage(pkg) {
  const meta = JSON.parse((await fetchBuffer(`${REGISTRY}/${encodeURIComponent(pkg.name).replace('%40', '@')}/${pkg.version}`)).toString('utf8'));
  const { tarball, integrity } = meta.dist;
  const tgz = await fetchBuffer(tarball);
  const [algo, expected] = integrity.split('-');
  const actual = createHash(algo).update(tgz).digest('base64');
  if (actual !== expected) throw new Error(`${pkg.name}@${pkg.version}: integrity mismatch`);
  const entries = readTar(gunzipSync(tgz));
  const out = [];
  for (const pattern of pkg.files) {
    const re = globToRegExp(`package/${pattern}`);
    const matches = [...entries.keys()].filter((k) => re.test(k)).sort();
    if (matches.length === 0) throw new Error(`${pkg.name}: no file matches ${pattern}`);
    for (const key of matches) {
      let rel = key.slice('package/'.length);
      if (pkg.strip && rel.startsWith(pkg.strip)) rel = rel.slice(pkg.strip.length);
      const dest = posix.join(pkg.dest, rel);
      const abs = join(ROOT, dest);
      mkdirSync(dirname(abs), { recursive: true });
      const data = entries.get(key);
      writeFileSync(abs, data);
      out.push({ path: dest, bytes: data.length, sha256: sha256(data) });
    }
  }
  return { name: pkg.name, version: pkg.version, license: pkg.license, tarball, integrity, files: out };
}

function writeDocs(lock) {
  const lines = [
    '# Vendored third-party files',
    '',
    'GlobalS has no build step and no npm dependencies: these files are copied verbatim from the npm registry by',
    '`node tools/vendor.mjs`, which verifies each tarball against its published sha512 integrity hash.',
    '`node tools/vendor.mjs --check` (also run by the test suite) confirms nothing here has been edited.',
    '',
    '| Package | Version | License | Files |',
    '| --- | --- | --- | --- |',
    ...lock.packages.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${p.files.length} |`),
    '',
  ];
  for (const p of lock.packages) {
    lines.push(`## ${p.name} ${p.version}`, '', `- Tarball: ${p.tarball}`, `- Integrity: \`${p.integrity}\``, '');
    for (const f of p.files) lines.push(`- \`${f.path}\` (${f.bytes.toLocaleString('en-US')} bytes)`);
    lines.push('');
  }
  writeFileSync(join(ROOT, 'VENDOR.md'), lines.join('\n'));
}

export function checkLock(root = ROOT) {
  const lock = JSON.parse(readFileSync(join(root, 'vendor', 'vendor-lock.json'), 'utf8'));
  const problems = [];
  for (const p of lock.packages) {
    for (const f of p.files) {
      const abs = join(root, f.path);
      if (!existsSync(abs)) { problems.push(`missing ${f.path}`); continue; }
      if (sha256(readFileSync(abs)) !== f.sha256) problems.push(`modified ${f.path}`);
    }
  }
  return problems;
}

async function main() {
  if (process.argv.includes('--check')) {
    const problems = checkLock();
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
    console.log('vendored files match vendor/vendor-lock.json');
    return;
  }
  const packages = [];
  for (const pkg of PACKAGES) {
    process.stdout.write(`${pkg.name}@${pkg.version} … `);
    const res = await vendorPackage(pkg);
    packages.push(res);
    console.log(`${res.files.length} files`);
  }
  const lock = { note: 'Generated by tools/vendor.mjs — do not edit by hand.', packages };
  mkdirSync(dirname(LOCK), { recursive: true });
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  writeDocs(lock);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

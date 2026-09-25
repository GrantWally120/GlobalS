#!/usr/bin/env node
// Downloads the NASA Earth imagery used by GlobalS's photorealistic globe (public domain, credit
// NASA Earth Observatory) and validates it. Run by .github/workflows/textures.yml, which commits
// the result to assets/textures/ so every copy of the app — local or deployed — renders the same.
//
//   node tools/fetch-textures.mjs [--out assets/textures]
//
// Zero dependencies (Node ≥ 22 global fetch). Tries each candidate URL in order and keeps the first
// file that is a real JPEG with the expected pixel dimensions.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOSTS = [
  'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords',
  'https://eoimages.gsfc.nasa.gov/images/imagerecords',
];

export const TEXTURES = [
  {
    key: 'day',
    file: 'earth-day.jpg',
    title: 'Blue Marble: Next Generation with topography and bathymetry',
    credit: 'NASA Earth Observatory (Reto Stöckli, NASA GSFC); Blue Marble Next Generation, 2004',
    width: 5400,
    height: 2700,
    paths: [
      '73000/73751/world.topo.bathy.200407.3x5400x2700.jpg', // July 2004
      '73000/73909/world.topo.bathy.200412.3x5400x2700.jpg', // December 2004
    ],
  },
  {
    key: 'night',
    file: 'earth-night.jpg',
    title: 'Black Marble 2016 — Earth at night (0.1° grid)',
    credit: 'NASA Earth Observatory (Joshua Stevens, Miguel Román, NASA GSFC); Suomi NPP VIIRS, 2016',
    width: 3600,
    height: 1800,
    paths: ['144000/144898/BlackMarble_2016_01deg.jpg'],
  },
];

/** Reads the pixel size from a JPEG's first start-of-frame marker. */
export function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) return null;
    const marker = buf[off + 1];
    if (marker === 0xff) { off += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    const len = buf.readUInt16BE(off + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && off + 9 <= buf.length) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

async function tryDownload(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'GlobalS-textures/1.0 (+https://github.com/GrantWally120/GlobalS)' },
    signal: AbortSignal.timeout(120_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const i = process.argv.indexOf('--out');
  const outDir = i >= 0 ? process.argv[i + 1] : 'assets/textures';
  mkdirSync(outDir, { recursive: true });
  const manifest = { note: 'Written by tools/fetch-textures.mjs', fetchedAt: new Date().toISOString(), textures: {} };
  const report = [];
  for (const tex of TEXTURES) {
    let done = false;
    for (const path of tex.paths) {
      for (const host of HOSTS) {
        const url = `${host}/${path}`;
        try {
          const buf = await tryDownload(url);
          const size = jpegSize(buf);
          if (!size) throw new Error('not a JPEG');
          if (size.width !== tex.width || size.height !== tex.height) {
            throw new Error(`unexpected size ${size.width}×${size.height}`);
          }
          writeFileSync(join(outDir, tex.file), buf);
          manifest.textures[tex.key] = {
            file: tex.file, title: tex.title, credit: tex.credit, source: url, license: 'Public domain (NASA)',
            width: size.width, height: size.height, bytes: buf.length,
            sha256: createHash('sha256').update(buf).digest('hex'),
          };
          report.push(`OK   ${tex.key}: ${url} (${(buf.length / 1e6).toFixed(2)} MB, ${size.width}×${size.height})`);
          done = true;
          break;
        } catch (err) {
          report.push(`FAIL ${tex.key}: ${url} — ${err.message}`);
        }
      }
      if (done) break;
    }
  }
  writeFileSync(join(outDir, 'textures.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(report.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### NASA textures\n\n\`\`\`\n${report.join('\n')}\n\`\`\`\n`);
  }
  if (Object.keys(manifest.textures).length === 0) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

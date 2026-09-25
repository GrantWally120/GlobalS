#!/usr/bin/env node
// Summarises a GlobalS data directory as Markdown (used in the data-check workflow summary):
// objects per category and orbit regime, common name prefixes, and element-set ages.
//   node tools/describe-data.mjs <data dir> [--now <ISO>]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, categorize, membership } from '../js/core/catalog.js';
import { orbitClass } from '../js/core/orbit.js';
import { recFromOmm } from '../js/core/sat.js';

const dir = process.argv[2] ?? 'data';
const nowArg = process.argv.indexOf('--now');
const now = nowArg > 0 ? Date.parse(process.argv[nowArg + 1]) : Date.now();
const catalog = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8'));
const groups = membership(JSON.parse(readFileSync(join(dir, 'groups.json'), 'utf8')));

const byCat = new Map();
const byOrbit = new Map();
const prefixes = new Map();
const ages = [];
let failed = 0;
for (const o of catalog) {
  const rec = recFromOmm(o);
  if (!rec) {
    failed++;
    continue;
  }
  const orbit = orbitClass(rec);
  const cat = CATEGORIES[categorize(rec.name, groups.get(rec.id) ?? new Set(), orbit)].label;
  byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
  byOrbit.set(orbit, (byOrbit.get(orbit) ?? 0) + 1);
  const prefix = rec.name.split(/[\s\-(0-9]/)[0] || rec.name;
  prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
  ages.push((now - rec.epochMs) / 86_400_000);
}
ages.sort((a, b) => a - b);
const pct = (p) => (ages.length ? ages[Math.min(ages.length - 1, Math.floor((p / 100) * ages.length))].toFixed(2) : '—');
const table = (title, m) => [`| ${title} | Objects |`, '| --- | ---: |', ...[...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
console.log([
  '### What the catalogue contains',
  '',
  `${catalog.length} objects (${failed} could not be initialised).`,
  `Element-set age in days — median ${pct(50)}, 90th percentile ${pct(90)}, max ${pct(100)}.`,
  '',
  table('GlobalS category', byCat),
  '',
  table('Orbit regime', byOrbit),
  '',
  table('Top name prefixes', new Map([...prefixes].sort((a, b) => b[1] - a[1]).slice(0, 25))),
  '',
].join('\n'));

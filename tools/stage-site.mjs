#!/usr/bin/env node
// Copies exactly the files the deployed app needs into a clean folder (default _site/), which
// .github/workflows/pages.yml then fills with orbital data, stamps (stamp-sw.mjs) and publishes.
//   node tools/stage-site.mjs [_site]
// Tests, tools, fixtures and docs stay behind.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Top-level files and folders that make up the app. */
export const INCLUDE = ['index.html', 'manifest.webmanifest', 'sw.js', 'ATTRIBUTION.md', 'css', 'js', 'vendor', 'assets'];

/** Inside those, never publish these. */
export const EXCLUDE = [
  /(^|\/)\./, // dotfiles
  /^vendor\/vendor-lock\.json$/, // maintainer bookkeeping
  /^assets\/stars\/constellations\.json$/, // vendored for future constellation labels; not used yet
];

const REQUIRED = ['index.html', 'manifest.webmanifest', 'sw.js', 'js/main.js'];

function walk(dir, base, out) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

/** Posix paths of every file that would be published, sorted. */
export function siteFiles(root = ROOT) {
  const files = [];
  for (const entry of INCLUDE) {
    const full = join(root, entry);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) walk(full, root, files);
    else files.push(entry);
  }
  return files.filter((f) => !EXCLUDE.some((re) => re.test(f))).sort();
}

/** Throws unless `out` is safe to wipe and refill: never the source folder or one containing it. */
export function checkTarget(out, root = ROOT) {
  const dest = resolve(out);
  const rel = relative(dest, resolve(root)); // how to get from the target to the source
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (!outside) throw new Error(`Refusing to stage into ${dest}: it would contain the source.`);
  return dest;
}

/** Replace `out` with a fresh copy of the site. Returns the staged paths. */
export function stage(out, root = ROOT) {
  const dest = checkTarget(out, root);
  const src = resolve(root);
  const files = siteFiles(root);
  for (const f of REQUIRED) if (!files.includes(f)) throw new Error(`Missing ${f} — is this the GlobalS repository?`);
  rmSync(dest, { recursive: true, force: true });
  for (const f of files) {
    const target = join(dest, ...f.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(src, ...f.split('/')), target);
  }
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const out = process.argv[2] ?? '_site';
  const files = stage(out);
  const bytes = files.reduce((n, f) => n + statSync(join(out, ...f.split('/'))).size, 0);
  console.log(`Staged ${files.length} files (${(bytes / 1048576).toFixed(1)} MB) into ${out}/`);
}

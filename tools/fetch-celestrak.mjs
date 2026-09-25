#!/usr/bin/env node
// Relays CelesTrak GP data (OMM JSON) into the GlobalS data feed, politely. Run by publish.yml.
//
//   node tools/fetch-celestrak.mjs --out _site/data [--previous <deployed data/ URL or local dir>] [--force]
//   node tools/fetch-celestrak.mjs --out fixtures/data --from-dir <dir with <group>.json files>
//
// Why a relay: CelesTrak's gp.php sends no CORS headers, so browsers can't fetch it directly.
// CelesTrak's rules (2026): data changes every 2 h; download each group at most once per update
// cycle; >100 MB/day from one IP risks a firewall block. So this script:
//   • reuses any group the previous deployment fetched less than 2 h ago (unless --force),
//   • fetches groups one at a time, 2 s apart, with an identifying User-Agent,
//   • stops contacting CelesTrak entirely after an HTTP 403 (circuit breaker),
//   • retries a 5xx/network failure once, never a 4xx,
//   • falls back to the previous deployment's copy of any group that fails, so the site never
//     loses data, and always exits 0 with a report in the GitHub step summary.
// Zero dependencies: Node ≥ 22 (global fetch).

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactOmm, dedupeById, validateOmm } from '../js/core/omm.js';
import { epochToMs, propagateMs, recFromOmm } from '../js/core/sat.js';

export const GROUPS = [
  { name: 'active', required: true, timeoutMs: 90_000 },
  { name: 'stations' }, { name: 'visual' },
  { name: 'gps-ops' }, { name: 'glo-ops' }, { name: 'galileo' }, { name: 'beidou' },
  { name: 'weather' }, { name: 'resource' }, { name: 'science' }, { name: 'amateur' },
  { name: 'last-30-days' },
];

const BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const USER_AGENT = 'GlobalS-data/1.0 (+https://github.com/GrantWally120/GlobalS)';
export const REUSE_MS = 2 * 3600e3;
const SPACING_MS = 2000;
const DAY = 86_400_000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Validate, initialise and test-propagate each record; returns kept records and drop counts. */
export function cleanRecords(raw) {
  const kept = [];
  let invalid = 0;
  let propagation = 0;
  for (const o of raw) {
    if (validateOmm(o)) {
      invalid++;
      continue;
    }
    const rec = recFromOmm(o);
    if (!rec || !propagateMs(rec, rec.epochMs)) {
      propagation++;
      continue;
    }
    kept.push(compactOmm(o));
  }
  return { kept, dropped: { invalid, propagation } };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function getJson(fetchImpl, url, timeoutMs = 30_000) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Load the previously deployed data (manifest, catalog, groups) — the fallback for every group. */
export async function loadPrevious(fetchImpl, previous) {
  if (!previous) return null;
  const base = previous.replace(/\/$/, '');
  const local = !/^https?:/.test(base);
  const load = local
    ? async (f) => {
      try {
        return JSON.parse(readFileSync(join(base, f.split('?')[0]), 'utf8'));
      } catch {
        return null;
      }
    }
    : (f, timeout) => getJson(fetchImpl, `${base}/${f}`, timeout);
  const manifest = await load('manifest.json');
  if (!manifest?.files) return null;
  const catalog = await load(manifest.files.catalog, 90_000);
  const groups = await load(manifest.files.groups);
  if (!Array.isArray(catalog) || !groups) return null;
  const byId = new Map(catalog.map((o) => [Number(o.NORAD_CAT_ID), o]));
  return { manifest, byId, groups };
}

function fromPrevious(prev, group) {
  const ids = prev?.groups?.[group];
  if (!ids) return null;
  return ids.map((id) => prev.byId.get(id)).filter(Boolean);
}

/**
 * Fetch one group with CelesTrak etiquette. Returns { status, records?, http?, bytes?, error? }.
 * status: 'fresh' | 'invalid' | 'blocked' | 'failed'
 */
async function fetchGroup(fetchImpl, group, { sleep, timeoutMs }) {
  const url = `${BASE}?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        redirect: 'follow',
      });
    } catch (err) {
      if (attempt === 0) {
        await sleep(30_000 + Math.floor(Math.random() * 5000));
        continue;
      }
      return { status: 'failed', error: err.name === 'TimeoutError' ? 'timeout' : err.message };
    }
    if (res.status === 403) return { status: 'blocked', http: 403 };
    if (res.status >= 500) {
      if (attempt === 0) {
        await sleep(30_000 + Math.floor(Math.random() * 5000));
        continue;
      }
      return { status: 'failed', http: res.status };
    }
    if (!res.ok) return { status: 'invalid', http: res.status };
    const text = await res.text();
    if (!text.trimStart().startsWith('[')) {
      return { status: 'invalid', http: res.status, error: text.slice(0, 80).replace(/\s+/g, ' ').trim() };
    }
    let records;
    try {
      records = JSON.parse(text);
    } catch {
      return { status: 'invalid', http: res.status, error: 'malformed JSON' };
    }
    if (!Array.isArray(records) || records.length === 0) return { status: 'invalid', http: res.status, error: 'no records' };
    return { status: 'fresh', http: res.status, bytes: text.length, records };
  }
  return { status: 'failed' };
}

/**
 * @param {object} o
 * @param {string} o.out output directory
 * @param {string} [o.previous] URL of the currently deployed data/ directory
 * @param {boolean} [o.force] ignore the 2-hour reuse guard
 * @param {string} [o.fromDir] read <group>.json files from a directory instead of CelesTrak
 */
export async function run({
  out, previous, force = false, fromDir, fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), log = console.log,
}) {
  const prev = fromDir ? null : await loadPrevious(fetchImpl, previous);
  const report = [];
  const results = {};
  let blocked = false; // CelesTrak said 403: stop asking for this run
  let unreachable = false; // a group failed twice (no answer, or server errors): same
  let contacted = 0;
  const dropped = { invalid: 0, propagation: 0 };

  for (const g of GROUPS) {
    const prevInfo = prev?.manifest?.groups?.[g.name];
    const prevRecords = fromPrevious(prev, g.name);
    let res;

    if (fromDir) {
      const file = join(fromDir, `${g.name}.json`);
      res = existsSync(file) ? { status: 'fresh', records: JSON.parse(readFileSync(file, 'utf8')), bytes: 0 } : { status: 'invalid', error: 'no file' };
    } else if (!force && prevInfo?.attemptedAt && now() - Date.parse(prevInfo.attemptedAt) < REUSE_MS) {
      // Contacted CelesTrak for this group less than one update cycle ago — whatever the outcome
      // was, asking again now would break the one-download-per-cycle rule.
      res = { status: 'reused', records: prevRecords ?? [], fetchedAt: prevInfo.fetchedAt, attemptedAt: prevInfo.attemptedAt };
    } else if (blocked || unreachable) {
      // Not contacted this run, so the previous attempt time stands.
      res = { status: blocked ? 'blocked' : 'unreachable', attemptedAt: prevInfo?.attemptedAt ?? null };
    } else {
      if (contacted++ > 0) await sleep(SPACING_MS);
      res = await fetchGroup(fetchImpl, g.name, { sleep, timeoutMs: g.timeoutMs ?? 30_000 });
      res.attemptedAt = new Date(now()).toISOString();
      if (res.status === 'blocked') blocked = true;
      if (res.status === 'failed') unreachable = true;
    }

    if (res.status === 'fresh') {
      const clean = cleanRecords(res.records);
      dropped.invalid += clean.dropped.invalid;
      dropped.propagation += clean.dropped.propagation;
      res.records = clean.kept;
      res.fetchedAt = new Date(now()).toISOString();
      // The big group must look like a real catalogue before it may replace the previous one.
      if (g.required) {
        const prevCount = prevRecords?.length ?? 0;
        const ages = res.records.map((o) => now() - epochToMs(o.EPOCH));
        const medAge = median(ages) ?? Infinity;
        if (res.records.length < prevCount * 0.5 || medAge > 7 * DAY) {
          res = { status: 'failed', error: `sanity check failed (${res.records.length} objects, median age ${(medAge / DAY).toFixed(1)} d)` };
        }
      }
    }

    if (res.status !== 'fresh' && res.status !== 'reused') {
      res = prevRecords
        ? { ...res, status: 'fallback', reason: res.status, records: prevRecords, fetchedAt: prevInfo?.fetchedAt ?? null }
        : { ...res, records: [] };
    }

    results[g.name] = res;
    report.push(`| ${g.name} | ${res.status}${res.reason ? ` (${res.reason})` : ''} | ${res.records.length} | ${res.http ?? ''} | ${res.error ?? ''} |`);
  }

  const union = dedupeById(Object.values(results).flatMap((r) => r.records));
  union.sort((a, b) => Number(a.NORAD_CAT_ID) - Number(b.NORAD_CAT_ID));
  const groups = Object.fromEntries(GROUPS.map((g) => [g.name, results[g.name].records.map((o) => Number(o.NORAD_CAT_ID)).sort((a, b) => a - b)]));
  const catalogText = JSON.stringify(union);
  const groupsText = JSON.stringify(groups);
  const version = sha256(catalogText + groupsText).slice(0, 12);
  const epochs = union.map((o) => epochToMs(o.EPOCH)).filter(Number.isFinite);
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

  const manifest = {
    schema: 1,
    version,
    generatedAt: new Date(now()).toISOString(),
    source: {
      name: 'CelesTrak',
      url: 'https://celestrak.org/NORAD/elements/',
      note: 'General perturbations (GP) orbital data in CCSDS OMM form, originally from the U.S. Space Force (18th/19th SDS) via Space-Track.org.',
    },
    files: { catalog: `catalog.json?v=${version}`, groups: `groups.json?v=${version}` },
    counts: { objects: union.length },
    epoch: {
      min: iso(epochs.length ? Math.min(...epochs) : null),
      median: iso(median(epochs)),
      max: iso(epochs.length ? Math.max(...epochs) : null),
    },
    dropped,
    groups: Object.fromEntries(GROUPS.map((g) => {
      const r = results[g.name];
      return [g.name, {
        status: r.status, count: r.records.length, fetchedAt: r.fetchedAt ?? null, attemptedAt: r.attemptedAt ?? null,
        ...(r.http ? { http: r.http } : {}), ...(r.bytes ? { bytes: r.bytes } : {}), ...(r.reason ? { reason: r.reason } : {}),
      }];
    })),
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'catalog.json'), catalogText);
  writeFileSync(join(out, 'groups.json'), groupsText);
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);

  const summary = [
    '### Orbital data (CelesTrak)',
    '',
    `${union.length.toLocaleString('en-US')} objects · version \`${version}\` · median epoch ${manifest.epoch.median ?? '—'}` +
      `${blocked ? ' · **CelesTrak returned 403 — stopped contacting it for this run**' : ''}` +
      `${unreachable ? ' · **CelesTrak did not answer — stopped contacting it for this run**' : ''}`,
    '',
    '| Group | Status | Objects | HTTP | Note |',
    '| --- | --- | --- | --- | --- |',
    ...report,
    '',
    `Dropped records: ${dropped.invalid} invalid, ${dropped.propagation} failed to propagate.`,
    '',
  ].join('\n');
  log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  return manifest;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run({
    out: arg('out') ?? 'data',
    previous: arg('previous'),
    force: process.argv.includes('--force'),
    fromDir: arg('from-dir'),
  }).catch((err) => {
    // Never fail the deploy over data: the app shows data age and keeps working offline.
    console.error(`fetch-celestrak: ${err.stack || err}`);
  });
}

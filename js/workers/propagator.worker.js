// Owns the satellite catalogue and runs SGP4 for all of it, off the main thread.
//   load/import  → build satellite records, reply with columnar metadata
//   keys         → queue keyframes (ECI position + velocity in scene units, sunlight, validity)
//   overhead     → everything above an observer's horizon right now
//   records      → original element sets for chosen objects (selection, pass predictions)

import { CATEGORIES, categorize, facetBits, membership } from '../core/catalog.js';
import { ER_KM, eciToEcf } from '../core/frames.js';
import { elevationDeg, lookAngles, makeObserver } from '../core/look.js';
import { dedupeById, parseTleText, sniffFormat, validateOmm } from '../core/omm.js';
import { orbitClass } from '../core/orbit.js';
import { checkForDecay, gmstFromMs, recFromAny, sgp4, shadowFraction } from '../core/sat.js';
import { sunAltDeg, sunEciAu } from '../core/sun.js';
import { syntheticOmms } from '../core/synthetic.js';
import { serve, withTransfer } from './rpc.js';

const ORBITS = ['LEO', 'MEO', 'GEO', 'GSO', 'HEO'];
const EMPTY = new Set();
const INV_ER = 1 / ER_KM;

let recs = [];
let sources = [];
let memberMap = new Map();
let latestGen = 0;
const queue = [];
let pumping = false;

function build(list) {
  const nextRecs = [];
  const nextSources = [];
  let failed = 0;
  for (const o of list) {
    const r = recFromAny(o);
    if (!r) {
      failed++;
      continue;
    }
    const groups = memberMap.get(r.id) ?? EMPTY;
    const orbit = orbitClass(r);
    r.orbit = ORBITS.indexOf(orbit);
    r.cat = categorize(r.name, groups, orbit);
    r.facets = facetBits(groups);
    nextRecs.push(r);
    nextSources.push(o);
  }
  recs = nextRecs;
  sources = nextSources;
  queue.length = 0;
  return failed;
}

function meta(extra = {}) {
  const n = recs.length;
  const ids = new Int32Array(n);
  const cats = new Uint8Array(n);
  const facets = new Uint8Array(n);
  const orbits = new Uint8Array(n);
  const epochs = new Float64Array(n);
  const names = new Array(n);
  const cospars = new Array(n);
  recs.forEach((r, i) => {
    ids[i] = r.id;
    cats[i] = r.cat;
    facets[i] = r.facets;
    orbits[i] = r.orbit;
    epochs[i] = r.epochMs;
    names[i] = r.name;
    cospars[i] = r.cospar;
  });
  return withTransfer(
    { count: n, ids, cats, facets, orbits, epochs, names, cospars, categories: CATEGORIES.map((c) => c.key), ...extra },
    [ids.buffer, cats.buffer, facets.buffer, orbits.buffer, epochs.buffer],
  );
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function computeKeyframe(t, gen) {
  const n = recs.length;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const lit = new Uint8Array(n);
  const ok = new Uint8Array(n);
  const sun = sunEciAu(t);
  for (let i = 0; i < n; i++) {
    const r = recs[i];
    const pv = sgp4(r.satrec, (t - r.epochMs) / 60000);
    if (!pv || checkForDecay(r.satrec)) continue;
    const p = pv.position;
    if (!(p.x === p.x)) continue; // NaN
    const v = pv.velocity;
    const k = 3 * i;
    pos[k] = p.x * INV_ER;
    pos[k + 1] = p.z * INV_ER;
    pos[k + 2] = -p.y * INV_ER;
    vel[k] = v.x * INV_ER;
    vel[k + 1] = v.z * INV_ER;
    vel[k + 2] = -v.y * INV_ER;
    lit[i] = Math.round(255 * (1 - shadowFraction(sun, p)));
    ok[i] = 1;
  }
  self.postMessage({ type: 'keyframe', t, gen, count: n, pos, vel, lit, ok }, [pos.buffer, vel.buffer, lit.buffer, ok.buffer]);
}

function pump() {
  pumping = false;
  while (queue.length && queue[0].gen < latestGen) queue.shift(); // superseded by a jump
  const job = queue.shift();
  if (job) computeKeyframe(job.t, job.gen);
  if (queue.length) schedule();
}

function schedule() {
  if (!pumping) {
    pumping = true;
    setTimeout(pump, 0); // lets newer requests arrive (and supersede) between keyframes
  }
}

const SYNTHETIC_GROUPS = [[/^NAVSTAR/, 'gps-ops'], [/^GALILEO/, 'galileo'], [/^GLONASS/, 'glo-ops']];

serve({
  async load(m) {
    const [catalog, groups] = await Promise.all([fetchJson(m.catalogUrl), m.groupsUrl ? fetchJson(m.groupsUrl) : {}]);
    memberMap = membership(groups);
    let list = catalog;
    if (m.synthetic > 0) {
      const syn = syntheticOmms(m.synthetic);
      for (const o of syn) {
        const hit = SYNTHETIC_GROUPS.find(([re]) => re.test(o.OBJECT_NAME));
        if (hit) memberMap.set(o.NORAD_CAT_ID, new Set([hit[1]]));
      }
      list = list.concat(syn);
    }
    const failed = build(list);
    return meta({ failed });
  },

  import(m) {
    const format = sniffFormat(m.text);
    const incoming = [];
    const problems = [];
    if (format === 'omm') {
      let data;
      try {
        data = JSON.parse(m.text);
      } catch {
        throw new Error('This file is not valid JSON.');
      }
      for (const o of Array.isArray(data) ? data : [data]) {
        const why = validateOmm(o);
        if (why) problems.push(`${o?.OBJECT_NAME ?? o?.NORAD_CAT_ID ?? 'record'}: ${why}`);
        else incoming.push(o);
      }
    } else if (format === 'tle') {
      const { sets, errors } = parseTleText(m.text);
      problems.push(...errors);
      for (const s of sets) {
        if (!s.checksumOk) problems.push(`${s.name}: checksum mismatch (kept)`);
        const o = { OBJECT_NAME: s.name, NORAD_CAT_ID: s.id, TLE_LINE1: s.line1, TLE_LINE2: s.line2 };
        const r = recFromAny(o);
        if (!r) {
          problems.push(`${s.name}: SGP4 could not initialise these elements`);
          continue;
        }
        o.EPOCH = new Date(Math.floor(r.epochMs)).toISOString();
        o.OBJECT_ID = r.cospar;
        incoming.push(o);
      }
    } else {
      throw new Error('Unrecognised file: expected OMM JSON (CelesTrak FORMAT=json) or TLE text.');
    }
    if (!incoming.length) throw new Error(problems[0] ?? 'No usable element sets found.');
    const list = m.mode === 'replace' ? incoming : dedupeById(sources.concat(incoming));
    const failed = build(list);
    return meta({ failed, imported: incoming.length, problems: problems.slice(0, 50), problemCount: problems.length });
  },

  keys(m) {
    latestGen = Math.max(latestGen, m.gen);
    for (const t of m.times) queue.push({ t, gen: m.gen });
    schedule();
  },

  overhead(m) {
    const obs = makeObserver(m.obs.latDeg, m.obs.lonDeg, m.obs.hKm);
    const gmst = gmstFromMs(m.t);
    const sun = sunEciAu(m.t);
    const skyDark = sunAltDeg(obs, m.t) < (m.sunAltMax ?? -6);
    const items = [];
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      const pv = sgp4(r.satrec, (m.t - r.epochMs) / 60000);
      if (!pv || checkForDecay(r.satrec)) continue;
      const ecf = eciToEcf(pv.position, gmst);
      if (!(ecf.x === ecf.x) || elevationDeg(obs, ecf) < m.minEl) continue;
      const la = lookAngles(obs, ecf);
      items.push({ i, az: la.azDeg, el: la.elDeg, range: la.rangeKm, lit: shadowFraction(sun, pv.position) < 0.5 });
    }
    items.sort((a, b) => b.el - a.el);
    return { t: m.t, skyDark, items };
  },

  records(m) {
    return m.indices.map((i) => sources[i] ?? null);
  },
});

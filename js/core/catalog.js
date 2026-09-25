// Catalogue organisation: categories, orbit regimes and search. Pure data, no rendering.

/**
 * Display categories, in priority order: an object belongs to the first one that matches.
 * Group names are CelesTrak GROUP= values; name patterns match OBJECT_NAME.
 */
export const CATEGORIES = [
  { key: 'stations', label: 'Space stations', groups: ['stations'] },
  { key: 'gnss', label: 'Navigation (GNSS)', groups: ['gps-ops', 'glo-ops', 'galileo', 'beidou'] },
  {
    key: 'weather',
    label: 'Weather & Earth observation',
    groups: ['weather', 'resource'],
    // Commercial imaging/sensing fleets CelesTrak files under "active" only (verified against live data).
    names: /^(FLOCK|SKYSAT|ICEYE|LEMUR|JILIN|GAOFEN|CAPELLA|UMBRA|NUSAT|SUPERVIEW|WORLDVIEW|PLEIADES|SENTINEL|LANDSAT)/i,
  },
  { key: 'science', label: 'Science', groups: ['science'] },
  { key: 'amateur', label: 'Amateur radio', groups: ['amateur'] },
  { key: 'starlink', label: 'Starlink', names: /^STARLINK/i },
  { key: 'oneweb', label: 'OneWeb', names: /^ONEWEB/i },
  { key: 'kuiper', label: 'Amazon Kuiper', names: /^KUIPER/i },
  { key: 'megacon', label: 'Other comms constellations', names: /^(QIANFAN|GUOWANG|HULIANWANG|SATNET|IRIDIUM|GLOBALSTAR|ORBCOMM)/i },
  { key: 'geo', label: 'Geosynchronous', orbit: ['GEO', 'GSO'] },
  { key: 'other', label: 'Other' },
];

export const CATEGORY_INDEX = Object.fromEntries(CATEGORIES.map((c, i) => [c.key, i]));

/** Facets are highlights layered on top of categories. */
export const FACETS = [
  { key: 'visual', label: 'Brightest', groups: ['visual'] },
  { key: 'recent', label: 'Launched in the last 30 days', groups: ['last-30-days'] },
];

/**
 * @param {string} name OBJECT_NAME
 * @param {Set<string>} groups CelesTrak groups containing this object
 * @param {string} orbit orbit class from orbit.orbitClass()
 * @returns {number} index into CATEGORIES
 */
export function categorize(name, groups, orbit) {
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    if (c.groups && c.groups.some((g) => groups.has(g))) return i;
    if (c.names && c.names.test(name)) return i;
    if (c.orbit && c.orbit.includes(orbit)) return i;
    if (!c.groups && !c.names && !c.orbit) return i;
  }
  return CATEGORIES.length - 1;
}

/** Bit flags for facets. */
export function facetBits(groups) {
  let bits = 0;
  FACETS.forEach((f, i) => {
    if (f.groups.some((g) => groups.has(g))) bits |= 1 << i;
  });
  return bits;
}

/** Map id → Set(group) from groups.json ({ group: [ids] }). */
export function membership(groupsJson) {
  const m = new Map();
  for (const [group, ids] of Object.entries(groupsJson || {})) {
    for (const id of ids) {
      let s = m.get(id);
      if (!s) m.set(id, (s = new Set()));
      s.add(group);
    }
  }
  return m;
}

const norm = (s) => String(s).toUpperCase().replace(/\s+/g, ' ').trim();
const JUNK_RE = /(\bDEB\b|\bR\/B\b|\bRB\b|\bAKM\b|\bPKM\b)/;

/** Build a search index from parallel arrays of names, ids and COSPAR designators. */
export function buildSearchIndex(names, ids, cospars) {
  return { names: names.map(norm), ids, cospars: cospars.map((c) => norm(c).replace(/-/g, '')) };
}

/**
 * Ranked search by catalog number, name or international designator.
 * @returns {number[]} indices into the arrays, best first
 */
export function search(index, query, limit = 30) {
  const q = norm(query);
  if (!q) return [];
  const scored = [];
  const digits = /^\d+$/.test(q);
  const qCospar = q.replace(/-/g, '');
  for (let i = 0; i < index.names.length; i++) {
    let score = 0;
    if (digits) {
      const id = String(index.ids[i]);
      if (id === q) score = 1000;
      else if (id.startsWith(q)) score = 300 - id.length;
    }
    const name = index.names[i];
    if (name === q) score = Math.max(score, 900);
    else if (name.startsWith(q)) score = Math.max(score, 700 - name.length);
    else {
      const at = name.indexOf(q);
      if (at > 0) {
        const wordStart = /[\s\-(/]/.test(name[at - 1]);
        score = Math.max(score, (wordStart ? 500 : 200) - name.length);
      }
    }
    if (qCospar.length >= 4 && index.cospars[i].startsWith(qCospar)) score = Math.max(score, 400);
    // Spacecraft before the debris and rocket bodies that share their names ("ISS DEB", "… R/B").
    if (score > 0 && score < 900 && JUNK_RE.test(name)) score -= 250;
    if (score > 0) scored.push([score, i]);
  }
  scored.sort((a, b) => b[0] - a[0] || index.names[a[1]].localeCompare(index.names[b[1]]));
  return scored.slice(0, limit).map((s) => s[1]);
}

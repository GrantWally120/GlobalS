// Data view: where the orbits come from and how fresh they are, file import, accuracy and credits.

import { DATA_AGE } from '../config.js';
import { fmtAge, fmtInt } from '../core/format.js';
import { $, el, fillKv } from './dom.js';
import { toast } from './toasts.js';

const SOURCE_LABEL = {
  site: 'CelesTrak, relayed by this site',
  feed: 'CelesTrak, via the public GlobalS feed',
  demo: 'DEMO data (reference orbits + synthetic shells)',
  import: 'Imported file',
  none: 'None',
};

export function initDataView(app) {
  const fileInput = $('#importFile');
  $('#importBtn').onclick = () => fileInput.click();
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (file) await importFile(file);
    fileInput.value = '';
  });

  async function importFile(file) {
    if (file.size > 50 * 1024 * 1024) return toast('That file is over 50 MB — too large to import.', { kind: 'warn' });
    const text = await file.text();
    const replace = $('#importReplace').checked;
    const box = $('#importReport');
    box.replaceChildren(el('div', { class: 'note info' }, `Reading ${file.name}…`));
    try {
      const res = await app.importText(text, replace ? 'replace' : 'merge');
      const items = [el('div', { class: 'note info' }, `Imported ${fmtInt(res.imported)} element set${res.imported === 1 ? '' : 's'} from ${file.name}. Catalogue now holds ${fmtInt(res.count)} objects.`)];
      if (res.problemCount) items.push(el('div', { class: 'note' }, `${res.problemCount} issue(s): ${res.problems.slice(0, 5).join('; ')}${res.problemCount > 5 ? '…' : ''}`));
      box.replaceChildren(...items);
    } catch (err) {
      box.replaceChildren(el('div', { class: 'note bad' }, err.message));
    }
  }

  // Drag & drop anywhere on the page.
  const overlay = $('#dropOverlay');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      app.showTab('data');
      await importFile(file);
    }
  });

  $('#accuracyText').replaceChildren(
    el('p', {}, 'Positions come from SGP4, the model the orbital data is made for. Public element sets are typically accurate to about a kilometre near their epoch, drifting by a few kilometres per day for low orbits — so the freshness of the data matters more than anything else.'),
    el('p', {}, 'GlobalS’s own maths is checked against Skyfield and the JPL DE421 ephemeris: pass rise/set times within 0.3 s, peak elevations within 0.005°, the Sun within 0.01°. The SGP4 code reproduces Vallado’s official verification output to 0.2 mm.'),
    el('p', {}, 'Pass times are for the geometric horizon without refraction; near the horizon, satellites actually appear a few seconds earlier. Brightness (magnitude) is not predicted: public orbital data carries no information about a satellite’s size or reflectivity.'),
    el('p', {}, 'Jumping far into the past or future still uses today’s catalogue: satellites launched later appear, and ones that have since re-entered are missing.'),
  );
  $('#creditsText').replaceChildren(
    el('ul', {},
      el('li', {}, 'Orbital data: ', el('a', { href: 'https://celestrak.org', target: '_blank', rel: 'noopener' }, 'CelesTrak'), ' (T.S. Kelso), from U.S. Space Force tracking data.'),
      el('li', {}, 'SGP4: satellite.js 7.1.0 (MIT), after Vallado et al. 2006.'),
      el('li', {}, '3D: three.js 0.186 (MIT). Maps: Natural Earth 1:50m via world-atlas (public domain / ISC).'),
      el('li', {}, 'Stars: XHIP (Hipparcos) and IAU constellation lines via d3-celestial (BSD-3).'),
      el('li', {}, 'Photoreal globe: NASA Blue Marble Next Generation and Black Marble 2016, NASA Earth Observatory (public domain).'),
      el('li', {}, 'Verification: Skyfield and python-sgp4 (Brandon Rhodes, MIT).')),
    el('p', { class: 'dim' }, 'Your location and settings stay in this browser. GlobalS sends nothing about you anywhere.'),
  );

  return {
    importFile,
    setData(info) {
      const { data, meta, source, clockOffsetMs, now } = info;
      const m = data?.manifest;
      const rows = [['Source', SOURCE_LABEL[source] ?? source]];
      if (m) {
        const age = (now - Date.parse(m.generatedAt)) / 3600e3;
        rows.push(['Updated', `${fmtAge(age)} (${m.generatedAt.slice(0, 16).replace('T', ' ')} UTC)`, age > DATA_AGE.redHours ? 'warn' : '']);
        if (m.epoch?.median) rows.push(['Median epoch', `${m.epoch.median.slice(0, 16).replace('T', ' ')} UTC`]);
        rows.push(['Version', m.version]);
      }
      if (meta) rows.push(['Objects', `${fmtInt(meta.count)}${meta.failed ? ` (${meta.failed} unusable)` : ''}`]);
      rows.push(['Your clock', clockOffsetMs ? `${(clockOffsetMs / 1000).toFixed(1)} s ${clockOffsetMs > 0 ? 'slow' : 'fast'} — corrected` : 'OK (within 2 s)', clockOffsetMs ? 'warn' : 'good']);
      fillKv($('#dataInfo'), rows);
      const notes = [];
      if (source === 'demo') notes.push(el('div', { class: 'note' }, 'DEMO DATA: live orbital data could not be loaded, so GlobalS is showing reference orbits and synthetic constellations. Positions are not real.'));
      if (!m && source !== 'import') notes.push(el('div', { class: 'note bad' }, 'No orbital data could be loaded. Check your internet connection, or import a TLE / OMM file below (you can download one from celestrak.org in your browser).'));
      if (m && (now - Date.parse(m.generatedAt)) / 3600e3 > DATA_AGE.redHours) {
        notes.push(el('div', { class: 'note' }, 'This data is more than two days old. The site refreshes it automatically every six hours; GitHub pauses scheduled updates after 60 days without repository activity, so the owner may need to re-enable the “Deploy GlobalS” workflow.'));
      }
      if (m?.groups && source !== 'demo') {
        const groups = Object.entries(m.groups);
        const carried = groups.filter(([, g]) => g.status === 'fallback');
        const missing = groups.filter(([, g]) => g.status !== 'fallback' && g.status !== 'fresh' && g.status !== 'reused');
        if (carried.length) notes.push(el('div', { class: 'note info' }, `CelesTrak didn’t answer for ${carried.map(([k]) => k).join(', ')} at the last update, so those groups are from the update before.`));
        if (missing.length) notes.push(el('div', { class: 'note info' }, `Unavailable at the last update: ${missing.map(([k, g]) => `${k} (${g.status})`).join(', ')}.`));
      }
      $('#dataNotes').replaceChildren(...notes);
    },
  };
}

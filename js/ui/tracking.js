// Tracking view: search, category layers, display options and telemetry.

import { CATEGORY_STYLE, ORBIT_CLASSES } from '../config.js';
import { CATEGORIES, search } from '../core/catalog.js';
import { fmtInt } from '../core/format.js';
import { $, el, setText } from './dom.js';
import { settings } from './store.js';

const TOGGLES = [
  ['paths', 'Orbit & ground track'], ['labels', 'Labels'], ['stars', 'Stars'], ['constellations', 'Constellations'],
  ['grid', 'Lat/long grid'], ['borders', 'Borders'], ['atmosphere', 'Atmosphere'],
];

export function initTracking(app) {
  const input = $('#search');
  const list = $('#searchResults');
  let results = [];
  let active = -1;

  function render() {
    list.replaceChildren();
    const q = input.value.trim();
    if (!q) return;
    if (!app.meta) {
      list.append(el('li', { class: 'empty' }, 'No orbital data loaded yet.'));
      return;
    }
    results = search(app.searchIndex, q, 40);
    if (!results.length) {
      list.append(el('li', { class: 'empty' }, `No satellite matches “${q}”.`));
      return;
    }
    results.forEach((i, k) => {
      const cat = app.categoryKeys[app.meta.cats[i]];
      list.append(el('li', {
        role: 'option', 'aria-selected': k === active ? 'true' : 'false', id: `res-${k}`,
        onclick: () => choose(k),
      },
      el('span', { class: 'swatch', style: { color: CATEGORY_STYLE[cat]?.color } }),
      el('span', { class: 'row-main' },
        el('div', { class: 'row-title' }, app.meta.names[i]),
        el('div', { class: 'row-sub' }, `NORAD ${app.meta.ids[i]} · ${app.meta.cospars[i] || '—'}`)),
      el('span', { class: 'row-side' }, ORBIT_CLASSES[app.meta.orbits[i]] ?? '')));
    });
  }

  function choose(k) {
    const i = results[k];
    if (i === undefined) return;
    app.select(i, { focus: true });
    input.blur();
  }

  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    active = -1;
    timer = setTimeout(render, 60);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, Math.min(results.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      render();
      $(`#res-${active}`)?.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', `res-${active}`);
    } else if (e.key === 'Enter') {
      choose(Math.max(active, 0));
    } else if (e.key === 'Escape') {
      input.value = '';
      render();
      input.blur();
    }
  });

  // Display toggles
  const toggles = $('#toggles');
  for (const [key, label] of TOGGLES) {
    const box = el('input', { type: 'checkbox', checked: settings.show[key] });
    box.addEventListener('change', () => app.setShow(key, box.checked));
    toggles.append(el('label', {}, box, label));
  }
  const holo = $('#styleHolo');
  const photo = $('#stylePhoto');
  holo.onclick = () => app.setStyle('holo');
  photo.onclick = () => app.setStyle('photo');

  return {
    focusSearch() {
      input.focus();
      input.select();
    },
    setStyle(style) {
      holo.setAttribute('aria-pressed', String(style === 'holo'));
      photo.setAttribute('aria-pressed', String(style === 'photo'));
    },
    setToggle(key, on) {
      const i = TOGGLES.findIndex(([k]) => k === key);
      if (i >= 0) toggles.children[i].firstChild.checked = on;
    },
    /** Rebuild category checkboxes with counts for a new catalogue. */
    setCatalog(meta) {
      const counts = new Array(CATEGORIES.length).fill(0);
      for (const c of meta.cats) counts[c]++;
      const ul = $('#layers');
      ul.replaceChildren();
      CATEGORIES.forEach((cat, k) => {
        if (!counts[k]) return;
        const hidden = settings.hiddenCats.includes(cat.key);
        const box = el('input', { type: 'checkbox', checked: !hidden });
        const li = el('li', { class: hidden ? 'off' : '' }, el('label', {}, box,
          el('span', { class: 'swatch', style: { color: CATEGORY_STYLE[cat.key]?.color } }), cat.label,
          el('span', { class: 'count' }, fmtInt(counts[k]))));
        box.addEventListener('change', () => {
          li.className = box.checked ? '' : 'off';
          app.setCategoryVisible(cat.key, box.checked);
        });
        ul.append(li);
      });
      setText($('#layersTotal'), `${fmtInt(meta.count)} objects`);
      render();
    },
    updateStats({ total, shown, lit, overhead, medianAgeDays, fps }) {
      setText($('#stTotal'), fmtInt(total));
      setText($('#stShown'), fmtInt(shown));
      setText($('#stLit'), fmtInt(lit));
      setText($('#stOverhead'), overhead == null ? '—' : fmtInt(overhead));
      setText($('#stAge'), Number.isFinite(medianAgeDays) ? `${Math.max(0, medianAgeDays).toFixed(1)} d` : '—');
      setText($('#stFps'), fps ? `${Math.round(fps)} fps` : '—');
    },
  };
}

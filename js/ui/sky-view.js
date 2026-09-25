// Sky view: a live radar of everything above your horizon, and the list behind it.

import { CATEGORY_STYLE } from '../config.js';
import { compass, fmtDeg, fmtInt, fmtKm } from '../core/format.js';
import { $, el, setText } from './dom.js';
import { drawDot, drawFrame } from './radar-svg.js';
import { settings } from './store.js';

export function initSkyView(app) {
  const radar = $('#skyRadar');
  const list = $('#overheadList');
  radar.addEventListener('click', () => {
    settings.radarMode = settings.radarMode === 'sky' ? 'map' : 'sky';
    app.saveSettings();
    app.refreshRadars();
  });

  return {
    update(oh) {
      const layer = drawFrame(radar, { mode: settings.radarMode, minElDeg: 0 });
      if (!oh) return;
      let lit = 0;
      for (const it of oh.items) {
        const sel = it.i === app.selected;
        const visible = it.lit && oh.skyDark;
        if (visible) lit++;
        drawDot(layer, it.az, it.el, { mode: settings.radarMode, cls: `sat${visible ? ' lit' : ''}${sel ? ' sel' : ''}`, r: sel ? 4 : visible ? 2.2 : 1.4 });
      }
      setText($('#skyInfo'), oh.skyDark ? 'sky dark' : 'sky bright');
      setText($('#skyCaption'), `${settings.radarMode === 'sky' ? 'Looking up (east on the left)' : 'Map view (east on the right)'} — tap to flip · `
        + `${oh.skyDark ? `${fmtInt(lit)} sunlit, so potentially visible` : 'too bright to see satellites now'}`);
      setText($('#overheadCount'), `${fmtInt(oh.items.length)} above the horizon`);
      list.replaceChildren();
      for (const it of oh.items.slice(0, 60)) {
        const cat = app.categoryKeys[app.meta.cats[it.i]];
        list.append(el('li', { onclick: () => app.select(it.i, { focus: true }) },
          el('span', { class: 'swatch', style: { color: CATEGORY_STYLE[cat]?.color } }),
          el('span', { class: 'row-main' },
            el('div', { class: 'row-title' }, app.meta.names[it.i]),
            el('div', { class: 'row-sub' }, `${fmtDeg(it.az, 0)} ${compass(it.az)} · ${fmtKm(it.range)}${it.lit ? ' · sunlit' : ''}`)),
          el('span', { class: 'row-side' }, fmtDeg(it.el, 0))));
      }
    },
  };
}

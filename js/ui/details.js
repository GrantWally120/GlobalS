// The selected satellite: facts, live position, look angles from the observer, next passes, radar.

import { CATEGORY_STYLE, ELEMENT_AGE_WARN_DAYS, ORBIT_CLASSES } from '../config.js';
import { CATEGORIES } from '../core/catalog.js';
import { compass, fmtAge, fmtDayShort, fmtDeg, fmtDuration, fmtHm, fmtInt, fmtKm, fmtLat, fmtLon } from '../core/format.js';
import { DEG, eciToEcf } from '../core/frames.js';
import { inertialToRotatingVelocity, lookAngles } from '../core/look.js';
import { apsides, periodSec } from '../core/orbit.js';
import { isSunlit } from '../core/passes.js';
import { $, el, fillKv, setText } from './dom.js';
import { drawDot, drawFrame, drawPass } from './radar-svg.js';
import { settings } from './store.js';
import { LOCAL_TZ } from './timebar.js';

const KIND_LABEL = { visible: 'Visible', daylight: 'Daylight', eclipsed: 'In shadow' };

/** How far the shown time is from the elements' epoch: "3.2 h", or "55 min before epoch" when time-travelling back. */
function elementAge(ageDays) {
  const days = Math.abs(ageDays);
  const span = days < 2 ? fmtAge(days * 24).replace(' ago', '') : `${days.toFixed(1)} days`;
  return ageDays < 0 && span !== 'just now' ? `${span} before epoch` : span;
}

export function initDetails(app) {
  const panel = $('#detailPanel');
  const list = $('#dPassList');
  let passes = null;
  let chosen = -1;
  let current = null;

  $('#dClose').onclick = () => app.deselect();
  $('#dFollow').onclick = () => app.toggleFollow();
  $('#dCenter').onclick = () => app.centreOnSelected();
  $('#dPasses').onclick = () => list.scrollIntoView({ behavior: 'smooth', block: 'start' });

  function header(i) {
    const m = app.meta;
    const catKey = app.categoryKeys[m.cats[i]];
    $('#dSwatch').style.color = CATEGORY_STYLE[catKey]?.color;
    setText($('#dName'), m.names[i]);
    const cat = CATEGORIES.find((c) => c.key === catKey)?.label ?? '';
    setText($('#dMeta'), `NORAD ${m.ids[i]} · ${m.cospars[i] || 'no COSPAR ID'} · ${cat}`);
  }

  function renderPasses() {
    list.replaceChildren();
    $('#dRadarWrap').hidden = true;
    if (!passes) {
      list.append(el('li', { class: 'empty' }, 'Calculating passes…'));
      return;
    }
    if (passes.error) {
      list.append(el('li', { class: 'empty' }, passes.error));
      return;
    }
    const o = app.observer;
    if (passes.alwaysUp) {
      list.append(el('li', { class: 'empty' }, `Always above ${settings.minElDeg}° from ${o.name} — a geosynchronous satellite hangs in the same place in your sky.`));
      return;
    }
    if (!passes.passes.length) {
      list.append(el('li', { class: 'empty' }, `No passes above ${settings.minElDeg}° from ${o.name} in the next 7 days.`));
      return;
    }
    passes.passes.slice(0, 20).forEach((p, k) => {
      const start = p.rise ?? p.max;
      const vis = p.visibility;
      const li = el('li', { class: 'pass', 'aria-selected': k === chosen ? 'true' : 'false', tabindex: 0,
        onclick: () => choose(k), onkeydown: (e) => { if (e.key === 'Enter') choose(k); } },
      el('div', { class: 'pass-top' },
        el('span', { class: 'pass-date' }, fmtDayShort(start.t, LOCAL_TZ)),
        el('span', { class: 'pass-time' }, `${fmtHm(start.t, LOCAL_TZ)}${p.set ? `–${fmtHm(p.set.t, LOCAL_TZ)}` : ''}`),
        el('span', { class: `pass-kind kind-${vis.kind}` }, KIND_LABEL[vis.kind])),
      el('div', { class: 'pass-sub' },
        'max ', el('span', { class: 'maxel' }, fmtDeg(p.max.elDeg, 0)), ` ${compass(p.max.azDeg)}`,
        p.rise ? ` · rises ${compass(p.rise.azDeg)}` : ' · already up',
        p.set ? ` · sets ${compass(p.set.azDeg)}` : '',
        p.durationSec ? ` · ${fmtDuration(p.durationSec)}` : '',
        vis.kind === 'visible' ? ` · look ${fmtHm(vis.start.t, LOCAL_TZ)}–${fmtHm(vis.end.t, LOCAL_TZ)}` : ''));
      list.append(li);
    });
    if (chosen < 0) choose(0, false);
  }

  function choose(k, scroll = true) {
    chosen = k;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === k)));
    const p = passes?.passes?.[k];
    if (!p) return;
    const wrap = $('#dRadarWrap');
    wrap.hidden = false;
    const layer = drawFrame($('#dRadar'), { mode: settings.radarMode, minElDeg: settings.minElDeg });
    drawPass(layer, p.track, { mode: settings.radarMode, timeZone: LOCAL_TZ });
    current = { layer, pass: p, dot: null };
    const vis = p.visibility;
    setText($('#dRadarCaption'), `${settings.radarMode === 'sky' ? 'Looking up: north at top, east on the LEFT' : 'Map view: north at top, east on the right'} · `
      + `${vis.kind === 'visible' ? `visible ${fmtHm(vis.start.t, LOCAL_TZ)}–${fmtHm(vis.end.t, LOCAL_TZ)}, up to ${fmtDeg(vis.maxElDeg, 0)}` : KIND_LABEL[vis.kind].toLowerCase()}`);
    if (scroll) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  return {
    show(i) {
      panel.hidden = false;
      document.body.classList.add('detail-open');
      header(i);
      passes = null;
      chosen = -1;
      renderPasses();
    },
    hide() {
      panel.hidden = true;
      document.body.classList.remove('detail-open');
      passes = null;
    },
    setPasses(result) {
      passes = result;
      chosen = -1;
      renderPasses();
      setText($('#dPassInfo'), result?.passes ? `from ${app.observer.name} · ≥${settings.minElDeg}°` : '');
    },
    setFollow(on) {
      $('#dFollow').setAttribute('aria-pressed', String(on));
    },
    /** 4 Hz refresh from the exact SGP4 state computed in the render loop. */
    update(state, t) {
      const rec = app.selectedRec;
      if (!rec) return;
      if (!state) {
        fillKv($('#dKv'), [['Status', 'No valid position (decayed or bad elements)', 'warn']]);
        return;
      }
      const { r, v, geo, ecf, gmst } = state;
      const speed = Math.hypot(v.x, v.y, v.z);
      const ap = apsides(rec);
      const o = app.observer;
      const vEcf = inertialToRotatingVelocity(eciToEcf(v, gmst), ecf);
      const la = lookAngles(o, ecf, vEcf);
      const lit = isSunlit(r, t);
      const ageDays = (t - rec.epochMs) / 86400e3;
      const deep = periodSec(rec) >= 225 * 60;
      const ageLimit = deep ? ELEMENT_AGE_WARN_DAYS.deepSpace : ELEMENT_AGE_WARN_DAYS.nearEarth;
      fillKv($('#dKv'), [
        ['Altitude', fmtKm(geo.h, 1)],
        ['Speed', `${speed.toFixed(3)} km/s`],
        ['Latitude', fmtLat(geo.lat / DEG)],
        ['Longitude', fmtLon(geo.lon / DEG)],
        ['Sunlight', lit ? 'Sunlit' : 'In Earth’s shadow', lit ? 'good' : ''],
        [`From ${o.name}`, `${fmtDeg(la.azDeg, 1)} ${compass(la.azDeg)} · ${la.elDeg >= 0 ? `${fmtDeg(la.elDeg, 1)} up` : `${fmtDeg(-la.elDeg, 1)} below`}`, la.elDeg > 0 ? 'good' : ''],
        ['Range', `${fmtKm(la.rangeKm)} · ${la.rangeRateKms >= 0 ? '+' : '−'}${Math.abs(la.rangeRateKms).toFixed(2)} km/s`],
        ['Orbit', `${ORBIT_CLASSES[app.meta.orbits[app.selected]]} · ${fmtDuration(periodSec(rec))}`],
        ['Inclination', fmtDeg(rec.satrec.inclo / DEG, 2)],
        ['Apogee × perigee', `${fmtInt(ap.apogeeKm)} × ${fmtInt(ap.perigeeKm)} km`],
        ['Eccentricity', rec.satrec.ecco.toFixed(5)],
        ['Elements from', `${new Date(rec.epochMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`],
        ['Element age', elementAge(ageDays), Math.abs(ageDays) > ageLimit ? 'warn' : ''],
      ]);
      const notes = $('#dNotes');
      const msg = Math.abs(ageDays) > ageLimit
        ? `These orbital elements are ${Math.abs(ageDays).toFixed(1)} days from the time shown. SGP4 is typically good to about a kilometre near the element epoch and drifts by a few kilometres per day, so this position is approximate.`
        : '';
      if (notes.dataset.msg !== msg) {
        notes.dataset.msg = msg;
        notes.replaceChildren(...(msg ? [el('div', { class: 'note' }, msg)] : []));
      }
      // live dot on the radar while the chosen pass is under way
      if (current) {
        current.dot?.remove();
        current.dot = null;
        const p = current.pass;
        if (la.elDeg > -1 && (p.rise?.t ?? -Infinity) <= t && t <= (p.set?.t ?? Infinity)) {
          current.dot = drawDot(current.layer, la.azDeg, la.elDeg, { mode: settings.radarMode });
        }
      }
    },
  };
}

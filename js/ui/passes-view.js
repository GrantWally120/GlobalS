// Passes view: where you are, and tonight's naked-eye passes of bright satellites.

import { DEFAULT_OBSERVER } from '../config.js';
import { compass, fmtDayShort, fmtDeg, fmtHm } from '../core/format.js';
import { $, el, setText } from './dom.js';
import { settings } from './store.js';
import { LOCAL_TZ } from './timebar.js';
import { toast } from './toasts.js';

export function initPassesView(app) {
  const f = { name: $('#locName'), lat: $('#locLat'), lon: $('#locLon'), h: $('#locH'), minEl: $('#locMinEl') };

  function fill(o) {
    f.name.value = o.name;
    f.lat.value = o.latDeg.toFixed(5);
    f.lon.value = o.lonDeg.toFixed(5);
    f.h.value = Math.round(o.hKm * 1000);
    f.minEl.value = String(settings.minElDeg);
  }

  $('#locationForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const lat = Number.parseFloat(f.lat.value);
    let lon = Number.parseFloat(f.lon.value);
    const h = Number.parseFloat(f.h.value || '0');
    if (!(lat >= -90 && lat <= 90)) return toast('Latitude must be between −90 and 90.', { kind: 'warn' });
    if (!Number.isFinite(lon)) return toast('Longitude must be a number (east positive).', { kind: 'warn' });
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    if (!(h > -500 && h < 9000)) return toast('Height should be in metres above sea level.', { kind: 'warn' });
    settings.minElDeg = Number(f.minEl.value);
    app.setObserver({ name: f.name.value.trim() || 'My location', latDeg: lat, lonDeg: lon, hKm: h / 1000 });
    toast(`Location saved: ${f.name.value.trim() || 'My location'}.`);
  });

  $('#locCebu').onclick = () => {
    app.setObserver({ ...DEFAULT_OBSERVER });
    fill(DEFAULT_OBSERVER);
  };

  $('#locGeo').onclick = () => {
    if (!navigator.geolocation) return toast('This browser cannot share your location.', { kind: 'warn' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const o = { name: 'My location', latDeg: pos.coords.latitude, lonDeg: pos.coords.longitude, hKm: (pos.coords.altitude ?? 0) / 1000 };
        app.setObserver(o);
        fill(o);
        toast(`Using your location (±${Math.round(pos.coords.accuracy)} m). It stays on this device.`);
      },
      (err) => toast(`Couldn't get your location: ${err.message}`, { kind: 'warn' }),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  };

  const list = $('#tonightList');
  return {
    fill,
    setTonight(result) {
      list.replaceChildren();
      if (!result) {
        list.append(el('li', { class: 'empty' }, 'Calculating tonight’s passes…'));
        setText($('#tonightInfo'), '');
        return;
      }
      if (result.error) {
        list.append(el('li', { class: 'empty' }, result.error));
        return;
      }
      if (!result.passes.length) {
        list.append(el('li', { class: 'empty' }, `No naked-eye passes above ${settings.minElDeg}° in the next two nights. Satellites are only visible when they are sunlit while your sky is dark.`));
        setText($('#tonightInfo'), '');
        return;
      }
      setText($('#tonightInfo'), `${result.passes.length} passes`);
      for (const p of result.passes.slice(0, 80)) {
        const v = p.visibility;
        list.append(el('li', {
          class: 'pass', tabindex: 0,
          onclick: () => app.selectById(p.id, { passAt: p.max.t }),
          onkeydown: (e) => { if (e.key === 'Enter') app.selectById(p.id, { passAt: p.max.t }); },
        },
        el('div', { class: 'pass-top' },
          el('span', { class: 'pass-date' }, fmtDayShort(v.start.t, LOCAL_TZ)),
          el('span', { class: 'pass-time' }, `${fmtHm(v.start.t, LOCAL_TZ)}–${fmtHm(v.end.t, LOCAL_TZ)}`),
          el('span', { class: 'pass-name' }, p.name)),
        el('div', { class: 'pass-sub' },
          `from ${compass(v.start.azDeg)} to ${compass(v.end.azDeg)} · up to `,
          el('span', { class: 'maxel' }, fmtDeg(v.maxElDeg, 0)), ` · peak ${fmtHm(p.max.t, LOCAL_TZ)}`)));
      }
    },
  };
}

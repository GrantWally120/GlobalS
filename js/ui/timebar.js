// Bottom bar: clocks (UTC, local, GMST, observer LST, Julian Date) and time controls.

import { dateTimeLocalValue, fmtClock, fmtDate, fmtRate, zoneLabel } from '../core/format.js';
import { gmstFromMs, hoursToHms, jdFromMs, lstRad, parseTimeParam, radToHours } from '../core/time.js';
import { $, setText } from './dom.js';

export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function initTimebar(app) {
  const c = app.clock;
  const q = (id) => $(`#${id}`);
  q('tBack').onclick = () => app.jumpTo(c.now() - 3600e3);
  q('tFwd').onclick = () => app.jumpTo(c.now() + 3600e3);
  q('tSlower').onclick = () => app.setRate(c.nextRate(-1));
  q('tFaster').onclick = () => app.setRate(c.nextRate(+1));
  q('tPlay').onclick = () => app.setRate(c.rate === 0 ? c.lastNonZeroRate || 1 : 0);
  q('tNow').onclick = () => app.backToNow();
  const jump = q('tJump');
  jump.addEventListener('change', () => {
    const t = parseTimeParam(jump.value, c.now(), LOCAL_TZ);
    if (Number.isFinite(t)) app.jumpTo(t);
  });
  let editing = false;
  jump.addEventListener('focus', () => { editing = true; });
  jump.addEventListener('blur', () => { editing = false; });

  return {
    update(t) {
      setText(q('cUtc'), fmtClock(t, 'UTC'));
      setText(q('cUtcDate'), fmtDate(t, 'UTC'));
      setText(q('cLocalLbl'), `Local ${zoneLabel(t, LOCAL_TZ)}`);
      setText(q('cLocal'), fmtClock(t, LOCAL_TZ));
      setText(q('cLocalDate'), fmtDate(t, LOCAL_TZ));
      setText(q('cGmst'), hoursToHms(radToHours(gmstFromMs(t))));
      setText(q('cLst'), hoursToHms(radToHours(lstRad(t, app.observer.lon))));
      setText(q('cJd'), jdFromMs(t).toFixed(5));
      setText(q('tRate'), fmtRate(c.rate));
      const playBtn = q('tPlay');
      setText(playBtn, c.rate === 0 ? '▶' : '❚❚');
      playBtn.setAttribute('aria-label', c.rate === 0 ? 'Play' : 'Pause');
      if (!editing) jump.value = dateTimeLocalValue(t, LOCAL_TZ);
      const live = c.isLive();
      const badge = q('timeBadge');
      badge.className = `badge ${live ? 'live' : 'sim'}`;
      setText(q('timeBadgeText'), live ? 'LIVE' : c.rate === 0 ? 'PAUSED' : 'SIMULATED');
    },
  };
}

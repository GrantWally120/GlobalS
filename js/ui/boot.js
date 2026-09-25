// The start-up screen. Unlike v1's scripted log, every line reports a step that really happened.

import { $, el } from './dom.js';

export function createBoot() {
  const bar = $('#bootBar');
  const pct = $('#bootPct');
  const phase = $('#bootPhase');
  const log = $('#bootLog');
  const dots = $('#bootDots');
  let n = 0;
  const timer = setInterval(() => {
    n = (n + 1) % 4;
    dots.textContent = '.'.repeat(n);
  }, 350);
  const tags = { ok: 'OK', warn: '!!', err: 'ERR' };
  return {
    progress(p, label) {
      bar.style.width = `${p}%`;
      pct.textContent = `${Math.round(p)}%`;
      if (label) phase.textContent = label;
    },
    log(kind, text) {
      log.append(el('div', {}, '[', el('span', { class: kind }, tags[kind] ?? kind), '] ', text));
      log.scrollTop = log.scrollHeight;
    },
    fail(message) {
      clearInterval(timer);
      dots.textContent = '';
      phase.textContent = 'STOPPED';
      const box = $('#bootError');
      box.hidden = false;
      box.textContent = message;
    },
    done() {
      clearInterval(timer);
      dots.textContent = '';
      this.progress(100, 'READY');
      setTimeout(() => {
        $('#boot').classList.add('hidden');
        const app = $('#app');
        app.classList.add('show');
        app.removeAttribute('aria-hidden');
      }, 250);
    },
  };
}

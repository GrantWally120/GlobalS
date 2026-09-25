// Small notifications in the corner.

import { $, el } from './dom.js';

export function toast(message, { kind = 'info', action, timeout = 7000 } = {}) {
  const box = el('div', { class: `toast ${kind === 'info' ? '' : kind}`, role: kind === 'bad' ? 'alert' : 'status' }, message);
  if (action) box.append(el('button', { class: 'btn', onclick: () => { action.onClick(); box.remove(); } }, action.label));
  $('#toasts').append(box);
  if (timeout) setTimeout(() => box.remove(), timeout);
  return box;
}

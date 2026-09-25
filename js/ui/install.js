// Installable app: the Install button, the service worker and the update prompt.

import { $ } from './dom.js';
import { toast } from './toasts.js';

export function initInstall({ isLocal, params }) {
  let deferred = null;
  const btn = $('#installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.onclick = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    btn.hidden = true;
  };
  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
    toast('GlobalS is installed — find it in your Start menu or pin it to the taskbar.');
  });

  if (!('serviceWorker' in navigator) || (isLocal && !params.has('sw'))) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => toast('A new version of GlobalS is ready.', {
      timeout: 0,
      action: { label: 'Reload', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 3600e3);
  }).catch(() => {
    // offline support is a bonus; the app works without it
  });
}

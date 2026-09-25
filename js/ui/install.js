// Installable app: the Install button, the service worker, the update prompt and offline data.

import { $ } from './dom.js';
import { toast } from './toasts.js';

let swEnabled = false;
let development = false;

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

  // Local development serves unstamped files; ?sw=1 tests the real thing against a staged site.
  development = isLocal && !params.has('sw');
  if (!('serviceWorker' in navigator) || development) return;
  swEnabled = true;
  // The first worker to take control of this page is the one just installed on a first visit —
  // nothing to reload for. Any later change of control is an update, and the page must reload so
  // its code matches the new cache.
  let controlled = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
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

/** Ask the service worker to keep this exact data snapshot for starting offline. */
export async function keepDataOffline(manifestUrl, manifest, files) {
  if (!swEnabled) return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: 'KEEP_DATA', manifestUrl, manifest, files });
}

/**
 * The running build (version.json is written at deploy; a service worker serves its own copy) and
 * whether GlobalS can start offline: 'ready' | 'pending' (first visit, still caching) |
 * 'unsupported' | 'off' (development).
 */
export async function buildInfo() {
  if (development) return { version: null, offline: 'off' };
  let version = null;
  try {
    const res = await fetch('version.json', { cache: 'no-cache' });
    if (res.ok) version = (await res.json()).version ?? null;
  } catch {
    // offline without a service worker
  }
  const offline = !swEnabled ? 'unsupported' : navigator.serviceWorker.controller ? 'ready' : 'pending';
  return { version, offline };
}

/** Last resort for a stuck installation: forget the service worker and every cached file. */
export async function resetAppCache() {
  if ('serviceWorker' in navigator) {
    // Other sites can share this origin (every project page on a github.io account does).
    const scope = new URL('./', location.href).href;
    for (const reg of await navigator.serviceWorker.getRegistrations()) if (reg.scope === scope) await reg.unregister();
  }
  if ('caches' in window) {
    for (const key of await caches.keys()) if (key.startsWith('globals-')) await caches.delete(key);
  }
  location.reload();
}

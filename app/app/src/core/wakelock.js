// Bildschirm während des Spiels anlassen (Screen Wake Lock API).
// Auf iOS erst ab Safari 16.4 vorhanden; in Home-Bildschirm-Apps laut WebKit-Bugtracker
// erst ab iOS 18.4 zuverlässig. Wird beim Zurückkehren in die App neu angefordert.

let sentinel = null;
let wanted = false;
let status = 'aus';
const listeners = new Set();

function setStatus(s) {
  status = s;
  listeners.forEach((fn) => fn(s));
}

export function wakeLockSupported() {
  return 'wakeLock' in navigator;
}

async function acquire() {
  if (!wanted || !wakeLockSupported() || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    setStatus('aktiv');
    sentinel.addEventListener('release', () => {
      sentinel = null;
      if (wanted) setStatus('unterbrochen');
    });
  } catch (e) {
    setStatus('abgelehnt');
  }
}

export function keepAwake(on) {
  wanted = on;
  if (on) acquire();
  else {
    if (sentinel) sentinel.release().catch(() => {});
    sentinel = null;
    setStatus('aus');
  }
}

export function wakeLockStatus() {
  return wakeLockSupported() ? status : 'nicht unterstützt';
}
export function onWakeLock(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted && !sentinel) acquire();
});

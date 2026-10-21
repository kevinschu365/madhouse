// Einstieg: Farben setzen, Bildschirme verwalten, Service Worker registrieren.
import { BRAND } from './config.js';
import { clear } from './ui/dom.js';
import { requestPersistence } from './core/storage.js';
import * as home from './ui/screens/home.js';
import * as players from './ui/screens/players.js';
import * as setup from './ui/screens/setup.js';
import * as game from './ui/screens/game.js';
import * as stats from './ui/screens/stats.js';
import * as settings from './ui/screens/settings.js';
import * as calibrate from './ui/screens/calibrate.js';
import { camera } from './vision/camera.js';

const SCREENS = { home, players, setup, game, stats, settings, calibrate };

function applyBrand() {
  const r = document.documentElement.style;
  const c = BRAND.colors;
  r.setProperty('--bg', c.background);
  r.setProperty('--surface', c.surface);
  r.setProperty('--surface2', c.surface2);
  r.setProperty('--accent', c.accent);
  r.setProperty('--accent-dim', c.accentDim);
  r.setProperty('--text', c.text);
  r.setProperty('--text-dim', c.textDim);
  r.setProperty('--danger', c.danger);
  r.setProperty('--warn', c.warn);
  document.title = BRAND.name;
}

const root = document.getElementById('app');
let cleanup = null;
let current = null;

export const nav = {
  go(name, params = {}) {
    if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } }
    cleanup = null;
    clear(root);
    window.scrollTo(0, 0);
    current = name;
    // Kamera-Stream nur zwischen Kalibrierung und Spiel offen halten (iOS fragt sonst evtl. erneut)
    if (name !== 'game' && name !== 'calibrate') camera.stop();
    const screen = SCREENS[name] || SCREENS.home;
    const res = screen.render(root, params, nav);
    if (typeof res === 'function') cleanup = res;
    // Absichtlich KEINE Änderung der URL (#hash/pushState): iOS entzieht Home-Bildschirm-Apps
    // sonst die Kamera-Erlaubnis (WebKit-Bug 215884).
  },
  get current() { return current; },
};

applyBrand();
requestPersistence();
nav.go('home');

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker', e));
}

// Einstieg: Farben setzen, Bildschirme verwalten, Service Worker registrieren.
import { BRAND } from './config.js';
import { clear } from './ui/dom.js';
import { requestPersistence, lsSet } from './core/storage.js';
import * as home from './ui/screens/home.js';
import * as players from './ui/screens/players.js';
import * as setup from './ui/screens/setup.js';
import * as game from './ui/screens/game.js';
import * as stats from './ui/screens/stats.js';
import * as settings from './ui/screens/settings.js';
import * as calibrate from './ui/screens/calibrate.js';
import * as training from './ui/screens/training.js';
import * as help from './ui/screens/help.js';
import * as tournament from './ui/screens/tournament.js';
import * as board from './ui/screens/board.js';
import * as live from './ui/screens/live.js';
import * as records from './ui/screens/records.js';
import * as milestones from './ui/screens/milestones.js';
import { camera } from './vision/camera.js';

const SCREENS = { home, players, setup, game, stats, settings, calibrate, training, help, tournament, board, live, records, milestones };

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
let reloadPending = false; // neue App-Version ist aktiv, Neuladen steht aus

export const nav = {
  go(name, params = {}) {
    if (reloadPending && name === 'home') { location.reload(); return; } // neue Version wartet (siehe unten)
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
// QR-Code vom Turnier-Server („?board=2“): direkt das Board-Handy für dieses Board öffnen.
// Die Adresse wird nur gelesen, nicht verändert (siehe Kamera-Hinweis in nav.go).
const qs = new URLSearchParams(location.search);
const qrBoard = parseInt(qs.get('board'), 10);
if (qs.get('live')) lsSet('liveCloud', qs.get('live').toUpperCase()); // Online-Turnier (QR-Code mit Code)
if (qrBoard > 0) { lsSet('liveBoard', qrBoard); nav.go('board'); } else nav.go('home');

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Neue Version aktiv (sw.js) -> einmal neu laden, damit nie alte und neue Dateien zusammen laufen.
  // Mitten im Spiel oder beim Kalibrieren erst beim nächsten Wechsel auf die Startseite.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadPending) return;
    reloadPending = true;
    if (current !== 'game' && current !== 'calibrate') location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((r) => r.update()).catch((e) => console.warn('Service Worker', e));
}

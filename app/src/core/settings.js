// Einstellungen und Spielerliste (lokal gespeichert).
import { lsGet, lsSet } from './storage.js';
import { newId } from '../game/match.js';

export const DEFAULT_SETTINGS = {
  speechLang: 'de',          // 'de' | 'en'
  announceDart: true,        // jeden Dart ansagen
  announceTurn: true,        // Summe der Aufnahme ansagen
  announceRest: true,        // Rest nach der Aufnahme ansagen
  voiceURI: null,            // gewählte Stimme (null = automatisch)
  speechRate: 1.0,
  beeps: true,               // Warntöne
  cameraEnabled: true,       // Kamera-Erkennung im Spiel
  cameraDeviceId: null,      // gewählte Rückkamera (null = Standard)
  saveCorrectionImages: true,// Bild speichern, wenn ein erkannter Dart korrigiert wird
  autoAdvance: true,         // automatisch weiter, wenn Board leer
  performance: 'auto',       // 'auto' | 'low' | 'high'
  lastSetup: { startScore: 501, setsBestOf: 1, legsBestOf: 3 },
};

let settings = { ...DEFAULT_SETTINGS, ...lsGet('settings', {}) };
const listeners = new Set();

export function getSettings() {
  return settings;
}
export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  lsSet('settings', settings);
  listeners.forEach((fn) => fn(settings));
}
export function reloadSettings() {
  settings = { ...DEFAULT_SETTINGS, ...lsGet('settings', {}) };
}
export function onSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Spieler ----------
export function getPlayers() {
  return lsGet('players', []);
}
export function savePlayers(list) {
  lsSet('players', list);
}
export function addPlayer(name) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) throw new Error('Bitte einen Namen eingeben.');
  const list = getPlayers();
  if (list.some((p) => p.name.toLowerCase() === clean.toLowerCase())) throw new Error('Diesen Namen gibt es schon.');
  const p = { id: newId('p'), name: clean, createdAt: Date.now() };
  list.push(p);
  savePlayers(list);
  return p;
}
export function renamePlayer(id, name) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) throw new Error('Bitte einen Namen eingeben.');
  const list = getPlayers();
  if (list.some((p) => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) throw new Error('Diesen Namen gibt es schon.');
  savePlayers(list.map((p) => (p.id === id ? { ...p, name: clean } : p)));
}
export function removePlayer(id) {
  // Spieler wird nur aus der Auswahl entfernt; alte Statistiken behalten den Namen im Match.
  savePlayers(getPlayers().filter((p) => p.id !== id));
}
export function playerName(id, fallback = '?') {
  const p = getPlayers().find((x) => x.id === id);
  return p ? p.name : fallback;
}

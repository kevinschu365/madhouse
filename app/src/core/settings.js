// Einstellungen und Spielerliste (lokal gespeichert).
import { lsGet, lsSet } from './storage.js';
import { newId } from '../game/match.js';

export const DEFAULT_SETTINGS = {
  speechLang: 'de',          // 'de' | 'en' | Dialekt (siehe audio/speech.js)
  quips: true,               // witzige Sprüche nach der Aufnahme (180, Überworfen …)
  announceDart: true,        // jeden Dart ansagen
  announceTurn: true,        // Summe der Aufnahme ansagen
  announceRest: true,        // Rest nach der Aufnahme ansagen
  announceRequire: true,     // Rest vor dem Wurf ansagen, wenn auscheckbar (X01)
  announceRequireName: true, // dabei den Namen dazusagen („Kevin, Rest 80“ statt „Rest 80“)
  taunts: true,              // Sticheleien, wenn jemand mehrere Aufnahmen in Folge unter 40 bleibt
  say26: true,               // bei 26 „Twenty fucking six“ statt „26“
  ownerId: null,             // Wem gehört dieses Handy? (Spieler-Kennung) – Startseite zeigt dann nur ihn
  homeAllPlayers: false,     // Startseite: trotzdem alle Spieler zeigen
  homeShowWeek: true,        // Startseite: Karte „Wochenaufgaben“
  homeShowProgress: true,    // Startseite: Karte „Fortschritt“
  homeCollapsed: {},         // eingeklappte Karten der Startseite: { week, prog }
  voiceURI: null,            // gewählte Stimme (null = automatisch)
  speechRate: 1.0,
  speechPitch: 1.0,          // Stimmlage: unter 1 = tiefer (männlicher), über 1 = höher
  restPause: 1.0,            // Pause (Sekunden) zwischen Summe und Rest
  beeps: true,               // Warntöne
  cameraEnabled: true,       // Kamera-Erkennung im Spiel
  cameraDeviceId: null,      // gewählte Rückkamera (null = Standard)
  cameraDebug: false,        // Diagnose-Zeile unter dem Kamerabild
  saveCorrectionImages: true,// Bild speichern, wenn ein erkannter Dart korrigiert wird
  autoAdvance: true,         // automatisch weiter, wenn Board leer
  performance: 'auto',       // 'auto' | 'low' | 'high'
  inputMode: 'total',        // Handeingabe: 'dart' (pro Dart) | 'board' (Scheibe) | 'total' (Summe)
  lastSetup: { startScore: 501, setsBestOf: 1, legsBestOf: 3 },
};

let settings = { ...DEFAULT_SETTINGS, ...lsGet('settings', {}) };
// Einmalig (Version 1.3): Summe wird Standard-Eingabe, auch wenn vorher „Pro Dart“ gespeichert war
if (!settings.inputTotalDefault) {
  settings = { ...settings, inputMode: 'total', inputTotalDefault: true };
  lsSet('settings', settings);
}
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
// Jeder Spieler hat eine feste Nummer (#12345). Sie wird beim Abgleich mitgeschickt: Darüber erkennt
// das andere Handy den Spieler sicher wieder – auch wenn es zwei Spieler mit gleichem Namen gibt.

/** Neue fünfstellige Nummer, die in der Liste noch nicht vorkommt. */
export function newPlayerCode(list = []) {
  const used = new Set(list.map((p) => p.code));
  let code;
  do code = String(10000 + Math.floor(Math.random() * 90000)); while (used.has(code));
  return code;
}

export function getPlayers() {
  const list = lsGet('players', []);
  // Ältere Spieler (vor 1.8.1) bekommen beim ersten Lesen ihre Nummer
  if (list.some((p) => !p.code)) {
    for (const p of list) if (!p.code) p.code = newPlayerCode(list);
    lsSet('players', list);
  }
  return list;
}
export function savePlayers(list) {
  lsSet('players', list);
}
/** Anzeige mit Nummer, nur wenn der Name mehrfach vorkommt („Kevin #48213“). */
export function displayName(p, list = getPlayers()) {
  const twins = list.filter((x) => x.name.toLowerCase() === p.name.toLowerCase()).length > 1;
  return twins ? `${p.name} #${p.code}` : p.name;
}
export function addPlayer(name) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) throw new Error('Bitte einen Namen eingeben.');
  const list = getPlayers();
  // Gleiche Namen sind erlaubt – die Nummer unterscheidet sie
  const p = { id: newId('p'), code: newPlayerCode(list), name: clean, createdAt: Date.now() };
  list.push(p);
  savePlayers(list);
  return p;
}
export function renamePlayer(id, name) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) throw new Error('Bitte einen Namen eingeben.');
  savePlayers(getPlayers().map((p) => (p.id === id ? { ...p, name: clean } : p)));
}
export function removePlayer(id) {
  // Spieler wird nur aus der Auswahl entfernt; alte Statistiken behalten den Namen im Match.
  savePlayers(getPlayers().filter((p) => p.id !== id));
}
/** Spieler, dem dieses Handy gehört (Einstellungen), oder null, wenn keiner gewählt bzw. gelöscht ist. */
export function ownerId() {
  const id = getSettings().ownerId;
  return id && getPlayers().some((p) => p.id === id) ? id : null;
}
export function playerName(id, fallback = '?') {
  const p = getPlayers().find((x) => x.id === id);
  return p ? p.name : fallback;
}

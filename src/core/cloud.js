// Online-Turnier über Firebase Realtime Database (REST, ohne Fremdbibliothek).
// Wird nur benutzt, wenn FIREBASE_DB_URL in config.js eingetragen ist und jemand „Online live schalten“ wählt.
// Ablage: /turniere/<CODE>/t = Turnierplan, /turniere/<CODE>/m/<MatchId> = Spielstand – jeweils als JSON-Text
// (Firebase verändert sonst Listen mit Lücken und leere Listen). Der Code hat 8 Zeichen und ist nur
// den Mitspielern bekannt; die Firebase-Regeln erlauben nur Zugriff auf einzelne Turniere, keine Liste.
// Geräte bekommen per Datenstrom nur die Änderungen (spart Datenvolumen).

import { FIREBASE_DB_URL } from '../config.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I, O, 0, 1 (leicht zu verwechseln)
export const CODE_LENGTH = 8;

export const cloudEnabled = () => !!FIREBASE_DB_URL;

/** Neuer zufälliger Turnier-Code. */
export function newCode() {
  return [...crypto.getRandomValues(new Uint8Array(CODE_LENGTH))].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}
/** Eingabe säubern („k7p2-qx9m“ -> „K7P2QX9M“); null, wenn kein gültiger Code. */
export function normCode(s) {
  const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === CODE_LENGTH && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}
/** Anzeige mit Bindestrich: „K7P2-QX9M“. */
export const showCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : '');

const base = (code) => `${FIREBASE_DB_URL.replace(/\/+$/, '')}/turniere/${code}`;

async function req(url, method, body) {
  const res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`Online-Dienst antwortet mit ${res.status}${res.status === 401 ? ' (Regeln in Firebase prüfen)' : ''}`);
  return res.json();
}

export const putTournament = (code, t) => req(`${base(code)}/t.json`, 'PUT', JSON.stringify(t));
export const putMatch = (code, m) => req(`${base(code)}/m/${m.id}.json`, 'PUT', JSON.stringify(m));
/** Turnier online löschen (nach dem Turnier; die Spiele bleiben auf den Geräten). */
export const deleteOnline = (code) => req(`${base(code)}.json`, 'DELETE');

/** Rohdaten { t: Text, m: { id: Text } } -> { tournament, matches }. */
function parseState(raw) {
  const tournament = raw && typeof raw.t === 'string' ? JSON.parse(raw.t) : null;
  const matches = Object.values((raw && raw.m) || {}).filter((s) => typeof s === 'string').map((s) => JSON.parse(s));
  return { tournament, matches };
}

/** Einmal laden (z. B. beim Beitreten prüfen, ob es den Code gibt). */
export async function fetchState(code) {
  return parseState(await req(`${base(code)}.json`, 'GET'));
}

/**
 * Laufend mitlesen: onChange({ tournament, matches }) bei jeder Änderung, onError(text) bei Störungen.
 * Rückgabe: Funktion zum Beenden. Der Browser verbindet sich bei Abbrüchen selbst neu.
 */
export function watch(code, onChange, onError = () => {}) {
  let raw = {};
  const es = new EventSource(`${base(code)}.json`);
  const apply = (path, data, merge) => {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) { raw = merge ? { ...raw, ...data } : (data || {}); return; }
    let o = raw;
    for (const p of parts.slice(0, -1)) o = (o[p] && typeof o[p] === 'object') ? o[p] : (o[p] = {});
    const k = parts[parts.length - 1];
    if (merge && data && typeof data === 'object') {
      const target = (o[k] && typeof o[k] === 'object') ? o[k] : (o[k] = {});
      for (const [kk, v] of Object.entries(data)) { if (v === null) delete target[kk]; else target[kk] = v; }
    } else if (data === null) delete o[k];
    else o[k] = data;
  };
  const handle = (merge) => (e) => {
    try {
      const { path, data } = JSON.parse(e.data);
      apply(path, data, merge);
      onChange(parseState(raw));
    } catch (err) { onError(err.message); }
  };
  es.addEventListener('put', handle(false));
  es.addEventListener('patch', handle(true));
  es.addEventListener('cancel', () => onError('Zugriff verweigert (Regeln in Firebase prüfen)'));
  es.onerror = () => onError('Verbindung zum Online-Dienst unterbrochen – es wird neu verbunden …');
  return () => es.close();
}

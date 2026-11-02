// Live-Turnier im eigenen WLAN: Verbindung zum Turnier-Server auf dem PC (werkzeuge/turnier-server.ps1).
// Die App wird dann vom PC geladen (http://<PC>:8130/app/), deshalb liegen die Schnittstellen unter /api/ derselben Adresse.
// Der PC (Turnierleitung) schickt den Turnierplan, die Board-Handys schicken nach jeder Aufnahme den Spielstand.
// Fällt das WLAN kurz aus, werden Spielstände gepuffert und beim nächsten Mal nachgeschickt.

import { lsGet, lsSet } from './storage.js';

const TIMEOUT = 3000;
let pingCache = null;

async function call(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(path, body === undefined
      ? { cache: 'no-store', signal: ctrl.signal }
      : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Server antwortet mit ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/** Läuft die App über den Turnier-Server? Ergebnis: { ok, ips, port } oder null. Wird einmal je Start geprüft. */
export function liveServer() {
  if (!pingCache) {
    pingCache = (location.protocol === 'http:' ? call('/api/ping') : Promise.resolve(null))
      .then((r) => (r && r.server === 'madhouse-turnier' ? r : null))
      .catch(() => null);
  }
  return pingCache;
}

/** Adresse, die die iPhones öffnen sollen (für die Anzeige an der Turnierleitung). */
export function boardUrl(info) {
  const ip = info && info.ips && info.ips[0];
  return ip ? `http://${ip}:${info.port}/app/` : null;
}

/** Stand vom Server: { rev, tournament, matches }. Schickt vorher gepufferte Spielstände nach. */
export async function liveState() {
  await flushQueue();
  return call('/api/state');
}

/** Turnierplan an den Server (nur die Turnierleitung). */
export function postTournament(t) {
  return call('/api/tournament', t);
}

/** Spielstand eines Turnier-Matches an den Server; bei Fehler in den Puffer. */
export async function postMatch(m) {
  const q = lsGet('liveQueue', {}) || {};
  q[m.id] = m;
  lsSet('liveQueue', q);
  await flushQueue();
}

async function flushQueue() {
  const q = lsGet('liveQueue', {}) || {};
  for (const [id, m] of Object.entries(q)) {
    try {
      await call('/api/match', m);
      const now = lsGet('liveQueue', {}) || {};
      if (now[id] && (now[id].updatedAt || 0) <= (m.updatedAt || 0)) { delete now[id]; lsSet('liveQueue', now); }
    } catch { return; } // Server gerade nicht erreichbar: später nochmal
  }
}

/** Wie viele Spielstände warten noch auf den Server? */
export function pendingCount() {
  return Object.keys(lsGet('liveQueue', {}) || {}).length;
}

/** Welches Board zählt dieses Handy? (bleibt gespeichert) */
export function myBoard() {
  return lsGet('liveBoard', null);
}
export function setMyBoard(n) {
  lsSet('liveBoard', n);
}

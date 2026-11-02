// Live-Turnier: Verbindung zwischen Turnierleitung (PC) und Board-Handys. Zwei Wege, gleiche Bedienung:
//  - WLAN: Turnier-Server auf dem PC (werkzeuge/turnier-server.ps1). Die App wird vom PC geladen
//    (http://<PC>:8130/app/), die Schnittstellen liegen unter /api/ derselben Adresse. Kein Internet nötig.
//  - Online: Firebase (core/cloud.js), nur wenn eingerichtet. Beitreten per 8-stelligem Code – auch aus der
//    normalen App auf dem Home-Bildschirm.
// Die Turnierleitung schickt den Turnierplan, die Board-Handys nach jeder Aufnahme den Spielstand.
// Fällt das Netz kurz aus, werden Spielstände gepuffert und beim nächsten Mal nachgeschickt.

import { lsGet, lsSet } from './storage.js';
import { putTournament, putMatch, watch, showCode } from './cloud.js';

const TIMEOUT = 8000;
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

// ---------- Online-Code (Firebase) ----------

/** Code des Online-Turniers, an dem dieses Gerät teilnimmt (oder null). */
export const cloudCode = () => lsGet('liveCloud', null);
/** Online-Turnier betreten oder verlassen (null). */
export function setCloudCode(code) {
  lsSet('liveCloud', code || null);
  pingCache = null;
  stopWatch();
}

// Laufendes Mitlesen der Online-Daten (ein Datenstrom je Gerät)
let cloud = null; // { code, state, error, stop, ready: Promise }
function stopWatch() { if (cloud) { cloud.stop(); cloud = null; } }
function ensureWatch(code) {
  if (cloud && cloud.code === code) return cloud;
  stopWatch();
  let resolveReady;
  cloud = { code, state: null, error: null, stop: () => {}, ready: new Promise((r) => { resolveReady = r; }) };
  const c = cloud;
  c.stop = watch(code, (s) => { c.state = s; c.error = null; resolveReady(); }, (msg) => { c.error = msg; });
  return c;
}

// ---------- Gemeinsame Schnittstelle ----------

/**
 * Ist ein Live-Turnier erreichbar? Online: { cloud: true, code }. WLAN: { ok, ips, port } vom PC. Sonst null.
 * Der WLAN-Server wird einmal je Start geprüft (nur wenn die App über http vom PC kommt).
 */
export function liveServer() {
  const code = cloudCode();
  if (code) return Promise.resolve({ cloud: true, code });
  if (!pingCache) {
    pingCache = (location.protocol === 'http:' ? call('/api/ping') : Promise.resolve(null))
      .then((r) => (r && r.server === 'madhouse-turnier' ? r : null))
      .catch(() => null);
  }
  return pingCache;
}

/** Kurzer Text für die Anzeige: „WLAN“ oder „Online · K7P2-QX9M“. */
export const liveLabel = (info) => (info && info.cloud ? `🌐 Online · Code ${showCode(info.code)}` : '📶 WLAN');

/**
 * Adresse für den QR-Code eines Boards. WLAN: http://<PC>:8130/app/?board=2 (öffnet die App vom PC).
 * Online: dieselbe App-Adresse mit ?live=CODE&board=2 (für Mitspieler ohne installierte App).
 */
export function boardUrl(info, board) {
  if (!info) return null;
  if (info.cloud) return `${location.origin}${location.pathname}?live=${info.code}&board=${board}`;
  const ip = info.ips && info.ips[0];
  return ip ? `http://${ip}:${info.port}/app/?board=${board}` : null;
}
/** Grundadresse ohne Board (Anzeige „ohne QR“). */
export function baseUrl(info) {
  if (!info || info.cloud) return null;
  const ip = info.ips && info.ips[0];
  return ip ? `http://${ip}:${info.port}/app/` : null;
}

/** Stand: { tournament, matches }. Schickt vorher gepufferte Spielstände nach. */
export async function liveState() {
  await flushQueue();
  const code = cloudCode();
  if (code) {
    const c = ensureWatch(code);
    await Promise.race([c.ready, new Promise((_, rej) => setTimeout(() => rej(new Error(c.error || 'Online-Dienst antwortet nicht')), TIMEOUT))]);
    if (c.error && !c.state) throw new Error(c.error);
    return c.state;
  }
  return call('/api/state');
}

/** Turnierplan senden (nur die Turnierleitung); bei einem Netzfehler ein zweiter Versuch. */
export async function postTournament(t) {
  const send = () => (cloudCode() ? putTournament(cloudCode(), t) : call('/api/tournament', t));
  try { return await send(); } catch {
    await new Promise((r) => setTimeout(r, 800));
    try { return await send(); } catch (e) {
      throw new Error(cloudCode() ? `Online-Dienst nicht erreichbar: ${e.message}` : 'Der Turnier-Server antwortet nicht. Ist das Fenster „Turnier-Server“ auf dem PC noch offen?');
    }
  }
}

/** Spielstand eines Turnier-Matches senden; bei Fehler in den Puffer. */
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
      const code = cloudCode();
      if (code) await putMatch(code, m); else await call('/api/match', m);
      const now = lsGet('liveQueue', {}) || {};
      if (now[id] && (now[id].updatedAt || 0) <= (m.updatedAt || 0)) { delete now[id]; lsSet('liveQueue', now); }
    } catch { return; } // gerade nicht erreichbar: später nochmal
  }
}

/** Wie viele Spielstände warten noch auf Übertragung? */
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

// Live-Turnier: Verbindung zwischen Turnierleitung (PC) und Board-Handys. Zwei Wege, gleiche Bedienung:
//  - WLAN: Turnier-Server auf dem PC (werkzeuge/turnier-server.ps1). Die App wird vom PC geladen
//    (http://<PC>:8130/app/), die Schnittstellen liegen unter /api/ derselben Adresse. Kein Internet nötig.
//  - Online: Firebase (core/cloud.js), nur wenn eingerichtet. Beitreten per 8-stelligem Code – auch aus der
//    normalen App auf dem Home-Bildschirm.
// Die Turnierleitung schickt den Turnierplan, die Board-Handys nach jeder Aufnahme den Spielstand.
// Fällt das Netz kurz aus, werden Spielstände gepuffert und beim nächsten Mal nachgeschickt.

import { lsGet, lsSet } from './storage.js';
import { putTournament, putMatch, putPresence, watch, showCode, fetchState } from './cloud.js';

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
let endedCode = null; // Code eines Online-Turniers, das inzwischen beendet (gelöscht) wurde – für einen Hinweis

function lanPing() {
  return (location.protocol === 'http:' ? call('/api/ping') : Promise.resolve(null))
    .then((r) => (r && r.server === 'madhouse-turnier' ? r : null))
    .catch(() => null);
}

export function liveServer() {
  if (!pingCache) {
    const code = cloudCode();
    // Online: einmal prüfen, ob es das Turnier noch gibt. Wurde es am PC beendet, Code vergessen.
    // Ohne Netz bleibt der Code erhalten (das Turnier läuft vielleicht noch).
    pingCache = code
      ? fetchState(code).then((s) => {
        if (s.tournament) return { cloud: true, code };
        lsSet('liveCloud', null); lsSet('liveBoard', null); stopWatch(); endedCode = code;
        return lanPing();
      }).catch(() => ({ cloud: true, code }))
      : lanPing();
  }
  return pingCache;
}

/** Wurde ein Online-Turnier beendet, seit es zuletzt benutzt wurde? Liefert den Code einmal, dann null. */
export function takeEndedNotice() {
  const c = endedCode;
  endedCode = null;
  return c;
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

// ---------- Board-Handy meldet sich (Herzschlag) ----------
// Alle 5 Sekunden: „Board 2 ist da“. Die Turnierleitung sieht so, welche Boards ein Handy haben,
// und ruft (je nach Einstellung) nur dort Spiele auf. Läuft weiter, auch während des Spiels.
export const PRESENCE_MS = 5000;
export const PRESENCE_TIMEOUT = 30000; // so lange ohne Meldung gilt ein Handy als weg
let heartbeat = null;

/** Name dieses Geräts für die Anzeige an der Turnierleitung. */
export function deviceName() {
  return lsGet('liveDevice', null) || (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : 'Handy');
}

async function beat() {
  const board = myBoard();
  if (!board) return;
  const info = await liveServer();
  if (!info) return;
  // Online-Turnier schon beendet (gelöscht)? Dann nicht mehr melden – sonst entstünden dort neue Reste
  if (info.cloud && cloud && cloud.code === info.code && cloud.state && !cloud.state.tournament) return;
  const p = { board, device: deviceName(), at: Date.now(), active: (lsGet('activeMatch', null) || {}).id || null };
  try {
    if (info.cloud) await putPresence(info.code, p); else await call('/api/presence', p);
  } catch { /* nächster Versuch in 5 Sekunden */ }
}

/** Herzschlag starten (einmal je App-Start, läuft über alle Bildschirme). */
export function startHeartbeat() {
  if (heartbeat) return;
  beat();
  heartbeat = setInterval(beat, PRESENCE_MS);
}

/**
 * Anwesenheit nach der eigenen Uhr: Die Turnierleitung merkt sich, wann sie zuletzt eine NEUE Meldung eines
 * Boards gesehen hat. So stört es nicht, wenn die Uhren von PC und Handy auseinanderlaufen.
 * Beim ersten Blick gilt ein Board als „unbekannt“, bis sich seine Meldung ändert (alte Einträge zählen nicht).
 */
export function presenceTracker() {
  const seen = new Map(); // Board -> { at (Zeitstempel des Handys), localAt (eigene Uhr), device }
  return {
    update(presence, now = Date.now()) {
      for (const p of Object.values(presence || {})) {
        if (!p || !p.board) continue;
        const b = Number(p.board);
        const old = seen.get(b);
        if (!old) seen.set(b, { at: p.at, localAt: now - PRESENCE_TIMEOUT, device: p.device });
        else if (old.at !== p.at) seen.set(b, { at: p.at, localAt: now, device: p.device });
      }
    },
    connected(now = Date.now()) {
      return new Set([...seen].filter(([, v]) => now - v.localAt < PRESENCE_TIMEOUT).map(([b]) => b));
    },
  };
}

/** Boards, an denen gerade ein Handy angemeldet ist (Set der Nummern), nach den Zeitstempeln der Handys. */
export function connectedBoards(presence, now = Date.now()) {
  return new Set(Object.values(presence || {}).filter((p) => p && now - p.at < PRESENCE_TIMEOUT).map((p) => Number(p.board)));
}

/** Welches Board zählt dieses Handy? (bleibt gespeichert) */
export function myBoard() {
  return lsGet('liveBoard', null);
}
export function setMyBoard(n) {
  lsSet('liveBoard', n);
}

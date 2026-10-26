// Lokale Datenspeicherung (nur auf dem Gerät, kein Konto, keine Cloud).
//  - Kleine Daten (Einstellungen, Spieler, Kalibrierung, laufendes Match) -> localStorage
//  - Matches, Würfe und Korrekturbilder -> IndexedDB
// Export/Import aller Daten als JSON-Datei.

import { BRAND, APP_VERSION } from '../config.js';

const LS_PREFIX = 'madhouse.';
const DB_NAME = 'madhouse';
const DB_VERSION = 1;

// ---------- localStorage ----------
export function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
export function lsSet(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(LS_PREFIX + key);
    else localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', key, e);
    return false;
  }
}

// ---------- IndexedDB ----------
let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('matches')) db.createObjectStore('matches', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('throws')) {
        const s = db.createObjectStore('throws', { keyPath: 'id' });
        s.createIndex('matchId', 'matchId');
        s.createIndex('playerId', 'playerId');
      }
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(t);
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll(store) {
  const db = await openDb();
  return reqToPromise(db.transaction(store).objectStore(store).getAll());
}
export async function dbGet(store, key) {
  const db = await openDb();
  return reqToPromise(db.transaction(store).objectStore(store).get(key));
}
export function dbPut(store, value) {
  return tx(store, 'readwrite', (t) => { t.objectStore(store).put(value); });
}
export function dbDelete(store, key) {
  return tx(store, 'readwrite', (t) => { t.objectStore(store).delete(key); });
}
export function dbClear(store) {
  return tx(store, 'readwrite', (t) => { t.objectStore(store).clear(); });
}

/** Match und seine Wurfzeilen gemeinsam speichern (alte Zeilen des Matches werden ersetzt). */
export async function saveMatchWithThrows(match, rows) {
  const db = await openDb();
  const existing = await reqToPromise(db.transaction('throws').objectStore('throws').index('matchId').getAllKeys(match.id));
  return tx(['matches', 'throws'], 'readwrite', (t) => {
    t.objectStore('matches').put(match);
    const ts = t.objectStore('throws');
    const keep = new Set(rows.map((r) => r.id));
    for (const k of existing) if (!keep.has(k)) ts.delete(k);
    for (const r of rows) ts.put(r);
  });
}

export async function deleteMatch(matchId) {
  const db = await openDb();
  const keys = await reqToPromise(db.transaction('throws').objectStore('throws').index('matchId').getAllKeys(matchId));
  return tx(['matches', 'throws'], 'readwrite', (t) => {
    t.objectStore('matches').delete(matchId);
    for (const k of keys) t.objectStore('throws').delete(k);
  });
}

/** Browser bitten, die Daten nicht automatisch zu löschen (wird nicht überall gewährt). */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* egal */ }
  return false;
}

// ---------- Export / Import ----------
const LS_KEYS = ['settings', 'players', 'calibration', 'activeMatch'];

export async function exportAll({ includeImages = false } = {}) {
  const data = {
    app: BRAND.name,
    format: 'madhouse-backup',
    version: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    local: {},
    matches: await dbGetAll('matches'),
    throws: await dbGetAll('throws'),
    images: includeImages ? await dbGetAll('images') : [],
  };
  for (const k of LS_KEYS) data.local[k] = lsGet(k, null);
  return data;
}

export async function importAll(data, { replace = true } = {}) {
  if (!data || data.format !== 'madhouse-backup') throw new Error('Das ist keine Madhouse-Sicherungsdatei.');
  if (replace) {
    await dbClear('matches');
    await dbClear('throws');
  }
  for (const k of LS_KEYS) if (k in (data.local || {})) lsSet(k, data.local[k]);
  await tx(['matches', 'throws', 'images'], 'readwrite', (t) => {
    for (const m of data.matches || []) t.objectStore('matches').put(m);
    for (const r of data.throws || []) t.objectStore('throws').put(r);
    for (const i of data.images || []) t.objectStore('images').put(i);
  });
}

export async function wipeAll() {
  for (const k of LS_KEYS) lsSet(k, null);
  await dbClear('matches');
  await dbClear('throws');
  await dbClear('images');
}

/** Datei an den Nutzer geben: Teilen-Menü (iOS) oder Download. */
export async function offerFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'aborted';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

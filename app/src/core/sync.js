// Abgleich zwischen zwei Handys ohne Server: Ein Handy schickt eine Abgleich-Datei
// (AirDrop, WhatsApp, Mail), das andere liest sie ein. Dabei wird ZUSAMMENGEFÜHRT, nicht ersetzt:
//  - Spieler werden über ihre Nummer (#12345) erkannt; beim allerersten Abgleich über den Namen,
//    danach haben beide Handys dieselbe Nummer. So sind auch gleiche Namen kein Problem.
//  - Matches über ihre Kennung: neue kommen dazu, vorhandene werden nur durch eine neuere Fassung ersetzt.
//  - Wurfzeilen werden aus dem Match neu berechnet, damit alles zur eigenen Spielerliste passt.
// Danach hat jedes Handy alle Spiele beider Handys. Schicken sich beide gegenseitig die Datei,
// sind beide auf demselben Stand.

import { BRAND, APP_VERSION } from '../config.js';
import { dbGetAll, saveMatchWithThrows, lsGet, lsSet } from './storage.js';
import { getPlayers, savePlayers, newPlayerCode } from './settings.js';
import { throwRows } from '../game/match.js';

export const SYNC_FORMAT = 'madhouse-sync';

/** Abgleich-Daten dieses Handys: Spieler, beendete und abgebrochene Matches, Vitrine. */
export async function exportSync() {
  const matches = (await dbGetAll('matches')).filter((m) => m.status !== 'running');
  return {
    app: BRAND.name, format: SYNC_FORMAT, version: 1, appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    players: getPlayers(),
    matches,
    showcase: lsGet('showcase', {}),
    tournaments: lsGet('tournaments', []) || [],
  };
}

const key = (name) => String(name || '').trim().toLowerCase();

/**
 * Zusammenführen planen (ohne zu speichern, damit es testbar ist).
 * localPlayers/localMatches: Stand dieses Handys; data: Abgleich-Datei.
 * Ergebnis: { players (neue Gesamtliste), save: [Matches zum Speichern], added, updated, unchanged,
 *   newPlayers: [Namen], mapId(id, name) }
 */
export function planMerge(localPlayers, localMatches, data) {
  const players = localPlayers.map((p) => ({ ...p }));
  const incoming = data.players || [];
  const incomingCodes = new Set(incoming.map((p) => p.code).filter(Boolean));
  const sameName = (name) => players.filter((x) => key(x.name) === key(name));
  const idMap = new Map();
  const taken = new Set(); // lokale Spieler, die schon einem eingehenden zugeordnet sind
  const newPlayers = [];
  for (const p of incoming) {
    // 1. Über die Spielernummer – sicher, auch bei gleichen Namen
    let mine = p.code ? players.find((x) => x.code === p.code) : null;
    // 2. Sonst über den Namen, aber nur wenn er eindeutig ist und die lokale Nummer nicht einem
    //    anderen eingehenden Spieler gehört. Beide Handys einigen sich dann auf die kleinere Nummer.
    if (!mine) {
      const cands = sameName(p.name).filter((x) => !taken.has(x.id) && !(x.code && incomingCodes.has(x.code)));
      if (cands.length === 1) {
        mine = cands[0];
        if (p.code && (!mine.code || p.code < mine.code)) mine.code = p.code;
      }
    }
    if (mine) {
      // Kampfname: der zuletzt geänderte gewinnt (auch ein gelöschter)
      if (p.nickAt && p.nickAt > (mine.nickAt || 0)) { mine.nick = String(p.nick || '').slice(0, 24); mine.nickAt = p.nickAt; }
      idMap.set(p.id, mine.id); taken.add(mine.id); continue;
    }
    // 3. Unbekannt: neu anlegen (Nummer übernehmen, wenn sie hier frei ist)
    const id = players.some((x) => x.id === p.id) ? `${p.id}_${Date.now().toString(36)}` : p.id;
    const code = p.code && !players.some((x) => x.code === p.code) ? p.code : newPlayerCode(players);
    const np = { id, code, name: String(p.name).slice(0, 24), createdAt: p.createdAt || Date.now() };
    if (p.nickAt) { np.nick = String(p.nick || '').slice(0, 24); np.nickAt = p.nickAt; }
    players.push(np);
    taken.add(id);
    idMap.set(p.id, id);
    newPlayers.push(np.name);
  }
  // Spieler, die nur in Matches vorkommen (z. B. gelöscht), über den Namen zuordnen – nur wenn eindeutig
  const mapId = (id, name) => {
    if (String(id).startsWith('bot:') || String(id).startsWith('guest:')) return id; // Computer und Gäste behalten ihre Kennung
    if (idMap.has(id)) return idMap.get(id);
    const cands = name ? sameName(name) : [];
    return cands.length === 1 ? cands[0].id : id;
  };
  const existing = new Map(localMatches.map((m) => [m.id, m]));
  const save = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const raw of data.matches || []) {
    if (raw.status === 'running') continue;
    const m = { ...raw, players: raw.players.map((id, i) => mapId(id, raw.playerNames[i])) };
    if (raw.tournament) m.tournament = { ...raw.tournament, players: (raw.tournament.players || []).map((id) => mapId(id, null)) };
    const old = existing.get(m.id);
    if (old && (old.updatedAt || 0) >= (m.updatedAt || 0)) { unchanged++; continue; }
    save.push(m);
    if (old) updated++; else added++;
  }
  return { players, save, added, updated, unchanged, newPlayers, mapId };
}

/**
 * Abgleich-Datei einlesen und zusammenführen.
 * Rückgabe: { added, updated, unchanged, newPlayers: [Namen] }
 */
export async function importSync(data) {
  if (data && data.format === 'madhouse-backup') data = { ...data, format: SYNC_FORMAT, players: (data.local || {}).players || [], showcase: {} };
  if (!data || data.format !== SYNC_FORMAT) throw new Error('Das ist keine Madhouse-Abgleich-Datei.');
  const plan = planMerge(getPlayers(), await dbGetAll('matches'), data);
  savePlayers(plan.players);
  let skipped = 0;
  for (const m of plan.save) {
    let rows;
    try { rows = throwRows(m); } catch { skipped++; continue; } // unbekannter Spielmodus (andere App-Version)
    await saveMatchWithThrows(m, rows);
  }
  // Vitrine: fehlende Einträge übernehmen (eigene Auswahl bleibt)
  const show = lsGet('showcase', {}) || {};
  for (const [pid, list] of Object.entries(data.showcase || {})) {
    const id = plan.mapId(pid, null);
    if (!show[id] || !show[id].length) show[id] = list;
  }
  lsSet('showcase', show);
  // Turniere: fehlende Turnierpläne übernehmen (Spieler-Kennungen wie bei den Matches umschreiben).
  // Die Ergebnisse stecken in den Matches und kommen damit von selbst mit.
  const tours = lsGet('tournaments', []) || [];
  for (const t of data.tournaments || []) {
    if (tours.some((x) => x.id === t.id)) continue;
    const map = (id) => (id ? plan.mapId(id, t.playerNames[id]) : id);
    tours.push({
      ...t,
      players: t.players.map(map),
      playerNames: Object.fromEntries(Object.entries(t.playerNames).map(([id, n]) => [map(id), n])),
      games: t.games.map((g) => ({ ...g, a: map(g.a), b: map(g.b) })),
    });
  }
  lsSet('tournaments', tours);
  return { added: plan.added - skipped, updated: plan.updated, unchanged: plan.unchanged, newPlayers: plan.newPlayers };
}

/** Dateiname für die Abgleich-Datei. */
export function syncFileName() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${BRAND.name.toLowerCase()}-abgleich-${stamp}.json`;
}

/**
 * Nur die Spiele bestimmter Spieler: behält Matches, an denen mindestens einer von ids beteiligt war,
 * dazu die Spieler, die darin vorkommen (damit Gegner zugeordnet werden), Vitrine und Turniere dieser Spieler.
 */
export function filterSyncData(data, ids) {
  const keep = new Set(ids);
  const matches = (data.matches || []).filter((m) => m.players.some((p) => keep.has(p)));
  const used = new Set(matches.flatMap((m) => m.players));
  return {
    ...data,
    matches,
    players: (data.players || []).filter((p) => used.has(p.id) || keep.has(p.id)),
    showcase: Object.fromEntries(Object.entries(data.showcase || {}).filter(([k]) => keep.has(k))),
    tournaments: (data.tournaments || []).filter((t) => (t.players || []).some((p) => keep.has(p))),
  };
}

/** Spieler einer Abgleich-Datei mit Zahl ihrer Spiele (ohne Gäste und Computer): [{ id, name, count }]. */
export function syncPlayers(data) {
  const names = new Map((data.players || []).map((p) => [p.id, p.name]));
  for (const m of data.matches || []) m.players.forEach((id, i) => { if (!names.has(id)) names.set(id, m.playerNames[i]); });
  return [...names].filter(([id]) => !String(id).startsWith('guest:') && !String(id).startsWith('bot:'))
    .map(([id, name]) => ({ id, name, count: (data.matches || []).filter((m) => m.players.includes(id)).length }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);
}

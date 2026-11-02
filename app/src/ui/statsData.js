// Gemeinsame Grundlage für Statistik, Rekorde und Meilensteine: Daten laden, Spielerauswahl, kleine Bausteine.
// Gezählt werden beendete Matches gegen echte Spieler und Trainings. Spiele gegen den Computer zählen nicht,
// Gäste bekommen keine eigene Statistik (ihre Mitspieler schon).
import { h } from './dom.js';
import { dbGetAll } from '../core/storage.js';
import { getPlayers, displayName, ownerId, isGuestId } from '../core/settings.js';
import { isBotId } from '../game/bot.js';

/** { rows, matches, finished, realMatches, usable, names, ids, vsBot } */
export async function loadStatsData() {
  const [rows, matches] = await Promise.all([dbGetAll('throws'), dbGetAll('matches')]);
  const finished = matches.filter((m) => m.status === 'finished');
  const vsBot = (m) => m.players.some(isBotId);
  const realMatches = finished.filter((m) => !vsBot(m));
  const realIds = new Set(realMatches.map((m) => m.id));
  const usable = rows.filter((r) => realIds.has(r.matchId) && !isGuestId(r.playerId));
  const known = getPlayers();
  const names = new Map();
  for (const m of matches) m.players.forEach((id, i) => names.set(id, m.playerNames[i]));
  for (const p of known) names.set(p.id, displayName(p, known));
  const ids = [...new Set([...known.map((p) => p.id), ...usable.map((r) => r.playerId)])].filter((id) => !isBotId(id) && !isGuestId(id));
  return { rows, matches, finished, realMatches, usable, names, ids, vsBot };
}

/** Ausgewählter Spieler: Vorgabe, sonst der Besitzer des Handys, sonst der erste. */
export function pickDefault(ids, wanted) {
  if (wanted && ids.includes(wanted)) return wanted;
  return ids.includes(ownerId()) ? ownerId() : ids[0] || null;
}

/** Auswahlliste der Spieler. */
export function playerPicker(ids, names, selected, onPick) {
  return h('label', { class: 'field' }, h('span', {}, 'Spieler'),
    h('select', { onchange: (e) => onPick(e.target.value) },
      ids.map((id) => h('option', { value: id, selected: id === selected }, names.get(id) || '?'))));
}

export const date = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
export const sec = (text, right = null) => h('div', { class: 'sechead' }, h('span', {}, text), right);
export const kpi = (v, k, cls = '') => h('div', { class: `kpi ${cls}` }, h('b', { class: 'num' }, v), h('span', {}, k));
export const topbar = (title, nav) => h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, title));

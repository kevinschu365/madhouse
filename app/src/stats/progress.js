// Fortschritt rund um Meilensteine: Wochenaufgaben, Saison-Rang, Wochen-Serie, Rivalen,
// Abend-Krone, „Fast geschafft“, Abzeichen-Vitrine und Rückblicke.
// Alles wird aus den gespeicherten Spielen berechnet (auch rückwirkend) – nichts Neues zu speichern
// außer der Vitrine (welche Abzeichen jemand zeigen will).

import { collect, weekStart, milestones, pointsOfList, playerStats, MILESTONES, playDayStart, playDayNo } from './stats.js';
import { lsGet, lsSet } from '../core/storage.js';

const DAY = 86400000;

// ---------- Wochenaufgaben ----------

// Drei Töpfe; jede Woche kommt aus jedem Topf eine Aufgabe (für alle Spieler dieselben).
const n = (v) => v || 0;
const CHALLENGE_POOLS = [
  [ // Scoring
    { id: 'ton5', icon: '💯', text: '5× 100+ werfen', get: (s) => s.ton, goal: 5 },
    { id: 'ton10', icon: '💯', text: '10× 100+ werfen', get: (s) => s.ton, goal: 10 },
    { id: 't40x2', icon: '🔥', text: '2× 140+ werfen', get: (s) => s.t40, goal: 2 },
    { id: 's60x10', icon: '🎯', text: '10× genau 60', get: (s) => n(s.exact[60]), goal: 10 },
    { id: 's26x3', icon: '🛏️', text: '3× Bed & Breakfast (26)', get: (s) => n(s.exact[26]), goal: 3 },
    { id: 's45x3', icon: '🥜', text: "3× Bag o' Nuts (45)", get: (s) => n(s.exact[45]), goal: 3 },
    { id: 's85x2', icon: '🔸', text: '2× genau 85', get: (s) => n(s.exact[85]), goal: 2 },
    { id: 's180', icon: '🚀', text: 'Eine 180 werfen', get: (s) => n(s.exact[180]), goal: 1 },
  ],
  [ // Finish
    { id: 'co5', icon: '✅', text: '5 Checkouts', get: (s) => s.checkouts, goal: 5 },
    { id: 'co80', icon: '🏁', text: 'Ein Finish 80+', get: (s) => (s.bestCheckout >= 80 ? 1 : 0), goal: 1 },
    { id: 'co100', icon: '💯', text: 'Ein Ton-Finish (100+)', get: (s) => (s.bestCheckout >= 100 ? 1 : 0), goal: 1 },
    { id: 'd16', icon: '🎯', text: 'Auf D16 auschecken', get: (s) => (s.doubles.has('D16') ? 1 : 0), goal: 1 },
    { id: 'd20', icon: '🔝', text: 'Auf Tops (D20) auschecken', get: (s) => (s.doubles.has('D20') ? 1 : 0), goal: 1 },
    { id: 'd8', icon: '🎯', text: 'Auf D8 auschecken', get: (s) => (s.doubles.has('D8') ? 1 : 0), goal: 1 },
    { id: 'dbl3', icon: '🎨', text: 'Auf 3 verschiedenen Doppeln auschecken', get: (s) => s.doubles.size, goal: 3 },
    { id: 'leg24', icon: '⚡', text: 'Ein Leg in 24 Darts oder weniger', get: (s) => (s.bestLeg <= 24 ? 1 : 0), goal: 1 },
  ],
  [ // Spiele
    { id: 'win3', icon: '🥇', text: '3 Matches gewinnen', get: (s) => s.wins, goal: 3 },
    { id: 'play5', icon: '🎟️', text: '5 Matches spielen', get: (s) => s.played, goal: 5 },
    { id: 'legs5', icon: '🏳️', text: '5 Legs gewinnen', get: (s) => s.legsWon, goal: 5 },
    { id: 'avg50', icon: '📈', text: 'Ein Match mit Average 50+', get: (s) => (s.bestAvg >= 50 ? 1 : 0), goal: 1 },
    { id: 'train2', icon: '🏋️', text: '2 Trainings beenden', get: (s) => s.trainings, goal: 2 },
    { id: 'days2', icon: '📅', text: 'An 2 Tagen spielen', get: (s) => s.days.size, goal: 2 },
  ],
];

/** Kleiner Zufallsgenerator mit festem Startwert (gleiche Woche = gleiche Aufgaben auf jedem Handy). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Die drei Aufgaben der Woche, in der ts liegt. */
export function weeklyChallenges(ts = Date.now()) {
  const wk = Math.round(weekStart(ts) / (7 * DAY));
  const r = rng(wk * 7919 + 13);
  return CHALLENGE_POOLS.map((pool) => pool[Math.floor(r() * pool.length)]);
}

/** Matches einer Woche (Montag bis Sonntag). */
const inRange = (matches, from, to) => matches.filter((m) => m.createdAt >= from && m.createdAt < to);

/**
 * Stand der Wochenaufgaben eines Spielers: { start, end, items: [{ ...Aufgabe, cur, done }], done (Anzahl), medal }.
 */
export function weekStatus(rows, matches, playerId, ts = Date.now()) {
  const start = weekStart(ts);
  const end = start + 7 * DAY;
  const s = collect(rows, inRange(matches, start, end), playerId);
  const items = weeklyChallenges(ts).map((c) => { const cur = Math.min(c.get(s), c.goal); return { ...c, cur, done: cur >= c.goal }; });
  const done = items.filter((i) => i.done).length;
  return { start, end, items, done, medal: done === items.length };
}

/** Alle Wochen, in denen der Spieler gespielt hat: [{ start, done, medal }], älteste zuerst. */
export function weekHistory(rows, matches, playerId) {
  const mine = matches.filter((m) => m.players.includes(playerId));
  const weeks = [...new Set(mine.map((m) => weekStart(m.createdAt)))].sort((a, b) => a - b);
  return weeks.map((w) => { const st = weekStatus(rows, matches, playerId, w); return { start: w, done: st.done, medal: st.medal }; });
}

// ---------- Saison (Quartal) ----------

const SEASON_NAMES = ['Winter', 'Frühling', 'Sommer', 'Herbst'];
/** Saison zum Zeitpunkt: { id: '2026-4', name: 'Herbst 2026', start, end }. */
export function seasonOf(ts = Date.now()) {
  const d = new Date(ts);
  const q = Math.floor(d.getMonth() / 3);
  const start = new Date(d.getFullYear(), q * 3, 1).getTime();
  const end = new Date(d.getFullYear(), q * 3 + 3, 1).getTime();
  return { id: `${d.getFullYear()}-${q + 1}`, name: `${SEASON_NAMES[q]} ${d.getFullYear()}`, start, end };
}

/** Saison-Ränge nach Saison-Punkten. */
export const SEASON_RANKS = [
  { min: 0, icon: '🪵', title: 'Holz', color: '#8d6e52' },
  { min: 40, icon: '🥉', title: 'Bronze', color: '#cd7f32' },
  { min: 100, icon: '🥈', title: 'Silber', color: '#c0c7d0' },
  { min: 200, icon: '🥇', title: 'Gold', color: '#f5c542' },
  { min: 330, icon: '💠', title: 'Platin', color: '#7fd6e0' },
  { min: 500, icon: '💎', title: 'Diamant', color: '#6fa8ff' },
  { min: 750, icon: '👑', title: 'Champion', color: '#ff7ad9' },
];
export const SEASON_POINTS_NOTE = 'Saison-Punkte: 5 je neuer Meilenstein + 10 je Wochenaufgabe + 25 je Wochen-Medaille + 3 je Sieg + 1 je gewonnenes Leg + 2 je Match.';

/**
 * Saison-Wertung eines Spielers: { season, points, rank, next, index, parts }.
 * ms = Ergebnis von milestones() (für die Meilenstein-Punkte der Saison).
 */
export function seasonStatus(rows, matches, playerId, ms, ts = Date.now()) {
  const season = seasonOf(ts);
  const msPts = ms.filter((m) => m.at && m.at >= season.start && m.at < season.end).length * 5;
  const s = collect(rows, inRange(matches, season.start, season.end), playerId);
  let tasks = 0;
  let medals = 0;
  for (let w = weekStart(season.start); w < season.end; w += 7 * DAY) {
    if (w > ts) break;
    const st = weekStatus(rows, matches, playerId, w + DAY); // +1 Tag: sicher innerhalb der Woche
    tasks += st.done;
    if (st.medal) medals++;
  }
  const points = msPts + tasks * 10 + medals * 25 + s.wins * 3 + s.legsWon + s.played * 2;
  let index = 0;
  while (index + 1 < SEASON_RANKS.length && points >= SEASON_RANKS[index + 1].min) index++;
  return { season, points, index, rank: SEASON_RANKS[index], next: SEASON_RANKS[index + 1] || null, parts: { msPts, tasks, medals, wins: s.wins, legs: s.legsWon, played: s.played } };
}

/** Abgeschlossene Saisons mit Abzeichen: [{ season, rank, points }], neueste zuerst. */
export function pastSeasons(rows, matches, playerId, ms) {
  const mine = matches.filter((m) => m.players.includes(playerId));
  const cur = seasonOf().id;
  const seen = new Map();
  for (const m of mine) { const s = seasonOf(m.createdAt); if (s.id !== cur) seen.set(s.id, s); }
  return [...seen.values()].sort((a, b) => b.start - a.start)
    .map((season) => { const st = seasonStatus(rows, matches, playerId, ms, season.end - 1); return { season, rank: st.rank, points: st.points }; });
}

// ---------- Wochen-Serie ----------

/**
 * Wochen in Folge mit mindestens einem Spiel: { current, best, playedThisWeek }.
 * Die Serie hält, solange man spätestens diese Woche wieder spielt (letzte Woche gespielt reicht noch).
 */
export function weekStreak(matches, playerId, now = Date.now()) {
  const weeks = new Set(matches.filter((m) => m.status === 'finished' && m.players.includes(playerId)).map((m) => Math.round(weekStart(m.createdAt) / (7 * DAY))));
  const cur = Math.round(weekStart(now) / (7 * DAY));
  let start = weeks.has(cur) ? cur : weeks.has(cur - 1) ? cur - 1 : null;
  let current = 0;
  while (start != null && weeks.has(start - current)) current++;
  let best = 0;
  for (const w of weeks) { if (weeks.has(w - 1)) continue; let k = 0; while (weeks.has(w + k)) k++; best = Math.max(best, k); }
  return { current, best, playedThisWeek: weeks.has(cur) };
}

// ---------- Rivalen ----------

/**
 * Bilanz gegen jeden Gegner (nur Spiele zu zweit): [{ id, name, wins, losses, streak, last }].
 * streak > 0: so viele Siege in Folge gegen ihn, < 0: so viele Niederlagen in Folge.
 */
export function rivalries(matches, playerId) {
  const map = new Map();
  const list = matches.filter((m) => m.status === 'finished' && m.players.length === 2 && m.players.includes(playerId) && m.winner != null)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const m of list) {
    const me = m.players.indexOf(playerId);
    const op = 1 - me;
    const id = m.players[op];
    const r = map.get(id) || map.set(id, { id, name: m.playerNames[op], wins: 0, losses: 0, streak: 0, last: 0 }).get(id);
    r.name = m.playerNames[op];
    r.last = m.createdAt;
    if (m.winner === me) { r.wins++; r.streak = r.streak > 0 ? r.streak + 1 : 1; } else { r.losses++; r.streak = r.streak < 0 ? r.streak - 1 : -1; }
  }
  return [...map.values()].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));
}

// ---------- Tages-Serie ----------

/**
 * Spieltage in Folge (ab 5 Uhr früh): Matches, Trainings und Spiele gegen den Computer zählen.
 * matches: alle beendeten Spiele (auch gegen den Computer). Ergebnis: { current, best, playedToday }.
 * Die Serie hält bis zum Ende des nächsten Spieltags („heute noch spielen, sonst reißt sie“).
 */
export function dayStreak(matches, playerId, now = Date.now()) {
  const days = new Set(matches.filter((m) => m.status === 'finished' && m.players.includes(playerId)).map((m) => playDayNo(m.createdAt)));
  const today = playDayNo(now);
  const start = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  let current = 0;
  while (start != null && days.has(start - current)) current++;
  let best = 0;
  for (const d of days) { if (days.has(d - 1)) continue; let k = 0; while (days.has(d + k)) k++; best = Math.max(best, k); }
  return { current, best, playedToday: days.has(today) };
}

// ---------- Abend-Krone ----------

export { playDayStart };

/**
 * Wer trägt die Krone? Bester X01-Average (ab 9 Darts) am letzten Spieltag mit X01-Matches
 * gegen echte Spieler. Sie bleibt bis zum nächsten Spieltag. null = noch niemand.
 * Ergebnis: { playerId, name, average, day }
 */
export function crownHolder(rows, matches) {
  const x01 = matches.filter((m) => m.status === 'finished' && m.mode === 'x01' && m.players.length > 1);
  if (!x01.length) return null;
  const day = Math.max(...x01.map((m) => playDayStart(m.createdAt)));
  const today = x01.filter((m) => playDayStart(m.createdAt) === day);
  const ids = new Set(today.map((m) => m.id));
  const names = new Map();
  for (const m of today) m.players.forEach((id, i) => names.set(id, m.playerNames[i]));
  let best = null;
  for (const [id, name] of names) {
    const st = playerStats(rows.filter((r) => r.playerId === id && ids.has(r.matchId)));
    if (st.darts >= 9 && (!best || st.average > best.average)) best = { playerId: id, name, average: st.average, day };
  }
  return best;
}

// ---------- „Fast geschafft“ ----------

/** Die nächsten erreichbaren Meilensteine (am weitesten fortgeschritten zuerst, ab 50 %). */
export function nearGoals(ms, count = 2) {
  return ms.filter((m) => !m.at && !m.secret && m.progress && m.progress[1] > 1 && m.progress[0] / m.progress[1] >= 0.5)
    .map((m) => ({ ...m, left: m.progress[1] - m.progress[0], ratio: m.progress[0] / m.progress[1] }))
    .sort((a, b) => b.ratio - a.ratio || a.left - b.left)
    .slice(0, count);
}

/** Kurzer Text: „Noch 3× 60 bis ‚50× 60‘“. */
export function goalText(g) {
  return `Noch ${g.left.toLocaleString('de-DE')} bis „${g.title}“`;
}

// ---------- Abzeichen-Vitrine ----------

/** Bis zu drei Lieblings-Meilensteine je Spieler (Kennungen). */
export function getShowcase(playerId) {
  return (lsGet('showcase', {}) || {})[playerId] || [];
}
/** Meilenstein in die Vitrine legen oder herausnehmen. Rückgabe: neue Liste. */
export function toggleShowcase(playerId, msId) {
  const all = lsGet('showcase', {}) || {};
  let list = all[playerId] || [];
  list = list.includes(msId) ? list.filter((x) => x !== msId) : [...list, msId].slice(-3);
  all[playerId] = list;
  lsSet('showcase', all);
  return list;
}
/** Icons der Vitrine eines Spielers („🚀🐟🛏️“), leer wenn nichts gewählt. */
export function showcaseIcons(playerId) {
  return getShowcase(playerId).map((id) => (MILESTONES.find((m) => m.id === id) || {}).icon || '').join('');
}

// ---------- Rückblicke ----------

/**
 * Zusammenfassung eines Zeitraums je Spieler: [{ playerId, name, matches, wins, darts, average, bestCheckout,
 * c180, s26, tons, newMilestones: [...], points }], bester Average zuerst.
 * prev (optional): gleicher Zeitraum davor, für den Vergleich des Averages (avgDelta).
 */
export function recap(rows, matches, from, to, prev = null) {
  const inside = matches.filter((m) => m.status === 'finished' && m.createdAt >= from && m.createdAt < to);
  const names = new Map();
  for (const m of inside) m.players.forEach((id, i) => names.set(id, m.playerNames[i]));
  const out = [];
  for (const [id, name] of names) {
    const s = collect(rows, inside, id);
    const ms = milestones(rows, matches.filter((m) => m.createdAt < to), id).filter((m) => m.at && m.at >= from && m.at < to);
    const average = s.x01Darts ? (s.x01Points / s.x01Darts) * 3 : null;
    let avgDelta = null;
    if (prev && average != null) {
      const p = collect(rows, matches.filter((m) => m.status === 'finished' && m.createdAt >= prev[0] && m.createdAt < prev[1]), id);
      if (p.x01Darts) avgDelta = average - (p.x01Points / p.x01Darts) * 3;
    }
    out.push({
      playerId: id, name,
      matches: inside.filter((m) => m.players.includes(id) && m.players.length > 1).length,
      trainings: s.trainings, wins: s.wins, darts: s.darts, average, avgDelta,
      bestCheckout: s.bestCheckout, c180: s.exact[180] || 0, s26: s.exact[26] || 0, tons: s.ton,
      newMilestones: ms, points: pointsOfList(ms),
    });
  }
  return out.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
}

/** Grenzen eines Monats: [Beginn, Ende) für Jahr/Monat (Monat 0–11). */
export function monthRange(year, month) {
  return [new Date(year, month, 1).getTime(), new Date(year, month + 1, 1).getTime()];
}

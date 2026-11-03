// Turniere: K.-o. (4–32 Spieler), Jeder gegen Jeden (3–8) und Gruppen + K.-o. (8–32).
// Gespeichert wird nur der Plan (Spieler, Auslosung, Format, Boards, Aufrufe) in localStorage bzw. beim
// Live-Turnier auf dem PC (werkzeuge/turnier-server.ps1). Ergebnisse werden immer aus den Matches berechnet
// (match.tournament = { id, game, … }). So stimmen Turnier und Statistik immer überein, Rückgängig wirkt sofort,
// und Spiele von anderen Handys kommen über den Abgleich oder den Turnier-Server ins Turnier.

import { lsGet, lsSet } from './storage.js';
import { derive, newId, winsNeeded } from '../game/match.js';

export const TOURNAMENT_FORMATS = { ko: 'K.-o.', rr: 'Jeder gegen Jeden', gko: 'Gruppen + K.-o.' };
export const LIMITS = { ko: [4, 32], rr: [3, 8], gko: [8, 32] };
export const MAX_PLAYERS = 32;
const GROUP_NAMES = 'ABCDEFGHIJKL';
export const groupName = (i) => `Gruppe ${GROUP_NAMES[i]}`;

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Speichern ----------

export function getTournaments() {
  return lsGet('tournaments', []) || [];
}
export function getTournament(id) {
  return getTournaments().find((t) => t.id === id) || null;
}
export function saveTournament(t) {
  const list = getTournaments().filter((x) => x.id !== t.id);
  list.unshift(t);
  lsSet('tournaments', list);
}
/** Nur der Turnier-Plan wird entfernt; die gespielten Matches bleiben in der Statistik. */
export function deleteTournament(id) {
  lsSet('tournaments', getTournaments().filter((t) => t.id !== id));
}

// ---------- Anlegen (Auslosung) ----------

/** Rundenname im K.-o.: vom Ende her gezählt. */
export function koRoundName(round, rounds) {
  const fromEnd = rounds - round;
  return ['Finale', 'Halbfinale', 'Viertelfinale', 'Achtelfinale', 'Sechzehntelfinale'][fromEnd] || `Runde ${round}`;
}

/** Plätze im K.-o.-Baum nach Setzliste: 1 trifft auf den letzten, 2 auf den vorletzten … (1-basiert). */
export function bracketOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Spielplan Jeder gegen Jeden (Rundenverfahren): [{ round, a, b }]. */
function roundRobin(ids) {
  const list = ids.length % 2 ? [...ids, null] : ids.slice();
  const m = list.length;
  const out = [];
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) {
      const a = list[i];
      const b = list[m - 1 - i];
      if (a && b) out.push({ round: r + 1, a: r % 2 ? b : a, b: r % 2 ? a : b });
    }
    list.splice(1, 0, list.pop());
  }
  return out;
}

/** Anzahl Gruppen für n Spieler bei gewünschter Gruppengröße (mindestens 2). */
/**
 * Anzahl Gruppen für n Spieler bei gewünschter Gruppengröße: immer 2, 4 oder 8. Weil Platz 1 und 2 weiterkommen,
 * sind dann genau 4, 8 oder 16 Spieler im K.-o. – ohne Freilose. Jede Gruppe hat mindestens 3 Spieler.
 */
export function groupCount(n, groupSize = 5) {
  let g = 2 ** Math.round(Math.log2(Math.max(1, n / groupSize)));
  g = Math.max(2, Math.min(8, g));
  while (g > 2 && n / g < 3) g /= 2;
  return g;
}

/** Grobe Dauer eines Spiels in Minuten (nur für Vorschläge vor dem Turnier; während des Turniers zählt die echte Dauer). */
export const MINUTES_PER_GAME = { 1: 6, 3: 15, 5: 24, 7: 33, 9: 42 };
const SET_FACTOR = { 1: 1, 3: 2.5, 5: 4 }; // so viele Sätze werden im Schnitt gespielt
export const gameMinutes = (legs, sets = 1) => Math.round((MINUTES_PER_GAME[legs] || 15) * (SET_FACTOR[sets] || 1));

/**
 * Format je Runde: t.rules = { group, ko, semi, final, finalSets } (Legs „Best of“, Sätze nur im Finale).
 * Fehlende Werte erben: Halbfinale ← K.-o., Finale ← Halbfinale, alles ← t.legsBestOf.
 */
export function resolvedRules(rules, legsBestOf = 3) {
  const r = rules || {};
  const ko = r.ko || legsBestOf;
  const semi = r.semi || ko;
  return { group: r.group || legsBestOf, ko, semi, final: r.final || semi, finalSets: r.finalSets || 1 };
}

/** Legs und Sätze für ein Spiel: Gruppe, K.-o.-Runde, Halbfinale (auch Spiel um Platz 3) oder Finale. */
export function formatFor(t, g) {
  const R = resolvedRules(t.rules, t.legsBestOf);
  if (!g || g.phase !== 'ko' || !t.ko) return { legsBestOf: R.group, setsBestOf: 1, kind: 'group' };
  const rounds = t.ko.rounds;
  if (!g.third && g.round === rounds) return { legsBestOf: R.final, setsBestOf: R.finalSets, kind: 'final' };
  if (g.third || g.round === rounds - 1) return { legsBestOf: R.semi, setsBestOf: 1, kind: 'semi' };
  return { legsBestOf: R.ko, setsBestOf: 1, kind: 'ko' };
}

/** Kurztext für das Format: „Best of 5“ bzw. „Best of 3 Sätze (je Best of 5)“. */
export function formatText(f) {
  return f.setsBestOf > 1 ? `Best of ${f.setsBestOf} Sätze (je Best of ${f.legsBestOf})` : f.legsBestOf === 1 ? '1 Leg' : `Best of ${f.legsBestOf}`;
}

/** Format eines Turniers in einer Zeile: „Best of 3“ oder „Gruppe 1 Leg · K.-o. Best of 3 · Finale Best of 3 Sätze (je Best of 5)“. */
export function rulesText(t) {
  const R = resolvedRules(t.rules, t.legsBestOf);
  const bo = (v) => (v === 1 ? '1 Leg' : `Best of ${v}`);
  const parts = [];
  if (t.format !== 'ko') parts.push(['Gruppe', bo(R.group)]);
  if (t.ko) {
    if (t.ko.rounds >= 3) parts.push(['K.-o.', bo(R.ko)]);
    if (t.ko.rounds >= 2) parts.push(['Halbfinale', bo(R.semi)]);
    parts.push(['Finale', formatText({ legsBestOf: R.final, setsBestOf: R.finalSets })]);
  }
  const uniq = new Set(parts.map((p) => p[1]));
  return uniq.size <= 1 ? (parts[0] ? parts[0][1] : bo(t.legsBestOf)) : parts.map((p) => `${p[0]} ${p[1]}`).join(' · ');
}

/** Grobe Turnierdauer in Minuten: Spiele je Runde mit ihrem Format, verteilt auf die Boards. */
export function estimateMinutes({ groupGames = 0, koPlayers = 0, third = false, rules = null, legsBestOf = 3, boards = 2 }) {
  const R = resolvedRules(rules, legsBestOf);
  let m = groupGames * gameMinutes(R.group);
  const rounds = koPlayers >= 2 ? Math.round(Math.log2(koPlayers)) : 0;
  for (let r = 1; r <= rounds; r++) {
    const games = koPlayers / 2 ** r;
    if (r === rounds) m += games * gameMinutes(R.final, R.finalSets);
    else if (r === rounds - 1) m += games * gameMinutes(R.semi);
    else m += games * gameMinutes(R.ko);
  }
  if (third && rounds >= 2) m += gameMinutes(R.semi);
  return Math.ceil(m / Math.max(1, boards));
}

/**
 * Mögliche Aufteilungen für Gruppen + K.-o. bei n Spielern: 2, 4 oder 8 Gruppen (mindestens 3 Spieler je Gruppe).
 * Je Vorschlag: Gruppengrößen, Spiele je Spieler in der Gruppe, Gruppen- und K.-o.-Spiele, grobe Dauer, Empfehlung.
 */
export function groupOptions(n, { legsBestOf = 3, boards = 2, third = false, groupSize = 5, rules = null, timeLimit = 0 } = {}) {
  const best = groupCount(n, groupSize);
  const list = [2, 4, 8].filter((g) => n / g >= 3).map((g) => {
    const sizes = Array.from({ length: g }, (_, i) => Math.floor(n / g) + (i < n % g ? 1 : 0));
    const groupGames = sizes.reduce((a, k) => a + (k * (k - 1)) / 2, 0);
    const koPlayers = 2 * g;
    const koGames = koPlayers - 1 + (third && koPlayers >= 4 ? 1 : 0);
    const total = groupGames + koGames;
    const minutes = estimateMinutes({ groupGames, koPlayers, third, rules, legsBestOf, boards });
    return {
      groups: g, sizes, minSize: Math.min(...sizes), maxSize: Math.max(...sizes),
      gamesPerPlayer: [Math.min(...sizes) - 1, Math.max(...sizes) - 1],
      groupGames, koPlayers, koGames, koRound: koRoundName(1, Math.log2(koPlayers)), total, minutes, recommended: false, fits: !timeLimit || minutes <= timeLimit,
    };
  });
  // Empfehlung: mit Zeitgrenze die Aufteilung mit den meisten Spielen, die noch passt (sonst die kürzeste);
  // ohne Zeitgrenze die mit etwa 5 Spielern je Gruppe
  let rec = list.find((o) => o.groups === best);
  if (timeLimit) {
    const fit = list.filter((o) => o.fits).sort((a, b) => b.total - a.total)[0];
    rec = fit || list.slice().sort((a, b) => a.minutes - b.minutes)[0];
  }
  if (rec) rec.recommended = true;
  return list;
}

/** K.-o.-Feld (Setzliste -> Plätze). seeds: Einträge { p } | { g, place } | null (Freilos), bester zuerst. */
function makeKo(seeds) {
  let size = 4;
  while (size < seeds.length) size *= 2;
  const filled = [...seeds, ...Array(size - seeds.length).fill(null)];
  const slots = bracketOrder(size).map((s) => filled[s - 1]);
  // Gruppen + K.-o.: in Runde 1 nicht zwei aus derselben Gruppe (Zweite tauschen)
  const pairs = size / 2;
  for (let i = 0; i < pairs; i++) {
    const [x, y] = [slots[2 * i], slots[2 * i + 1]];
    if (!x || !y || x.g == null || x.g !== y.g) continue;
    for (let j = 0; j < pairs; j++) {
      const k = 2 * j + 1;
      const o = slots[k];
      const other = slots[2 * j];
      if (j === i || !o || o.g == null || o.g === x.g || (other && other.g === y.g)) continue;
      [slots[2 * i + 1], slots[k]] = [o, y];
      break;
    }
  }
  return { size, rounds: Math.log2(size), slots };
}

/**
 * Neues Turnier. players/playerNames in beliebiger Reihenfolge, die Auslosung mischt.
 * format 'ko': Feld mit 4, 8, 16 oder 32 Plätzen, fehlende Plätze sind Freilose (gehen an die ersten Setzplätze).
 * format 'rr': jeder gegen jeden.
 * format 'gko': Gruppen (Größe groupSize), die besten 2 je Gruppe kommen ins K.-o.
 * boards: Zahl der Boards (für Aufrufe beim Live-Turnier), pauseMin: Pause vor jeder K.-o.-Runde.
 * seeded: gesetzte Spieler, bester zuerst. K.-o.: Sie treffen sich erst spät (1 und 2 frühestens im Finale) und
 * bekommen die Freilose. Gruppen: jeder Gesetzte in eine andere Gruppe. Alle anderen werden zugelost.
 */
export function createTournament({ name, format, mode, options, legsBestOf, input, camera, players, playerNames, groupSize = 5, boards = 2, pauseMin = 0, seeded = [], third = false, groups: groupsWanted = 0, rules = null }) {
  const n = players.length;
  const [min, max] = LIMITS[format] || [];
  if (!min || n < min || n > max) throw new Error(`${TOURNAMENT_FORMATS[format] || 'Dieses Format'} braucht ${min} bis ${max} Spieler.`);
  const top = seeded.filter((id, i) => players.includes(id) && seeded.indexOf(id) === i);
  const seeds = [...top, ...shuffled(players.filter((id) => !top.includes(id)))];
  let groups = [];
  let ko = null;
  if (format === 'rr') groups = [seeds];
  if (format === 'gko') {
    // Gruppenzahl: gewählter Vorschlag (2, 4 oder 8) oder automatisch aus der gewünschten Gruppengröße
    const g = [2, 4, 8].includes(groupsWanted) && n / groupsWanted >= 3 ? groupsWanted : groupCount(n, groupSize);
    groups = Array.from({ length: g }, () => []);
    // Schlangenlinie: 1. Durchgang A, B, C …, 2. Durchgang … C, B, A (so landen Gesetzte nie zusammen)
    seeds.forEach((id, i) => groups[Math.floor(i / g) % 2 ? g - 1 - (i % g) : i % g].push(id));
    // Setzliste fürs K.-o.: alle Gruppenersten, dann alle Zweiten (in anderer Reihenfolge)
    const order = shuffled(groups.map((_, i) => i));
    ko = makeKo([...order.map((g2) => ({ g: g2, place: 0 })), ...order.slice().reverse().map((g2) => ({ g: g2, place: 1 }))]);
  }
  if (format === 'ko') ko = makeKo(seeds.map((p) => ({ p })));
  return {
    id: newId('t'), createdAt: Date.now(), name: name || 'Turnier', format, mode, options, legsBestOf,
    input: input || 'total', camera: !!camera,
    players: players.slice(), playerNames: Object.fromEntries(players.map((id, i) => [id, playerNames[i]])),
    seeded: top, groupSize, third: !!third && format !== 'rr', // third: Spiel um Platz 3 (nur mit K.-o.)
    rules: rules || null, // Legs je Runde (siehe resolvedRules)
    groups, groupGames: makeGroupGames(groups), ko,
    boards: Math.max(1, Math.min(8, boards || 2)), pauseMin: pauseMin || 0, calls: {},
  };
}

/** Spiele aller Gruppen (Jeder gegen Jeden je Gruppe). */
function makeGroupGames(groups) {
  const out = [];
  groups.forEach((list, gi) => {
    const perRound = {};
    roundRobin(list).forEach((x, i) => {
      const slot = perRound[x.round] = (perRound[x.round] ?? -1) + 1; // Nummer innerhalb der Runde (für die Reihenfolge)
      out.push({ key: `g${gi}-r${x.round}-${i}`, group: gi, round: x.round, slot, a: x.a, b: x.b });
    });
  });
  return out;
}

// ---------- Auslosung von Hand ändern (nur bevor das erste Spiel läuft) ----------

/** Darf die Auslosung noch geändert werden? Kein Spiel begonnen, keins aufgerufen. */
export function canEditDraw(t, matches) {
  if (Object.keys(t.calls || {}).length) return false;
  return !matches.some((m) => m.tournament && m.tournament.id === t.id && m.status !== 'aborted');
}

/**
 * Zwei Plätze tauschen. K.-o.: x/y = { slot } (Platz in Runde 1, auch Freilose). Gruppen: x/y = { group, index }.
 * Gibt das geänderte Turnier zurück oder wirft einen Fehler (z. B. zwei Freilose gegeneinander).
 */
export function swapDraw(t, x, y) {
  const next = { ...t };
  if (t.format === 'ko') {
    const slots = t.ko.slots.slice();
    [slots[x.slot], slots[y.slot]] = [slots[y.slot], slots[x.slot]];
    for (let i = 0; i < slots.length; i += 2) if (!slots[i] && !slots[i + 1]) throw new Error('Zwei Freilose können nicht gegeneinander spielen.');
    next.ko = { ...t.ko, slots };
  } else {
    const groups = t.groups.map((g) => g.slice());
    [groups[x.group][x.index], groups[y.group][y.index]] = [groups[y.group][y.index], groups[x.group][x.index]];
    next.groups = groups;
    next.groupGames = makeGroupGames(groups);
  }
  return next;
}

/** Neu auslosen mit denselben Einstellungen und Gesetzten (Name, Kennung und Boards bleiben). */
export function redraw(t) {
  const fresh = createTournament({
    name: t.name, format: t.format, mode: t.mode, options: t.options, legsBestOf: t.legsBestOf, input: t.input, camera: t.camera,
    players: t.players, playerNames: t.players.map((id) => t.playerNames[id]), groupSize: t.groupSize || Math.round(t.players.length / Math.max(1, t.groups.length)),
    boards: t.boards, pauseMin: t.pauseMin, seeded: t.seeded || [], groups: t.format === 'gko' ? t.groups.length : 0, third: t.third, rules: t.rules,
  });
  return { ...t, groups: fresh.groups, groupGames: fresh.groupGames, ko: fresh.ko, calls: {} };
}

// ---------- Stand berechnen ----------

/** Ergebnis eines Matches: { winnerId, legs: { id: gewonnene Legs }, at } oder null (läuft noch). */
function matchResult(m) {
  // Unentschieden (nur Gruppenphase, von der Turnierleitung gewertet, z. B. Spiel dauerte zu lange)
  if (m && m.status === 'finished' && m.manualResult && m.manualResult.draw) return { winnerId: null, draw: true, legs: { ...m.manualResult.legs }, at: m.updatedAt || m.createdAt };
  if (!m || m.status !== 'finished' || m.winner == null) return null;
  // Am PC eingetragenes Ergebnis (Handy ausgefallen): nur Legs, keine Würfe
  // walkover: Spieler nicht angetreten (am PC „kampflos“ gewertet) – zählt wie eine Aufgabe, nicht für die Ruhezeit
  if (m.manualResult) return { winnerId: m.players[m.winner], legs: { ...m.manualResult.legs }, at: m.updatedAt || m.createdAt, ...(m.manualResult.walkover ? { walkover: true } : {}) };
  const legs = {};
  try {
    const st = derive(m);
    // Spiel in Sätzen (z. B. Finale): Ergebnis in gewonnenen Sätzen, sonst in Legs
    const sets = m.format && m.format.setsBestOf > 1;
    m.players.forEach((id, i) => { legs[id] = sets ? st.setsWon[i] : st.legsWon[i]; });
  } catch { m.players.forEach((id) => { legs[id] = 0; }); }
  return { winnerId: m.players[m.winner], legs, at: m.updatedAt || m.createdAt };
}

/** Punkte in der Tabelle: Sieg 2, Unentschieden 1. */
export const pointsOf = (r) => 2 * r.won + (r.drawn || 0);
/** Erklärung der Reihenfolge (Tooltip und Hinweis unter den Gruppen). */
export const TIEBREAK_TEXT = 'Reihenfolge: Siege (Unentschieden = halber Sieg), dann Leg-Differenz, dann gewonnene Legs, dann der direkte Vergleich.';

/**
 * Tabelle aus Ergebnissen: [{ id, played, won, drawn, lost, legsFor, legsAgainst }].
 * Reihenfolge: Punkte (Sieg 2, Unentschieden 1; ohne Unentschieden = Siege), dann Leg-Differenz,
 * dann gewonnene Legs, dann direkter Vergleich.
 */
export function standings(players, results) {
  const row = Object.fromEntries(players.map((id) => [id, { id, played: 0, won: 0, drawn: 0, lost: 0, legsFor: 0, legsAgainst: 0 }]));
  const direct = new Set();
  for (const r of results) {
    const [a, b] = r.players;
    if (!row[a] || !row[b]) continue;
    for (const [me, op] of [[a, b], [b, a]]) {
      row[me].played++;
      row[me].legsFor += r.legs[me] || 0;
      row[me].legsAgainst += r.legs[op] || 0;
      if (!r.winnerId) row[me].drawn++;
      else if (r.winnerId === me) row[me].won++; else row[me].lost++;
    }
    if (r.winnerId) direct.add(`${r.winnerId}>${r.winnerId === a ? b : a}`);
  }
  const key = (r) => `${pointsOf(r)}|${r.legsFor - r.legsAgainst}|${r.legsFor}`;
  const tied = new Map();
  for (const r of Object.values(row)) tied.set(key(r), (tied.get(key(r)) || 0) + 1);
  // Direkter Vergleich nur bei genau zwei Punktgleichen (bei drei im Kreis wäre er widersprüchlich),
  // sonst feste Reihenfolge – so kommt überall derselbe Sieger heraus.
  return Object.values(row).sort((x, y) => pointsOf(y) - pointsOf(x)
    || (y.legsFor - y.legsAgainst) - (x.legsFor - x.legsAgainst)
    || y.legsFor - x.legsFor
    || (tied.get(key(x)) === 2 ? (direct.has(`${y.id}>${x.id}`) ? 1 : direct.has(`${x.id}>${y.id}`) ? -1 : 0) : 0)
    || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/**
 * Matches eines Turniers je Spiel: beendetes bevorzugt, sonst das neueste laufende (abgebrochene zählen nicht).
 * stopped: von der Turnierleitung gestoppte Matches (t.stopped = { matchId: Zeitpunkt }, „Neu starten“ / „Später spielen“)
 * zählen wie abgebrochen – auch wenn ein Handy danach noch einen Stand schickt.
 */
function matchesByGame(id, matches, stopped = {}) {
  const out = new Map();
  for (const m of matches) {
    if (!m.tournament || m.tournament.id !== id || m.status === 'aborted' || stopped[m.id]) continue;
    const prev = out.get(m.tournament.game);
    if (!prev || (prev.status !== 'finished' && (m.status === 'finished' || m.createdAt > prev.createdAt))) out.set(m.tournament.game, m);
  }
  return out;
}

/**
 * Rechnerischer Stand einer Gruppe: { Spieler: 'safe' (kommt sicher weiter) | 'out' (kann nicht mehr weiter) }.
 * Vorsichtig gerechnet: Gleichstand gilt als möglich verloren (Leg-Differenz ist noch offen).
 */
export function groupOutlook(table, games, done, qualify = 2, withdrawn = {}) {
  const out = {};
  if (!table.length) return out;
  if (done) {
    table.forEach((r, i) => { out[r.id] = i < qualify ? 'safe' : 'out'; });
    return out;
  }
  const open = (id) => games.filter((g) => g.status !== 'done' && (g.a === id || g.b === id)).length;
  const pts = Object.fromEntries(table.map((r) => [r.id, pointsOf(r)]));
  const max = Object.fromEntries(table.map((r) => [r.id, withdrawn[r.id] ? pts[r.id] : pts[r.id] + 2 * open(r.id)]));
  for (const r of table) {
    const others = table.filter((x) => x.id !== r.id);
    if (withdrawn[r.id] || others.filter((x) => pts[x.id] > max[r.id]).length >= qualify) out[r.id] = 'out';
    else if (others.filter((x) => max[x.id] >= pts[r.id]).length < qualify) out[r.id] = 'safe';
  }
  return out;
}

/**
 * Stand eines Turniers:
 * { games: [{ key, phase ('group'|'ko'), group, round, roundName, a, b, aLabel, bLabel, status, match, winnerId, result, score, notBefore }],
 *   groups: [{ index, name, players, table, games, done }], groupsDone, koRounds: [{ round, name, games }],
 *   table (Jeder gegen Jeden), champion, done, open (spielbar oder laufend), byGame (Map) }
 * status: 'bye' | 'done' | 'running' | 'ready' | 'waiting'.
 */
export function tournamentState(t, matches) {
  const byGame = matchesByGame(t.id, matches, t.stopped || {});
  const games = [];
  // Aufgabe (t.withdrawn = { Spieler: Zeitpunkt }): offene Spiele dieses Spielers gewinnt der Gegner kampflos
  const out_ = t.withdrawn || {};
  const walkover = (g) => {
    if (!g.a || !g.b || !(out_[g.a] || out_[g.b])) return null;
    const winnerId = out_[g.a] && !out_[g.b] ? g.b : out_[g.b] && !out_[g.a] ? g.a : (out_[g.a] <= out_[g.b] ? g.b : g.a);
    const f = formatFor(t, g);
    const need = winsNeeded(f.setsBestOf > 1 ? f.setsBestOf : f.legsBestOf);
    return { winnerId, legs: { [winnerId]: need, [winnerId === g.a ? g.b : g.a]: 0 }, at: Math.max(out_[g.a] || 0, out_[g.b] || 0), walkover: true };
  };
  const add = (g) => {
    const m = byGame.get(g.key) || null;
    const res = matchResult(m) || walkover(g);
    let status = 'waiting';
    let winnerId = null;
    if (g.bye) { status = 'bye'; winnerId = g.a || g.b; }
    else if (res) { status = 'done'; winnerId = res.winnerId; }
    else if (m && m.status === 'running') status = 'running';
    else if (g.a && g.b) status = 'ready';
    const out = {
      ...g, status, match: m, winnerId,
      result: res && { ...res, players: [g.a, g.b] },
      score: res ? (res.walkover ? 'kampflos' : `${res.legs[g.a] || 0} : ${res.legs[g.b] || 0}${res.draw ? ' (unentschieden)' : ''}`) : '',
    };
    games.push(out);
    return out;
  };

  // Gruppenphase (bei Jeder gegen Jeden: eine Gruppe)
  const groups = (t.groups || []).map((players, gi) => {
    const list = (t.groupGames || []).filter((g) => g.group === gi)
      .map((g) => add({ ...g, phase: 'group', roundName: t.format === 'rr' ? `Runde ${g.round}` : `${groupName(gi)} · Runde ${g.round}` }));
    const done = list.every((g) => g.status === 'done');
    const table = standings(players, list.filter((g) => g.result).map((g) => g.result));
    // Sicher weiter / ausgeschieden (nur Gruppen + K.-o.: Platz 1 und 2 kommen weiter)
    const outlook = t.format === 'gko' ? groupOutlook(table, list, done, 2, out_) : {};
    return { index: gi, name: groupName(gi), players, table, games: list, done, outlook };
  });
  const groupsDone = groups.every((g) => g.done);
  const groupsEnd = Math.max(0, ...groups.flatMap((g) => g.games.map((x) => (x.result ? x.result.at : 0))));

  // K.-o.: Plätze aus der Setzliste; Gruppenplätze erst, wenn alle Gruppen fertig sind
  const koRounds = [];
  if (t.ko) {
    const resolve = (e) => {
      if (!e) return { id: null, label: 'Freilos', bye: true };
      if (e.p) return { id: e.p, label: null };
      const label = `${e.place + 1}. ${groupName(e.g)}`;
      return { id: groupsDone ? groups[e.g].table[e.place]?.id || null : null, label };
    };
    const pause = (t.pauseMin || 0) * 60000;
    let prev = [];
    for (let r = 1; r <= t.ko.rounds; r++) {
      const cur = [];
      const prevEnd = r === 1 ? (t.format === 'gko' ? groupsEnd : 0) : Math.max(0, ...prev.map((g) => (g.result ? g.result.at : 0)));
      const count = t.ko.size / 2 ** r;
      for (let i = 0; i < count; i++) {
        let A; let B;
        if (r === 1) { A = resolve(t.ko.slots[2 * i]); B = resolve(t.ko.slots[2 * i + 1]); }
        else {
          const [x, y] = [prev[2 * i], prev[2 * i + 1]];
          // Platzhalter, solange das Vorspiel läuft: „Sieger Kevin / Tom“. Freilos: gleich der Spieler („1. Gruppe C“).
          // Ist das Vorspiel selbst noch offen, kurz „Sieger Viertelfinale 2“ statt „Sieger Sieger …“.
          const nm = (id, lbl) => t.playerNames[id] || lbl || '?';
          const plain = (id, lbl) => !!id || (lbl && !/^(Sieger|Verlierer|Freilos)/.test(lbl));
          const who = (g, k) => {
            if (g.bye) return g.aLabel === 'Freilos' ? nm(g.b, g.bLabel) : nm(g.a, g.aLabel);
            if (plain(g.a, g.aLabel) && plain(g.b, g.bLabel)) return `Sieger ${nm(g.a, g.aLabel)} / ${nm(g.b, g.bLabel)}`;
            return `Sieger ${koRoundName(r - 1, t.ko.rounds)} ${k + 1}`;
          };
          A = { id: x.winnerId, label: x.winnerId ? null : who(x, 2 * i) };
          B = { id: y.winnerId, label: y.winnerId ? null : who(y, 2 * i + 1) };
        }
        const bye = r === 1 && (A.bye || B.bye) && !(A.bye && B.bye);
        // Pause vor der Runde: erst nach Ende der vorigen Runde (bzw. Gruppenphase) + Pause
        const allPrevDone = r === 1 ? (t.format !== 'gko' || groupsDone) : prev.every((g) => g.status === 'done' || g.status === 'bye');
        const notBefore = pause && prevEnd && allPrevDone && (r > 1 || t.format === 'gko') ? prevEnd + pause : 0;
        cur.push(add({
          key: `k${r}-${i}`, phase: 'ko', round: r, roundName: koRoundName(r, t.ko.rounds),
          a: A.id, b: B.id, aLabel: A.label, bLabel: B.label, bye, notBefore,
        }));
      }
      koRounds.push({ round: r, name: koRoundName(r, t.ko.rounds), games: cur });
      prev = cur;
    }
    // Spiel um Platz 3 (Auswahl beim Anlegen): die beiden Halbfinal-Verlierer; wird vor dem Finale aufgerufen
    if (t.third && t.ko.rounds >= 2) {
      const semis = koRounds[koRounds.length - 2].games;
      const loser = (g) => (g.winnerId && g.a && g.b ? (g.winnerId === g.a ? g.b : g.a) : null);
      const who = (g, k) => (g.a && g.b ? `Verlierer ${t.playerNames[g.a]} / ${t.playerNames[g.b]}` : `Verlierer ${koRoundName(t.ko.rounds - 1, t.ko.rounds)} ${k}`);
      const fin = koRounds[koRounds.length - 1];
      fin.games.push(add({
        key: 'k3rd', phase: 'ko', round: t.ko.rounds, slot: -1, roundName: 'Spiel um Platz 3', third: true,
        a: loser(semis[0]), b: loser(semis[1]),
        aLabel: loser(semis[0]) ? null : who(semis[0], 1), bLabel: loser(semis[1]) ? null : who(semis[1], 2),
        bye: false, notBefore: fin.games[0].notBefore || 0,
      }));
    }
  }

  let champion = null;
  const done = games.every((g) => g.status === 'done' || g.status === 'bye');
  if (t.ko) champion = koRounds[koRounds.length - 1].games[0].winnerId;
  else if (done && groups[0]) champion = groups[0].table[0].id;
  const open = games.filter((g) => g.status === 'ready' || g.status === 'running');
  return { games, groups, groupsDone, koRounds, table: t.format === 'rr' ? groups[0].table : null, champion, done, open, byGame };
}

// ---------- Aufrufe an Boards (Live-Turnier) ----------

/**
 * Welches Spiel läuft gerade an welchem Board? t.calls: { spielKey: { board, at } }.
 * Ein Aufruf ist erledigt, sobald das Spiel beendet ist.
 * Ergebnis: [{ board, game (oder null), since }], Board 1 zuerst.
 */
export function boardStatus(t, st) {
  const byKey = new Map(st.games.map((g) => [g.key, g]));
  const out = Array.from({ length: t.boards || 1 }, (_, i) => ({ board: i + 1, game: null, since: null }));
  for (const [key, c] of Object.entries(t.calls || {})) {
    const g = byKey.get(key);
    if (!g || g.status === 'done' || g.status === 'bye' || !out[c.board - 1]) continue;
    out[c.board - 1] = { board: c.board, game: g, since: c.at, writer: c.writer || null };
  }
  return out;
}

/** Reihenfolge der Warteschlange: Gruppenspiele vor K.-o., dann Runde, dann abwechselnd die Gruppen (A, B, A, B …). */
export function queueOrder(games) {
  return games.slice().sort((x, y) => (x.phase === y.phase ? 0 : x.phase === 'group' ? -1 : 1)
    || x.round - y.round || (x.slot ?? 0) - (y.slot ?? 0) || (x.group ?? 0) - (y.group ?? 0));
}

/**
 * Neue Aufrufe für freie Boards: das nächste spielbare Spiel, dessen Spieler gerade nicht an einem anderen
 * Board stehen. Gruppenspiele der Runde nach, K.-o. der Runde nach. Pausen (notBefore) werden eingehalten.
 * Ergebnis: { calls: [{ board, game }], pauseUntil (Zeitpunkt, falls ein Board nur wegen der Pause frei bleibt) }.
 */
export function planCalls(t, st, now = Date.now(), { boards: allowed = null, rest = 0, gap = 0, beforePause = false } = {}) {
  // Von Hand angehalten („⏸ Turnier anhalten“, t.pausedUntil): bis dahin keine neuen Aufrufe
  if (t.pausedUntil && t.pausedUntil > now) return { calls: [], pauseUntil: t.pausedUntil, manualPause: true };
  const boards = boardStatus(t, st);
  const busy = new Set();
  for (const b of boards) if (b.game) { busy.add(b.game.a); busy.add(b.game.b); }
  for (const g of st.games) if (g.status === 'running') { busy.add(g.a); busy.add(g.b); }
  // Abwesende Spieler („🙋 nicht da“, t.absent) werden nicht aufgerufen
  for (const id of Object.keys(t.absent || {})) busy.add(id);
  const candidates = upcomingQueue(t, st);
  // Ruhezeit: Wer gerade gespielt hat, kommt möglichst erst nach `rest` ms wieder dran. Gibt es kein anderes
  // spielbares Spiel, trotzdem (sonst bliebe ein Board leer).
  const lastEnd = new Map();
  for (const g of st.games) if (g.result && !g.result.walkover) for (const p of [g.a, g.b]) lastEnd.set(p, Math.max(lastEnd.get(p) || 0, g.result.at || 0));
  const rested = (g) => !rest || [g.a, g.b].every((p) => now - (lastEnd.get(p) || 0) >= rest);
  // Wartezeit je Board (gap): nach dem Ende des letzten Spiels dort so lange nichts Neues aufrufen
  const boardEnd = new Map();
  if (gap) {
    const byKey = new Map(st.games.map((g) => [g.key, g]));
    for (const [key, c] of Object.entries(t.calls || {})) {
      const g = byKey.get(key);
      if (g && g.result && !g.result.walkover) boardEnd.set(c.board, Math.max(boardEnd.get(c.board) || 0, g.result.at || 0));
    }
  }
  // beforePause: vor einer geplanten Pause (t.plannedPause) nur Spiele aufrufen, die nach üblicher Dauer noch davor fertig werden
  const pp = t.plannedPause;
  const fitsBeforePause = (g) => {
    if (!beforePause || !pp || pp.at <= now) return true;
    const f = formatFor(t, g);
    return now + gameMinutes(f.legsBestOf, f.setsBestOf) * 60000 <= pp.at;
  };
  const calls = [];
  let pauseUntil = 0;
  for (const b of boards) {
    if (b.game) continue;
    if (allowed && !allowed.has(b.board)) continue; // an diesem Board ist gerade kein Handy angemeldet
    if (gap && now - (boardEnd.get(b.board) || 0) < gap) continue;
    const free = (g) => !busy.has(g.a) && !busy.has(g.b) && !calls.some((c) => c.game === g) && !(g.notBefore > now) && fitsBeforePause(g);
    const pick = candidates.find((g) => free(g) && rested(g)) || candidates.find(free);
    if (pick) {
      calls.push({ board: b.board, game: pick });
      busy.add(pick.a); busy.add(pick.b);
    } else {
      const waiting = candidates.find((g) => g.notBefore > now);
      if (waiting) pauseUntil = pauseUntil ? Math.min(pauseUntil, waiting.notBefore) : waiting.notBefore;
    }
  }
  return { calls, pauseUntil };
}

/**
 * Warteschlange: spielbare, noch nicht aufgerufene Spiele in Aufruf-Reihenfolge. „Später spielen“ (t.defer)
 * stellt ein Spiel ans Ende.
 */
export function upcomingQueue(t, st) {
  const called = new Set(Object.keys(t.calls || {}));
  const defer = t.defer || {};
  const list = queueOrder(st.games.filter((g) => g.status === 'ready' && !called.has(g.key)));
  return [...list.filter((g) => !defer[g.key]), ...list.filter((g) => defer[g.key]).sort((x, y) => defer[x.key] - defer[y.key])];
}

/** Angaben, die ein Turnier-Match bei sich trägt (für Turnier-Stand und Meilensteine). */
export function matchTag(t, game) {
  return {
    id: t.id, game: game.key, name: t.name, format: t.format, players: t.players.slice(),
    total: t.format === 'rr' ? (t.groupGames || []).length : null,
    final: !!t.ko && game.phase === 'ko' && game.round === t.ko.rounds && !game.third, // Spiel um Platz 3 ist kein Finale
  };
}

/**
 * Turniersieger allein aus Matches (für Meilensteine, ohne gespeicherten Plan):
 * Map turnierId -> { winnerId, matchId (das entscheidende Match) }.
 * K.-o. und Gruppen + K.-o.: Sieger des Finales. Jeder gegen Jeden: Tabellenerster, sobald alle Spiele beendet sind.
 */
export function tournamentChampions(matches) {
  const groups = new Map();
  for (const m of matches) {
    if (!m.tournament || m.status !== 'finished') continue;
    (groups.get(m.tournament.id) || groups.set(m.tournament.id, []).get(m.tournament.id)).push(m);
  }
  const out = new Map();
  for (const [id, list] of groups) {
    const tag = list[0].tournament;
    // je Spiel nur ein Match zählen
    const byGame = new Map();
    for (const m of list.sort((a, b) => a.createdAt - b.createdAt)) if (!byGame.has(m.tournament.game)) byGame.set(m.tournament.game, m);
    const uniq = [...byGame.values()];
    const fin = uniq.find((m) => m.tournament.final);
    if (fin) out.set(id, { winnerId: fin.players[fin.winner], matchId: fin.id });
    else if (tag.format === 'rr' && tag.total && uniq.length >= tag.total) {
      const results = uniq.map((m) => ({ ...matchResult(m), players: m.players.slice() }));
      out.set(id, { winnerId: standings(tag.players, results)[0].id, matchId: uniq[uniq.length - 1].id });
    }
  }
  return out;
}

// ---------- Schreiber, Highlights, Zeitplan (Live-Ansicht) ----------

/**
 * Schreiber für ein neu aufgerufenes Spiel: der Verlierer des letzten Spiels an diesem Board
 * (Darts-Brauch), sonst jemand, der gerade nicht spielt. busy = Spieler, die gerade spielen oder aufgerufen sind.
 */
export function pickWriter(t, st, board, game, busy = new Set()) {
  const byKey = new Map(st.games.map((g) => [g.key, g]));
  const free = (p) => p && p !== game.a && p !== game.b && !busy.has(p) && !(t.withdrawn || {})[p] && !(t.absent || {})[p]; // wer aufgegeben hat oder nicht da ist, schreibt nicht
  const last = Object.entries(t.calls || {})
    .filter(([key, c]) => c.board === board && byKey.get(key)?.status === 'done')
    .sort((x, y) => y[1].at - x[1].at)[0];
  if (last) {
    const g = byKey.get(last[0]);
    const loser = g.winnerId === g.a ? g.b : g.a;
    if (free(loser)) return loser;
  }
  return t.players.find(free) || null;
}

/**
 * Highlights aus Aufnahmen: 180 und Finishes ab 100 (nur X01).
 * Ergebnis: [{ key (eindeutig), kind ('180'|'finish'), text, speech, playerId }], älteste zuerst.
 */
export function highlightsOf(m) {
  if (!m || m.mode !== 'x01') return [];
  let st;
  try { st = derive(m); } catch { return []; }
  const out = [];
  const start = (m.options && m.options.startScore) || 501;
  for (const leg of st.legs) {
    const darts = new Map(); // Spieler -> Darts in diesem Leg
    for (const info of leg.turns) {
      const who = m.playerNames[info.player];
      const at = info.ts || m.updatedAt || 0;
      darts.set(info.player, (darts.get(info.player) || 0) + ((info.ev && info.ev.usedDarts) || (info.darts || []).length || 3));
      if (info.ev.finished && info.startRemaining >= 100) {
        out.push({ key: `${m.id}:${info.index}`, kind: 'finish', at, text: `🏁 ${info.startRemaining} Finish – ${who}`, speech: `${info.startRemaining} Finish von ${who}!`, playerId: m.players[info.player] });
      } else if (!info.ev.bust && info.ev.points === 180) {
        out.push({ key: `${m.id}:${info.index}`, kind: '180', at, text: `🚀 180 – ${who}`, speech: `Einhundertachtzig! ${who}!`, playerId: m.players[info.player] });
      }
      // Short Leg: 501 in höchstens 15 Darts (301 in höchstens 9), 9-Darter extra
      const n = darts.get(info.player);
      const limit = start >= 501 ? 15 : start >= 301 ? 9 : 0;
      if (info.ev.finished && limit && n <= limit) {
        const nine = start === 501 && n <= 9;
        out.push({ key: `${m.id}:${info.index}:short`, kind: nine ? 'nine' : 'short', at, text: nine ? `💎 9-Darter – ${who}` : `⚡ ${n}-Darter – ${who}`, speech: nine ? `Neun-Darter! ${who}!` : `Leg in ${n} Darts von ${who}!`, playerId: m.players[info.player] });
      }
    }
  }
  return out;
}

/**
 * Zeitplan voraus rechnen: Jedes offene Spiel bekommt das nächste frei werdende Board. Dauer je Spiel nach seinem
 * Format (Legs je Runde), angepasst an das bisherige Tempo (echte Dauer ÷ geschätzte Dauer der fertigen Spiele).
 * K.-o.-Runden beginnen erst nach der vorigen Runde (bzw. der Gruppenphase) plus Pause.
 * Ergebnis: { at (Ende), minutes, groupsAt (Ende der Gruppenphase, falls noch offen), finalAt (Beginn des Finales),
 *   starts: Map Spiel-Key -> geschätzter Beginn } oder null (nichts mehr offen).
 */
export function forecast(t, st, now = Date.now()) {
  const expected = (g) => { const f = formatFor(t, g); return gameMinutes(f.legsBestOf, f.setsBestOf) * 60000; };
  const done = st.games.filter((g) => g.status === 'done' && g.match && !g.match.manualResult);
  const ratios = done.map((g) => ((g.match.updatedAt || 0) - (g.match.createdAt || 0)) / expected(g)).filter((r) => r > 0.1 && r < 8);
  const ratio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;
  const dur = (g) => expected(g) * ratio;
  const open = st.games.filter((g) => g.status !== 'done' && g.status !== 'bye');
  if (!open.length) return null;
  const start0 = Math.max(now, t.pausedUntil || 0);
  const free = Array.from({ length: Math.max(1, t.boards || 1) }, () => start0);
  const starts = new Map();
  const ends = new Map();
  // Spiele, die schon an einem Board stehen (laufend oder aufgerufen)
  for (const b of boardStatus(t, st)) {
    if (!b.game || free[b.board - 1] == null) continue;
    const s0 = b.game.status === 'running' && b.game.match ? b.game.match.createdAt || now : now;
    const end = Math.max(now + 60000, s0 + dur(b.game));
    free[b.board - 1] = end;
    starts.set(b.game.key, s0); ends.set(b.game.key, end);
  }
  const assign = (g, notBefore) => {
    if (ends.has(g.key)) return ends.get(g.key);
    const i = free.indexOf(Math.min(...free));
    let s0 = Math.max(free[i], notBefore, t.pausedUntil || 0); // während einer Pause beginnt nichts vor ihrem Ende
    // geplante Pause (t.plannedPause): was in sie fallen würde, beginnt erst danach
    const pp = t.plannedPause;
    if (pp && s0 >= pp.at && s0 < pp.at + pp.min * 60000) s0 = pp.at + pp.min * 60000;
    free[i] = s0 + dur(g);
    starts.set(g.key, s0); ends.set(g.key, free[i]);
    return free[i];
  };
  // Gruppenphase: in Aufruf-Reihenfolge (zurückgestellte zuletzt), dann die übrigen offenen Gruppenspiele
  const groupOpen = open.filter((g) => g.phase === 'group');
  // Spiele mit abwesenden Spielern (t.absent) ans Ende – sie werden erst aufgerufen, wenn die Spieler wieder da sind
  const away = (g) => !!((t.absent || {})[g.a] || (t.absent || {})[g.b]);
  const queued = upcomingQueue(t, st).filter((g) => g.phase === 'group');
  const order = [...queued.filter((g) => !away(g)), ...queued.filter(away), ...groupOpen];
  let groupsEnd = Math.max(0, ...st.games.filter((g) => g.phase === 'group' && g.result).map((g) => g.result.at || 0));
  for (const g of order) groupsEnd = Math.max(groupsEnd, assign(g, now));
  let prevEnd = t.format === 'gko' ? groupsEnd : now;
  const pause = (t.pauseMin || 0) * 60000;
  let finalAt = null;
  for (const r of st.koRounds) {
    const left = r.games.filter((g) => g.status !== 'done' && g.status !== 'bye');
    if (!left.length) { prevEnd = Math.max(prevEnd, ...r.games.map((g) => (g.result ? g.result.at || 0 : 0))); continue; }
    const roundStart = Math.max(now, prevEnd + (pause && (r.round > 1 || t.format === 'gko') ? pause : 0));
    // Spiel um Platz 3 vor dem Finale
    const sorted = left.slice().sort((x, y) => (y.third ? 1 : 0) - (x.third ? 1 : 0));
    let roundEnd = prevEnd;
    for (const g of sorted) {
      roundEnd = Math.max(roundEnd, assign(g, roundStart));
      if (!g.third && r.round === t.ko.rounds && g.status !== 'running') finalAt = starts.get(g.key);
    }
    prevEnd = roundEnd;
  }
  const at = Math.max(now, ...ends.values());
  return {
    at, minutes: Math.max(1, Math.round((at - now) / 60000)), starts,
    groupsAt: t.format === 'gko' && !st.groupsDone ? groupsEnd : null,
    finalAt,
  };
}

/**
 * Geplante Pause (t.plannedPause = { at, min, reason }) fällig? Dann die Änderung am Turnier, die sie startet:
 * Pause bis at + min (gerechnet ab der geplanten Zeit, nicht ab dem Erkennen), Plan gelöscht. Sonst null.
 * Läuft schon eine längere Pause, wird der Plan nur gelöscht.
 */
export function plannedPauseStart(t, now = Date.now()) {
  const pp = t.plannedPause;
  if (!pp || pp.at > now) return null;
  const until = pp.at + pp.min * 60000;
  if (until <= now || (t.pausedUntil || 0) >= until) return { plannedPause: null };
  return { plannedPause: null, pausedUntil: until, pauseReason: pp.reason || null };
}

/** Geschätztes Turnierende: { minutes, at, groupsAt, finalAt, starts } oder null (siehe forecast). */
export function scheduleEstimate(t, st, now = Date.now()) {
  return forecast(t, st, now);
}

/**
 * Endplatzierung (Export und Urkunden): [{ id, place, placeText }], bester zuerst.
 * K.-o.: Sieger, Finalgegner, Platz 3 (Spiel um Platz 3 oder beide Halbfinal-Verlierer), dann je Runde die
 * Verlierer (geteilte Plätze, z. B. 5.–8.). Gruppen + K.-o.: danach die übrigen nach Gruppenplatz und Punkten.
 * Jeder gegen Jeden: die Tabelle.
 */
export function finalRanking(t, st) {
  const tiers = [];
  const seen = new Set();
  const push = (ids) => { const l = ids.filter((id) => id && !seen.has(id)); l.forEach((id) => seen.add(id)); if (l.length) tiers.push(l); };
  const loser = (g) => (g && g.status === 'done' && g.winnerId && g.a && g.b ? (g.winnerId === g.a ? g.b : g.a) : null);
  if (t.ko && st.koRounds.length) {
    const R = st.koRounds;
    const fin = R[R.length - 1].games.find((g) => !g.third);
    const third = R[R.length - 1].games.find((g) => g.third);
    push([fin && fin.winnerId]);
    push([loser(fin)]);
    if (third && third.status === 'done') { push([third.winnerId]); push([loser(third)]); }
    for (let i = R.length - 2; i >= 0; i--) push(R[i].games.map(loser));
  }
  if (st.groups.length) {
    const depth = Math.max(0, ...st.groups.map((g) => g.table.length));
    for (let k = 0; k < depth; k++) {
      const rate = (r) => pointsOf(r) / Math.max(1, r.played);
      const rows = st.groups.map((g) => g.table[k]).filter((r) => r && !seen.has(r.id))
        .sort((x, y) => rate(y) - rate(x) || (y.legsFor - y.legsAgainst) - (x.legsFor - x.legsAgainst) || y.legsFor - x.legsFor);
      rows.forEach((r) => push([r.id]));
    }
  }
  push(t.players.filter((id) => !seen.has(id)));
  const out = [];
  let place = 1;
  for (const ids of tiers) {
    const text = ids.length > 1 ? `${place}.–${place + ids.length - 1}.` : `${place}.`;
    ids.forEach((id) => out.push({ id, place, placeText: text }));
    place += ids.length;
  }
  return out;
}

// ---------- Protokoll (Turnierleitung) ----------

export const LOG_MAX = 600;
/**
 * Eintrag ins Protokoll des Turniers (t.log, neuester zuletzt). undo: wie die Aktion zurückgenommen wird
 * (siehe ui/screens/live.js › undoEntry), z. B. { op: 'withdraw', id }. Gibt das geänderte Turnier zurück.
 */
export function withLog(t, text, { undo = null, kind = 'action', ref = null, at = Date.now() } = {}) {
  const entry = { id: `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, kind, text, ref, undo };
  return { ...t, log: [...(t.log || []), entry].slice(-LOG_MAX) };
}

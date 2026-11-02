// Turniere: K.-o. (4–32 Spieler), Jeder gegen Jeden (3–8) und Gruppen + K.-o. (8–32).
// Gespeichert wird nur der Plan (Spieler, Auslosung, Format, Boards, Aufrufe) in localStorage bzw. beim
// Live-Turnier auf dem PC (werkzeuge/turnier-server.ps1). Ergebnisse werden immer aus den Matches berechnet
// (match.tournament = { id, game, … }). So stimmen Turnier und Statistik immer überein, Rückgängig wirkt sofort,
// und Spiele von anderen Handys kommen über den Abgleich oder den Turnier-Server ins Turnier.

import { lsGet, lsSet } from './storage.js';
import { derive, newId } from '../game/match.js';

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
export function groupCount(n, groupSize = 5) {
  return Math.max(2, Math.round(n / groupSize));
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
export function createTournament({ name, format, mode, options, legsBestOf, input, camera, players, playerNames, groupSize = 5, boards = 2, pauseMin = 0, seeded = [] }) {
  const n = players.length;
  const [min, max] = LIMITS[format] || [];
  if (!min || n < min || n > max) throw new Error(`${TOURNAMENT_FORMATS[format] || 'Dieses Format'} braucht ${min} bis ${max} Spieler.`);
  const top = seeded.filter((id, i) => players.includes(id) && seeded.indexOf(id) === i);
  const seeds = [...top, ...shuffled(players.filter((id) => !top.includes(id)))];
  let groups = [];
  let ko = null;
  if (format === 'rr') groups = [seeds];
  if (format === 'gko') {
    const g = groupCount(n, groupSize);
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
    seeded: top, groupSize,
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
    boards: t.boards, pauseMin: t.pauseMin, seeded: t.seeded || [],
  });
  return { ...t, groups: fresh.groups, groupGames: fresh.groupGames, ko: fresh.ko, calls: {} };
}

// ---------- Stand berechnen ----------

/** Ergebnis eines Matches: { winnerId, legs: { id: gewonnene Legs }, at } oder null (läuft noch). */
function matchResult(m) {
  if (!m || m.status !== 'finished' || m.winner == null) return null;
  // Am PC eingetragenes Ergebnis (Handy ausgefallen): nur Legs, keine Würfe
  if (m.manualResult) return { winnerId: m.players[m.winner], legs: { ...m.manualResult.legs }, at: m.updatedAt || m.createdAt };
  const legs = {};
  try {
    const st = derive(m);
    m.players.forEach((id, i) => { legs[id] = st.legsWon[i]; }); // Turniere werden ohne Sets gespielt
  } catch { m.players.forEach((id) => { legs[id] = 0; }); }
  return { winnerId: m.players[m.winner], legs, at: m.updatedAt || m.createdAt };
}

/**
 * Tabelle aus Ergebnissen: [{ id, played, won, lost, legsFor, legsAgainst }].
 * Reihenfolge: Siege, dann Leg-Differenz, dann gewonnene Legs, dann direkter Vergleich.
 */
export function standings(players, results) {
  const row = Object.fromEntries(players.map((id) => [id, { id, played: 0, won: 0, lost: 0, legsFor: 0, legsAgainst: 0 }]));
  const direct = new Set();
  for (const r of results) {
    const [a, b] = r.players;
    if (!row[a] || !row[b]) continue;
    for (const [me, op] of [[a, b], [b, a]]) {
      row[me].played++;
      row[me].legsFor += r.legs[me] || 0;
      row[me].legsAgainst += r.legs[op] || 0;
      if (r.winnerId === me) row[me].won++; else row[me].lost++;
    }
    direct.add(`${r.winnerId}>${r.winnerId === a ? b : a}`);
  }
  const key = (r) => `${r.won}|${r.legsFor - r.legsAgainst}|${r.legsFor}`;
  const tied = new Map();
  for (const r of Object.values(row)) tied.set(key(r), (tied.get(key(r)) || 0) + 1);
  // Direkter Vergleich nur bei genau zwei Punktgleichen (bei drei im Kreis wäre er widersprüchlich),
  // sonst feste Reihenfolge – so kommt überall derselbe Sieger heraus.
  return Object.values(row).sort((x, y) => y.won - x.won
    || (y.legsFor - y.legsAgainst) - (x.legsFor - x.legsAgainst)
    || y.legsFor - x.legsFor
    || (tied.get(key(x)) === 2 ? (direct.has(`${y.id}>${x.id}`) ? 1 : direct.has(`${x.id}>${y.id}`) ? -1 : 0) : 0)
    || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Matches eines Turniers je Spiel: beendetes bevorzugt, sonst das neueste laufende (abgebrochene zählen nicht). */
function matchesByGame(id, matches) {
  const out = new Map();
  for (const m of matches) {
    if (!m.tournament || m.tournament.id !== id || m.status === 'aborted') continue;
    const prev = out.get(m.tournament.game);
    if (!prev || (prev.status !== 'finished' && (m.status === 'finished' || m.createdAt > prev.createdAt))) out.set(m.tournament.game, m);
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
  const byGame = matchesByGame(t.id, matches);
  const games = [];
  const add = (g) => {
    const m = byGame.get(g.key) || null;
    const res = matchResult(m);
    let status = 'waiting';
    let winnerId = null;
    if (g.bye) { status = 'bye'; winnerId = g.a || g.b; }
    else if (res) { status = 'done'; winnerId = res.winnerId; }
    else if (m && m.status === 'running') status = 'running';
    else if (g.a && g.b) status = 'ready';
    const out = {
      ...g, status, match: m, winnerId,
      result: res && { ...res, players: [g.a, g.b] },
      score: res ? `${res.legs[g.a] || 0} : ${res.legs[g.b] || 0}` : '',
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
    return { index: gi, name: groupName(gi), players, table, games: list, done };
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
          // Platzhalter, solange das Vorspiel läuft: „Sieger Kevin / Tom“
          const who = (g) => `Sieger ${t.playerNames[g.a] || g.aLabel || '?'} / ${t.playerNames[g.b] || g.bLabel || '?'}`;
          A = { id: x.winnerId, label: x.winnerId ? null : who(x) };
          B = { id: y.winnerId, label: y.winnerId ? null : who(y) };
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
export function planCalls(t, st, now = Date.now(), { boards: allowed = null } = {}) {
  const boards = boardStatus(t, st);
  const busy = new Set();
  for (const b of boards) if (b.game) { busy.add(b.game.a); busy.add(b.game.b); }
  for (const g of st.games) if (g.status === 'running') { busy.add(g.a); busy.add(g.b); }
  const called = new Set(Object.keys(t.calls || {}));
  const candidates = queueOrder(st.games.filter((g) => g.status === 'ready' && !called.has(g.key)));
  const calls = [];
  let pauseUntil = 0;
  for (const b of boards) {
    if (b.game) continue;
    if (allowed && !allowed.has(b.board)) continue; // an diesem Board ist gerade kein Handy angemeldet
    const pick = candidates.find((g) => !busy.has(g.a) && !busy.has(g.b) && !calls.some((c) => c.game === g) && !(g.notBefore > now));
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

/** Angaben, die ein Turnier-Match bei sich trägt (für Turnier-Stand und Meilensteine). */
export function matchTag(t, game) {
  return {
    id: t.id, game: game.key, name: t.name, format: t.format, players: t.players.slice(),
    total: t.format === 'rr' ? (t.groupGames || []).length : null,
    final: !!t.ko && game.phase === 'ko' && game.round === t.ko.rounds,
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
  const free = (p) => p && p !== game.a && p !== game.b && !busy.has(p);
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
  for (const leg of st.legs) {
    for (const info of leg.turns) {
      const who = m.playerNames[info.player];
      if (info.ev.finished && info.startRemaining >= 100) {
        out.push({ key: `${m.id}:${info.index}`, kind: 'finish', text: `🏁 ${info.startRemaining} Finish – ${who}`, speech: `${info.startRemaining} Finish von ${who}!`, playerId: m.players[info.player] });
      } else if (!info.ev.bust && info.ev.points === 180) {
        out.push({ key: `${m.id}:${info.index}`, kind: '180', text: `🚀 180 – ${who}`, speech: `Einhundertachtzig! ${who}!`, playerId: m.players[info.player] });
      }
    }
  }
  return out;
}

/**
 * Geschätztes Turnierende aus der bisherigen Spieldauer: { minutes, at } oder null (noch kein Spiel fertig).
 * Rechnung: Spiele, die noch fehlen ÷ Boards × durchschnittliche Dauer eines Spiels.
 */
export function scheduleEstimate(t, st, now = Date.now()) {
  const done = st.games.filter((g) => g.status === 'done' && g.match && !g.match.manualResult);
  const durations = done.map((g) => (g.match.updatedAt || 0) - (g.match.createdAt || 0)).filter((d) => d > 30000 && d < 3 * 3600000);
  if (!durations.length) return null;
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const left = st.games.filter((g) => g.status !== 'done' && !g.bye).length;
  if (!left) return null;
  const ms = Math.ceil(left / Math.max(1, t.boards || 1)) * avg;
  return { minutes: Math.round(ms / 60000), at: now + ms };
}

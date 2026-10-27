// Statistiken aus der einheitlichen Wurfliste (throwRows).
// Funktioniert für alle gespeicherten Würfe, auch rückwirkend.

import { derive } from '../game/match.js';

/** Kennzahlen eines Spielers aus seinen Wurfzeilen (nur X01). */
export function playerStats(rows) {
  const x01 = rows.filter((r) => r.mode === 'x01');
  const turns = groupTurns(x01);
  let darts = 0;
  let points = 0;
  let highest = 0;
  let c180 = 0;
  let c140 = 0;
  let c100 = 0;
  let busts = 0;
  let first9Points = 0;
  let first9Darts = 0;
  let checkoutAttempts = 0;
  let checkouts = 0;
  let highestCheckout = 0;
  const legsWonDarts = [];
  const legDarts = new Map();
  // Eigene Aufnahme-Nummer je Leg (1, 2, 3 …). r.turn zählt die Aufnahmen aller Spieler im Leg,
  // für First 9 zählen aber die ersten drei eigenen Aufnahmen (= 9 Darts).
  const ownTurn = new Map();
  const byLeg = new Map();
  for (const t of turns) {
    const k = `${t.matchId}:${t.legOverall}:${t.playerId}`;
    (byLeg.get(k) || byLeg.set(k, []).get(k)).push(t);
  }
  for (const list of byLeg.values()) list.sort((a, b) => a.turn - b.turn).forEach((t, i) => ownTurn.set(t, i + 1));

  for (const t of turns) {
    const counted = t.darts.filter((d) => d.counted);
    darts += counted.length;
    points += t.points;
    if (t.bust) busts++;
    if (t.points > highest) highest = t.points;
    if (t.points === 180) c180++;
    else if (t.points >= 140) c140++;
    else if (t.points >= 100) c100++;
    if (ownTurn.get(t) <= 3) { first9Points += t.points; first9Darts += counted.length; }
    for (const d of counted) {
      if (d.onFinish) checkoutAttempts++;
      if (d.checkout) {
        checkouts++;
        if (t.restBefore > highestCheckout) highestCheckout = t.restBefore;
      }
    }
    const lk = `${t.matchId}:${t.legOverall}:${t.playerId}`;
    legDarts.set(lk, (legDarts.get(lk) || 0) + counted.length);
    if (counted.some((d) => d.checkout)) legsWonDarts.push(lk);
  }
  const bestLeg = legsWonDarts.length ? Math.min(...legsWonDarts.map((k) => legDarts.get(k))) : null;
  return {
    turns: turns.length,
    darts,
    average: darts ? (points / darts) * 3 : 0,
    first9: first9Darts ? (first9Points / first9Darts) * 3 : 0,
    highest,
    c180,
    c140,
    c100,
    busts,
    checkoutAttempts,
    checkouts,
    checkoutRate: checkoutAttempts ? checkouts / checkoutAttempts : 0,
    highestCheckout,
    bestLeg,
    legsWon: legsWonDarts.length,
    matches: new Set(x01.map((r) => r.matchId)).size,
  };
}

/** Wurfzeilen zu Aufnahmen bündeln. */
export function groupTurns(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = `${r.matchId}:${r.legOverall}:${r.turn}:${r.playerId}`;
    let t = map.get(k);
    if (!t) {
      t = { matchId: r.matchId, legOverall: r.legOverall, turn: r.turn, playerId: r.playerId, points: r.turnPoints, marks: r.turnMarks, bust: r.turnBust, restBefore: r.restBefore, ts: r.ts, darts: [] };
      map.set(k, t);
    }
    if (r.dart === 1) t.restBefore = r.restBefore;
    t.darts.push(r);
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

/** Erkennungs-Qualität: Anteil der Kamera-Darts, die nicht korrigiert wurden. */
export function detectionStats(rows) {
  const cam = rows.filter((r) => r.source === 'camera' || (r.source === 'corrected' && r.correctedFromCamera));
  const corrected = cam.filter((r) => r.source === 'corrected').length;
  return { total: cam.length, corrected, rate: cam.length ? 1 - corrected / cam.length : null };
}

/** Kurzer Text „20, 5, 0 = 25“ für eine Aufnahme. */
export function turnSummary(labels, points, bust) {
  return `${labels.join(', ')} = ${bust ? 'Überworfen' : points}`;
}

/** Cricket-Kennzahlen eines Spielers: Marks pro Runde (MPR), beste Runde, 5- bis 9-Mark-Runden. */
export function cricketStats(rows) {
  const turns = groupTurns(rows.filter((r) => r.mode === 'cricket'));
  let marks = 0;
  let best = 0;
  let m5 = 0;
  let darts = 0;
  for (const t of turns) {
    const n = t.marks || 0;
    marks += n;
    darts += t.darts.filter((d) => d.counted).length;
    if (n > best) best = n;
    if (n >= 5) m5++;
  }
  return {
    turns: turns.length,
    darts,
    marks,
    // MPR = Marks pro 3 Darts (übliche Definition). Eine Siegrunde mit nur 1 Dart zählt so als Drittel-Runde.
    mpr: darts ? marks / (darts / 3) : 0,
    bestRound: best,
    rounds5: m5,
    matches: new Set(turns.map((t) => t.matchId)).size,
  };
}

/** Schlüssel für Rekorde: Modus plus Variante (z. B. „Around the Clock · nur Doubles“). */
export function trainingKey(mode, options) {
  try { return `${mode.id}|${mode.describe(options)}`; } catch { return `${mode.id}|`; }
}

/**
 * Trainings-Ergebnisse eines Spielers aus gespeicherten Matches (nur beendete), neueste zuerst.
 * Rückgabe je trainingKey: { count, best, last, recent[] } mit Einträgen { value, text, at }.
 */
export function trainingRecords(matches, playerId, getMode) {
  const out = {};
  const mine = matches
    .filter((m) => m.status === 'finished' && m.result && m.players.length === 1 && m.players[0] === playerId)
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const m of mine) {
    let key;
    try { key = trainingKey(getMode(m.mode), m.options); } catch { continue; } // unbekannter Modus
    const better = m.result.better;
    const e = { value: m.result.value, text: m.result.text, at: m.createdAt, matchId: m.id, mode: m.mode, options: m.options };
    const r = out[key] || (out[key] = { count: 0, best: null, last: e, recent: [] });
    r.count++;
    if (r.recent.length < 10) r.recent.push(e);
    if (!r.best || (better === 'low' ? e.value < r.best.value : e.value > r.best.value)) r.best = e;
  }
  return out;
}

/**
 * Trefferquote je Doppel (X01): Jeder Dart, der bei einem Ein-Dart-Finish geworfen wurde
 * (Rest 2–40 gerade oder 50), ist ein Versuch auf dieses Doppel. Summen-Eingaben zählen nur, wenn
 * eindeutig ist, auf welches Doppel geworfen wurde (z. B. Rest 40, kein Punkt, 3 Darts aufs Doppel).
 * Ergebnis: [{ target: 'D16', attempts, hits, rate }], meistgeworfenes zuerst.
 */
export function doubleStats(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.mode !== 'x01' || !r.counted || !r.onFinish) continue;
    // Summen-Eingabe: nur wenn eindeutig ist, auf welches Doppel geworfen wurde (siehe throwRows)
    if (r.fromTotal ? !r.doubleTarget : r.segment == null) continue;
    const target = r.fromTotal ? r.doubleTarget : r.restBefore === 50 ? 'BULL' : `D${r.restBefore / 2}`;
    const e = map.get(target) || { target, attempts: 0, hits: 0 };
    e.attempts++;
    if (r.checkout) e.hits++;
    map.set(target, e);
  }
  return [...map.values()]
    .map((e) => ({ ...e, rate: e.hits / e.attempts }))
    .sort((a, b) => b.attempts - a.attempts || b.rate - a.rate);
}

// ---------------------------------------------------------------------------
// Rekorde, Meilensteine und Ränge (nur echte Matches übergeben, ohne Computer)
// ---------------------------------------------------------------------------

function byMatch(rows) {
  const map = new Map();
  for (const r of rows) (map.get(r.matchId) || map.set(r.matchId, []).get(r.matchId)).push(r);
  return map;
}

// ---------- Bestwerte mit Treppchen (Platz 1–3) ----------

/** Persönliche Bestwerte je Match. places = Bezeichnung für Platz 1, 2, 3 („Zweitbester Average“). */
export const RECORD_DEFS = [
  { key: 'avg', label: 'Bester Average', places: ['Bester Average', 'Zweitbester Average', 'Drittbester Average'] },
  { key: 'first9', label: 'Bester First-9-Average', places: ['Bester First-9-Average', 'Zweitbester First-9-Average', 'Drittbester First-9-Average'] },
  { key: 'bestLeg', label: 'Bestes Leg', better: 'low', places: ['Bestes Leg', 'Zweitbestes Leg', 'Drittbestes Leg'] },
  { key: 'checkout', label: 'Höchstes Finish', places: ['Höchstes Finish', 'Zweithöchstes Finish', 'Dritthöchstes Finish'] },
  { key: 'visit', label: 'Höchste Aufnahme', places: ['Höchste Aufnahme', 'Zweithöchste Aufnahme', 'Dritthöchste Aufnahme'] },
  { key: 'c180', label: 'Meiste 180er (Match)', places: ['Meiste 180er in einem Match', 'Zweitmeiste 180er in einem Match', 'Drittmeiste 180er in einem Match'] },
  { key: 'mpr', label: 'Cricket: beste MPR', places: ['Beste Cricket-MPR', 'Zweitbeste Cricket-MPR', 'Drittbeste Cricket-MPR'] },
  { key: 'round', label: 'Cricket: beste Runde', places: ['Beste Cricket-Runde', 'Zweitbeste Cricket-Runde', 'Drittbeste Cricket-Runde'] },
];
export const MEDALS = ['🥇', '🥈', '🥉'];

/** Werte eines Matches für die Bestwerte: [key, value, text]. */
function matchRecordValues(m, rs) {
  const out = [];
  if (m.mode === 'x01') {
    const s = playerStats(rs);
    if (s.darts >= 9) out.push(['avg', s.average, s.average.toFixed(2)], ['first9', s.first9, s.first9.toFixed(2)]);
    if (s.bestLeg) out.push(['bestLeg', s.bestLeg, `${s.bestLeg} Darts`]);
    if (s.highestCheckout) out.push(['checkout', s.highestCheckout, String(s.highestCheckout)]);
    if (s.highest) out.push(['visit', s.highest, String(s.highest)]);
    if (s.c180) out.push(['c180', s.c180, `${s.c180}×`]);
  } else if (m.mode === 'cricket') {
    const c = cricketStats(rs);
    if (c.turns >= 3) out.push(['mpr', c.mpr, c.mpr.toFixed(2)]);
    if (c.bestRound) out.push(['round', c.bestRound, `${c.bestRound} Marks`]);
  }
  return out;
}

/** Listen je Bestwert sortieren: bester zuerst, bei Gleichstand der frühere. */
function sortLists(lists) {
  for (const def of RECORD_DEFS) {
    const low = def.better === 'low';
    if (lists[def.key]) lists[def.key].sort((a, b) => (low ? a.value - b.value : b.value - a.value) || a.at - b.at);
  }
  return lists;
}

/** Alle Match-Werte eines Spielers je Bestwert, bester zuerst. */
function recordLists(rows, matches, playerId) {
  const meta = new Map(matches.map((m) => [m.id, m]));
  const lists = {};
  for (const [mid, rs] of byMatch(rows.filter((r) => r.playerId === playerId))) {
    const m = meta.get(mid);
    if (!m) continue;
    const me = m.players.indexOf(playerId);
    const opponents = m.playerNames.filter((_, i) => i !== me);
    for (const [key, value, text] of matchRecordValues(m, rs)) {
      (lists[key] || (lists[key] = [])).push({ value, text, at: m.createdAt, matchId: m.id, mode: m.mode, opponents, playerId, name: m.playerNames[me] });
    }
  }
  return sortLists(lists);
}

/** Alle Match-Werte aller Spieler je Bestwert (für die Bestenliste), bester zuerst. */
function globalLists(rows, matches) {
  const lists = {};
  for (const id of new Set(rows.map((r) => r.playerId))) {
    for (const [k, l] of Object.entries(recordLists(rows, matches, id))) (lists[k] || (lists[k] = [])).push(...l);
  }
  return sortLists(lists);
}

const top = (lists, n) => Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, l.slice(0, n)]));

/** Treppchen je Bestwert: { key: [Platz 1, Platz 2, Platz 3] } mit { value, text, at, matchId, mode, opponents, name }. */
export function personalPodiums(rows, matches, playerId, n = 3) {
  return top(recordLists(rows, matches, playerId), n);
}

/** Bestenliste über alle Spieler: wie personalPodiums, Einträge mit playerId und name. */
export function allPlayersPodiums(rows, matches, n = 3) {
  return top(globalLists(rows, matches), n);
}

/** Persönliche Bestwerte (nur Platz 1): { key: { value, text, at, matchId, mode, opponents } }. */
export function personalRecords(rows, matches, playerId) {
  return Object.fromEntries(Object.entries(personalPodiums(rows, matches, playerId, 1)).map(([k, l]) => [k, l[0]]));
}

/**
 * Plätze auf dem Treppchen, die ein Match erreicht hat. Nur wenn das Match auch etwas hinter
 * sich lässt – das erste Match ist nicht automatisch „Bestwert“.
 * Ergebnis: [{ def, place (0–2), entry, best (bisheriger bzw. aktueller Rekord) }]
 */
function placesIn(lists, matchId, playerId = null) {
  const out = [];
  for (const def of RECORD_DEFS) {
    const list = lists[def.key] || [];
    list.forEach((entry, place) => {
      if (entry.matchId !== matchId || place > 2 || list.length < place + 2) return;
      if (playerId && entry.playerId !== playerId) return;
      out.push({ def, place, entry, best: list.find((e) => e.matchId !== matchId) });
    });
  }
  return out;
}

/** Persönliches Treppchen eines Spielers in diesem Match („Zweitbester Average ever“). */
export function matchPlaces(rows, matches, playerId, matchId) {
  return placesIn(recordLists(rows, matches, playerId), matchId);
}

/** Bestenliste aller Spieler: Plätze, die in diesem Match erreicht wurden (entry.name = wer). */
export function globalMatchPlaces(rows, matches, matchId) {
  return placesIn(globalLists(rows, matches), matchId);
}

// ---------- Meilensteine ----------

/** Die 8 Kategorien der Meilensteine (Reihenfolge = Anzeige). */
export const MILESTONE_CATEGORIES = [
  { id: 'quick', icon: '⌨️', title: 'Schnelltasten-Scores', note: 'Genau diese Punkte in einer Aufnahme: 26, 41, 45, 60, 85, 100, 140, 180' },
  { id: 'scoring', icon: '💥', title: 'Scoring', note: '100+, 140+, Serien und starke Matches' },
  { id: 'finish', icon: '🏁', title: 'Finishes', note: 'Checkouts, hohe Finishes, Doppel-Sammlung' },
  { id: 'legs', icon: '⚡', title: 'Legs', note: 'Gewonnene Legs und schnelle Legs' },
  { id: 'avg', icon: '📈', title: 'Average', note: 'Match-Average, First 9 und Gesamt-Average' },
  { id: 'wins', icon: '🥇', title: 'Siege & Matches', note: 'Siege, Serien, Gegner' },
  { id: 'cricket', icon: '🏏', title: 'Cricket', note: 'MPR, Mark-Runden, Siege' },
  { id: 'grind', icon: '🎳', title: 'Fleiß & Kurioses', note: 'Darts, Spieltage, Trainings und Kuriositäten' },
];

const fmt = (n) => n.toLocaleString('de-DE');
const one = (cat, id, icon, title, test) => ({ cat, id, icon, title, test });
const count = (cat, id, icon, title, get, goal) => ({ cat, id, icon, title, test: (s) => get(s) >= goal, progress: (s) => [Math.min(get(s), goal), goal] });
const tiers = (cat, prefix, icon, get, goals, title) => goals.map((g) => count(cat, `${prefix}-${g}`, icon, title(g), get, g));

// Schnelltasten der Summen-Eingabe (siehe ui/screens/game.js), mit den üblichen Darts-Namen
const QUICK = [
  [26, '🛏️', 'Bed & Breakfast'], [41, '🔹', ''], [45, '🥜', "Bag o' Nuts"], [60, '🎯', 'Sixty'],
  [85, '🔸', ''], [100, '💯', 'Ton'], [140, '🔥', 'Ton-40'], [180, '🚀', 'Maximum'],
];
const QUICK_TIERS = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const ALL_DOUBLES = 21; // D1–D20 und Bull

/** Alle Meilensteine; progress liefert [erreicht, Ziel] für die Anzeige. */
export const MILESTONES = [
  // Schnelltasten-Scores (die 180 behält ihre alten Kennungen 180-1, 180-10 …)
  ...QUICK.flatMap(([n, icon, nick]) => (n === 180 ? [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] : QUICK_TIERS).map((g) =>
    count('quick', n === 180 ? `180-${g}` : `s${n}-${g}`, icon,
      g === 1 ? `Erste ${n}${nick ? ` – ${nick}` : ''}` : `${fmt(g)}× ${n}`, (s) => s.exact[n] || 0, g))),

  // Scoring
  ...tiers('scoring', 'ton', '💯', (s) => s.ton, [1, 10, 50, 100, 250, 500, 1000], (g) => (g === 1 ? 'Erste Aufnahme 100+' : `${fmt(g)}× 100+`)),
  ...tiers('scoring', 't40', '🔥', (s) => s.t40, [1, 10, 50, 100, 250], (g) => (g === 1 ? 'Erste Aufnahme 140+' : `${fmt(g)}× 140+`)),
  one('scoring', 'tonrow-2', '🔁', 'Zwei 100+ in Folge', (s) => s.maxTonRow >= 2),
  one('scoring', 'tonrow-3', '🔁', 'Drei 100+ in Folge', (s) => s.maxTonRow >= 3),
  one('scoring', 'tonrow-5', '🔁', 'Fünf 100+ in Folge', (s) => s.maxTonRow >= 5),
  one('scoring', 'tonmatch-5', '📦', '5× 100+ in einem Match', (s) => s.bestTonMatch >= 5),
  one('scoring', 'tonmatch-10', '📦', '10× 100+ in einem Match', (s) => s.bestTonMatch >= 10),
  one('scoring', '180match-2', '🚀', 'Zwei 180er in einem Match', (s) => s.best180Match >= 2),
  one('scoring', '180match-3', '🚀', 'Drei 180er in einem Match', (s) => s.best180Match >= 3),

  // Finishes
  ...tiers('finish', 'co-n', '✅', (s) => s.checkouts, [1, 10, 25, 50, 100, 250, 500, 1000], (g) => (g === 1 ? 'Erstes Checkout' : `${fmt(g)} Checkouts`)),
  one('finish', 'co-50', '🏁', 'Finish 50+', (s) => s.bestCheckout >= 50),
  one('finish', 'co-80', '🏁', 'Finish 80+', (s) => s.bestCheckout >= 80),
  one('finish', 'co-100', '💯', 'Ton-Finish (100+)', (s) => s.bestCheckout >= 100),
  one('finish', 'co-121', '🔥', 'Finish 121+', (s) => s.bestCheckout >= 121),
  one('finish', 'co-150', '🔥', 'Finish 150+', (s) => s.bestCheckout >= 150),
  one('finish', 'co-161', '🔥', 'Finish 161+', (s) => s.bestCheckout >= 161),
  one('finish', 'co-170', '🐟', 'Big Fish (170)', (s) => s.bestCheckout >= 170),
  one('finish', 'bull', '🐂', 'Bull-Finish', (s) => s.bullFinishes >= 1),
  count('finish', 'bull-10', '🐂', '10 Bull-Finishes', (s) => s.bullFinishes, 10),
  one('finish', 'madhouse', '🏚️', 'Madhouse – Finish auf D1', (s) => s.madhouse >= 1),
  count('finish', 'madhouse-10', '🏚️', '10× Madhouse', (s) => s.madhouse, 10),
  one('finish', 'tops-1', '🔝', 'Finish auf Tops (D20)', (s) => s.tops >= 1),
  count('finish', 'tops-25', '🔝', '25× auf Tops gecheckt', (s) => s.tops, 25),
  count('finish', 'tops-100', '🔝', '100× auf Tops gecheckt', (s) => s.tops, 100),
  count('finish', 'dbl-5', '🎨', 'Auf 5 verschiedenen Doppeln gecheckt', (s) => s.doubles.size, 5),
  count('finish', 'dbl-10', '🎨', 'Auf 10 verschiedenen Doppeln gecheckt', (s) => s.doubles.size, 10),
  count('finish', 'dbl-15', '🎨', 'Auf 15 verschiedenen Doppeln gecheckt', (s) => s.doubles.size, 15),
  count('finish', 'dbl-all', '🌈', 'Doppel-Sammler: alle 21 Doppel (mit Bull)', (s) => s.doubles.size, ALL_DOUBLES),
  one('finish', 'co-rate-50', '🎯', 'Checkout-Quote 50 %+ im Match (ab 4 Darts aufs Doppel)', (s) => s.bestCoRate4 >= 0.5),
  one('finish', 'co-rate-100', '🎯', 'Checkout-Quote 100 % im Match (ab 3 Darts aufs Doppel)', (s) => s.bestCoRate3 >= 1),

  // Legs
  ...tiers('legs', 'legs', '🏳️', (s) => s.legsWon, [1, 10, 25, 50, 100, 250, 500], (g) => (g === 1 ? 'Erstes Leg gewonnen' : `${fmt(g)} Legs gewonnen`)),
  ...[30, 27, 24, 21, 18, 15, 12, 11, 10].map((n) => one('legs', `leg-${n}`, '⚡', `Leg in ${n} Darts`, (s) => s.bestLeg <= n)),
  one('legs', 'leg-9', '👑', '9-Darter', (s) => s.bestLeg <= 9),

  // Average
  ...[30, 40, 50, 60, 70, 80, 90].map((n) => one('avg', `avg-${n}`, '📈', `Match-Average ${n}+`, (s) => s.bestAvg >= n)),
  one('avg', 'avg-100', '🏆', 'Ton-Average (100+)', (s) => s.bestAvg >= 100),
  ...[60, 80, 100, 120].map((n) => one('avg', `f9-${n}`, '🚦', `First-9-Average ${n}+ im Match`, (s) => s.bestFirst9 >= n)),
  ...[40, 50, 60, 70, 80].map((n) => one('avg', `life-${n}`, '📊', `Gesamt-Average ${n}+ (ab 300 Darts)`, (s) => s.lifeAvg >= n)),

  // Siege & Matches (alle Spielarten mit mindestens 2 Spielern)
  ...tiers('wins', 'win', '🥇', (s) => s.wins, [1, 5, 10, 25, 50, 100, 250], (g) => (g === 1 ? 'Erster Sieg' : `${fmt(g)} Matches gewonnen`)),
  ...tiers('wins', 'played', '🎟️', (s) => s.played, [1, 10, 50, 100, 250, 500], (g) => (g === 1 ? 'Erstes Match' : `${fmt(g)} Matches gespielt`)),
  ...[3, 5, 10].map((n) => count('wins', `streak-${n}`, '🔥', `${n} Siege in Folge`, (s) => s.bestStreak, n)),
  one('wins', 'ww', '🧹', 'Zu-Null-Sieg (ab 2 Legs, Gegner ohne Leg)', (s) => s.whitewash),
  one('wins', 'sets', '🎾', 'Match über Sätze gewonnen', (s) => s.setsWin),
  one('wins', 'big', '👥', 'Sieg gegen 3 oder mehr Gegner', (s) => s.bigWin),
  ...[3, 5, 10].map((n) => count('wins', `opp-${n}`, '🤝', `Gegen ${n} verschiedene Gegner gespielt`, (s) => s.opponents.size, n)),

  // Cricket
  ...tiers('cricket', 'cwin', '🏏', (s) => s.cricketWins, [1, 10, 25, 50], (g) => (g === 1 ? 'Erster Cricket-Sieg' : `${fmt(g)} Cricket-Siege`)),
  one('cricket', 'mpr-15', '🏏', 'MPR 1,5+ im Match', (s) => s.bestMpr >= 1.5),
  one('cricket', 'mpr-2', '🏏', 'MPR 2,0+ im Match', (s) => s.bestMpr >= 2),
  one('cricket', 'mpr-25', '🏏', 'MPR 2,5+ im Match', (s) => s.bestMpr >= 2.5),
  one('cricket', 'mpr-3', '🏏', 'MPR 3,0+ im Match', (s) => s.bestMpr >= 3),
  one('cricket', 'mpr-4', '🏏', 'MPR 4,0+ im Match', (s) => s.bestMpr >= 4),
  ...[5, 6, 7, 8, 9].map((n) => one('cricket', `round-${n}`, n === 9 ? '🐴' : '✖️', `${n}-Mark-Runde`, (s) => s.bestRound >= n)),
  ...tiers('cricket', 'marks', '✖️', (s) => s.marks, [100, 500, 1000, 5000], (g) => `${fmt(g)} Marks`),
  ...tiers('cricket', 'r5', '✋', (s) => s.rounds5, [10, 50], (g) => `${g} Runden mit 5+ Marks`),

  // Fleiß & Kurioses
  ...[[1000, '1k'], [5000, '5k'], [10000, '10k'], [25000, '25k'], [50000, '50k'], [100000, '100k']]
    .map(([g, k]) => count('grind', `darts-${k}`, '🎳', `${fmt(g)} Darts geworfen`, (s) => s.darts, g)),
  ...tiers('grind', 'days', '📅', (s) => s.days.size, [3, 10, 30, 100], (g) => `An ${g} Tagen gespielt`),
  ...[5, 10].map((n) => count('grind', `day-${n}`, '☕', `${n} Spiele an einem Tag`, (s) => s.maxPerDay, n)),
  ...tiers('grind', 'train', '🏋️', (s) => s.trainings, [1, 10, 50, 100, 250], (g) => (g === 1 ? 'Erstes Training' : `${fmt(g)} Trainings`)),
  one('grind', 'night', '🦉', 'Nachteule: Spiel zwischen 0 und 4 Uhr', (s) => s.night),
  one('grind', 'bed', '🛌', 'Three in a Bed (3 Darts im selben Feld)', (s) => s.bed >= 1),
  count('grind', 'bed-10', '🛌', '10× Three in a Bed', (s) => s.bed, 10),
  one('grind', 'bust-1', '💣', 'Zum ersten Mal überworfen', (s) => s.busts >= 1),
  count('grind', 'bust-50', '💣', '50× überworfen', (s) => s.busts, 50),
  one('grind', 'zero-1', '🥚', 'Erste Null-Aufnahme', (s) => s.zeros >= 1),
  count('grind', 'zero-25', '🥚', '25× kein Punkt', (s) => s.zeros, 25),
];

/** Auf welches Doppel wurde ausgecheckt? 'D16', 'BULL' oder null (bei Summen-Eingabe nicht immer bekannt). */
function finishDouble(r) {
  if (r.segment != null) return r.segment === 25 ? 'BULL' : `D${r.segment}`;
  if (r.doubleTarget) return r.doubleTarget;
  // Summe: mit dem ersten Dart ausgecheckt, oder Rest 2 (geht nur über D1)
  if (r.dart === 1 || r.restBefore === 2) return r.restBefore === 50 ? 'BULL' : `D${r.restBefore / 2}`;
  return null;
}

const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/**
 * Meilensteine eines Spielers: Matches werden der Zeit nach durchgegangen,
 * so steht bei jedem erreichten Meilenstein das Datum des Matches, in dem er fiel.
 * Ergebnis: [{ ...Meilenstein, at (Zeitpunkt oder null), progress ([ist, Ziel] oder null) }]
 */
export function milestones(rows, matches, playerId) {
  const s = {
    darts: 0, exact: {}, ton: 0, t40: 0, maxTonRow: 0, bestTonMatch: 0, best180Match: 0,
    checkouts: 0, bestCheckout: 0, bullFinishes: 0, madhouse: 0, tops: 0, doubles: new Set(), bestCoRate3: 0, bestCoRate4: 0,
    legsWon: 0, bestLeg: Infinity, bestAvg: 0, bestFirst9: 0, x01Points: 0, x01Darts: 0, lifeAvg: 0,
    wins: 0, played: 0, streak: 0, bestStreak: 0, whitewash: false, setsWin: false, bigWin: false, opponents: new Set(),
    cricketWins: 0, bestMpr: 0, bestRound: 0, marks: 0, rounds5: 0,
    days: new Set(), maxPerDay: 0, trainings: 0, night: false, bed: 0, busts: 0, zeros: 0,
  };
  const perDay = new Map();
  const reached = {};
  const mine = byMatch(rows.filter((r) => r.playerId === playerId));
  for (const m of matches.slice().sort((a, b) => a.createdAt - b.createdAt)) {
    const rs = mine.get(m.id);
    if (!rs) continue;
    const me = m.players.indexOf(playerId);
    if (m.status === 'finished') {
      const day = dayKey(m.createdAt);
      s.days.add(day);
      perDay.set(day, (perDay.get(day) || 0) + 1);
      s.maxPerDay = Math.max(s.maxPerDay, perDay.get(day));
      const hour = new Date(m.createdAt).getHours();
      if (hour < 4) s.night = true;
      if (m.players.length === 1) s.trainings++;
      else {
        s.played++;
        m.players.forEach((id, i) => { if (i !== me) s.opponents.add(id); });
        if (m.winner != null && m.winner === me) {
          s.wins++;
          s.streak++;
          if (m.mode === 'cricket') s.cricketWins++;
          if (m.format && m.format.setsBestOf > 1) s.setsWin = true;
          if (m.players.length >= 4) s.bigWin = true;
          try {
            const st = derive(m);
            if (st.legsWon[me] >= 2 && st.legsWon.every((n, i) => i === me || n === 0) && (m.format?.setsBestOf || 1) === 1) s.whitewash = true;
          } catch { /* unbekannter Modus */ }
        } else s.streak = 0;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
      }
    }
    if (m.mode === 'x01') {
      const p = playerStats(rs);
      s.darts += p.darts;
      s.x01Points += (p.average * p.darts) / 3;
      s.x01Darts += p.darts;
      s.lifeAvg = s.x01Darts >= 300 ? (s.x01Points / s.x01Darts) * 3 : 0;
      s.bestCheckout = Math.max(s.bestCheckout, p.highestCheckout);
      s.legsWon += p.legsWon;
      if (p.bestLeg) s.bestLeg = Math.min(s.bestLeg, p.bestLeg);
      if (p.darts >= 9) { s.bestAvg = Math.max(s.bestAvg, p.average); s.bestFirst9 = Math.max(s.bestFirst9, p.first9); }
      if (p.checkoutAttempts >= 3) s.bestCoRate3 = Math.max(s.bestCoRate3, p.checkoutRate);
      if (p.checkoutAttempts >= 4) s.bestCoRate4 = Math.max(s.bestCoRate4, p.checkoutRate);
      s.best180Match = Math.max(s.best180Match, p.c180);
      let tonRow = 0;
      let tons = 0;
      for (const t of groupTurns(rs).sort((a, b) => a.legOverall - b.legOverall || a.turn - b.turn)) {
        if (t.bust) { s.busts++; tonRow = 0; continue; }
        s.exact[t.points] = (s.exact[t.points] || 0) + 1;
        if (t.points === 0) s.zeros++;
        if (t.points >= 140) s.t40++;
        if (t.points >= 100) { s.ton++; tons++; tonRow++; s.maxTonRow = Math.max(s.maxTonRow, tonRow); } else tonRow = 0;
        const ds = t.darts.filter((d) => d.counted);
        if (ds.length === 3 && ds[0].segment > 0 && ds.every((d) => d.segment === ds[0].segment && d.multiplier === ds[0].multiplier)) s.bed++;
      }
      s.bestTonMatch = Math.max(s.bestTonMatch, tons);
      for (const r of rs) {
        if (!r.checkout) continue;
        s.checkouts++;
        const dbl = finishDouble(r);
        if (!dbl) continue;
        s.doubles.add(dbl);
        if (dbl === 'BULL') s.bullFinishes++;
        if (dbl === 'D1') s.madhouse++;
        if (dbl === 'D20') s.tops++;
      }
    } else if (m.mode === 'cricket') {
      const c = cricketStats(rs);
      s.darts += c.darts;
      s.marks += c.marks;
      s.rounds5 += c.rounds5;
      if (c.turns >= 3) s.bestMpr = Math.max(s.bestMpr, c.mpr);
      s.bestRound = Math.max(s.bestRound, c.bestRound);
    } else {
      s.darts += rs.filter((r) => r.counted !== false).length; // Trainings und Party-Spiele
    }
    for (const d of MILESTONES) if (!reached[d.id] && d.test(s)) reached[d.id] = m.createdAt;
  }
  return MILESTONES.map((d) => ({ ...d, at: reached[d.id] || null, progress: d.progress ? d.progress(s) : null }));
}

// ---------- Ränge ----------

/** Rang nach Anzahl erreichter Meilensteine – vom Neuling bis zum Master. */
export const RANKS = [
  ['🐣', 'Darts-Neuling', 0], ['🌱', 'Frischling', 3], ['🎯', 'Anfänger', 6], ['🎲', 'Gelegenheitswerfer', 10],
  ['🍺', 'Kneipenwerfer', 15], ['🍻', 'Stammtisch-Ass', 21], ['🏠', 'Hobbyspieler', 28], ['🌙', 'Feierabend-Profi', 36],
  ['🛡️', 'Vereinsspieler', 45], ['🎽', 'Mannschaftsführer', 55], ['🏅', 'Ligaspieler', 66], ['🥉', 'Bezirksmeister', 78],
  ['🥈', 'Landesmeister', 91], ['🏟️', 'Turnierspieler', 105], ['🎫', 'Tour-Card-Anwärter', 120], ['💎', 'Profi', 135],
  ['🌍', 'Weltranglisten-Spieler', 150], ['⭐', 'Weltklasse', 166], ['🏆', 'Weltmeister', 183], ['👑', 'Darts-Master', 200],
].map(([icon, title, min], i, all) => ({
  min, icon, title,
  // Farbe wandert über den Farbkreis; Neuling grau, Master gold
  color: i === 0 ? '#8a8f98' : i === all.length - 1 ? '#f5c542' : `hsl(${(190 + i * 19) % 360} 65% 60%)`,
}));

/** Rang zu einer Anzahl Meilensteine: Index in RANKS. */
export function rankIndex(done) {
  let i = 0;
  while (i + 1 < RANKS.length && done >= RANKS[i + 1].min) i++;
  return i;
}

/**
 * Rang und Zeitstrahl aus dem Ergebnis von milestones():
 * { index, rank, next, done, total, timeline: [{ ...Rang, at (erreicht am) oder null }] }
 */
export function playerRank(ms) {
  const dates = ms.filter((m) => m.at).map((m) => m.at).sort((a, b) => a - b);
  const index = rankIndex(dates.length);
  return {
    index,
    rank: RANKS[index],
    next: RANKS[index + 1] || null,
    done: dates.length,
    total: ms.length,
    timeline: RANKS.map((r) => ({ ...r, at: r.min === 0 ? (dates[0] || null) : (dates[r.min - 1] || null) })),
  };
}

// Statistiken aus der einheitlichen Wurfliste (throwRows).
// Funktioniert für alle gespeicherten Würfe, auch rückwirkend.

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
// Rekorde und Meilensteine (nur echte Matches übergeben, ohne Computer)
// ---------------------------------------------------------------------------

function byMatch(rows) {
  const map = new Map();
  for (const r of rows) (map.get(r.matchId) || map.set(r.matchId, []).get(r.matchId)).push(r);
  return map;
}

/**
 * Persönliche Bestwerte je Match: { key: { value, text, at, matchId, mode, opponents } }.
 * key: avg, bestLeg, checkout, visit, c180 (X01) · mpr, round (Cricket).
 */
export function personalRecords(rows, matches, playerId) {
  const meta = new Map(matches.map((m) => [m.id, m]));
  const out = {};
  const consider = (key, value, better, text, m) => {
    const cur = out[key];
    if (cur && (better === 'low' ? value >= cur.value : value <= cur.value)) return;
    const opponents = m.playerNames.filter((_, i) => m.players[i] !== playerId);
    out[key] = { value, text, at: m.createdAt, matchId: m.id, mode: m.mode, opponents };
  };
  for (const [mid, rs] of byMatch(rows.filter((r) => r.playerId === playerId))) {
    const m = meta.get(mid);
    if (!m) continue;
    if (m.mode === 'x01') {
      const s = playerStats(rs);
      if (s.darts >= 9) consider('avg', s.average, 'high', s.average.toFixed(2), m);
      if (s.bestLeg) consider('bestLeg', s.bestLeg, 'low', `${s.bestLeg} Darts`, m);
      if (s.highestCheckout) consider('checkout', s.highestCheckout, 'high', String(s.highestCheckout), m);
      if (s.highest) consider('visit', s.highest, 'high', String(s.highest), m);
      if (s.c180) consider('c180', s.c180, 'high', `${s.c180}×`, m);
    } else if (m.mode === 'cricket') {
      const c = cricketStats(rs);
      if (c.turns >= 3) consider('mpr', c.mpr, 'high', c.mpr.toFixed(2), m);
      if (c.bestRound) consider('round', c.bestRound, 'high', `${c.bestRound} Marks`, m);
    }
  }
  return out;
}

const fmt = (n) => n.toLocaleString('de-DE');
const count = (id, icon, title, field, goal) => ({ id, icon, title, test: (s) => s[field] >= goal, progress: (s) => [Math.min(s[field], goal), goal] });

/** Meilensteine der Reihe nach; progress liefert [erreicht, Ziel] für die Anzeige. */
export const MILESTONES = [
  count('180-1', '🎯', 'Erste 180', 'c180', 1),
  count('180-10', '🎯', '10× 180', 'c180', 10),
  count('180-50', '🎯', '50× 180', 'c180', 50),
  count('180-100', '🎯', '100× 180', 'c180', 100),
  { id: 'co-100', icon: '💯', title: 'Ton-Finish (100+)', test: (s) => s.bestCheckout >= 100 },
  { id: 'co-150', icon: '🔥', title: 'Finish 150+', test: (s) => s.bestCheckout >= 150 },
  { id: 'co-170', icon: '🐟', title: 'Big Fish (170)', test: (s) => s.bestCheckout >= 170 },
  { id: 'bull', icon: '🐂', title: 'Bull-Finish', test: (s) => s.bullFinish },
  { id: 'leg-18', icon: '⚡', title: 'Leg in 18 Darts', test: (s) => s.bestLeg <= 18 },
  { id: 'leg-15', icon: '⚡', title: 'Leg in 15 Darts', test: (s) => s.bestLeg <= 15 },
  { id: 'leg-12', icon: '⚡', title: 'Leg in 12 Darts', test: (s) => s.bestLeg <= 12 },
  { id: 'leg-9', icon: '👑', title: '9-Darter', test: (s) => s.bestLeg <= 9 },
  { id: 'avg-50', icon: '📈', title: 'Match-Average 50+', test: (s) => s.bestAvg >= 50 },
  { id: 'avg-60', icon: '📈', title: 'Match-Average 60+', test: (s) => s.bestAvg >= 60 },
  { id: 'avg-70', icon: '📈', title: 'Match-Average 70+', test: (s) => s.bestAvg >= 70 },
  { id: 'avg-80', icon: '📈', title: 'Match-Average 80+', test: (s) => s.bestAvg >= 80 },
  { id: 'avg-100', icon: '🏆', title: 'Ton-Average (100+)', test: (s) => s.bestAvg >= 100 },
  count('darts-1k', '🎳', `${fmt(1000)} Darts geworfen`, 'darts', 1000),
  count('darts-10k', '🎳', `${fmt(10000)} Darts geworfen`, 'darts', 10000),
  count('darts-50k', '🎳', `${fmt(50000)} Darts geworfen`, 'darts', 50000),
  count('win-1', '🥇', 'Erster Sieg', 'wins', 1),
  count('win-10', '🥇', '10 Matches gewonnen', 'wins', 10),
  count('win-50', '🥇', '50 Matches gewonnen', 'wins', 50),
  count('win-100', '🥇', '100 Matches gewonnen', 'wins', 100),
  { id: 'mpr-2', icon: '🏏', title: 'Cricket: MPR 2,0+ im Match', test: (s) => s.bestMpr >= 2 },
  { id: 'mpr-3', icon: '🏏', title: 'Cricket: MPR 3,0+ im Match', test: (s) => s.bestMpr >= 3 },
  { id: 'round-5', icon: '🏏', title: 'Cricket: 5-Mark-Runde', test: (s) => s.bestRound >= 5 },
  { id: 'round-9', icon: '🏏', title: 'Cricket: 9-Mark-Runde', test: (s) => s.bestRound >= 9 },
];

/**
 * Meilensteine eines Spielers: Matches werden der Zeit nach durchgegangen,
 * so steht bei jedem erreichten Meilenstein das Datum des Matches, in dem er fiel.
 * Ergebnis: [{ ...Meilenstein, at (Zeitpunkt oder null), progress ([ist, Ziel] oder null) }]
 */
export function milestones(rows, matches, playerId) {
  const s = { darts: 0, c180: 0, wins: 0, bestCheckout: 0, bestLeg: Infinity, bestAvg: 0, bullFinish: false, bestMpr: 0, bestRound: 0 };
  const reached = {};
  const mine = byMatch(rows.filter((r) => r.playerId === playerId));
  for (const m of matches.slice().sort((a, b) => a.createdAt - b.createdAt)) {
    const rs = mine.get(m.id);
    if (!rs) continue;
    if (m.status === 'finished' && m.winner != null && m.players[m.winner] === playerId) s.wins++;
    if (m.mode === 'x01') {
      const p = playerStats(rs);
      s.darts += p.darts;
      s.c180 += p.c180;
      s.bestCheckout = Math.max(s.bestCheckout, p.highestCheckout);
      if (p.bestLeg) s.bestLeg = Math.min(s.bestLeg, p.bestLeg);
      if (p.darts >= 9) s.bestAvg = Math.max(s.bestAvg, p.average);
      if (rs.some((r) => r.checkout && r.segment === 25 && r.multiplier === 2)) s.bullFinish = true;
    } else if (m.mode === 'cricket') {
      const c = cricketStats(rs);
      s.darts += c.darts;
      if (c.turns >= 3) s.bestMpr = Math.max(s.bestMpr, c.mpr);
      s.bestRound = Math.max(s.bestRound, c.bestRound);
    }
    for (const d of MILESTONES) if (!reached[d.id] && d.test(s)) reached[d.id] = m.createdAt;
  }
  return MILESTONES.map((d) => ({ ...d, at: reached[d.id] || null, progress: d.progress ? d.progress(s) : null }));
}

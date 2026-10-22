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

  for (const t of turns) {
    const counted = t.darts.filter((d) => d.counted);
    darts += counted.length;
    points += t.points;
    if (t.bust) busts++;
    if (t.points > highest) highest = t.points;
    if (t.points === 180) c180++;
    else if (t.points >= 140) c140++;
    else if (t.points >= 100) c100++;
    if (t.turn <= 3) { first9Points += t.points; first9Darts += counted.length; }
    for (const d of counted) {
      if (d.onFinish) checkoutAttempts++;
      if (d.checkout) {
        checkouts++;
        if (t.restBefore > highestCheckout) highestCheckout = t.restBefore;
      }
    }
    const lk = `${t.matchId}:${t.legOverall}`;
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
    mpr: turns.length ? marks / turns.length : 0,
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

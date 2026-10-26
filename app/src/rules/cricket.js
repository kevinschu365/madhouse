// Spielregeln Cricket (Standard und Cut Throat).
// Es zählen nur 15–20 und Bull. Single/Double/Triple = 1/2/3 Marks (Single Bull 1, Bullseye 2).
// Ab 3 Marks ist eine Zahl offen: weitere Marks bringen Punkte, solange ein Gegner sie noch nicht geschlossen hat.
//  Standard:   Punkte bekommt der Werfer. Gewonnen hat, wer alles geschlossen hat und mindestens gleich viele Punkte hat.
//  Cut Throat: Punkte bekommen die Gegner. Gewonnen hat, wer alles geschlossen hat und höchstens gleich viele Punkte hat.
// Eigenständiger Baustein mit derselben Schnittstelle wie X01 (siehe rules/index.js).

export const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 25];

function emptyMarks() {
  return Object.fromEntries(CRICKET_NUMBERS.map((n) => [n, 0]));
}

function allClosed(marks) {
  return CRICKET_NUMBERS.every((n) => marks[n] >= 3);
}

export const CRICKET = {
  id: 'cricket',
  label: 'Cricket',
  kind: 'match',
  dartsPerTurn: 3,
  defaultOptions: { cutThroat: false },

  describe(options) {
    return options.cutThroat ? 'Cricket · Cut Throat' : 'Cricket';
  },

  newLeg(options, playerCount) {
    return { marks: Array.from({ length: playerCount }, emptyMarks), points: Array(playerCount).fill(0) };
  },

  /**
   * Ergebnis zusätzlich zu den Feldern von X01:
   *  marks  – zählende Marks der Aufnahme (Schließen + Punkten, für MPR)
   *  after  – Leg-Zustand nach den bisherigen Darts (für die Live-Anzeige)
   *  hits   – je Dart: hat er gezählt?
   */
  evaluateTurn(options, leg, playerIdx, darts) {
    const marks = leg.marks.map((m) => ({ ...m }));
    const points = leg.points.slice();
    const others = marks.map((_, i) => i).filter((i) => i !== playerIdx);
    let used = 0;
    let turnMarks = 0;
    let turnPoints = 0;
    let finished = false;
    const hits = [];
    for (const d of darts) {
      if (finished || used >= this.dartsPerTurn) break;
      used++;
      const n = d.segment;
      if (!CRICKET_NUMBERS.includes(n) || !d.multiplier) { hits.push(false); continue; }
      const mine = marks[playerIdx];
      const toClose = Math.max(0, 3 - mine[n]);
      const closing = Math.min(d.multiplier, toClose);
      const extra = d.multiplier - closing;
      mine[n] += closing;
      const open = others.filter((o) => marks[o][n] < 3);
      let counted = closing;
      if (extra > 0 && open.length) {
        counted += extra;
        const value = extra * n;
        turnPoints += value;
        if (options.cutThroat) for (const o of open) points[o] += value;
        else points[playerIdx] += value;
      }
      turnMarks += counted;
      hits.push(counted > 0);
      if (allClosed(mine)) {
        const mineP = points[playerIdx];
        const otherP = others.map((o) => points[o]);
        finished = options.cutThroat ? otherP.every((p) => mineP <= p) : otherP.every((p) => mineP >= p);
      }
    }
    return {
      points: turnPoints,
      marks: turnMarks,
      bust: false,
      finished,
      closed: finished || used >= this.dartsPerTurn,
      usedDarts: used,
      hits,
      after: { marks, points },
      running: [],
    };
  },

  applyTurn(options, leg, playerIdx, evaluation) {
    return evaluation.after;
  },

  displayScore(leg, playerIdx) {
    return leg.points[playerIdx];
  },

  hint() {
    return null;
  },

  /** Computer-Gegner: erst die eigenen Zahlen schließen (20 abwärts, dann Bull), danach punkten, wo der Gegner offen ist. */
  botTarget(options, leg, p) {
    const aim = (n) => (n === 25 ? { segment: 25, multiplier: 2 } : { segment: n, multiplier: 3 });
    const open = CRICKET_NUMBERS.find((n) => leg.marks[p][n] < 3);
    if (open != null) return aim(open);
    const score = CRICKET_NUMBERS.find((n) => leg.marks.some((m, i) => i !== p && m[n] < 3));
    return aim(score ?? 20);
  },

  turnLabel(ev) {
    return ev.finished ? 'GAME' : `${ev.marks} M`;
  },

  /** Ansage nach der Aufnahme: Marks statt Punkte. */
  turnSpeech(options, ev, { T }) {
    if (ev.finished) return null; // Standard-Ansage „Game shot …“
    return { parts: [ev.marks ? T.marks(ev.marks) : T.noScore] };
  },
};

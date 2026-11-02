// Weitere Spiele für den Spieleabend: Count-Up, Baseball, Gotcha (2–6 Spieler) und Scram (2 Spieler).
// Eigenständige Bausteine mit derselben Schnittstelle wie X01 (siehe rules/index.js),
// Anzeige je Spieler über panel/targetText wie bei Halve-It und Killer (rules/partyGames.js).

import { dartScore } from '../core/board.js';

/** Index des Spielers mit den meisten Punkten (bei Gleichstand der erste). */
function leader(scores) {
  return scores.reduce((best, s, i) => (s > scores[best] ? i : best), 0);
}

// ---------------------------------------------------------------------------
// Count-Up: feste Zahl Runden, jeder Punkt zählt. Höchste Summe gewinnt.
// ---------------------------------------------------------------------------
export const COUNTUP = {
  id: 'countup',
  label: 'Count-Up',
  kind: 'match',
  maxPlayers: 6,
  dartsPerTurn: 3,
  defaultOptions: { rounds: 8 },

  describe(options) { return `Count-Up · ${options.rounds} Runden`; },

  newLeg(options, playerCount) {
    return { scores: Array(playerCount).fill(0), done: Array(playerCount).fill(0) };
  },

  evaluateTurn(options, leg, p, darts) {
    let used = 0;
    let points = 0;
    for (const d of darts) {
      if (used >= this.dartsPerTurn) break;
      used++;
      points += dartScore(d);
    }
    const closed = used >= this.dartsPerTurn;
    const scores = leg.scores.slice();
    const done = leg.done.slice();
    scores[p] += points;
    if (closed) done[p]++;
    const finished = closed && done.every((n) => n >= options.rounds);
    return {
      points, bust: false, finished, closed, usedDarts: used, hits: [], running: [],
      after: { scores, done }, winner: finished ? leader(scores) : undefined,
    };
  },

  applyTurn(options, leg, p, ev) { return ev.after; },
  displayScore(leg, p) { return leg.scores[p]; },
  hint() { return null; },

  panel(options, leg, p) {
    return { big: String(leg.scores[p]), sub: `Runde ${Math.min(leg.done[p] + 1, options.rounds)} / ${options.rounds}` };
  },
  targetText(options, leg, p) {
    return `Runde ${Math.min(leg.done[p] + 1, options.rounds)} / ${options.rounds} · so viele Punkte wie möglich`;
  },
  botTarget() { return { segment: 20, multiplier: 3 }; },

  turnLabel(ev) { return String(ev.points); },
  turnSpeech(options, ev, { T }) {
    if (ev.finished) return null;
    return { parts: [ev.points ? T.points(ev.points) : T.noScore] };
  },
};

// ---------------------------------------------------------------------------
// Baseball: 9 Innings, im Inning n zählt nur die Zahl n. Single = 1 Run, Double = 2, Triple = 3.
// Die meisten Runs gewinnen.
// ---------------------------------------------------------------------------
export const BASEBALL = {
  id: 'baseball',
  label: 'Baseball',
  kind: 'match',
  maxPlayers: 6,
  dartsPerTurn: 3,
  defaultOptions: { innings: 9 },

  describe(options) { return `Baseball · ${options.innings} Innings`; },

  newLeg(options, playerCount) {
    return { runs: Array(playerCount).fill(0), done: Array(playerCount).fill(0) };
  },

  evaluateTurn(options, leg, p, darts) {
    const target = Math.min(leg.done[p], options.innings - 1) + 1;
    let used = 0;
    let points = 0;
    let hitCount = 0;
    const hits = [];
    for (const d of darts) {
      if (used >= this.dartsPerTurn) break;
      used++;
      const hit = d.segment === target && d.multiplier > 0;
      hits.push(hit);
      if (hit) { hitCount++; points += d.multiplier; }
    }
    const closed = used >= this.dartsPerTurn;
    const runs = leg.runs.slice();
    const done = leg.done.slice();
    runs[p] += points;
    if (closed) done[p]++;
    const finished = closed && done.every((n) => n >= options.innings);
    return {
      points, hitCount, bust: false, finished, closed, usedDarts: used, hits, running: [],
      after: { runs, done }, winner: finished ? leader(runs) : undefined,
    };
  },

  applyTurn(options, leg, p, ev) { return ev.after; },
  displayScore(leg, p) { return leg.runs[p]; },
  hint() { return null; },

  panel(options, leg, p) {
    const inning = Math.min(leg.done[p] + 1, options.innings);
    return { big: String(leg.runs[p]), sub: `Inning ${inning} / ${options.innings} · Runs` };
  },
  targetText(options, leg, p) {
    const inning = Math.min(leg.done[p] + 1, options.innings);
    return `Inning ${inning}: Ziel ${inning} (Single 1, Double 2, Triple 3 Runs)`;
  },
  botTarget(options, leg, p) {
    return { segment: Math.min(leg.done[p], options.innings - 1) + 1, multiplier: 3 };
  },

  turnLabel(ev) { return `${ev.points} R`; },
  turnSpeech(options, ev, { T }) {
    if (ev.finished) return null;
    return { parts: [ev.points ? T.points(ev.points) : T.noScore] };
  },
};

// ---------------------------------------------------------------------------
// Gotcha: Alle zählen von 0 genau auf das Ziel (301). Landest du nach einem Dart genau auf dem
// Stand eines Gegners, fällt er auf 0 zurück. Drüber = überworfen, die Aufnahme zählt nicht.
// ---------------------------------------------------------------------------
export const GOTCHA = {
  id: 'gotcha',
  label: 'Gotcha',
  kind: 'match',
  maxPlayers: 6,
  dartsPerTurn: 3,
  defaultOptions: { target: 301 },

  describe(options) { return `Gotcha · genau ${options.target}`; },

  newLeg(options, playerCount) {
    return { scores: Array(playerCount).fill(0) };
  },

  evaluateTurn(options, leg, p, darts) {
    let scores = leg.scores.slice();
    let used = 0;
    let points = 0;
    let knocked = 0;
    let bust = false;
    let finished = false;
    const hits = [];
    for (const d of darts) {
      if (used >= this.dartsPerTurn || finished) break;
      used++;
      const v = dartScore(d);
      const s = scores[p] + v;
      if (s > options.target) { bust = true; break; }
      points += v;
      scores[p] = s;
      let hit = false;
      if (s === options.target) finished = true;
      else if (v > 0) {
        scores.forEach((o, q) => { if (q !== p && o === s) { scores[q] = 0; knocked++; hit = true; } });
      }
      hits.push(hit);
    }
    if (bust) { scores = leg.scores.slice(); knocked = 0; } // überworfen: die ganze Aufnahme zählt nicht
    const closed = bust || finished || used >= this.dartsPerTurn;
    return {
      points: bust ? 0 : points, knocked, bust, finished, closed, usedDarts: used, hits, running: [],
      after: { scores }, winner: finished ? p : undefined,
    };
  },

  applyTurn(options, leg, p, ev) { return ev.after; },
  displayScore(leg, p) { return leg.scores[p]; },
  hint() { return null; },

  panel(options, leg, p) {
    return { big: String(leg.scores[p]), sub: `noch ${options.target - leg.scores[p]}` };
  },
  targetText(options, leg, p) {
    const rest = options.target - leg.scores[p];
    const prey = leg.scores.map((s, q) => (q !== p && s > leg.scores[p] && s - leg.scores[p] <= 60 ? s - leg.scores[p] : null)).filter((x) => x != null);
    return `Rest ${rest}${prey.length ? ` · Erwischen mit ${[...new Set(prey)].sort((a, b) => a - b).join(' oder ')}` : ''}`;
  },
  botTarget(options, leg, p) {
    const rest = options.target - leg.scores[p];
    if (rest >= 60) return { segment: 20, multiplier: 3 };
    if (rest <= 20) return { segment: rest, multiplier: 1 };
    if (rest % 2 === 0 && rest <= 40) return { segment: rest / 2, multiplier: 2 };
    return { segment: Math.min(20, rest - 20), multiplier: 1 };
  },

  turnLabel(ev) { return ev.bust ? 'BUST' : ev.knocked ? `${ev.points} ✂` : String(ev.points); },
  turnSpeech(options, ev, { T }) {
    if (ev.finished) return null;
    return { parts: [ev.bust ? T.noScore : ev.points ? T.points(ev.points) : T.noScore] };
  },
};

// ---------------------------------------------------------------------------
// Scram (zu zweit): Zwei Hälften. In Hälfte 1 schließt Spieler 1 („Stopper“) die Zahlen 15–20 und Bull
// mit je einem Treffer, Spieler 2 („Scorer“) punktet auf allen noch offenen Zahlen. Sind alle zu,
// werden die Rollen getauscht. Die meisten Punkte gewinnen (Gleichstand: Spieler 1).
// ---------------------------------------------------------------------------
const SCRAM_NUMBERS = [20, 19, 18, 17, 16, 15, 25];
const scramName = (n) => (n === 25 ? 'Bull' : String(n));

export const SCRAM = {
  id: 'scram',
  label: 'Scram',
  kind: 'match',
  maxPlayers: 2,
  dartsPerTurn: 3,
  defaultOptions: {},

  describe() { return 'Scram'; },

  newLeg() {
    return { half: 0, closed: [], points: [0, 0] };
  },

  /** Wer stoppt in dieser Hälfte? */
  stopper(leg) { return leg.half === 0 ? 0 : 1; },

  evaluateTurn(options, leg, p, darts) {
    let half = leg.half;
    let closedNums = leg.closed.slice();
    const points = leg.points.slice();
    const stopper = half === 0 ? 0 : 1;
    let used = 0;
    let gained = 0;
    let shut = 0;
    let finished = false;
    let switched = false;
    const hits = [];
    for (const d of darts) {
      if (used >= this.dartsPerTurn || switched || finished) break;
      used++;
      const open = d.multiplier > 0 && SCRAM_NUMBERS.includes(d.segment) && !closedNums.includes(d.segment);
      hits.push(open);
      if (!open) continue;
      if (p === stopper) {
        closedNums.push(d.segment);
        shut++;
        if (closedNums.length === SCRAM_NUMBERS.length) {
          if (half === 0) { half = 1; closedNums = []; switched = true; } else finished = true;
        }
      } else {
        const v = dartScore(d);
        points[p] += v;
        gained += v;
      }
    }
    const closed = switched || finished || used >= this.dartsPerTurn;
    return {
      points: gained, shut, switched, bust: false, finished, closed, usedDarts: used, hits, running: [],
      after: { half, closed: closedNums, points }, winner: finished ? (points[1] > points[0] ? 1 : 0) : undefined,
    };
  },

  applyTurn(options, leg, p, ev) { return ev.after; },
  displayScore(leg, p) { return leg.points[p]; },
  hint() { return null; },

  panel(options, leg, p) {
    return { big: String(leg.points[p]), sub: `${p === this.stopper(leg) ? '🛑 Stopper' : '🎯 Scorer'} · Hälfte ${leg.half + 1} / 2` };
  },
  targetText(options, leg, p) {
    const open = SCRAM_NUMBERS.filter((n) => !leg.closed.includes(n)).map(scramName).join(' ');
    return p === this.stopper(leg) ? `Stoppen: ${open}` : `Punkten auf: ${open}`;
  },
  botTarget(options, leg, p) {
    const open = SCRAM_NUMBERS.filter((n) => !leg.closed.includes(n));
    const n = open[0] ?? 20;
    return { segment: n, multiplier: n === 25 ? 1 : 3 };
  },

  turnLabel(ev) { return ev.shut ? `${ev.shut} zu` : String(ev.points); },
  turnSpeech(options, ev, { T }) {
    if (ev.finished) return null;
    if (ev.shut) return { parts: [T.hits(ev.shut)] };
    return { parts: [ev.points ? T.points(ev.points) : T.noScore] };
  },
};

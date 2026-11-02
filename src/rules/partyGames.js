// Spiele für 2–6 Spieler: Halve-It und Killer.
// Eigenständige Bausteine mit derselben Schnittstelle wie X01 (siehe rules/index.js), zusätzlich:
//   panel(options, liveLeg, playerIdx) -> { big, sub }   Anzeige im Spielerfeld
//   targetText(options, liveLeg, playerIdx) -> Text     Ziel des Spielers, der dran ist
//   botTarget(options, leg, playerIdx, ev, dartsLeft) -> Treffer, auf den der Computer zielt

import { dartScore } from '../core/board.js';

// ---------------------------------------------------------------------------
// Halve-It: Jede Runde hat ein Ziel. Treffer aufs Ziel bringen ihre Punkte.
// Kein Treffer in der Runde: Punktestand wird halbiert (abgerundet). Am Ende gewinnt die höchste Punktzahl.
// ---------------------------------------------------------------------------
const HALVE_ROUNDS = [
  { label: '15', test: (d) => d.segment === 15, aim: { segment: 15, multiplier: 3 } },
  { label: '16', test: (d) => d.segment === 16, aim: { segment: 16, multiplier: 3 } },
  { label: 'Double', test: (d) => d.multiplier === 2, aim: { segment: 20, multiplier: 2 } },
  { label: '17', test: (d) => d.segment === 17, aim: { segment: 17, multiplier: 3 } },
  { label: '18', test: (d) => d.segment === 18, aim: { segment: 18, multiplier: 3 } },
  { label: 'Triple', test: (d) => d.multiplier === 3, aim: { segment: 20, multiplier: 3 } },
  { label: '19', test: (d) => d.segment === 19, aim: { segment: 19, multiplier: 3 } },
  { label: '20', test: (d) => d.segment === 20, aim: { segment: 20, multiplier: 3 } },
  { label: 'Bull', test: (d) => d.segment === 25, aim: { segment: 25, multiplier: 2 } },
];

/** Index des Spielers mit den meisten Punkten (bei Gleichstand der erste). */
function leader(scores) {
  return scores.reduce((best, s, i) => (s > scores[best] ? i : best), 0);
}

export const HALVEIT = {
  id: 'halveit',
  label: 'Halve-It',
  kind: 'match',
  maxPlayers: 6,
  dartsPerTurn: 3,
  defaultOptions: { start: 40 },

  describe() { return 'Halve-It'; },

  newLeg(options, playerCount) {
    return { scores: Array(playerCount).fill(options.start), done: Array(playerCount).fill(0) };
  },

  evaluateTurn(options, leg, p, darts) {
    const round = HALVE_ROUNDS[Math.min(leg.done[p], HALVE_ROUNDS.length - 1)];
    let used = 0;
    let points = 0;
    let hitCount = 0;
    const hits = [];
    for (const d of darts) {
      if (used >= this.dartsPerTurn) break;
      used++;
      const hit = !!d.multiplier && round.test(d);
      hits.push(hit);
      if (hit) { hitCount++; points += dartScore(d); }
    }
    const closed = used >= this.dartsPerTurn;
    const scores = leg.scores.slice();
    const done = leg.done.slice();
    const halved = closed && !hitCount;
    scores[p] = halved ? Math.floor(scores[p] / 2) : scores[p] + points;
    if (closed) done[p]++;
    const finished = closed && done.every((n) => n >= HALVE_ROUNDS.length);
    return {
      points, hitCount, halved, bust: false, finished, closed, usedDarts: used, hits, running: [],
      after: { scores, done }, winner: finished ? leader(scores) : undefined,
    };
  },

  applyTurn(options, leg, p, ev) { return ev.after; },
  displayScore(leg, p) { return leg.scores[p]; },
  hint() { return null; },

  panel(options, leg, p) {
    return { big: String(leg.scores[p]), sub: `Runde ${Math.min(leg.done[p] + 1, HALVE_ROUNDS.length)} / ${HALVE_ROUNDS.length}` };
  },
  targetText(options, leg, p) {
    return `Ziel: ${HALVE_ROUNDS[Math.min(leg.done[p], HALVE_ROUNDS.length - 1)].label}`;
  },
  botTarget(options, leg, p) {
    return HALVE_ROUNDS[Math.min(leg.done[p], HALVE_ROUNDS.length - 1)].aim;
  },

  turnLabel(ev) { return ev.halved ? '½' : String(ev.points); },
  turnSpeech(options, ev, { T }) {
    if (ev.finished) return null;
    return { parts: [ev.halved ? T.noScore : T.points(ev.points)] };
  },
};

// ---------------------------------------------------------------------------
// Killer: Jeder Spieler bekommt eine Zahl. Erst das eigene Double treffen -> Killer.
// Als Killer kostet jeder Treffer auf das Double eines Gegners ihm ein Leben (eigenes Double: eigenes Leben).
// Wer keine Leben mehr hat, ist raus. Der Letzte gewinnt.
// ---------------------------------------------------------------------------
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const KILLER = {
  id: 'killer',
  label: 'Killer',
  kind: 'match',
  maxPlayers: 6,
  dartsPerTurn: 3,
  defaultOptions: { lives: 3, numbers: [] },

  describe(options) { return `Killer · ${options.lives} Leben`; },

  /** Zahlen werden beim Anlegen festgelegt und im Match gespeichert (Spielstand bleibt reproduzierbar). */
  prepareOptions(options) {
    return { ...options, numbers: shuffled(Array.from({ length: 20 }, (_, i) => i + 1)) };
  },

  newLeg(options, playerCount) {
    return {
      numbers: options.numbers.slice(0, playerCount),
      lives: Array(playerCount).fill(options.lives),
      killer: Array(playerCount).fill(false),
    };
  },

  evaluateTurn(options, leg, p, darts) {
    const lives = leg.lives.slice();
    const killer = leg.killer.slice();
    let used = 0;
    let hitCount = 0;
    let finished = false;
    const hits = [];
    for (const d of darts) {
      if (finished || used >= this.dartsPerTurn || lives[p] <= 0) break;
      used++;
      const owner = d.multiplier === 2 ? leg.numbers.indexOf(d.segment) : -1;
      let hit = false;
      if (owner === p && !killer[p]) { killer[p] = true; hit = true; }
      else if (owner >= 0 && killer[p] && lives[owner] > 0) { lives[owner]--; hit = true; }
      hits.push(hit);
      if (hit) hitCount++;
      finished = lives.filter((l) => l > 0).length <= 1;
    }
    const closed = finished || used >= this.dartsPerTurn || lives[p] <= 0;
    const alive = lives.findIndex((l) => l > 0);
    return {
      points: 0, hitCount, marks: hitCount, bust: false, finished, closed, usedDarts: used, hits, running: [],
      after: { numbers: leg.numbers, lives, killer }, winner: finished ? (alive >= 0 ? alive : p) : undefined,
    };
  },

  applyTurn(options, leg, p, ev) { return ev.after; },
  displayScore(leg, p) { return leg.lives[p]; },
  hint() { return null; },

  /** Ausgeschiedene Spieler werden übersprungen. */
  nextPlayer(options, leg, current, n) {
    for (let k = 1; k <= n; k++) {
      const i = (current + k) % n;
      if (leg.lives[i] > 0) return i;
    }
    return current;
  },

  panel(options, leg, p) {
    const out = leg.lives[p] <= 0;
    return {
      big: out ? '✝' : '♥'.repeat(leg.lives[p]),
      sub: `D${leg.numbers[p]}${out ? ' · raus' : leg.killer[p] ? ' · KILLER' : ''}`,
    };
  },
  targetText(options, leg, p) {
    if (!leg.killer[p]) return `Ziel: D${leg.numbers[p]} → Killer werden`;
    const victims = leg.numbers.filter((n, i) => i !== p && leg.lives[i] > 0).map((n) => `D${n}`);
    return `Killer: ${victims.join(' · ')}`;
  },
  botTarget(options, leg, p) {
    if (!leg.killer[p]) return { segment: leg.numbers[p], multiplier: 2 };
    // Gegner mit den wenigsten Leben angreifen
    let victim = -1;
    leg.lives.forEach((l, i) => { if (i !== p && l > 0 && (victim < 0 || l < leg.lives[victim])) victim = i; });
    return { segment: leg.numbers[victim >= 0 ? victim : p], multiplier: 2 };
  },

  turnLabel(ev) { return ev.finished ? 'GAME' : `${ev.hitCount} ✓`; },
  turnSpeech(options, ev, { T }) {
    if (ev.finished) return null;
    return { parts: [ev.hitCount ? T.hits(ev.hitCount) : T.noScore] };
  },
};

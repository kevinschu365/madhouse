// Trainingsspiele für einen Spieler: Around the Clock, Bob's 27, Shanghai, Doubles, Score-Training, JDC Challenge.
// Jedes Training ist ein Spielmodus mit derselben Schnittstelle wie X01 (siehe rules/index.js),
// läuft als Match mit einem Spieler und genau einem Leg. Das Leg ist zu Ende, wenn das Training fertig ist.
// Dadurch funktionieren Kamera, Rückgängig, Korrektur und Speicherung ohne Sonderwege.
//
// Zusätzlich zur Spiel-Schnittstelle liefert jedes Training:
//   status(options, leg, ev) -> { big, label, lines[], target }   Anzeige (ev = bisherige Aufnahme)
//   turnLabel(ev)            -> kurzer Text für die Aufnahme
//   turnSpeech(options, ev, { T, hit }) -> { parts[], rest }     Ansage nach der Aufnahme
//   result(options, leg)     -> { value, text, better: 'high'|'low' }  Ergebnis für Rekorde

import { dartScore } from '../core/board.js';

const T_ = (segment, multiplier) => ({ segment, multiplier });

/** Kurzname eines Ziels: 7, D7, T7, 25, BULL. mult 0 = beliebiges Feld der Zahl. */
export function targetLabel(segment, mult = 0) {
  if (segment === 25) return mult === 2 ? 'BULL' : mult === 1 ? '25' : 'Bull';
  return (mult === 3 ? 'T' : mult === 2 ? 'D' : '') + segment;
}

/** Gesprochenes Ziel. */
function targetSpeech(say, segment, mult = 0) {
  if (segment === 25) return mult === 1 ? say.T.outerBull : say.T.bull;
  return say.hit(T_(segment, mult || 1));
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '–');

/** Gemeinsame Teile aller Trainings. */
const BASE = {
  kind: 'training',
  players: 1,
  dartsPerTurn: 3,
  hint() { return null; },
  applyTurn(options, leg, playerIdx, ev) { return ev.after; },
};

// ---------------------------------------------------------------------------
// Around the Clock: 1 bis 20 (und Bull) der Reihe nach, erst bei Treffer zum nächsten Feld.
// ---------------------------------------------------------------------------
function atcTargets(options) {
  const list = [];
  for (let n = 1; n <= 20; n++) list.push(n);
  if (options.bull) list.push(25);
  return list;
}
function atcMult(options, segment) {
  if (options.variant === 'double') return 2;
  if (options.variant === 'triple') return segment === 25 ? 0 : 3;
  return 0;
}
function atcHit(options, d, segment) {
  if (d.segment !== segment || !d.multiplier) return false;
  const m = atcMult(options, segment);
  return !m || d.multiplier === m;
}

export const ATC = {
  ...BASE,
  id: 'atc',
  label: 'Around the Clock',
  defaultOptions: { variant: 'any', bull: true },
  describe(o) {
    const v = { any: 'alle Felder', double: 'nur Doubles', triple: 'nur Triples' }[o.variant] || '';
    return `Around the Clock · ${v}`;
  },
  newLeg() { return { idx: 0, darts: 0, hits: 0 }; },
  evaluateTurn(options, leg, p, darts) {
    const targets = atcTargets(options);
    let idx = leg.idx;
    let used = 0;
    const hits = [];
    for (const d of darts) {
      if (used >= 3 || idx >= targets.length) break;
      used++;
      const hit = atcHit(options, d, targets[idx]);
      hits.push(hit);
      if (hit) idx++;
    }
    const finished = idx >= targets.length;
    const n = hits.filter(Boolean).length;
    return {
      points: n, bust: false, finished, closed: finished || used >= 3, usedDarts: used, hits, running: [],
      after: { idx, darts: leg.darts + used, hits: leg.hits + n },
    };
  },
  displayScore(leg) { return leg.idx; },
  status(options, leg, ev) {
    const targets = atcTargets(options);
    const a = ev.after;
    const t = targets[Math.min(a.idx, targets.length - 1)];
    const label = a.idx >= targets.length ? '✓' : targetLabel(t, atcMult(options, t));
    return { big: label, label: 'Ziel', target: a.idx >= targets.length ? null : label, lines: [`Feld ${Math.min(a.idx + 1, targets.length)} / ${targets.length}`, `${a.darts} Darts`] };
  },
  turnLabel(ev) { return `${ev.points} ✓`; },
  turnSpeech(options, ev, say) {
    const { T } = say;
    if (ev.finished) return { parts: [T.trainingDone, T.darts(ev.after.darts)] };
    const t = atcTargets(options)[ev.after.idx];
    return { parts: [ev.points ? T.hits(ev.points) : T.noScore], rest: T.target(targetSpeech(say, t, atcMult(options, t))) };
  },
  result(options, leg) {
    return { value: leg.darts, text: `${leg.darts} Darts`, better: 'low' };
  },
};

// ---------------------------------------------------------------------------
// Bob's 27: Start mit 27. Je 3 Darts auf D1 … D20, dann Bullseye.
// Jeder Treffer +Wert des Doubles. Kein Treffer in der Runde: −Wert. Bei 0 oder weniger ist Schluss.
// ---------------------------------------------------------------------------
const B27_ROUNDS = 21;
const b27Target = (round) => (round < 20 ? round + 1 : 25);
const b27Value = (round) => (round < 20 ? 2 * (round + 1) : 50);

export const BOBS27 = {
  ...BASE,
  id: 'bobs27',
  label: "Bob's 27",
  defaultOptions: {},
  describe() { return "Bob's 27"; },
  newLeg() { return { round: 0, score: 27, hits: 0, out: false }; },
  evaluateTurn(options, leg, p, darts) {
    const seg = b27Target(leg.round);
    let used = 0;
    const hits = [];
    for (const d of darts) {
      if (used >= 3) break;
      used++;
      hits.push(d.segment === seg && d.multiplier === 2);
    }
    const n = hits.filter(Boolean).length;
    const closed = used >= 3;
    const value = b27Value(leg.round);
    const delta = n ? n * value : -value;
    const score = leg.score + (closed ? delta : n * value);
    const out = closed && score <= 0;
    return {
      points: closed ? delta : n * value, bust: false, closed, usedDarts: used, hits, running: [],
      finished: closed && (out || leg.round === B27_ROUNDS - 1),
      after: { round: closed ? leg.round + 1 : leg.round, score, hits: leg.hits + n, out },
    };
  },
  displayScore(leg) { return leg.score; },
  status(options, leg, ev) {
    const t = targetLabel(b27Target(leg.round), 2);
    return { big: String(ev.after.score), label: 'Stand', target: ev.after.out || leg.round >= B27_ROUNDS ? null : t, lines: [`Runde ${Math.min(leg.round + 1, B27_ROUNDS)} / ${B27_ROUNDS}`, `Ziel ${t} (${b27Value(leg.round)})`] };
  },
  turnLabel(ev) { return ev.points > 0 ? `+${ev.points}` : String(ev.points); },
  turnSpeech(options, ev, say) {
    const { T } = say;
    const a = ev.after;
    if (a.out) return { parts: [T.out, T.points(a.score)] };
    if (ev.finished) return { parts: [T.trainingDone, T.points(a.score)] };
    return { parts: [String(a.score)], rest: T.target(targetSpeech(say, b27Target(a.round), 2)) };
  },
  result(options, leg) {
    const text = leg.out ? `${leg.score} · raus bei ${targetLabel(b27Target(leg.round - 1), 2)}` : `${leg.score} Punkte`;
    return { value: leg.score, text, better: 'high' };
  },
};

// ---------------------------------------------------------------------------
// Shanghai: Runde 1 auf die 1, Runde 2 auf die 2 … Punkte nur auf der Rundenzahl.
// Single, Double und Triple der Zahl in einer Aufnahme = Shanghai, das Spiel ist sofort gewonnen.
// ---------------------------------------------------------------------------
function isShanghai(darts, seg) {
  const m = new Set(darts.filter((d) => d.segment === seg).map((d) => d.multiplier));
  return m.has(1) && m.has(2) && m.has(3);
}

export const SHANGHAI = {
  ...BASE,
  id: 'shanghai',
  label: 'Shanghai',
  defaultOptions: { to: 7 },
  describe(o) { return `Shanghai 1–${o.to}`; },
  newLeg() { return { round: 0, score: 0, shanghai: false }; },
  evaluateTurn(options, leg, p, darts) {
    const seg = leg.round + 1;
    const ds = darts.slice(0, 3);
    const hits = ds.map((d) => d.segment === seg && d.multiplier > 0);
    const pts = ds.reduce((s, d, i) => s + (hits[i] ? dartScore(d) : 0), 0);
    const closed = ds.length >= 3;
    const shanghai = closed && isShanghai(ds, seg);
    return {
      points: pts, bust: false, closed, usedDarts: ds.length, hits, running: [],
      finished: closed && (shanghai || seg >= options.to),
      after: { round: closed ? leg.round + 1 : leg.round, score: leg.score + pts, shanghai },
    };
  },
  displayScore(leg) { return leg.score; },
  status(options, leg, ev) {
    const seg = Math.min(leg.round + 1, options.to);
    return { big: String(ev.after.score), label: 'Punkte', target: String(seg), lines: [`Runde ${seg} / ${options.to}`, `Ziel ${seg}`] };
  },
  turnLabel(ev) { return ev.after.shanghai ? 'SHANGHAI' : String(ev.points); },
  turnSpeech(options, ev, say) {
    const { T } = say;
    if (ev.after.shanghai) return { parts: [T.shanghai, T.points(ev.after.score)] };
    if (ev.finished) return { parts: [T.trainingDone, T.points(ev.after.score)] };
    return { parts: [ev.points ? String(ev.points) : T.noScore], rest: T.target(String(ev.after.round + 1)) };
  },
  result(options, leg) {
    return { value: leg.score, text: `${leg.score} Punkte${leg.shanghai ? ' · Shanghai!' : ''}`, better: 'high' };
  },
};

// ---------------------------------------------------------------------------
// Doubles-Training: feste Anzahl Darts auf ein Double, oder reihum D1 … D20 und Bull (je 3 Darts).
// ---------------------------------------------------------------------------
function dblTurns(o) { return o.target === 0 ? 21 : Math.round(o.darts / 3); }
function dblTarget(o, turn) { return o.target === 0 ? (turn < 20 ? turn + 1 : 25) : o.target; }

export const DOUBLES = {
  ...BASE,
  id: 'doubles',
  label: 'Doubles-Training',
  defaultOptions: { target: 20, darts: 30 },
  describe(o) { return o.target === 0 ? 'Doubles reihum' : `Doubles · ${targetLabel(o.target, 2)} · ${o.darts} Darts`; },
  newLeg() { return { turn: 0, hits: 0, darts: 0 }; },
  evaluateTurn(options, leg, p, darts) {
    const seg = dblTarget(options, leg.turn);
    const ds = darts.slice(0, 3);
    const hits = ds.map((d) => d.segment === seg && d.multiplier === 2);
    const n = hits.filter(Boolean).length;
    const closed = ds.length >= 3;
    return {
      points: n, bust: false, closed, usedDarts: ds.length, hits, running: [],
      finished: closed && leg.turn >= dblTurns(options) - 1,
      after: { turn: closed ? leg.turn + 1 : leg.turn, hits: leg.hits + n, darts: leg.darts + ds.length },
    };
  },
  displayScore(leg) { return leg.hits; },
  status(options, leg, ev) {
    const a = ev.after;
    const t = targetLabel(dblTarget(options, Math.min(leg.turn, dblTurns(options) - 1)), 2);
    return { big: pct(a.hits, a.darts), label: `${a.hits} / ${a.darts} Treffer`, target: t, lines: [`Aufnahme ${Math.min(leg.turn + 1, dblTurns(options))} / ${dblTurns(options)}`, `Ziel ${t}`] };
  },
  turnLabel(ev) { return `${ev.points} ✓`; },
  turnSpeech(options, ev, say) {
    const { T } = say;
    if (ev.finished) return { parts: [T.trainingDone, pct(ev.after.hits, ev.after.darts)] };
    const parts = [ev.points ? T.hits(ev.points) : T.noScore];
    if (options.target !== 0) return { parts };
    return { parts, rest: T.target(targetSpeech(say, dblTarget(options, ev.after.turn), 2)) };
  },
  result(options, leg) {
    const rate = leg.darts ? leg.hits / leg.darts : 0;
    return { value: Math.round(rate * 1000) / 10, text: `${leg.hits}/${leg.darts} · ${pct(leg.hits, leg.darts)}`, better: 'high' };
  },
};

// ---------------------------------------------------------------------------
// Score-Training: feste Zahl Aufnahmen, alles zählt. Ziel ist ein hoher Average.
// ---------------------------------------------------------------------------
export const SCORE = {
  ...BASE,
  id: 'score',
  label: 'Score-Training',
  defaultOptions: { rounds: 10 },
  describe(o) { return `Score-Training · ${o.rounds} Aufnahmen`; },
  newLeg() { return { round: 0, total: 0, darts: 0, c100: 0, c140: 0, c180: 0 }; },
  evaluateTurn(options, leg, p, darts) {
    const ds = darts.slice(0, 3);
    const pts = ds.reduce((s, d) => s + dartScore(d), 0);
    const closed = ds.length >= 3;
    const c = closed ? pts : 0;
    return {
      points: pts, bust: false, closed, usedDarts: ds.length, running: [],
      hits: ds.map((d) => d.segment === 20 && d.multiplier === 3),
      finished: closed && leg.round >= options.rounds - 1,
      after: {
        round: closed ? leg.round + 1 : leg.round, total: leg.total + pts, darts: leg.darts + ds.length,
        c180: leg.c180 + (c === 180 ? 1 : 0), c140: leg.c140 + (c >= 140 && c < 180 ? 1 : 0), c100: leg.c100 + (c >= 100 && c < 140 ? 1 : 0),
      },
    };
  },
  displayScore(leg) { return leg.total; },
  status(options, leg, ev) {
    const a = ev.after;
    const avg = a.darts ? (a.total / a.darts) * 3 : 0;
    return { big: avg.toFixed(1), label: 'Average', target: null, banner: `Ø ${avg.toFixed(1)}`, lines: [`Aufnahme ${Math.min(leg.round + 1, options.rounds)} / ${options.rounds}`, `100+: ${a.c100} · 140+: ${a.c140} · 180: ${a.c180}`] };
  },
  turnLabel(ev) { return String(ev.points); },
  turnSpeech(options, ev, say) {
    const { T } = say;
    const parts = [ev.points ? String(ev.points) : T.noScore];
    if (ev.finished) parts.push(T.trainingDone);
    return { parts };
  },
  result(options, leg) {
    const avg = leg.darts ? (leg.total / leg.darts) * 3 : 0;
    return { value: Math.round(avg * 100) / 100, text: `Ø ${avg.toFixed(2)}`, better: 'high' };
  },
};

// ---------------------------------------------------------------------------
// JDC Challenge (Junior Darts Corporation):
//  Teil 1  Shanghai 10–15: je 3 Darts, Punkte = Feldwert, Shanghai +100
//  Teil 2  je 1 Dart auf D1 … D20 und Bull: jedes getroffene Double 50, Bullseye 100
//  Teil 3  Shanghai 15–20 wie Teil 1
// Stufen: White, Purple, Yellow, Green, Blue, Red, Black.
// ---------------------------------------------------------------------------
const JDC_TURNS = 19;
export const JDC_GRADES = [[850, 'Black'], [700, 'Red'], [600, 'Blue'], [450, 'Green'], [300, 'Yellow'], [150, 'Purple'], [0, 'White']];
export function jdcGrade(score) { return JDC_GRADES.find(([min]) => score >= min)[1]; }

/** Teil und Ziel für Aufnahme t und Dart k (0–2). */
function jdcTarget(t, k = 0) {
  if (t < 6) return { part: 1, segment: 10 + t, mult: 0 };
  if (t < 13) {
    const i = (t - 6) * 3 + k;
    return { part: 2, segment: i < 20 ? i + 1 : 25, mult: 2 };
  }
  return { part: 3, segment: 15 + (t - 13), mult: 0 };
}

export const JDC = {
  ...BASE,
  id: 'jdc',
  label: 'JDC Challenge',
  defaultOptions: {},
  describe() { return 'JDC Challenge'; },
  newLeg() { return { t: 0, score: 0, parts: [0, 0, 0] }; },
  evaluateTurn(options, leg, p, darts) {
    const ds = darts.slice(0, 3);
    const hits = [];
    let pts = 0;
    ds.forEach((d, k) => {
      const tg = jdcTarget(leg.t, k);
      if (tg.part === 2) {
        const hit = d.segment === tg.segment && d.multiplier === 2;
        hits.push(hit);
        if (hit) pts += tg.segment === 25 ? 100 : 50;
      } else {
        const hit = d.segment === tg.segment && d.multiplier > 0;
        hits.push(hit);
        if (hit) pts += dartScore(d);
      }
    });
    const closed = ds.length >= 3;
    const tg = jdcTarget(leg.t);
    const bonus = closed && tg.part !== 2 && isShanghai(ds, tg.segment) ? 100 : 0;
    pts += bonus;
    const parts = leg.parts.slice();
    parts[tg.part - 1] += pts;
    return {
      points: pts, bonus, bust: false, closed, usedDarts: ds.length, hits, running: [],
      finished: closed && leg.t >= JDC_TURNS - 1,
      after: { t: closed ? leg.t + 1 : leg.t, score: leg.score + pts, parts },
    };
  },
  displayScore(leg) { return leg.score; },
  status(options, leg, ev) {
    const t = Math.min(leg.t, JDC_TURNS - 1);
    const tg = jdcTarget(t, Math.min(ev.usedDarts, 2));
    const label = targetLabel(tg.segment, tg.mult);
    const partName = ['Teil 1 · Shanghai 10–15', 'Teil 2 · Doubles (1 Dart je Feld)', 'Teil 3 · Shanghai 15–20'][tg.part - 1];
    return { big: String(ev.after.score), label: `Punkte · ${jdcGrade(ev.after.score)}`, target: label, lines: [partName, `Aufnahme ${t + 1} / ${JDC_TURNS} · Ziel ${label}`] };
  },
  turnLabel(ev) { return ev.bonus ? `${ev.points} SH` : String(ev.points); },
  turnSpeech(options, ev, say) {
    const { T } = say;
    if (ev.finished) return { parts: [T.trainingDone, T.points(ev.after.score)] };
    const parts = [ev.bonus ? T.shanghai : null, ev.points ? String(ev.points) : T.noScore];
    const tg = jdcTarget(ev.after.t);
    return { parts, rest: T.target(targetSpeech(say, tg.segment, tg.mult)) };
  },
  result(options, leg) {
    return { value: leg.score, text: `${leg.score} · ${jdcGrade(leg.score)}`, better: 'high' };
  },
};

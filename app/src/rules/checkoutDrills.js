// Checkout-Trainings für einen Spieler: 121, Catch 40, Zufalls-Checkout.
// Gemeinsamer Ablauf: Eine Zielzahl wird mit Double-Out ausgecheckt, dafür gibt es eine feste Zahl Darts.
// Überworfen beendet die Aufnahme (alle 3 Darts sind verbraucht), der Rest bleibt wie bei X01.
// Schnittstelle wie die übrigen Trainings (siehe rules/training.js).

import { dartScore, isDouble } from '../core/board.js';
import { checkoutPath } from './checkout.js';

/**
 * Baut ein Checkout-Training.
 * cfg.attempts(o)          Anzahl Versuche
 * cfg.limit(o, target)     Darts je Versuch
 * cfg.target(o, state)     Zielzahl des nächsten Versuchs (state = bisheriger Zustand inkl. log)
 * cfg.score(target, darts) Punkte für einen geschafften Versuch (optional)
 */
function checkoutDrill(cfg) {
  const firstState = (o) => {
    const s = { attempt: 0, used: 0, best: 0, successes: 0, points: 0, level: null, log: [] };
    s.target = cfg.target(o, s);
    s.rest = s.target;
    return s;
  };
  return {
    kind: 'training',
    players: 1,
    dartsPerTurn: 3,
    ...cfg.mode,

    newLeg(o) { return firstState(o); },

    evaluateTurn(o, leg, p, darts) {
      const start = leg.rest;
      let rest = start;
      let used = 0;
      let bust = false;
      let checkout = false;
      const running = [];
      const hits = [];
      for (const d of darts) {
        if (bust || checkout || used >= 3) break;
        used++;
        const after = rest - dartScore(d);
        if (after < 0 || after === 1 || (after === 0 && !isDouble(d))) { bust = true; running.push(start); hits.push(false); break; }
        if (after === 0) { checkout = true; rest = 0; running.push(0); hits.push(true); break; }
        rest = after;
        running.push(rest);
        hits.push(false);
      }
      const closed = bust || checkout || used >= 3;
      const limit = cfg.limit(o, leg.target);
      const attemptDarts = leg.used + (bust ? 3 : used);
      const failed = closed && !checkout && attemptDarts >= limit;
      let after = null;
      let finished = false;
      if (checkout || failed) {
        const pts = checkout && cfg.score ? cfg.score(leg.target, attemptDarts) : 0;
        const s = {
          ...leg,
          attempt: leg.attempt + 1,
          used: 0,
          best: checkout ? Math.max(leg.best, leg.target) : leg.best,
          successes: leg.successes + (checkout ? 1 : 0),
          points: leg.points + pts,
          log: [...leg.log, { target: leg.target, darts: attemptDarts, ok: checkout }],
        };
        finished = s.attempt >= cfg.attempts(o);
        s.target = finished ? leg.target : cfg.target(o, s);
        s.rest = s.target;
        after = s;
      } else if (closed) {
        after = { ...leg, used: attemptDarts, rest: bust ? start : rest };
      }
      return {
        points: bust ? 0 : start - rest, bust, checkout, failed, finished, closed, usedDarts: used, hits, running,
        remaining: bust ? start : rest, startRemaining: start, after,
      };
    },

    applyTurn(o, leg, p, ev) { return ev.after || leg; },
    displayScore(leg) { return leg.rest; },

    hint(o, leg, p, ev, dartsLeft) {
      const rest = ev ? ev.remaining : leg.rest;
      if (dartsLeft <= 0 || rest > 170) return null;
      return checkoutPath(rest, Math.min(dartsLeft, cfg.limit(o, leg.target) - leg.used));
    },

    status(o, leg, ev) {
      const limit = cfg.limit(o, leg.target);
      const left = Math.max(0, limit - leg.used - ev.usedDarts);
      const extra = cfg.extraLine ? cfg.extraLine(o, ev.after || leg) : null;
      return {
        big: String(ev.remaining),
        banner: ev.remaining === leg.target ? `Ziel ${leg.target}` : `Rest ${ev.remaining}`,
        label: `Ziel ${leg.target}`,
        target: null,
        lines: [`Versuch ${Math.min(leg.attempt + 1, cfg.attempts(o))} / ${cfg.attempts(o)} · noch ${left} von ${limit} Darts`, extra],
      };
    },

    turnLabel(ev) {
      if (ev.checkout) return 'CHECK';
      if (ev.bust) return 'BUST';
      return String(ev.points);
    },

    turnSpeech(o, ev, { T }) {
      if (ev.finished) return { parts: [ev.checkout ? T.game : T.failed, T.trainingDone] };
      if (ev.checkout) return { parts: [T.game], rest: T.target(String(ev.after.target)) };
      if (ev.failed) return { parts: [T.failed], rest: T.target(String(ev.after.target)) };
      return { parts: [ev.bust ? T.bust : ev.points ? String(ev.points) : T.noScore], rest: T.youRequire(ev.remaining) };
    },

    result: cfg.result,
  };
}

// ---------------------------------------------------------------------------
// 121: Start bei 121 (einstellbar). Geschafft -> eine Zahl höher, nicht geschafft -> eine tiefer (nie unter den Start).
// ---------------------------------------------------------------------------
export const C121 = checkoutDrill({
  mode: {
    id: 'c121',
    label: '121 Checkout',
    defaultOptions: { start: 121, limit: 9, attempts: 10 },
    describe(o) { return `${o.start} Checkout · ${o.limit} Darts`; },
  },
  attempts: (o) => o.attempts,
  limit: (o) => o.limit,
  target(o, s) {
    const last = s.log[s.log.length - 1];
    if (!last) return o.start;
    return last.ok ? last.target + 1 : Math.max(o.start, last.target - 1);
  },
  extraLine: (o, s) => `Geschafft: ${s.successes} · Bestes Finish: ${s.best || '–'}`,
  result(o, leg) {
    return { value: leg.best, text: leg.best ? `Bestes ${leg.best} · ${leg.successes}/${o.attempts} geschafft` : `kein Finish (0/${o.attempts})`, better: 'high' };
  },
});

// ---------------------------------------------------------------------------
// Catch 40: 61 bis 100 auschecken, je höchstens 6 Darts.
// 2 Darts = 3 Punkte, 3 Darts = 2 Punkte, 4–6 Darts = 1 Punkt. 99 geht nicht mit 2 Darts, dort zählen 3 Darts als 3 Punkte.
// ---------------------------------------------------------------------------
export function catch40Points(target, darts) {
  const best = target === 99 ? 3 : 2;
  if (darts <= best) return 3;
  if (darts === best + 1 && best === 2) return 2;
  return darts <= 6 ? 1 : 0;
}

export const CATCH40 = checkoutDrill({
  mode: {
    id: 'catch40',
    label: 'Catch 40',
    defaultOptions: {},
    describe() { return 'Catch 40 · 61–100'; },
  },
  attempts: () => 40,
  limit: () => 6,
  target: (o, s) => 61 + s.attempt,
  score: catch40Points,
  extraLine: (o, s) => `Punkte: ${s.points} · Geschafft: ${s.successes}`,
  result(o, leg) {
    return { value: leg.points, text: `${leg.points} Punkte · ${leg.successes}/40`, better: 'high' };
  },
});

// ---------------------------------------------------------------------------
// Zufalls-Checkout: zufällige, mit 3 Darts machbare Restwerte. Die Zahlen werden beim Start
// festgelegt und im Match gespeichert (sonst wäre der Spielstand nicht reproduzierbar).
// ---------------------------------------------------------------------------
export const RANDOM_CHECKOUT = checkoutDrill({
  mode: {
    id: 'randomco',
    label: 'Zufalls-Checkout',
    defaultOptions: { limit: 3, attempts: 10, min: 2, max: 170, targets: [] },
    describe(o) { return `Zufalls-Checkout · bis ${o.max} · ${o.limit} Darts`; },
    /** Wird beim Anlegen eines Matches aufgerufen (auch bei „Nochmal“: dann neue Zahlen). */
    prepareOptions(o) {
      const pool = [];
      for (let n = o.min; n <= o.max; n++) if (checkoutPath(n, 3)) pool.push(n);
      const targets = Array.from({ length: o.attempts }, () => pool[Math.floor(Math.random() * pool.length)]);
      return { ...o, targets };
    },
  },
  attempts: (o) => o.attempts,
  limit: (o) => o.limit,
  target: (o, s) => o.targets[s.attempt] ?? 40,
  extraLine: (o, s) => `Geschafft: ${s.successes}`,
  result(o, leg) {
    return { value: leg.successes, text: `${leg.successes}/${o.attempts} geschafft`, better: 'high' };
  },
});

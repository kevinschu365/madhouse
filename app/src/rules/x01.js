// Spielregeln X01 (301/501/701) mit Double-Out.
// Eigenständiger, austauschbarer Baustein: kennt weder Kamera noch Anzeige.
// Jeder Spielmodus liefert dieselbe Schnittstelle (siehe rules/index.js).

import { dartScore, isDouble } from '../core/board.js';
import { checkoutPath, turnPlan, labelToHit } from './checkout.js';

export const X01 = {
  id: 'x01',
  label: 'X01',
  kind: 'match',
  maxPlayers: 6,
  dartsPerTurn: 3,
  defaultOptions: { startScore: 501, doubleOut: true },

  describe(options) {
    return `${options.startScore} · ${options.doubleOut ? 'Double-Out' : 'Single-Out'}`;
  },

  /** Neuer Leg-Zustand. */
  newLeg(options, playerCount) {
    return { remaining: Array(playerCount).fill(options.startScore) };
  },

  /**
   * Bewertet die bisherigen Darts einer Aufnahme, ohne den Zustand zu ändern.
   * Ergebnis:
   *  points      – zählende Punkte (0 bei Überworfen)
   *  bust        – überworfen
   *  finished    – Leg ausgecheckt
   *  closed      – keine weiteren Darts in dieser Aufnahme möglich
   *  usedDarts   – Anzahl Darts, die zählen (Darts nach Bust/Finish werden ignoriert)
   *  remaining   – Rest nach der Aufnahme (bei Bust: Rest vor der Aufnahme)
   *  running     – Rest nach jedem Dart (für die Anzeige)
   */
  evaluateTurn(options, leg, playerIdx, darts, total = null) {
    const start = leg.remaining[playerIdx];
    // Aufnahme als Summe eingegeben (ohne einzelne Darts)
    if (total) {
      const after = start - total.points;
      const finished = after === 0;
      const bust = after < 0 || (options.doubleOut && after === 1);
      return {
        points: bust ? 0 : total.points,
        bust,
        finished: finished && !bust,
        closed: true,
        usedDarts: finished ? total.darts : 3,
        remaining: bust ? start : after,
        startRemaining: start,
        running: [bust ? start : after],
        isTotal: true,
      };
    }
    let rest = start;
    let bust = false;
    let finished = false;
    let used = 0;
    const running = [];
    for (const d of darts) {
      if (bust || finished || used >= this.dartsPerTurn) break;
      used++;
      const after = rest - dartScore(d);
      if (after < 0 || (options.doubleOut && after === 1)) { bust = true; running.push(start); break; }
      if (after === 0) {
        if (options.doubleOut && !isDouble(d)) { bust = true; running.push(start); break; }
        finished = true; rest = 0; running.push(0); break;
      }
      rest = after;
      running.push(rest);
    }
    return {
      points: bust ? 0 : start - rest,
      bust,
      finished,
      closed: bust || finished || used >= this.dartsPerTurn,
      usedDarts: used,
      remaining: bust ? start : rest,
      startRemaining: start,
      running,
    };
  },

  /** Übernimmt eine abgeschlossene Aufnahme in den Leg-Zustand. */
  applyTurn(options, leg, playerIdx, evaluation) {
    const remaining = leg.remaining.slice();
    remaining[playerIdx] = evaluation.remaining;
    return { remaining };
  },

  /** Restwert für die Anzeige. */
  displayScore(leg, playerIdx) {
    return leg.remaining[playerIdx];
  },

  /** Checkout-Vorschlag (oder null). */
  hint(options, leg, playerIdx, evaluationSoFar, dartsLeft) {
    const rest = evaluationSoFar ? evaluationSoFar.remaining : leg.remaining[playerIdx];
    if (!options.doubleOut || dartsLeft <= 0 || rest > 170) return null;
    return checkoutPath(rest, dartsLeft);
  },

  /** Ist diese Summe mit 3 Darts überhaupt werfbar? */
  isPossibleTotal(points) {
    return points >= 0 && points <= 180 && ![163, 166, 169, 172, 173, 175, 176, 178, 179].includes(points);
  },

  /** Computer-Gegner: Finish-Weg, sonst Stellwurf ohne Bogey, weit weg einfach T20. */
  botTarget(options, leg, playerIdx, ev, dartsLeft) {
    const rest = ev ? ev.remaining : leg.remaining[playerIdx];
    const plan = rest <= 350 ? turnPlan(rest, dartsLeft) : null;
    return plan ? labelToHit(plan.darts[0]) : { segment: 20, multiplier: 3 };
  },

  /** Für Statistik: War ein Ein-Dart-Finish möglich (Wurf „aufs Doppel“)? */
  isOnFinish(rest) {
    return rest === 50 || (rest <= 40 && rest >= 2 && rest % 2 === 0);
  },
};

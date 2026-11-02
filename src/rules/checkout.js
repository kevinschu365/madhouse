// Checkout-Vorschläge für Double-Out (bis 170 Rest).
// Berechnet Wege (Hauptweg + Alternativen) mit möglichst wenigen Darts und bevorzugt gängige Doppel
// und gängige Vorbereitungswürfe (T20, T19 …). Ergebnis wird zwischengespeichert.

import { allHits, hitLabel, dartScore } from '../core/board.js';

// Je kleiner, desto lieber (Zielfeld für den letzten Dart).
const DOUBLE_PREF = { 20: 0, 16: 1, 18: 2, 12: 3, 10: 4, 8: 5, 14: 6, 6: 7, 4: 8, 2: 9, 19: 10, 17: 10, 15: 10, 13: 10, 11: 10, 9: 11, 7: 11, 5: 11, 3: 12, 1: 13, 25: 9 };

function setupCost(hit) {
  if (hit.segment === 25) return hit.multiplier === 2 ? 9 : 6;
  if (hit.multiplier === 3) return hit.segment === 20 ? 0 : hit.segment === 19 ? 1 : hit.segment >= 15 ? 3 : 6;
  if (hit.multiplier === 1) return hit.segment >= 10 ? 2 : 3; // Singles sind große Felder
  return 8; // Doppel als Vorbereitung vermeiden
}

const HITS = allHits();
const DOUBLES = HITS.filter((h) => h.multiplier === 2);
const cache = new Map();
const bestCost = new Map(); // Kosten des besten Wegs je Rest und Dart-Anzahl (für den Stellwurf-Plan)

/** Alle Finish-Wege für einen Rest, bester zuerst, ohne doppelte Reihenfolgen. */
function rankedPaths(rest, dartsLeft) {
  const key = rest * 10 + dartsLeft;
  if (cache.has(key)) return cache.get(key);
  const found = [];
  for (const d of DOUBLES) {
    const dv = dartScore(d);
    const dCost = DOUBLE_PREF[d.segment] ?? 10;
    if (dv === rest) found.push({ path: [d], cost: 1000 + dCost });
    if (dartsLeft >= 2) {
      for (const a of HITS) {
        if (dartScore(a) + dv === rest) found.push({ path: [a, d], cost: 2000 + dCost + setupCost(a) });
      }
    }
    if (dartsLeft >= 3) {
      for (const a of HITS) {
        const av = dartScore(a);
        if (av + dv >= rest) continue;
        for (const b of HITS) {
          if (av + dartScore(b) + dv !== rest) continue;
          // Ersten Dart möglichst hoch, damit bei Fehlwurf noch etwas geht
          const order = av >= dartScore(b) ? 0 : 1;
          found.push({ path: [a, b, d], cost: 3000 + dCost + setupCost(a) + setupCost(b) + order });
        }
      }
    }
  }
  found.sort((x, y) => x.cost - y.cost); // stabil: bei gleichen Kosten gilt die Suchreihenfolge
  const seen = new Set();
  const out = [];
  for (const f of found) {
    const labels = f.path.map(hitLabel);
    const k = `${labels.slice(0, -1).sort().join(',')}|${labels[labels.length - 1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(labels);
  }
  cache.set(key, out);
  bestCost.set(key, found.length ? found[0].cost : Infinity);
  return out;
}

// Standard-Checkout-Tabelle (so wie in den gängigen Checkout-Charts, 3 Darts, Double-Out).
// Das sind die Wege, die in der Praxis gespielt werden; die Berechnung unten ist nur der Rückfall
// (z. B. wenn weniger Darts übrig sind, als der Tabellenweg braucht) und liefert die Alternativen.
const CHART = {
  170: 'T20 T20 BULL', 167: 'T20 T19 BULL', 164: 'T20 T18 BULL', 161: 'T20 T17 BULL', 160: 'T20 T20 D20',
  158: 'T20 T20 D19', 157: 'T20 T19 D20', 156: 'T20 T20 D18', 155: 'T20 T19 D19', 154: 'T20 T18 D20',
  153: 'T20 T19 D18', 152: 'T20 T20 D16', 151: 'T20 T17 D20', 150: 'T20 T18 D18', 149: 'T20 T19 D16',
  148: 'T20 T20 D14', 147: 'T20 T17 D18', 146: 'T20 T18 D16', 145: 'T20 T15 D20', 144: 'T20 T20 D12',
  143: 'T20 T17 D16', 142: 'T20 T14 D20', 141: 'T20 T19 D12', 140: 'T20 T20 D10', 139: 'T20 T13 D20',
  138: 'T20 T18 D12', 137: 'T20 T19 D10', 136: 'T20 T20 D8', 135: 'T20 T17 D12', 134: 'T20 T14 D16',
  133: 'T20 T19 D8', 132: 'T20 T16 D12', 131: 'T20 T13 D16', 130: 'T20 T20 D5', 129: 'T19 T16 D12',
  128: 'T18 T14 D16', 127: 'T20 T17 D8', 126: 'T19 T19 D6', 125: '25 T20 D20', 124: 'T20 T16 D8',
  123: 'T19 T16 D9', 122: 'T18 T20 D4', 121: 'T20 T11 D14', 120: 'T20 20 D20', 119: 'T19 T12 D13',
  118: 'T20 18 D20', 117: 'T20 17 D20', 116: 'T20 16 D20', 115: 'T20 15 D20', 114: 'T20 14 D20',
  113: 'T20 13 D20', 112: 'T20 12 D20', 111: 'T20 11 D20', 110: 'T20 BULL', 109: 'T20 9 D20',
  108: 'T20 16 D16', 107: 'T19 BULL', 106: 'T20 6 D20', 105: 'T20 5 D20', 104: 'T18 BULL',
  103: 'T19 6 D20', 102: 'T20 10 D16', 101: 'T17 BULL', 100: 'T20 D20', 99: 'T19 10 D16',
  98: 'T20 D19', 97: 'T19 D20', 96: 'T20 D18', 95: 'T19 D19', 94: 'T18 D20', 93: 'T19 D18',
  92: 'T20 D16', 91: 'T17 D20', 90: 'T18 D18', 89: 'T19 D16', 88: 'T20 D14', 87: 'T17 D18',
  86: 'T18 D16', 85: 'T15 D20', 84: 'T20 D12', 83: 'T17 D16', 82: 'BULL D16', 81: 'T19 D12',
  80: 'T20 D10', 79: 'T19 D11', 78: 'T18 D12', 77: 'T19 D10', 76: 'T20 D8', 75: 'T17 D12',
  74: 'T14 D16', 73: 'T19 D8', 72: 'T16 D12', 71: 'T13 D16', 70: 'T18 D8', 69: 'T19 D6',
  68: 'T20 D4', 67: 'T17 D8', 66: 'T10 D18', 65: 'T19 D4', 64: 'T16 D8', 63: 'T13 D12',
  62: 'T10 D16', 61: 'T15 D8', 60: '20 D20', 59: '19 D20', 58: '18 D20', 57: '17 D20',
  56: '16 D20', 55: '15 D20', 54: '14 D20', 53: '13 D20', 52: '12 D20', 51: '11 D20',
  50: 'BULL', 49: '9 D20', 48: '16 D16', 47: '15 D16', 46: '6 D20', 45: '13 D16', 44: '12 D16',
  43: '3 D20', 42: '10 D16', 41: '9 D16', 40: 'D20', 39: '7 D16', 38: 'D19', 37: '5 D16',
  36: 'D18', 35: '3 D16', 34: 'D17', 33: '1 D16', 32: 'D16', 31: '15 D8', 30: 'D15', 29: '13 D8',
  28: 'D14', 27: '11 D8', 26: 'D13', 25: '9 D8', 24: 'D12', 23: '7 D8', 22: 'D11', 21: '5 D8',
  20: 'D10', 19: '3 D8', 18: 'D9', 17: '1 D8', 16: 'D8', 15: '7 D4', 14: 'D7', 13: '5 D4',
  12: 'D6', 11: '3 D4', 10: 'D5', 9: '1 D4', 8: 'D4', 7: '3 D2', 6: 'D3', 5: '1 D2', 4: 'D2',
  3: '1 D1', 2: 'D1',
};

/** Liefert z. B. ['T20','T20','BULL'] oder null, wenn kein Finish möglich ist. */
export function checkoutPath(rest, dartsLeft = 3) {
  if (rest < 2 || rest > 170 || dartsLeft < 1) return null;
  const chart = CHART[rest] && CHART[rest].split(' ');
  if (chart && chart.length <= dartsLeft) return chart;
  return rankedPaths(rest, dartsLeft)[0] || null;
}

/** Alle Einträge der Standard-Tabelle (für Tests). */
export const CHECKOUT_CHART = CHART;

/**
 * Hauptweg plus bis zu (count - 1) Alternativen, z. B. [['T20','D20'], ['BULL','BULL'], …].
 * Eine Alternative unterscheidet sich im ersten Dart oder im Doppel von den schon gewählten.
 */
export function checkoutPaths(rest, dartsLeft = 3, count = 3) {
  if (rest < 2 || rest > 170 || dartsLeft < 1) return [];
  const main = checkoutPath(rest, dartsLeft); // Tabellenweg zuerst
  const picked = main ? [main] : [];
  for (const p of rankedPaths(rest, dartsLeft)) {
    if (picked.length >= count) break;
    if (!picked.some((q) => q[0] === p[0] && q[q.length - 1] === p[p.length - 1])) picked.push(p);
  }
  return picked;
}

/** 'T20' -> { segment: 20, multiplier: 3 }; 'BULL', '25', 'D16', '7', '0'. */
export function labelToHit(label) {
  if (label === 'BULL') return { segment: 25, multiplier: 2 };
  if (label === '25') return { segment: 25, multiplier: 1 };
  if (label === '0') return { segment: 0, multiplier: 0 };
  const m = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  return { segment: parseInt(label.replace(/^[TD]/, ''), 10), multiplier: m };
}

// Restwerte bis 170, die mit 3 Darts nicht auszuchecken sind (169, 168, 166, 165, 163, 162, 159).
let bogeys = null;
export function isBogey(rest) {
  if (!bogeys) {
    bogeys = new Set();
    for (let r = 2; r <= 170; r++) if (!checkoutPath(r, 3)) bogeys.add(r);
  }
  return bogeys.has(rest);
}

// ---------------------------------------------------------------------------
// Stellwurf-Plan: Wenn kein Finish geht, so werfen, dass ein guter Rest bleibt.
// ---------------------------------------------------------------------------

// Mögliche Ziele beim Stellen. Kosten = wie unüblich/riskant das Ziel ist:
// T20/T19 kostenlos, Singles und Bull gering, kleine Triples (T7, T8 …) deutlich teurer.
const AIMS = (() => {
  const labels = [];
  for (let s = 20; s >= 1; s--) labels.push(`T${s}`);
  for (let s = 20; s >= 1; s--) labels.push(String(s));
  labels.push('25', 'BULL', 'D20', 'D16', 'D18', 'D10', 'D8');
  // T20 ist das normale Ziel; je ungewohnter das Feld, desto teurer
  const tripleCost = { 20: 0, 19: 2, 18: 5, 17: 6, 16: 6, 15: 6 };
  return labels.map((label) => {
    const hit = labelToHit(label);
    let cost = setupCost(hit);
    if (hit.multiplier === 3) cost = tripleCost[hit.segment] ?? 15;
    if (hit.multiplier === 2 && hit.segment !== 25) cost = 12; // Doppel nur zum Stellen, wenn es sich lohnt
    return { label, score: dartScore(hit), cost };
  });
})();

/**
 * Wie gut ist ein Rest für die nächste Aufnahme? Kleiner = besser.
 * Wenige Darts zum Finish zählen am meisten, dann ein Lieblingsdoppel (D20, D16, D18 …),
 * dann ein niedriger Rest. Bogeys (169 …) und Reste über 170 sind schlecht.
 */
function leaveCost(rest) {
  if (rest < 2) return Infinity;
  if (rest > 170) return 5000 + rest;
  if (isBogey(rest)) return 20000;
  const path = rankedPaths(rest, 3)[0];
  const dbl = labelToHit(path[path.length - 1]);
  // Doppel-Vorliebe zählt hier dreifach: lieber D20/D16/D18 als D8 oder gar D2/D1
  return bestCost.get(rest * 10 + 3) + 2 * (DOUBLE_PREF[dbl.segment] ?? 10) + rest * 0.1;
}

const SCORING_AIMS = AIMS.filter((a) => a.label === 'T20' || a.label === 'T19');
const planCache = new Map();

/**
 * Wurfplan für die übrigen Darts der Aufnahme (Double-Out):
 * Ist ein Finish möglich, ist es der Checkout-Weg (Standard-Tabelle). Sonst wie in der Praxis:
 * auf T20 punkten (T19, wenn T20 schlecht aufgeht) und mit dem letzten Dart auf einen guten Rest
 * stellen (z. B. 181: T20 T20 25 -> 36 = D18, statt T20 T20 T19 -> 4 = D2).
 * Ergebnis: { darts: ['T20', 'T20', '25'], leave, finish } oder null bei Rest < 2.
 */
export function turnPlan(rest, dartsLeft = 3) {
  if (rest < 2 || dartsLeft < 1) return null;
  const fin = checkoutPath(rest, dartsLeft);
  if (fin) return { darts: fin, leave: 0, finish: true };
  const key = rest * 10 + dartsLeft;
  if (planCache.has(key)) return planCache.get(key);
  let best = null;
  let bestTotal = Infinity;
  const darts = [];
  const walk = (r, k, cost) => {
    if (cost + 1000 >= bestTotal) return; // jeder Rest kostet mindestens 1000
    if (k === 0) {
      const total = cost + leaveCost(r);
      if (total < bestTotal) { bestTotal = total; best = { darts: darts.slice(), leave: r, finish: false }; }
      return;
    }
    // Wie in der Praxis: erst auf T20 punkten (T19, wenn T20 schlecht aufgeht), der letzte Dart stellt
    for (const a of k > 1 ? SCORING_AIMS : AIMS) {
      const next = r - a.score;
      if (next < 2) continue; // überworfen
      darts.push(a.label);
      walk(next, k - 1, cost + a.cost);
      darts.pop();
    }
  };
  walk(rest, dartsLeft, 0);
  planCache.set(key, best);
  return best;
}

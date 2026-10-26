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
  return out;
}

/** Liefert z. B. ['T20','T20','BULL'] oder null, wenn kein Finish möglich ist. */
export function checkoutPath(rest, dartsLeft = 3) {
  if (rest < 2 || rest > 170 || dartsLeft < 1) return null;
  return rankedPaths(rest, dartsLeft)[0] || null;
}

/**
 * Hauptweg plus bis zu (count - 1) Alternativen, z. B. [['T20','D20'], ['BULL','BULL'], …].
 * Eine Alternative unterscheidet sich im ersten Dart oder im Doppel von den schon gewählten.
 */
export function checkoutPaths(rest, dartsLeft = 3, count = 3) {
  if (rest < 2 || rest > 170 || dartsLeft < 1) return [];
  const picked = [];
  for (const p of rankedPaths(rest, dartsLeft)) {
    if (picked.length >= count) break;
    if (!picked.some((q) => q[0] === p[0] && q[q.length - 1] === p[p.length - 1])) picked.push(p);
  }
  return picked;
}

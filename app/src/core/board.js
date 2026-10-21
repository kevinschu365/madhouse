// Geometrie der Steeldart-Scheibe und Zuordnung Punkt -> Segment.
// Koordinaten in Millimetern, Ursprung = Bullseye, x nach rechts, y nach OBEN.

// Reihenfolge im Uhrzeigersinn, beginnend oben.
export const SEGMENT_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// Standardmaße (WDF/BDO-Regelwerk, Radien bis Draht-Mitte, gerundet).
export const STANDARD_DIMENSIONS = {
  bullInner: 6.35,     // Bullseye (50)
  bullOuter: 15.9,     // Single Bull (25)
  trebleInner: 99,
  trebleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,
  boardRadius: 225,
};

// Ein Treffer: { segment: 1..20 | 25 | 0, multiplier: 0..3 }
//  segment 25 + multiplier 1 = Single Bull (25), segment 25 + multiplier 2 = Bullseye (50)
//  segment 0  + multiplier 0 = Außenfeld / daneben
export const MISS = Object.freeze({ segment: 0, multiplier: 0 });

export function dartScore(hit) {
  if (!hit) return 0;
  return hit.segment * hit.multiplier;
}

/** Winkel (Grad, 0 = rechts, gegen den Uhrzeigersinn) -> Segmentnummer */
export function segmentFromAngle(deg) {
  // Segment 20 ist bei 90° zentriert; jedes Segment ist 18° breit, Uhrzeigersinn = abnehmender Winkel.
  let a = 90 - deg + 9;           // 0 bei linker Kante von 20, im Uhrzeigersinn steigend
  a = ((a % 360) + 360) % 360;
  return SEGMENT_ORDER[Math.floor(a / 18) % 20];
}

/** Punkt (mm, y oben) -> Treffer */
export function hitFromPoint(x, y, dims = STANDARD_DIMENSIONS) {
  const r = Math.hypot(x, y);
  if (r <= dims.bullInner) return { segment: 25, multiplier: 2 };
  if (r <= dims.bullOuter) return { segment: 25, multiplier: 1 };
  if (r > dims.doubleOuter) return { ...MISS };
  const seg = segmentFromAngle(Math.atan2(y, x) * 180 / Math.PI);
  if (r > dims.doubleInner) return { segment: seg, multiplier: 2 };
  if (r > dims.trebleInner && r <= dims.trebleOuter) return { segment: seg, multiplier: 3 };
  return { segment: seg, multiplier: 1 };
}

/** Mittelpunkt (mm) eines Feldes – nützlich für Tests und Anzeige. */
export function pointForHit(hit, dims = STANDARD_DIMENSIONS) {
  if (hit.segment === 25) return { x: 0, y: hit.multiplier === 2 ? 0 : (dims.bullInner + dims.bullOuter) / 2 };
  if (hit.segment === 0) return { x: 0, y: (dims.doubleOuter + dims.boardRadius) / 2 };
  const idx = SEGMENT_ORDER.indexOf(hit.segment);
  const ang = (90 - idx * 18) * Math.PI / 180;
  let r;
  if (hit.multiplier === 2) r = (dims.doubleInner + dims.doubleOuter) / 2;
  else if (hit.multiplier === 3) r = (dims.trebleInner + dims.trebleOuter) / 2;
  else r = (dims.trebleOuter + dims.doubleInner) / 2;
  return { x: r * Math.cos(ang), y: r * Math.sin(ang) };
}

/** Kurzname: T20, D16, S5, 25, BULL, 0 */
export function hitLabel(hit) {
  if (!hit || hit.multiplier === 0 || hit.segment === 0) return '0';
  if (hit.segment === 25) return hit.multiplier === 2 ? 'BULL' : '25';
  return (hit.multiplier === 3 ? 'T' : hit.multiplier === 2 ? 'D' : '') + hit.segment;
}

export function isDouble(hit) {
  return hit && hit.multiplier === 2; // Bullseye zählt als Doppel
}

export function sameHit(a, b) {
  return a.segment === b.segment && a.multiplier === b.multiplier;
}

/** Alle möglichen Treffer (für Checkout-Berechnung und Eingabe). */
export function allHits() {
  const hits = [];
  for (let s = 1; s <= 20; s++) for (let m = 1; m <= 3; m++) hits.push({ segment: s, multiplier: m });
  hits.push({ segment: 25, multiplier: 1 }, { segment: 25, multiplier: 2 });
  return hits;
}

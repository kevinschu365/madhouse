// Kalibrierung: Zuordnung Kamerabild <-> Board (Draufsicht in mm).
// Der Nutzer tippt das Bullseye und vier Punkte auf dem äußeren Doppel-Draht an.
// Daraus wird eine Homographie berechnet (schräges Bild -> gerade Draufsicht).

import { solveHomography, applyH, invertH, dartDirectionModel } from './homography.js';
import { STANDARD_DIMENSIONS, hitFromPoint } from '../core/board.js';

// Referenzpunkte: Schnittpunkt des äußeren Doppel-Drahts mit dem Segmentdraht zwischen zwei Zahlen.
// Winkel in Grad (0 = rechts, gegen den Uhrzeigersinn).
export const CAL_POINTS = [
  { key: 'bull', label: 'Bullseye (Mitte)', angle: null, r: 0 },
  { key: '20-1', label: 'Außenkante Doppelring, Draht zwischen 20 und 1 (oben, knapp rechts der Mitte)', angle: 81, r: 'doubleOuter' },
  { key: '6-10', label: 'Außenkante Doppelring, Draht zwischen 6 und 10 (rechts, knapp unter der Mitte)', angle: -9, r: 'doubleOuter' },
  { key: '3-19', label: 'Außenkante Doppelring, Draht zwischen 3 und 19 (unten, knapp links der Mitte)', angle: -99, r: 'doubleOuter' },
  { key: '11-14', label: 'Außenkante Doppelring, Draht zwischen 11 und 14 (links, knapp über der Mitte)', angle: 171, r: 'doubleOuter' },
];

export function boardPointFor(cp, dims = STANDARD_DIMENSIONS) {
  if (cp.angle === null) return [0, 0];
  const r = typeof cp.r === 'string' ? dims[cp.r] : cp.r;
  const a = cp.angle * Math.PI / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

/**
 * Baut ein Kalibrierungsobjekt.
 * imagePoints: Bildkoordinaten (Pixel bezogen auf width/height) in Reihenfolge von boardPoints.
 */
export function buildCalibration({ boardPoints, imagePoints, width, height, dims = STANDARD_DIMENSIONS, extra = {} }) {
  const H = solveHomography(boardPoints, imagePoints);
  return finishCalibration({ H, width, height, dims, imagePoints, boardPoints, ...extra });
}

export function finishCalibration(cal) {
  const Hinv = invertH(cal.H);
  const dir = dartDirectionModel(cal.H, cal.width, cal.height);
  return { ...cal, Hinv, dir };
}

/** Gespeicherte (JSON-)Kalibrierung wieder nutzbar machen, ggf. auf andere Bildgröße skaliert. */
export function restoreCalibration(saved, width = saved.width, height = saved.height) {
  let H = saved.H;
  if (width !== saved.width || height !== saved.height) {
    const sx = width / saved.width, sy = height / saved.height;
    H = [H[0] * sx, H[1] * sx, H[2] * sx, H[3] * sy, H[4] * sy, H[5] * sy, H[6], H[7], H[8]];
  }
  // Immer die aktuellen Ringmaße verwenden (die Kalibrierpunkte liegen am äußeren Doppeldraht, der gleich bleibt)
  return finishCalibration({ ...saved, H, width, height, dims: STANDARD_DIMENSIONS });
}

/** Nur die speicherbaren Teile (ohne Funktionen). */
export function serializeCalibration(cal) {
  const { Hinv, dir, ...rest } = cal;
  return rest;
}

export function imageToBoard(cal, x, y) {
  return applyH(cal.Hinv, x, y);
}
export function boardToImage(cal, bx, by) {
  return applyH(cal.H, bx, by);
}
export function hitAtImage(cal, x, y) {
  const [bx, by] = imageToBoard(cal, x, y);
  return { hit: hitFromPoint(bx, by, cal.dims || STANDARD_DIMENSIONS), board: [bx, by], radius: Math.hypot(bx, by) };
}

/** Verschiebt eine Kalibrierung um (dx, dy) Pixel (für automatisches Nachführen). */
export function shiftCalibration(cal, dx, dy) {
  const T = [1, 0, dx, 0, 1, dy, 0, 0, 1];
  const H = [
    T[0] * cal.H[0] + T[2] * cal.H[6], T[0] * cal.H[1] + T[2] * cal.H[7], T[0] * cal.H[2] + T[2] * cal.H[8],
    T[4] * cal.H[3] + T[5] * cal.H[6], T[4] * cal.H[4] + T[5] * cal.H[7], T[4] * cal.H[5] + T[5] * cal.H[8],
    cal.H[6], cal.H[7], cal.H[8],
  ];
  return finishCalibration({ ...cal, H, imagePoints: (cal.imagePoints || []).map(([x, y]) => [x + dx, y + dy]) });
}

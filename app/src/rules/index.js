// Verzeichnis der Spielmodi. Ein neuer Modus (z. B. Cricket) wird als eigene Datei
// mit derselben Schnittstelle wie X01 angelegt und hier eingetragen – sonst nichts.
//
// Schnittstelle eines Modus:
//   id, label, dartsPerTurn, defaultOptions
//   describe(options)                                   -> Text
//   newLeg(options, playerCount)                        -> Leg-Zustand
//   evaluateTurn(options, leg, playerIdx, darts)        -> { points, bust, finished, closed, usedDarts, ... }
//   applyTurn(options, leg, playerIdx, evaluation)      -> neuer Leg-Zustand
//   displayScore(leg, playerIdx)                        -> Zahl für die große Anzeige
//   hint(options, leg, playerIdx, evalSoFar, dartsLeft) -> z. B. ['T20','D20'] oder null

import { X01 } from './x01.js';

export const MODES = { [X01.id]: X01 };

export function getMode(id) {
  const m = MODES[id];
  if (!m) throw new Error(`Unbekannter Spielmodus: ${id}`);
  return m;
}

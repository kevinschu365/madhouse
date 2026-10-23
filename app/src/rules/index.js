// Verzeichnis der Spielmodi. Ein neuer Modus wird als eigene Datei mit derselben
// Schnittstelle wie X01 angelegt und hier eingetragen – sonst nichts.
//
// Schnittstelle eines Modus:
//   id, label, dartsPerTurn, defaultOptions
//   kind                                                'match' (gegeneinander) oder 'training' (allein)
//   describe(options)                                   -> Text
//   newLeg(options, playerCount)                        -> Leg-Zustand
//   evaluateTurn(options, leg, playerIdx, darts, total) -> { points, bust, finished, closed, usedDarts, ... }
//                                                          (total = { points, darts } bei Summen-Eingabe, sonst null)
//   applyTurn(options, leg, playerIdx, evaluation)      -> neuer Leg-Zustand
//   displayScore(leg, playerIdx)                        -> Zahl für die große Anzeige
//   hint(options, leg, playerIdx, evalSoFar, dartsLeft) -> z. B. ['T20','D20'] oder null
// Optional:
//   isPossibleTotal(points)    Summen-Eingabe erlaubt (nur X01)
//   prepareOptions(options)    beim Anlegen eines Matches (z. B. Zufallszahlen festlegen)
//   turnLabel(ev)              kurzer Text der Aufnahme (statt Punkte)
//   turnSpeech(options, ev, { T, hit }) -> { parts[], rest } eigene Ansage nach der Aufnahme
//   status(options, leg, ev)   Anzeige für Trainings (siehe rules/training.js)
//   result(options, leg)       Ergebnis eines Trainings für Rekorde

import { X01 } from './x01.js';
import { CRICKET } from './cricket.js';
import { ATC, BOBS27, SHANGHAI, DOUBLES, SCORE, JDC } from './training.js';
import { C121, CATCH40, RANDOM_CHECKOUT } from './checkoutDrills.js';

const ALL = [X01, CRICKET, ATC, SHANGHAI, BOBS27, DOUBLES, SCORE, C121, CATCH40, RANDOM_CHECKOUT, JDC];

export const MODES = Object.fromEntries(ALL.map((m) => [m.id, m]));

export function getMode(id) {
  const m = MODES[id];
  if (!m) throw new Error(`Unbekannter Spielmodus: ${id}`);
  return m;
}

export function isTraining(id) {
  return MODES[id]?.kind === 'training';
}

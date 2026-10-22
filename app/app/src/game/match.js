// Match-Verwaltung (Sets, Legs, Reihenfolge, Rückgängig, Korrektur).
// Ein Match speichert nur die geworfenen Darts je Aufnahme. Alles andere
// (Rest, Legs, Sets, wer dran ist) wird daraus jedes Mal neu berechnet.
// Dadurch sind Rückgängig und Korrekturen immer konsistent.

import { getMode } from '../rules/index.js';
import { MISS, dartScore } from '../core/board.js';

export function winsNeeded(bestOf) {
  return Math.floor(bestOf / 2) + 1;
}

let idCounter = 0;
export function newId(prefix) {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createMatch({ mode = 'x01', options, players, playerNames, setsBestOf = 1, legsBestOf = 3, firstStarter = 0, starterMethod = 'tap' }) {
  const m = getMode(mode);
  return {
    id: newId('m'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode,
    options: { ...m.defaultOptions, ...options },
    players: players.slice(),
    playerNames: playerNames ? playerNames.slice() : players.slice(),
    format: { setsBestOf, legsBestOf },
    firstStarter,
    starterMethod,
    turns: [],
    status: 'running',
    winner: null,
  };
}

/** Berechnet den kompletten Spielstand aus den gespeicherten Aufnahmen. */
export function derive(match) {
  const mode = getMode(match.mode);
  const n = match.players.length;
  const legsNeeded = winsNeeded(match.format.legsBestOf);
  const setsNeeded = winsNeeded(match.format.setsBestOf);

  let setNo = 1;
  let legInSet = 1;
  let legOverall = 1;
  const setsWon = Array(n).fill(0);
  let legsWon = Array(n).fill(0);
  let leg = mode.newLeg(match.options, n);
  let legStarter = match.firstStarter;
  let current = legStarter;
  let finished = false;
  let winner = null;
  let openTurn = null;
  const legs = [];
  let legRecord = { set: setNo, legInSet, legOverall, starter: legStarter, turns: [], winner: null };

  for (let i = 0; i < match.turns.length; i++) {
    const t = match.turns[i];
    if (finished) break;
    const before = leg;
    const ev = mode.evaluateTurn(match.options, leg, current, t.darts, t.total || null);
    const info = { index: i, player: current, darts: t.darts, total: t.total || null, ts: t.closedAt || t.openedAt, ev, set: setNo, legInSet, legOverall, startRemaining: mode.displayScore(before, current) };
    if (!t.closed) {
      openTurn = info;
      break;
    }
    legRecord.turns.push(info);
    leg = mode.applyTurn(match.options, leg, current, ev);
    if (ev.finished) {
      legRecord.winner = current;
      legs.push(legRecord);
      legsWon[current]++;
      if (legsWon[current] >= legsNeeded) {
        setsWon[current]++;
        if (setsWon[current] >= setsNeeded) {
          finished = true;
          winner = current;
          break;
        }
        legsWon = Array(n).fill(0);
        setNo++;
        legInSet = 1;
      } else {
        legInSet++;
      }
      legOverall++;
      legStarter = (legStarter + 1) % n;       // Anwurf wechselt nach jedem Leg
      current = legStarter;
      leg = mode.newLeg(match.options, n);
      legRecord = { set: setNo, legInSet, legOverall, starter: legStarter, turns: [], winner: null };
    } else {
      current = (current + 1) % n;
    }
  }
  if (!finished) legs.push(legRecord);

  const turnDarts = openTurn ? openTurn.darts : [];
  const turnEval = mode.evaluateTurn(match.options, leg, current, turnDarts);
  const dartsLeft = turnEval.closed ? 0 : mode.dartsPerTurn - turnEval.usedDarts;
  return {
    mode,
    finished,
    winner,
    setNo,
    legInSet,
    legOverall,
    setsWon,
    legsWon,
    legsNeeded,
    setsNeeded,
    leg,
    legStarter,
    current,
    openTurnIndex: openTurn ? openTurn.index : -1,
    turnDarts,
    turnEval,
    dartsLeft,
    scores: match.players.map((_, i) => mode.displayScore(leg, i)),
    hint: finished ? null : mode.hint(match.options, leg, current, turnEval, dartsLeft),
    legs,
  };
}

function clone(match) {
  return { ...match, turns: match.turns.map((t) => ({ ...t, darts: t.darts.slice() })), updatedAt: Date.now() };
}

/** Dart hinzufügen. Gibt null zurück, wenn die Aufnahme keine Darts mehr annimmt. */
export function addDart(match, hit, source = 'manual', extra = {}) {
  const st = derive(match);
  if (st.finished) return null;
  if (st.openTurnIndex >= 0 && st.turnEval.closed) return null;
  const m = clone(match);
  const dart = { segment: hit.segment, multiplier: hit.multiplier, source, ts: Date.now(), ...extra };
  if (st.openTurnIndex >= 0) m.turns[st.openTurnIndex].darts.push(dart);
  else m.turns.push({ player: st.current, darts: [dart], closed: false, openedAt: Date.now() });
  return m;
}

/** Aufnahme abschließen; fehlende Darts zählen als 0 (Fehlwurf / Bounce-out). */
export function closeTurn(match) {
  const st = derive(match);
  if (st.finished) return match;
  const m = clone(match);
  let idx = st.openTurnIndex;
  if (idx < 0) {
    m.turns.push({ player: st.current, darts: [], closed: false, openedAt: Date.now() });
    idx = m.turns.length - 1;
  }
  const t = m.turns[idx];
  const ev = st.mode.evaluateTurn(m.options, st.leg, st.current, t.darts);
  // Darts nach Bust/Finish verwerfen
  t.darts = t.darts.slice(0, ev.usedDarts);
  if (!ev.bust && !ev.finished) {
    while (t.darts.length < st.mode.dartsPerTurn) t.darts.push({ ...MISS, source: 'filled', ts: Date.now() });
  }
  t.closed = true;
  t.closedAt = Date.now();
  return finalize(m);
}

function finalize(m) {
  const st = derive(m);
  m.status = st.finished ? 'finished' : 'running';
  m.winner = st.finished ? st.winner : null;
  return m;
}

/**
 * Aufnahme als Summe eintragen (z. B. 85) und abschließen.
 * darts: bei Checkout die Zahl der benötigten Darts (1–3), sonst 3.
 * Eine offene Aufnahme mit einzelnen Darts wird dabei ersetzt.
 */
export function enterTotal(match, points, darts = 3) {
  const st = derive(match);
  if (st.finished) return null;
  const m = clone(match);
  const turn = { player: st.current, darts: [], total: { points, darts }, closed: true, openedAt: Date.now(), closedAt: Date.now(), ts: Date.now() };
  if (st.openTurnIndex >= 0) m.turns[st.openTurnIndex] = turn;
  else m.turns.push(turn);
  return finalize(m);
}

/** Letzten Dart zurücknehmen (öffnet bei Bedarf die vorige Aufnahme wieder). */
export function undoDart(match) {
  const m = clone(match);
  // aufgefüllte Fehlwürfe der letzten Aufnahme zählen nicht als „echter“ letzter Dart
  for (let i = m.turns.length - 1; i >= 0; i--) {
    const t = m.turns[i];
    if (t.total) { m.turns.splice(i, 1); return finalize(m); } // Summen-Aufnahme ganz zurücknehmen
    if (t.closed) {
      t.closed = false;
      delete t.closedAt;
      while (t.darts.length && t.darts[t.darts.length - 1].source === 'filled') t.darts.pop();
    }
    if (t.darts.length) {
      t.darts.pop();
      if (!t.darts.length) m.turns.splice(i, 1);
      return finalize(m);
    }
    m.turns.splice(i, 1);
  }
  return finalize(m);
}

/** Ganze Aufnahme zurücknehmen: offene Aufnahme leeren, sonst letzte Aufnahme löschen. */
export function undoTurn(match) {
  const m = clone(match);
  if (!m.turns.length) return m;
  m.turns.pop();
  return finalize(m);
}

/** Einen Dart der offenen (oder zuletzt abgeschlossenen) Aufnahme ersetzen. */
export function correctDart(match, turnIndex, dartIndex, hit, extra = {}) {
  const m = clone(match);
  const t = m.turns[turnIndex];
  if (!t) return match;
  const old = t.darts[dartIndex];
  const dart = { segment: hit.segment, multiplier: hit.multiplier, source: 'corrected', ts: old ? old.ts : Date.now(), correctedFrom: old ? { segment: old.segment, multiplier: old.multiplier, source: old.source } : null, ...extra };
  if (dartIndex < t.darts.length) t.darts[dartIndex] = dart;
  else t.darts.push(dart);
  if (t.closed) {
    // Aufnahme neu bewerten (z. B. jetzt Bust) und wieder schließen
    t.closed = false;
    while (t.darts.length && t.darts[t.darts.length - 1].source === 'filled' && t.darts.length - 1 > dartIndex) t.darts.pop();
    // nur die letzte Aufnahme darf so wieder geschlossen werden
    if (turnIndex === m.turns.length - 1) return closeTurn(m);
    t.closed = true;
  }
  return finalize(m);
}

/** Flache, einheitliche Wurfliste für Statistiken (Spieler, Dart, Segment, Zeitpunkt, Match, Leg). */
export function throwRows(match) {
  const st = derive(match);
  const rows = [];
  const mode = st.mode;
  for (const leg of st.legs) {
    leg.turns.forEach((info, turnNo) => {
      if (info.total) {
        // Summen-Eingabe: eine Zeile je Dart, ohne Feld (unbekannt). Punkte stehen in turnPoints.
        for (let k = 0; k < info.ev.usedDarts; k++) {
          const last = k === info.ev.usedDarts - 1;
          rows.push({
            id: `${match.id}:${info.index}:${k}`,
            matchId: match.id,
            mode: match.mode,
            playerId: match.players[info.player],
            set: leg.set,
            leg: leg.legInSet,
            legOverall: leg.legOverall,
            turn: turnNo + 1,
            dart: k + 1,
            segment: null,
            multiplier: null,
            score: null,
            ts: info.ts,
            source: 'total',
            fromTotal: true,
            correctedFromCamera: false,
            imageId: null,
            counted: true,
            restBefore: info.startRemaining,
            turnPoints: info.ev.points,
            turnBust: info.ev.bust,
            checkout: info.ev.finished && last,
            // Wie viele Darts aufs Doppel gingen, ist bei Summen unbekannt: nur der Checkout-Dart zählt als Versuch
            onFinish: info.ev.finished && last,
          });
        }
        return;
      }
      info.darts.forEach((d, k) => {
        const counted = k < info.ev.usedDarts;
        const restBefore = k === 0 ? info.startRemaining : info.ev.running[k - 1];
        rows.push({
          id: `${match.id}:${info.index}:${k}`,
          matchId: match.id,
          mode: match.mode,
          playerId: match.players[info.player],
          set: leg.set,
          leg: leg.legInSet,
          legOverall: leg.legOverall,
          turn: turnNo + 1,
          dart: k + 1,
          segment: d.segment,
          multiplier: d.multiplier,
          score: dartScore(d),
          ts: d.ts,
          source: d.source,
          correctedFromCamera: d.source === 'corrected' && !!d.correctedFrom && d.correctedFrom.source === 'camera',
          imageId: d.imageId || null,
          counted,
          restBefore: restBefore ?? info.startRemaining,
          turnPoints: info.ev.points,
          turnBust: info.ev.bust,
          checkout: info.ev.finished && k === info.ev.usedDarts - 1,
          onFinish: mode.isOnFinish ? mode.isOnFinish(restBefore ?? info.startRemaining) : false,
        });
      });
    });
  }
  return rows;
}

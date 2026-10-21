// Laufendes Spiel: verbindet Match-Logik, Speicherung und Ansagen.
// Kennt keine Anzeige und keine Kamera – die hängen sich über Ereignisse an.

import * as M from './match.js';
import { lsSet, saveMatchWithThrows } from '../core/storage.js';
import { announceDart, announceTurn } from '../audio/speech.js';
import { hitLabel } from '../core/board.js';

export class GameSession {
  constructor(match) {
    this.match = match;
    this.listeners = new Set();
    this.announcedTurnKey = null;
    this.state = M.derive(match);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(type, data = {}) {
    for (const fn of this.listeners) fn(type, data, this);
  }

  set(match, type, data) {
    this.match = match;
    this.state = M.derive(match);
    lsSet('activeMatch', this.match.status === 'running' ? this.match : null);
    this.emit(type, data);
  }

  get turnKey() {
    return `${this.match.turns.length}:${this.state.openTurnIndex}`;
  }

  /** Dart eintragen (Hand oder Kamera). */
  addDart(hit, source = 'manual', extra = {}) {
    const m = M.addDart(this.match, hit, source, extra);
    if (!m) return false;
    this.set(m, 'dart', { hit, source });
    announceDart(hit);
    if (this.state.turnEval.closed) this.announceComplete();
    return true;
  }

  /** Ansage, sobald die Aufnahme voll ist (3 Darts, Bust oder Finish). */
  announceComplete(force = false) {
    const key = `${this.state.openTurnIndex}`;
    if (!force && this.announcedTurnKey === key) return;
    this.announcedTurnKey = key;
    const ev = this.state.turnEval;
    const after = M.derive(M.closeTurn(this.match));
    const p = this.state.current;
    announceTurn({
      points: ev.points,
      bust: ev.bust,
      finished: ev.finished,
      remaining: ev.remaining,
      legWon: ev.finished,
      setWon: ev.finished && after.setsWon[p] > this.state.setsWon[p],
      matchWon: after.finished,
    });
  }

  correct(turnIndex, dartIndex, hit, extra = {}) {
    const wasClosed = this.state.turnEval.closed;
    const m = M.correctDart(this.match, turnIndex, dartIndex, hit, extra);
    this.set(m, 'correct', { turnIndex, dartIndex, hit });
    announceDart(hit);
    if (turnIndex === this.state.openTurnIndex && this.state.turnEval.closed) this.announceComplete(wasClosed);
  }

  undoDart() {
    this.set(M.undoDart(this.match), 'undo');
    this.announcedTurnKey = null;
  }

  undoTurn() {
    this.set(M.undoTurn(this.match), 'undo');
    this.announcedTurnKey = null;
  }

  /** Aufnahme abschließen und zum nächsten Spieler wechseln. */
  async next(reason = 'manual') {
    if (this.state.finished) return;
    const before = this.state;
    const ev = before.turnEval;
    if (!ev.closed) this.announceComplete(true);
    const labels = [...before.turnDarts.slice(0, ev.usedDarts || before.turnDarts.length)];
    const m = M.closeTurn(this.match);
    this.announcedTurnKey = null;
    this.set(m, 'next', { reason, before, labels: labels.map(hitLabel) });
    await this.persist();
    const st = this.state;
    if (st.finished) this.emit('matchWon', { winner: st.winner });
    else if (st.legOverall !== before.legOverall) this.emit('legWon', { winner: before.current, setWon: st.setNo !== before.setNo });
  }

  async persist() {
    try {
      await saveMatchWithThrows(this.match, M.throwRows(this.match));
    } catch (e) {
      console.warn('Speichern in IndexedDB fehlgeschlagen', e);
      this.emit('error', { message: 'Speichern fehlgeschlagen' });
    }
  }

  async abort() {
    this.match = { ...this.match, status: 'aborted', updatedAt: Date.now() };
    lsSet('activeMatch', null);
    await this.persist();
  }
}

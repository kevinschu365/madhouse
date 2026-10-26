// Match-Details: Zusammenfassung je Spieler und jedes Leg mit allen Aufnahmen.
// Wird aus dem Verlauf in der Statistik und am Spielende geöffnet.
import { h, sheet } from './dom.js';
import { derive, throwRows } from '../game/match.js';
import { playerStats, cricketStats } from '../stats/stats.js';
import { hitLabel } from '../core/board.js';

const date = (ts) => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Kennzahlen je Spieler als Tabelle (Spalten = Spieler). */
function summary(m, st) {
  const rows = throwRows(m);
  const mine = m.players.map((pid) => rows.filter((r) => r.playerId === pid));
  const head = h('tr', {}, h('td', {}), m.playerNames.map((n) => h('td', { class: 'num' }, h('b', {}, n))));
  const line = (label, fn) => h('tr', {}, h('td', {}, label), mine.map((rs, i) => h('td', { class: 'num' }, fn(rs, i))));
  const won = (i) => (m.format.setsBestOf > 1 ? `${st.setsWon[i]} Sets` : `${st.legsWon[i]} Legs`);
  let lines;
  if (m.mode === 'x01') {
    const s = mine.map((rs) => playerStats(rs));
    lines = [
      line('Ergebnis', (_, i) => won(i)),
      line('Average', (_, i) => s[i].average.toFixed(1)),
      line('First 9', (_, i) => s[i].first9.toFixed(1)),
      line('180er', (_, i) => s[i].c180),
      line('Höchste', (_, i) => s[i].highest),
      line('Bestes Leg', (_, i) => (s[i].bestLeg ? `${s[i].bestLeg} D.` : '–')),
      line('Finish', (_, i) => s[i].highestCheckout || '–'),
      line('Checkout', (_, i) => (s[i].checkoutAttempts ? `${s[i].checkouts}/${s[i].checkoutAttempts}` : '–')),
      line('Darts', (_, i) => s[i].darts),
    ];
  } else if (m.mode === 'cricket') {
    const c = mine.map((rs) => cricketStats(rs));
    lines = [
      line('Ergebnis', (_, i) => won(i)),
      line('MPR', (_, i) => c[i].mpr.toFixed(2)),
      line('Beste Runde', (_, i) => `${c[i].bestRound} M.`),
      line('Marks', (_, i) => c[i].marks),
      line('Darts', (_, i) => c[i].darts),
    ];
  } else {
    lines = [line('Ergebnis', (_, i) => won(i))];
  }
  return h('table', { class: 'hist detail' }, head, lines);
}

/** Text einer Aufnahme: X01 „60 → 441“, Cricket „3 M“, sonst Punkte. */
function visitText(m, mode, t) {
  const ev = t.ev;
  if (m.mode === 'x01') {
    if (ev.bust) return 'Bust';
    return ev.finished ? `✓ ${ev.points}` : `${ev.points} → ${ev.remaining}`;
  }
  if (mode.turnLabel) return mode.turnLabel(ev);
  return String(ev.points);
}

/** Ein Leg: wer gewonnen hat, mit wie vielen Darts, und alle Aufnahmen Runde für Runde. */
function legBlock(m, st, leg) {
  const mode = st.mode;
  const n = m.players.length;
  const darts = Array(n).fill(0);
  for (const t of leg.turns) darts[t.player] += t.ev.usedDarts || 0;
  const title = leg.winner != null
    ? `${m.playerNames[leg.winner]} gewinnt · ${darts[leg.winner]} Darts`
    : 'nicht beendet';
  // Runden: je Spieler eine Spalte; eine Runde = eine Aufnahme jedes Spielers ab dem Anwurf
  const order = Array.from({ length: n }, (_, k) => (leg.starter + k) % n);
  const rounds = [];
  const seen = Array(n).fill(0);
  for (const t of leg.turns) {
    const r = seen[t.player]++;
    (rounds[r] || (rounds[r] = Array(n).fill(null)))[t.player] = t;
  }
  const cell = (t) => {
    if (!t) return h('td', {}, '');
    // Einzelne Darts nur, wenn sie eingegeben wurden (nicht bei Summe oder automatisch aufgefüllten Fehlwürfen)
    const shown = t.total ? [] : t.darts.slice(0, t.ev.usedDarts);
    const darts = shown.every((d) => d.source === 'filled') ? '' : shown.map(hitLabel).join(' ');
    return h('td', { class: `num${t.ev.finished ? ' accent' : ''}` }, visitText(m, mode, t), darts ? h('div', { class: 'dartsline' }, darts) : null);
  };
  return h('div', { class: 'legblock' },
    h('div', { class: 'leghead' }, h('b', {}, `${m.format.setsBestOf > 1 ? `Set ${leg.set} · ` : ''}Leg ${leg.legInSet}`), h('span', {}, title)),
    h('table', { class: 'hist detail visits' },
      h('tr', {}, h('td', {}, '#'), order.map((p) => h('td', { class: 'num' }, m.playerNames[p]))),
      rounds.map((r, i) => h('tr', {}, h('td', { class: 'dim' }, i + 1), order.map((p) => cell(r[p])))),
    ),
  );
}

/** Blatt mit den Details eines Matches öffnen. */
export function showMatchDetail(m) {
  const st = derive(m);
  const legs = st.legs.filter((l) => l.turns.length);
  const s = sheet(h('div', { class: 'stack matchdetail' },
    h('h2', { style: { marginBottom: 0 } }, `${st.mode.label} · ${m.playerNames.join(' vs. ')}`),
    h('div', { class: 'dim', style: { fontSize: '14px' } }, `${date(m.createdAt)} · ${st.mode.describe(m.options)}`),
    summary(m, st),
    legs.map((l) => legBlock(m, st, l)),
    h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Schließen'),
  ));
  return s;
}

// Anzeige eines Turniers (Gruppen-Tabellen, Spielplan, K.-o.-Baum, Sieger), gemeinsam für den Turnier-Bildschirm
// am Handy und die Live-Ansicht der Turnierleitung (ui/screens/live.js).
import { h } from './dom.js';
import { TOURNAMENT_FORMATS, TIEBREAK_TEXT } from '../core/tournament.js';
import { derive } from '../game/match.js';

const sec = (text, right = null) => h('div', { class: 'sechead' }, h('span', {}, text), right);

/** Name eines Spielers oder Platzhalter („1. Gruppe A“, „Freilos“). */
export const nameOf = (t, id, label) => (id ? t.playerNames[id] || '?' : label || '–');

/** Eine Spielkarte (zwei Zeilen, Sieger fett). onTap(g) bei spielbaren/laufenden/beendeten Spielen. board: Board-Nummer, falls aufgerufen. */
export function gameCard(t, g, { onTap = null, board = null, noPlay = false } = {}) {
  const side = (id, label) => h('div', { class: `tside ${g.winnerId && g.winnerId === id ? 'win' : g.winnerId ? 'lose' : ''}` },
    h('span', {}, nameOf(t, id, label)),
    g.result ? h('b', { class: 'num' }, g.result.walkover ? (g.winnerId === id ? 'w.o.' : '–') : g.result.legs[id] ?? '') : null);
  const live = g.status === 'running' && g.match ? liveScore(g.match) : null;
  return h('div', {
    class: `tgame ${g.status}${onTap && ['ready', 'running', 'done'].includes(g.status) ? ' tap' : ''}`,
    onclick: () => { if (onTap && ['ready', 'running', 'done'].includes(g.status)) onTap(g); },
  },
  side(g.a, g.aLabel), side(g.b, g.bLabel),
  board && g.status !== 'done' ? h('div', { class: 'tplay' }, `🎯 Board ${board}${live ? ` · ${live}` : ''}`)
    : g.status === 'ready' && onTap && !noPlay ? h('div', { class: 'tplay' }, '▶ Spielen')
      : g.status === 'running' ? h('div', { class: 'tplay' }, `⏵ läuft${live ? ` · ${live}` : ''}`) : null);
}

/** Kurzer Live-Stand eines laufenden Matches: „1:0 · 141–260“ (Legs, dann Rest bzw. Punkte). */
export function liveScore(m) {
  try {
    const st = derive(m);
    // X01: beim Werfer schon die Darts der laufenden Aufnahme abziehen (wie in der Board-Kachel)
    const scores = st.scores.map((v, i) => (m.mode === 'x01' && !st.finished && i === st.current && st.turnEval && st.turnEval.remaining != null ? st.turnEval.remaining : v));
    // Spiel in Sätzen: erst die Sätze, dann die Legs im laufenden Satz
    const sets = m.format && m.format.setsBestOf > 1 ? `Sätze ${st.setsWon.join(':')} · ` : '';
    return `${sets}${st.legsWon.join(':')} · ${scores.join('–')}`;
  } catch { return ''; }
}

/**
 * Tabelle einer Gruppe (Platz 1 und 2 hervorgehoben, wenn es ein K.-o. danach gibt). Rechnerisch sicher weiter: ✓,
 * sicher ausgeschieden: ✗ und grau. Spalte U nur, wenn es Unentschieden gibt. onName(id): Klick auf einen Namen (Spielerprofil).
 */
export function groupTable(t, grp, withKo, { onName = null, busy = null } = {}) {
  const draws = grp.table.some((r) => r.drawn);
  const look = grp.outlook || {};
  return h('table', { class: 'hist ttable', title: TIEBREAK_TEXT },
    h('tr', { class: 'dim small' }, h('td', {}, '#'), h('td', {}, 'Spieler'), h('td', { class: 'num' }, 'Sp.'), h('td', { class: 'num' }, 'S'), draws ? h('td', { class: 'num' }, 'U') : null, h('td', { class: 'num' }, 'N'), h('td', { class: 'num' }, 'Legs')),
    // Weiterkommer-Plätze (1 und 2 bei Gruppen + K.-o.) immer markiert, mit Spielen kräftiger, bei fertiger Gruppe ✓
    // busy: { Spieler: { kind: 'play'|'called'|'write', board } } – wer gerade am Board steht (Live-Ansicht), farbig markiert
    grp.table.map((r, i) => h('tr', { class: [withKo && i < 2 ? 'zone' : '', withKo && i < 2 && r.played ? 'qual' : !withKo && i === 0 && r.played ? 'lead' : '', withKo && i < 2 && grp.done ? 'through' : '', look[r.id] === 'out' ? 'outrow' : '', busy && busy[r.id] ? `busy-${busy[r.id].kind}` : ''].join(' ') },
      h('td', { class: 'num' }, i + 1),
      h('td', {},
        h('b', { class: onName ? 'namelink' : '', onclick: onName ? (e) => { e.stopPropagation(); onName(r.id); } : null }, nameOf(t, r.id)),
        busy && busy[r.id] ? h('span', { class: `busytag ${busy[r.id].kind}`, title: { play: 'spielt gerade', called: 'ist aufgerufen', write: 'schreibt gerade' }[busy[r.id].kind] },
          `${{ play: '🎯', called: '📣', write: '✍️' }[busy[r.id].kind]} B${busy[r.id].board}`) : null,
        !grp.done && look[r.id] === 'safe' ? h('span', { class: 'safetag', title: 'Kommt rechnerisch sicher weiter' }, ' ✓ sicher weiter') : null,
        !grp.done && look[r.id] === 'out' && !(t.withdrawn || {})[r.id] ? h('span', { class: 'outtag dimtag', title: 'Kann Platz 2 nicht mehr erreichen' }, ' ✗ raus') : null,
        (t.withdrawn || {})[r.id] ? h('span', { class: 'outtag' }, ' aufgegeben') : null,
        (t.absent || {})[r.id] && !(t.withdrawn || {})[r.id] ? h('span', { class: 'awaytag' }, ' ⏸ nicht da') : null),
      h('td', { class: 'num' }, r.played), h('td', { class: 'num accent' }, r.won), draws ? h('td', { class: 'num' }, r.drawn) : null, h('td', { class: 'num' }, r.lost),
      h('td', { class: 'num' }, `${r.legsFor}:${r.legsAgainst}`))));
}

/** K.-o.-Baum: eine Spalte je Runde (waagerecht wischen). */
export function bracket(t, st, opts = {}) {
  // Aktuelle Runde: die erste mit offenen Spielen (bei Gruppen + K.-o. erst, wenn die Gruppen fertig sind)
  const open = (r) => r.games.some((g) => g.status !== 'done' && g.status !== 'bye');
  const cur = t.format === 'gko' && !st.groupsDone ? -1 : st.koRounds.findIndex(open);
  return h('div', { class: 'bracket' }, st.koRounds.map((r, i) => h('div', { class: `bcol ${i === cur ? 'current' : ''} ${i < cur || (cur < 0 && !open(r) && st.done) ? 'past' : ''}` },
    h('div', { class: 'bhead' }, r.name, i === cur ? h('span', { class: 'bnowtag' }, 'läuft') : null),
    h('div', { class: 'bgames' }, r.games.map((g) => {
      const card = gameCard(t, g, { ...opts, board: opts.boardOf ? opts.boardOf(g) : null });
      // Spiel um Platz 3 steht mit Überschrift unter dem Finale
      return g.third ? h('div', { class: 'thirdwrap' }, h('div', { class: 'bsub' }, '🥉 Spiel um Platz 3'), card) : card;
    })))));
}

/** Sieger-Karte. */
export function champCard(t, st) {
  return h('div', { class: 'card mshero champcard', style: '--rc: #f5c542' },
    h('div', { class: 'champicon' }, '🏆'),
    h('div', { class: 'small dim' }, `${t.name} · ${TOURNAMENT_FORMATS[t.format]}`),
    h('div', { class: 'rankname' }, nameOf(t, st.champion)),
    h('div', { class: 'small dim' }, 'gewinnt das Turnier!'));
}

/**
 * Gesamter Turnierplan: Gruppen (Tabelle + Spiele), danach der K.-o.-Baum.
 * opts: { onTap(g), boardOf(g) -> Board-Nummer, compact (nur offene Gruppenspiele zeigen) }
 */
export function planView(t, st, opts = {}) {
  const out = [];
  const withKo = !!t.ko;
  const card = (g) => gameCard(t, g, { ...opts, board: opts.boardOf ? opts.boardOf(g) : null });
  if (st.groups.length) {
    out.push(sec(t.format === 'rr' ? '📊 Tabelle' : '👥 Gruppen', t.format === 'gko' ? h('span', { class: 'dim small', title: TIEBREAK_TEXT }, 'Platz 1 und 2 kommen weiter ⓘ') : null));
    out.push(h('div', { class: st.groups.length > 1 ? 'groupgrid' : '' }, st.groups.map((grp) => h('div', { class: 'card groupcard' },
      st.groups.length > 1 ? h('div', { class: 'grouphead' }, h('b', {}, grp.name), h('span', { class: 'small dim' }, grp.done ? 'fertig' : `${grp.games.filter((g) => g.status === 'done').length} / ${grp.games.length}`)) : null,
      groupTable(t, grp, withKo, { onName: opts.onName, busy: opts.busy }),
      h('details', { class: 'infofold', open: !opts.compact && st.groups.length === 1 },
        h('summary', {}, `Spiele (${grp.games.length})`),
        h('div', { class: 'rrgames' }, grp.games.map(card)))))));
  }
  if (st.koRounds.length) {
    out.push(sec('🌳 K.-o.-Runde'));
    out.push(bracket(t, st, opts));
  }
  return out;
}

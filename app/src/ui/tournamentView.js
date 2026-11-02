// Anzeige eines Turniers (Gruppen-Tabellen, Spielplan, K.-o.-Baum, Sieger), gemeinsam für den Turnier-Bildschirm
// am Handy und die Live-Ansicht der Turnierleitung (ui/screens/live.js).
import { h } from './dom.js';
import { TOURNAMENT_FORMATS } from '../core/tournament.js';
import { derive } from '../game/match.js';

const sec = (text, right = null) => h('div', { class: 'sechead' }, h('span', {}, text), right);

/** Name eines Spielers oder Platzhalter („1. Gruppe A“, „Freilos“). */
export const nameOf = (t, id, label) => (id ? t.playerNames[id] || '?' : label || '–');

/** Eine Spielkarte (zwei Zeilen, Sieger fett). onTap(g) bei spielbaren/laufenden/beendeten Spielen. board: Board-Nummer, falls aufgerufen. */
export function gameCard(t, g, { onTap = null, board = null } = {}) {
  const side = (id, label) => h('div', { class: `tside ${g.winnerId && g.winnerId === id ? 'win' : g.winnerId ? 'lose' : ''}` },
    h('span', {}, nameOf(t, id, label)),
    g.result ? h('b', { class: 'num' }, g.result.legs[id] ?? '') : null);
  const live = g.status === 'running' && g.match ? liveScore(g.match) : null;
  return h('div', {
    class: `tgame ${g.status}${onTap && ['ready', 'running', 'done'].includes(g.status) ? ' tap' : ''}`,
    onclick: () => { if (onTap && ['ready', 'running', 'done'].includes(g.status)) onTap(g); },
  },
  side(g.a, g.aLabel), side(g.b, g.bLabel),
  board && g.status !== 'done' ? h('div', { class: 'tplay' }, `🎯 Board ${board}${live ? ` · ${live}` : ''}`)
    : g.status === 'ready' && onTap ? h('div', { class: 'tplay' }, '▶ Spielen')
      : g.status === 'running' ? h('div', { class: 'tplay' }, `⏵ läuft${live ? ` · ${live}` : ''}`) : null);
}

/** Kurzer Live-Stand eines laufenden Matches: „1:0 · 141–260“ (Legs, dann Rest bzw. Punkte). */
export function liveScore(m) {
  try {
    const st = derive(m);
    return `${st.legsWon.join(':')} · ${st.scores.join('–')}`;
  } catch { return ''; }
}

/** Tabelle einer Gruppe (Platz 1 und 2 hervorgehoben, wenn es ein K.-o. danach gibt). */
export function groupTable(t, grp, withKo) {
  return h('table', { class: 'hist ttable' },
    h('tr', { class: 'dim small' }, h('td', {}, '#'), h('td', {}, 'Spieler'), h('td', { class: 'num' }, 'Sp.'), h('td', { class: 'num' }, 'S'), h('td', { class: 'num' }, 'N'), h('td', { class: 'num' }, 'Legs')),
    grp.table.map((r, i) => h('tr', { class: withKo && i < 2 && r.played ? 'qual' : i === 0 && r.played ? 'lead' : '' },
      h('td', { class: 'num' }, i + 1), h('td', {}, h('b', {}, nameOf(t, r.id))),
      h('td', { class: 'num' }, r.played), h('td', { class: 'num accent' }, r.won), h('td', { class: 'num' }, r.lost),
      h('td', { class: 'num' }, `${r.legsFor}:${r.legsAgainst}`))));
}

/** K.-o.-Baum: eine Spalte je Runde (waagerecht wischen). */
export function bracket(t, st, opts = {}) {
  return h('div', { class: 'bracket' }, st.koRounds.map((r) => h('div', { class: 'bcol' },
    h('div', { class: 'bhead' }, r.name),
    h('div', { class: 'bgames' }, r.games.map((g) => gameCard(t, g, { ...opts, board: opts.boardOf ? opts.boardOf(g) : null }))))));
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
    out.push(sec(t.format === 'rr' ? '📊 Tabelle' : '👥 Gruppen', t.format === 'gko' ? h('span', { class: 'dim small' }, 'Platz 1 und 2 kommen weiter') : null));
    out.push(h('div', { class: st.groups.length > 1 ? 'groupgrid' : '' }, st.groups.map((grp) => h('div', { class: 'card groupcard' },
      st.groups.length > 1 ? h('div', { class: 'grouphead' }, h('b', {}, grp.name), h('span', { class: 'small dim' }, grp.done ? 'fertig' : `${grp.games.filter((g) => g.status === 'done').length} / ${grp.games.length}`)) : null,
      groupTable(t, grp, withKo),
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

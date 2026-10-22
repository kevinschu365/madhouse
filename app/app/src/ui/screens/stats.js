import { h, confirmDialog, toast } from '../dom.js';
import { dbGetAll, deleteMatch } from '../../core/storage.js';
import { getPlayers } from '../../core/settings.js';
import { playerStats, detectionStats } from '../../stats/stats.js';
import { derive } from '../../game/match.js';

export function render(root, params, nav) {
  const body = h('div', { class: 'stack', style: { maxWidth: '640px', margin: '0 auto' } },
    h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Statistik')),
    h('p', { class: 'dim' }, 'Lade …'));
  root.appendChild(body);
  let selectedPlayer = params.player || null;

  Promise.all([dbGetAll('throws'), dbGetAll('matches')]).then(([rows, matches]) => {
    const finished = matches.filter((m) => m.status === 'finished');
    const finishedIds = new Set(finished.map((m) => m.id));
    // Statistik nur aus beendeten Matches (abgebrochene zählen nicht)
    const usable = rows.filter((r) => finishedIds.has(r.matchId));
    const known = getPlayers();
    const names = new Map();
    for (const m of matches) m.players.forEach((id, i) => names.set(id, m.playerNames[i]));
    for (const p of known) names.set(p.id, p.name);
    const ids = [...new Set([...known.map((p) => p.id), ...usable.map((r) => r.playerId)])];
    if (!selectedPlayer && ids.length) selectedPlayer = ids[0];

    const draw = () => {
      body.replaceChildren(
        h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Statistik')),
      );
      if (!ids.length) { body.appendChild(h('p', { class: 'dim' }, 'Noch keine Spiele gespeichert.')); return; }
      body.appendChild(h('div', { class: 'chips' }, ids.map((id) =>
        h('button', { class: `chip ${id === selectedPlayer ? 'on' : ''}`, onclick: () => { selectedPlayer = id; draw(); } }, names.get(id) || '?'))));
      const pr = usable.filter((r) => r.playerId === selectedPlayer);
      const s = playerStats(pr);
      const myMatches = finished.filter((m) => m.players.includes(selectedPlayer)).sort((a, b) => b.createdAt - a.createdAt);
      const won = myMatches.filter((m) => m.players[m.winner] === selectedPlayer).length;
      const stat = (v, k) => h('div', { class: 'stat' }, h('div', { class: 'v num' }, v), h('div', { class: 'k' }, k));
      body.appendChild(h('div', { class: 'statgrid' },
        stat(s.average.toFixed(2), 'Average (3 Darts)'),
        stat(s.first9.toFixed(2), 'First-9-Average'),
        stat(s.highest, 'Höchste Aufnahme'),
        stat(s.c180, '180er'),
        stat(s.c140, '140+'),
        stat(s.c100, '100+'),
        stat(s.checkoutAttempts ? `${(s.checkoutRate * 100).toFixed(1)} %` : '–', `Checkout-Quote (${s.checkouts}/${s.checkoutAttempts})`),
        stat(s.highestCheckout || '–', 'Höchstes Finish'),
        stat(s.bestLeg ? `${s.bestLeg}` : '–', 'Bestes Leg (Darts)'),
        stat(`${won} / ${myMatches.length}`, 'Matches gewonnen'),
        stat(s.legsWon, 'Legs gewonnen'),
        stat(s.darts, 'Darts geworfen'),
      ));
      const det = detectionStats(pr);
      if (det.total) body.appendChild(h('p', { class: 'dim' }, `Kamera-Erkennung bei diesem Spieler: ${det.total - det.corrected} von ${det.total} Darts ohne Korrektur (${(det.rate * 100).toFixed(0)} %).`));
      body.appendChild(h('p', { class: 'dim', style: { fontSize: '13px' } }, 'Checkout-Quote = Treffer ins Finish geteilt durch alle Darts, die auf ein mögliches Ein-Dart-Finish (Doppel oder Bull) geworfen wurden. Bei Summen-Eingabe ist unbekannt, wie viele Darts aufs Doppel gingen – dort zählt nur der Checkout-Dart, die Quote fällt dann zu gut aus.'));

      body.appendChild(h('h3', { style: { marginTop: '10px' } }, 'Verlauf'));
      const table = h('table', { class: 'hist' });
      for (const m of myMatches) {
        const me = m.players.indexOf(selectedPlayer);
        const opp = 1 - me;
        let res = '';
        try {
          const st = derive(m);
          res = m.format.setsBestOf > 1 ? `${st.setsWon[me]}:${st.setsWon[opp]} Sets` : `${st.legsWon[me]}:${st.legsWon[opp]} Legs`;
        } catch { res = '?'; }
        const mrows = pr.filter((r) => r.matchId === m.id);
        const ms = playerStats(mrows);
        table.appendChild(h('tr', {},
          h('td', {}, new Date(m.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })),
          h('td', {}, `vs. ${m.playerNames[opp]}`),
          h('td', { class: m.winner === me ? 'accent' : '' }, res),
          h('td', { class: 'num' }, `Ø ${ms.average.toFixed(1)}`),
          h('td', {}, h('button', {
            class: 'iconbtn', 'aria-label': 'Löschen',
            onclick: async () => {
              if (await confirmDialog('Match löschen?', 'Alle Würfe dieses Matches werden aus der Statistik entfernt.', { ok: 'Löschen', danger: true })) {
                await deleteMatch(m.id); toast('Gelöscht'); nav.go('stats', { player: selectedPlayer });
              }
            },
          }, '🗑')),
        ));
      }
      if (!myMatches.length) body.appendChild(h('p', { class: 'dim' }, 'Noch keine beendeten Matches.'));
      else body.appendChild(table);
    };
    draw();
  }).catch((e) => {
    body.appendChild(h('p', { class: 'dim' }, `Statistik konnte nicht geladen werden: ${e.message}`));
  });
}

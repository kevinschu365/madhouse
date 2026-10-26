import { h, confirmDialog, toast } from '../dom.js';
import { dbGetAll, deleteMatch } from '../../core/storage.js';
import { getPlayers } from '../../core/settings.js';
import { playerStats, detectionStats, cricketStats, trainingRecords, doubleStats, personalRecords, milestones } from '../../stats/stats.js';
import { isBotId } from '../../game/bot.js';
import { derive } from '../../game/match.js';
import { getMode, isTraining } from '../../rules/index.js';

const TABS = [['x01', 'X01'], ['cricket', 'Cricket'], ['training', 'Training'], ['records', 'Rekorde']];

export function render(root, params, nav) {
  const body = h('div', { class: 'stack', style: { maxWidth: '640px', margin: '0 auto' } },
    h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Statistik')),
    h('p', { class: 'dim' }, 'Lade …'));
  root.appendChild(body);
  let selectedPlayer = params.player || null;
  let tab = params.tab || 'x01';

  Promise.all([dbGetAll('throws'), dbGetAll('matches')]).then(([rows, matches]) => {
    const finished = matches.filter((m) => m.status === 'finished');
    // Statistik nur aus beendeten Matches gegen echte Spieler (abgebrochene und Spiele gegen den Computer zählen nicht)
    const vsBot = (m) => m.players.some(isBotId);
    const realIds = new Set(finished.filter((m) => !vsBot(m)).map((m) => m.id));
    const usable = rows.filter((r) => realIds.has(r.matchId));
    const known = getPlayers();
    const names = new Map();
    for (const m of matches) m.players.forEach((id, i) => names.set(id, m.playerNames[i]));
    for (const p of known) names.set(p.id, p.name);
    // Der Computer-Gegner bekommt keine eigene Statistik
    const ids = [...new Set([...known.map((p) => p.id), ...usable.map((r) => r.playerId)])].filter((id) => !isBotId(id));
    if (!selectedPlayer && ids.length) selectedPlayer = ids[0];

    const stat = (v, k) => h('div', { class: 'stat' }, h('div', { class: 'v num' }, v), h('div', { class: 'k' }, k));
    const date = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const delBtn = (m) => h('button', {
      class: 'iconbtn', 'aria-label': 'Löschen',
      onclick: async () => {
        if (await confirmDialog('Eintrag löschen?', 'Alle Würfe davon werden aus der Statistik entfernt.', { ok: 'Löschen', danger: true })) {
          await deleteMatch(m.id); toast('Gelöscht'); nav.go('stats', { player: selectedPlayer, tab });
        }
      },
    }, '🗑');

    /** Verlauf der Matches eines Modus (gegen andere Spieler). */
    const matchHistory = (list, pr, metric) => {
      const table = h('table', { class: 'hist' });
      for (const m of list) {
        const me = m.players.indexOf(selectedPlayer);
        const opps = m.players.map((_, i) => i).filter((i) => i !== me);
        let res = '';
        try {
          const st = derive(m);
          const won = m.format.setsBestOf > 1 ? st.setsWon : st.legsWon;
          // Eigenes Ergebnis zuerst, dann die Gegner
          res = [me, ...opps].map((i) => won[i]).join(':') + (m.format.setsBestOf > 1 ? ' Sets' : ' Legs');
        } catch { res = '?'; }
        table.appendChild(h('tr', {},
          h('td', {}, date(m.createdAt)),
          h('td', {}, `vs. ${opps.map((i) => m.playerNames[i]).join(', ')}`),
          h('td', { class: m.winner === me ? 'accent' : '' }, res),
          h('td', { class: 'num' }, metric(pr.filter((r) => r.matchId === m.id))),
          h('td', {}, delBtn(m)),
        ));
      }
      return list.length ? table : h('p', { class: 'dim' }, 'Noch keine beendeten Matches.');
    };

    const drawX01 = (pr, myMatches) => {
      const s = playerStats(pr);
      const won = myMatches.filter((m) => m.players[m.winner] === selectedPlayer).length;
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
      // Trefferquote je Doppel: zeigt, welches Doppel gut sitzt und welches man üben sollte
      const dbl = doubleStats(pr);
      if (dbl.length) {
        body.appendChild(h('h3', { style: { marginTop: '10px' } }, 'Doppel-Quote'));
        body.appendChild(h('table', { class: 'hist' }, dbl.map((d) => h('tr', {},
          h('td', {}, h('b', {}, d.target)),
          h('td', { class: 'num' }, `${d.hits} / ${d.attempts}`),
          h('td', { class: 'num' }, h('div', { class: 'ratebar' }, h('div', { style: { width: `${Math.round(d.rate * 100)}%` } }))),
          h('td', { class: `num ${d.rate >= 0.35 ? 'accent' : ''}` }, `${Math.round(d.rate * 100)} %`),
        ))));
        body.appendChild(h('p', { class: 'dim', style: { fontSize: '13px' } }, 'Jeder Dart bei einem Ein-Dart-Finish (z. B. Rest 32 = D16) zählt als Versuch auf dieses Doppel. Nur Pro-Dart-, Scheiben- und Kamera-Eingabe; bei Summen-Eingabe ist unbekannt, wohin die Darts gingen.'));
      }
      body.appendChild(h('h3', { style: { marginTop: '10px' } }, 'Verlauf'));
      body.appendChild(matchHistory(myMatches, pr, (r) => `Ø ${playerStats(r).average.toFixed(1)}`));
    };

    const drawCricket = (pr, myMatches) => {
      const c = cricketStats(pr);
      const won = myMatches.filter((m) => m.players[m.winner] === selectedPlayer).length;
      body.appendChild(h('div', { class: 'statgrid' },
        stat(c.mpr.toFixed(2), 'MPR (Marks pro Runde)'),
        stat(c.bestRound, 'Beste Runde (Marks)'),
        stat(c.rounds5, 'Runden mit 5+ Marks'),
        stat(`${won} / ${myMatches.length}`, 'Matches gewonnen'),
        stat(c.turns, 'Runden'),
        stat(c.darts, 'Darts geworfen'),
      ));
      body.appendChild(h('p', { class: 'dim', style: { fontSize: '13px' } }, 'MPR zählt Marks, die eine Zahl schließen oder Punkte bringen. Faustregel: ab 2,0 MPR spielst du sehr ordentlich, ab 3,0 auf hohem Niveau.'));
      body.appendChild(h('h3', { style: { marginTop: '10px' } }, 'Verlauf'));
      body.appendChild(matchHistory(myMatches, pr, (r) => `MPR ${cricketStats(r).mpr.toFixed(2)}`));
    };

    // Rekorde (Bestwerte je Match) und Meilensteine – nur Spiele gegen echte Spieler
    const drawRecords = () => {
      const realMatches = finished.filter((m) => !vsBot(m));
      const rec = personalRecords(usable, realMatches, selectedPlayer);
      const line = (key, label) => {
        const r = rec[key];
        return h('tr', {},
          h('td', {}, label),
          h('td', { class: 'num accent' }, r ? r.text : '–'),
          h('td', { class: 'dim', style: { fontSize: '13px' } }, r ? `${date(r.at)}${r.opponents.length ? ` · vs. ${r.opponents.join(', ')}` : ''}` : ''),
        );
      };
      body.appendChild(h('h3', { style: { marginTop: '10px' } }, 'Persönliche Bestwerte'));
      body.appendChild(h('table', { class: 'hist' },
        line('avg', 'Bester Average'),
        line('bestLeg', 'Bestes Leg'),
        line('checkout', 'Höchstes Finish'),
        line('visit', 'Höchste Aufnahme'),
        line('c180', 'Meiste 180er (Match)'),
        line('mpr', 'Cricket: beste MPR'),
        line('round', 'Cricket: beste Runde'),
      ));
      const ms = milestones(usable, realMatches, selectedPlayer);
      const done = ms.filter((m) => m.at).length;
      body.appendChild(h('h3', { style: { marginTop: '14px' } }, `Meilensteine · ${done} / ${ms.length}`));
      // Erreichte zuerst (neueste oben), dann die offenen in fester Reihenfolge
      const sorted = [...ms.filter((m) => m.at).sort((a, b) => b.at - a.at), ...ms.filter((m) => !m.at)];
      body.appendChild(h('div', { class: 'milestones' }, sorted.map((m) => h('div', { class: `ms ${m.at ? 'on' : ''}` },
        h('div', { class: 'msicon' }, m.at ? m.icon : '🔒'),
        h('div', { class: 'mstext' },
          h('b', {}, m.title),
          h('span', {}, m.at ? date(m.at) : m.progress ? `${m.progress[0].toLocaleString('de-DE')} / ${m.progress[1].toLocaleString('de-DE')}` : 'noch offen'),
        ),
      ))));
      body.appendChild(h('p', { class: 'dim', style: { fontSize: '13px' } }, 'Gezählt werden beendete Matches gegen echte Spieler (X01 und Cricket). Spiele gegen den Computer und Trainings zählen nicht.'));
    };

    // Spiele gegen den Computer: eigene Bilanz je Spiel und Stärke (getrennt von echten Gegnern)
    const drawVsBot = () => {
      const games = finished.filter((m) => vsBot(m) && m.players.length === 2 && m.players[0] === selectedPlayer);
      if (!games.length) return false;
      const groups = new Map();
      for (const m of games) {
        const key = `${m.mode}|${m.players[1]}`;
        (groups.get(key) || groups.set(key, []).get(key)).push(m);
      }
      body.appendChild(h('h3', { style: { marginTop: '10px' } }, '🤖 Gegen den Computer'));
      const table = h('table', { class: 'hist' });
      for (const [key, list] of groups) {
        const [mode] = key.split('|');
        const myRows = rows.filter((r) => r.playerId === selectedPlayer && list.some((m) => m.id === r.matchId));
        const value = mode === 'x01' ? `Ø ${playerStats(myRows).average.toFixed(1)}` : `MPR ${cricketStats(myRows).mpr.toFixed(2)}`;
        table.appendChild(h('tr', {},
          h('td', {}, `${getMode(mode).label} · ${list[0].playerNames[1]}`),
          h('td', { class: 'num' }, `${list.filter((m) => m.winner === 0).length} / ${list.length} gewonnen`),
          h('td', { class: 'num' }, value),
        ));
      }
      body.appendChild(table);
      return true;
    };

    const drawTraining = () => {
      const hadBot = drawVsBot();
      const recs = trainingRecords(finished, selectedPlayer, getMode);
      const keys = Object.keys(recs);
      if (!keys.length) {
        if (hadBot) return;
        body.appendChild(h('p', { class: 'dim' }, 'Noch keine Trainings beendet.'));
        body.appendChild(h('button', { class: 'btn primary', onclick: () => nav.go('training', { player: selectedPlayer }) }, 'Zum Training'));
        return;
      }
      for (const k of keys) {
        const r = recs[k];
        const mode = getMode(r.last.mode);
        const values = r.recent.map((e) => e.value);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const table = h('table', { class: 'hist' }, r.recent.map((e) => h('tr', {},
          h('td', {}, date(e.at)),
          h('td', { class: e.matchId === r.best.matchId ? 'accent' : '' }, e.text),
          h('td', {}, delBtn(finished.find((m) => m.id === e.matchId))),
        )));
        body.appendChild(h('div', { class: 'card stack' },
          h('h3', { style: { margin: 0 } }, mode.describe(r.last.options)),
          h('div', { class: 'statgrid' },
            stat(r.best.text, 'Rekord'),
            stat(Number.isInteger(avg) ? avg : avg.toFixed(1), `Schnitt letzte ${values.length}`),
          ),
          h('div', { class: 'dim', style: { fontSize: '14px' } }, `${r.count}× gespielt`),
          table,
        ));
      }
    };

    const draw = () => {
      body.replaceChildren(
        h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Statistik')),
      );
      if (!ids.length) { body.appendChild(h('p', { class: 'dim' }, 'Noch keine Spiele gespeichert.')); return; }
      body.appendChild(h('div', { class: 'chips' }, ids.map((id) =>
        h('button', { class: `chip ${id === selectedPlayer ? 'on' : ''}`, onclick: () => { selectedPlayer = id; draw(); } }, names.get(id) || '?'))));
      body.appendChild(h('div', { class: 'tabs' }, TABS.map(([k, label]) =>
        h('button', { class: `tab ${tab === k ? 'on' : ''}`, onclick: () => { tab = k; draw(); } }, label))));
      if (tab === 'training') { drawTraining(); return; }
      if (tab === 'records') { drawRecords(); return; }
      const pr = usable.filter((r) => r.playerId === selectedPlayer && r.mode === tab);
      const myMatches = finished
        .filter((m) => m.mode === tab && !isTraining(m.mode) && !vsBot(m) && m.players.length > 1 && m.players.includes(selectedPlayer))
        .sort((a, b) => b.createdAt - a.createdAt);
      if (tab === 'cricket') drawCricket(pr, myMatches);
      else drawX01(pr, myMatches);
    };
    draw();
  }).catch((e) => {
    body.appendChild(h('p', { class: 'dim' }, `Statistik konnte nicht geladen werden: ${e.message}`));
  });
}

import { h, toast } from '../dom.js';
import { dbGetAll } from '../../core/storage.js';
import { getPlayers, displayName, ownerId, isGuestId } from '../../core/settings.js';
import { playerStats, detectionStats, cricketStats, trainingRecords, doubleStats } from '../../stats/stats.js';
import { isBotId } from '../../game/bot.js';
import { derive } from '../../game/match.js';
import { showMatchDetail } from '../matchDetail.js';
import { lineChart } from '../chart.js';
import { getMode, isTraining } from '../../rules/index.js';
import { trainingTips } from '../../stats/coach.js';

const TABS = [['x01', 'X01'], ['cricket', 'Cricket'], ['training', 'Training']]; // Rekorde und Meilensteine haben eigene Bereiche (records.js, milestones.js)

export function render(root, params, nav) {
  // Früher war „Rekorde“ ein Reiter hier – jetzt eigener Bereich
  if (params.tab === 'records') { nav.go('milestones', { player: params.player }); return; }
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
    const usable = rows.filter((r) => realIds.has(r.matchId) && !isGuestId(r.playerId)); // Gäste bekommen keine Statistik
    const known = getPlayers();
    const names = new Map();
    for (const m of matches) m.players.forEach((id, i) => names.set(id, m.playerNames[i]));
    for (const p of known) names.set(p.id, displayName(p, known));
    // Der Computer-Gegner bekommt keine eigene Statistik
    const ids = [...new Set([...known.map((p) => p.id), ...usable.map((r) => r.playerId)])].filter((id) => !isBotId(id) && !isGuestId(id));
    // Ohne Vorgabe: der Spieler, dem dieses Handy gehört, sonst der erste
    if (!selectedPlayer && ids.length) selectedPlayer = ids.includes(ownerId()) ? ownerId() : ids[0];

    const date = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    // Bausteine im Stil der Rekorde-Seite: Abschnitts-Kopf, Kennzahl-Kachel, Erklärung zum Aufklappen
    const sec = (text, right = null) => h('div', { class: 'sechead' }, h('span', {}, text), right);
    const kpi = (v, k, cls = '') => h('div', { class: `kpi ${cls}` }, h('b', { class: 'num' }, v), h('span', {}, k));
    const info = (...texts) => h('details', { class: 'infofold' }, h('summary', {}, 'ⓘ Wie wird gezählt?'), texts.map((t) => h('p', {}, t)));
    const pct = (v) => `${(v * 100).toFixed(v >= 0.9995 ? 0 : 1).replace('.', ',')} %`;
    const dec = (v, n = 2) => v.toFixed(n).replace('.', ',');

    /** Verlauf der Matches eines Modus (gegen andere Spieler). Beendete Matches bleiben immer drin. */
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
        table.appendChild(h('tr', { class: 'tap', onclick: () => showMatchDetail(m) },
          h('td', {}, date(m.createdAt)),
          h('td', {}, `${m.tournament ? '🏆 ' : ''}vs. ${opps.map((i) => m.playerNames[i]).join(', ')}`),
          h('td', { class: m.winner === me ? 'accent' : '' }, res),
          h('td', { class: 'num' }, metric(pr.filter((r) => r.matchId === m.id))),
          h('td', { class: 'dim' }, '›'),
        ));
      }
      return list.length ? table : h('p', { class: 'dim' }, 'Noch keine beendeten Matches.');
    };

    /** Kopfkarte: drei große Kennzahlen und eine Zeile Bilanz. */
    const hero = (kpis, line) => h('div', { class: 'card mshero statshero', style: '--rc: var(--accent)' },
      h('div', { class: 'kpis big' }, kpis), h('div', { class: 'small dim' }, line));

    const drawX01 = (pr, myMatches) => {
      const s = playerStats(pr);
      const won = myMatches.filter((m) => m.players[m.winner] === selectedPlayer).length;
      body.appendChild(hero([
        kpi(dec(s.average), 'Average'),
        kpi(dec(s.first9), 'First 9'),
        kpi(s.checkoutAttempts ? pct(s.checkoutRate) : '–', 'Checkout-Quote'),
      ], `${won} von ${myMatches.length} Matches gewonnen · ${s.legsWon} Legs · ${s.darts.toLocaleString('de-DE')} Darts`));
      body.appendChild(sec('💥 Scoring'));
      body.appendChild(h('div', { class: 'kpis four' }, kpi(s.highest || '–', 'Höchste'), kpi(s.c180, '180er'), kpi(s.c140, '140+'), kpi(s.c100, '100+')));
      body.appendChild(sec('🏁 Finish'));
      body.appendChild(h('div', { class: 'kpis' }, kpi(s.highestCheckout || '–', 'Höchstes Finish'), kpi(s.bestLeg || '–', 'Bestes Leg (Darts)'), kpi(`${s.checkouts} / ${s.checkoutAttempts}`, 'Checkouts')));
      const det = detectionStats(pr);
      if (det.total) body.appendChild(h('div', { class: 'small dim' }, `📷 Kamera: ${det.total - det.corrected} von ${det.total} Darts ohne Korrektur (${(det.rate * 100).toFixed(0)} %)`));
      // Trefferquote je Doppel: zeigt, welches Doppel gut sitzt und welches man üben sollte
      const dbl = doubleStats(pr);
      if (dbl.length) {
        body.appendChild(sec('🎯 Doppel-Quote'));
        body.appendChild(h('div', { class: 'card dbllist' }, dbl.map((d) => h('div', { class: 'dblrow' },
          h('b', {}, d.target),
          h('div', { class: 'ratebar' }, h('div', { style: { width: `${Math.round(d.rate * 100)}%` } })),
          h('span', { class: `num ${d.rate >= 0.35 ? 'accent' : ''}` }, `${Math.round(d.rate * 100)} %`),
          h('span', { class: 'num dim small' }, `${d.hits}/${d.attempts}`),
        ))));
      }
      body.appendChild(sec('📈 Verlauf'));
      // Diagramme: die letzten 30 Matches, älteste links
      const recent = myMatches.slice(0, 30).reverse().map((m) => ({ m, s: playerStats(pr.filter((r) => r.matchId === m.id)) }));
      const opp = (m) => `vs. ${m.playerNames.filter((_, i) => m.players[i] !== selectedPlayer).join(', ')}`;
      body.appendChild(h('div', { class: 'charts' },
        lineChart(recent.filter((e) => e.s.darts).map((e) => ({ y: e.s.average, at: e.m.createdAt, label: opp(e.m), m: e.m })),
          { title: 'Average je Match', onOpen: (p) => showMatchDetail(p.m) }),
        lineChart(recent.filter((e) => e.s.checkoutAttempts).map((e) => ({ y: e.s.checkoutRate * 100, at: e.m.createdAt, label: opp(e.m), m: e.m })),
          { title: 'Checkout-Quote je Match (%)', format: (v) => `${v.toFixed(0)} %`, onOpen: (p) => showMatchDetail(p.m), min: 0, max: 100 }),
      ));
      body.appendChild(sec('🗂️ Matches', h('span', { class: 'num dim' }, myMatches.length)));
      body.appendChild(matchHistory(myMatches, pr, (r) => `Ø ${playerStats(r).average.toFixed(1)}`));
      body.appendChild(info(
        'Checkout-Quote = Treffer ins Finish geteilt durch alle Darts, die auf ein mögliches Ein-Dart-Finish (Doppel oder Bull) geworfen wurden. Bei Summen-Eingabe fragt die App, wie viele Darts aufs Doppel gingen, sobald ein Doppel möglich war (ab Version 1.6.1; ältere Summen-Spiele zählen nur den Checkout-Dart).',
        'Doppel-Quote: Jeder Dart bei einem Ein-Dart-Finish (z. B. Rest 32 = D16) zählt als Versuch auf dieses Doppel. Summen-Aufnahmen zählen nur, wenn das Doppel eindeutig ist (z. B. Rest 40, kein Punkt).',
        'Gezählt werden alle beendeten Matches gegen echte Spieler. Abgebrochene Spiele und Spiele gegen den Computer zählen nicht. Beendete Matches lassen sich nicht löschen, damit die Statistik ehrlich bleibt.'));
    };

    const drawCricket = (pr, myMatches) => {
      const c = cricketStats(pr);
      const won = myMatches.filter((m) => m.players[m.winner] === selectedPlayer).length;
      body.appendChild(hero([
        kpi(dec(c.mpr), 'MPR'),
        kpi(c.bestRound || '–', 'Beste Runde'),
        kpi(c.rounds5, 'Runden 5+'),
      ], `${won} von ${myMatches.length} Matches gewonnen · ${c.turns} Runden · ${c.darts.toLocaleString('de-DE')} Darts`));
      body.appendChild(sec('📈 Verlauf'));
      const recent = myMatches.slice(0, 30).reverse().map((m) => ({ m, c: cricketStats(pr.filter((r) => r.matchId === m.id)) }));
      body.appendChild(h('div', { class: 'charts' },
        lineChart(recent.filter((e) => e.c.turns).map((e) => ({ y: e.c.mpr, at: e.m.createdAt, label: `vs. ${e.m.playerNames.filter((_, i) => e.m.players[i] !== selectedPlayer).join(', ')}`, m: e.m })),
          { title: 'MPR je Match', format: (v) => v.toFixed(2), onOpen: (p) => showMatchDetail(p.m) }),
      ));
      body.appendChild(sec('🗂️ Matches', h('span', { class: 'num dim' }, myMatches.length)));
      body.appendChild(matchHistory(myMatches, pr, (r) => `MPR ${cricketStats(r).mpr.toFixed(2)}`));
      body.appendChild(info(
        'MPR zählt Marks, die eine Zahl schließen oder Punkte bringen. MPR = Marks pro 3 Darts. Faustregel: ab 2,0 MPR spielst du sehr ordentlich, ab 3,0 auf hohem Niveau.',
        'Gezählt werden alle beendeten Matches gegen echte Spieler. Abgebrochene Spiele zählen nicht; beendete lassen sich nicht löschen.'));
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
      body.appendChild(sec('🤖 Gegen den Computer'));
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
      const recs = trainingRecords(finished, selectedPlayer, getMode);
      const keys = Object.keys(recs);
      const mine = finished.filter((m) => m.players.length === 1 && m.players[0] === selectedPlayer && isTraining(m.mode));
      const weekAgo = Date.now() - 7 * 86400000;
      // Vorschlag aus den eigenen Daten (wie auf der Trainingsseite)
      const tip = trainingTips(rows, finished, selectedPlayer)[0];
      if (tip) {
        body.appendChild(h('div', { class: 'card tipline tap', onclick: () => nav.go('training', { player: selectedPlayer }) },
          h('span', { class: 'tipicon' }, tip.icon),
          h('div', {}, h('b', {}, tip.title), h('div', { class: 'small dim' }, tip.text)),
          h('span', { class: 'dim' }, '›')));
      }
      if (keys.length) {
        body.appendChild(hero([
          kpi(mine.length, 'Trainings'),
          kpi(mine.filter((m) => m.createdAt >= weekAgo).length, 'letzte 7 Tage'),
          kpi(keys.length, 'Varianten'),
        ], 'Tipp auf eine Übung zeigt die letzten Ergebnisse.'));
      }
      drawVsBot();
      if (!keys.length) {
        body.appendChild(h('p', { class: 'dim' }, 'Noch keine Trainings beendet.'));
        body.appendChild(h('button', { class: 'btn primary', onclick: () => nav.go('training', { player: selectedPlayer }) }, 'Zum Training'));
        return;
      }
      body.appendChild(sec('🏋️ Übungen'));
      for (const k of keys) {
        const r = recs[k];
        const mode = getMode(r.last.mode);
        const values = r.recent.map((e) => e.value);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        body.appendChild(h('details', { class: 'card drillstat' },
          h('summary', {},
            h('div', { class: 'drilltop' }, h('b', {}, mode.describe(r.last.options)), h('span', { class: 'dim small' }, `${r.count}×`)),
            h('div', { class: 'kpis' },
              kpi(r.best.text, '🏆 Rekord'),
              kpi(Number.isInteger(avg) ? avg : avg.toFixed(1).replace('.', ','), `Schnitt letzte ${values.length}`),
              kpi(r.last.text, `Zuletzt ${date(r.last.at)}`))),
          h('table', { class: 'hist' }, r.recent.map((e) => h('tr', {},
            h('td', {}, date(e.at)),
            h('td', { class: e.matchId === r.best.matchId ? 'accent' : '' }, e.text),
          ))),
        ));
      }
      body.appendChild(info('Jede beendete Übung zählt und bleibt in der Liste; abgebrochene zählen nicht. Spiele gegen den Computer stehen getrennt und zählen nicht in die Statistik gegen echte Spieler.'));
    };

    const draw = () => {
      body.replaceChildren(
        h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Statistik')),
      );
      if (!ids.length) { body.appendChild(h('p', { class: 'dim' }, 'Noch keine Spiele gespeichert.')); return; }
      // Spieler per Auswahlliste (bei vielen Spielern wäre eine Knopfreihe zu voll)
      body.appendChild(h('label', { class: 'field' }, h('span', {}, 'Spieler'),
        h('select', { onchange: (e) => { selectedPlayer = e.target.value; draw(); } },
          ids.map((id) => h('option', { value: id, selected: id === selectedPlayer }, names.get(id) || '?')))));
      body.appendChild(h('div', { class: 'tabs' }, TABS.map(([k, label]) =>
        h('button', { class: `tab ${tab === k ? 'on' : ''}`, onclick: () => { tab = k; draw(); } }, label))));
      if (tab === 'training') { drawTraining(); return; }
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

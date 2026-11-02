// Rekorde (eigener Bereich, Knopf auf der Startseite): Treppchen je Bestwert – eigene oder Bestenliste aller Spieler,
// für immer, diese Saison oder diesen Monat –, Abend-Krone, Duelle und Monatsrückblick.
import { h } from '../dom.js';
import { personalPodiums, allPlayersPodiums, trainingRecords, RECORD_DEFS, MEDALS } from '../../stats/stats.js';
import { getMode } from '../../rules/index.js';
import { crownHolder, seasonOf, rivalries } from '../../stats/progress.js';
import { showMonthRecap, MONTHS } from '../recapSheet.js';
import { showMatchDetail } from '../matchDetail.js';
import { loadStatsData, pickDefault, playerPicker, date, sec, topbar } from '../statsData.js';

export function render(root, params, nav) {
  const body = h('div', { class: 'stack', style: { maxWidth: '680px', margin: '0 auto' } }, topbar('Rekorde', nav), h('p', { class: 'dim' }, 'Lade …'));
  root.appendChild(body);
  let period = 'all';  // 'all' | 'season' | 'month'
  let view = 'mine';   // 'mine' (eigene) | 'all' (Bestenliste aller Spieler)
  let scope = 'games'; // 'games' | 'training'

  loadStatsData().then(({ finished, realMatches, usable, names, ids }) => {
    let player = pickDefault(ids, params.player);
    const draw = () => {
      body.replaceChildren(topbar('Rekorde', nav));
      if (!ids.length) { body.appendChild(h('p', { class: 'dim' }, 'Noch keine Spiele gespeichert.')); return; }
      // Spiele oder Training – Trainings zählen nicht in die Bestwerte der Spiele
      body.appendChild(h('div', { class: 'seg two' },
        h('button', { class: scope === 'games' ? 'on' : '', onclick: () => { scope = 'games'; draw(); } }, '🎯 Spiele'),
        h('button', { class: scope === 'training' ? 'on' : '', onclick: () => { scope = 'training'; draw(); } }, '🏋️ Training')));
      if (scope === 'training') {
        body.appendChild(playerPicker(ids, names, player, (v) => { player = v; draw(); }));
        const recs = Object.values(trainingRecords(finished, player, getMode));
        body.appendChild(sec(`🏋️ Trainings-Rekorde von ${names.get(player) || '?'}`));
        if (!recs.length) body.appendChild(h('p', { class: 'dim' }, 'Noch keine Trainings beendet.'));
        body.appendChild(h('div', { class: 'podiums' }, recs.map((r) => h('div', { class: 'podcard trainrec' },
          h('div', { class: 'podtitle' }, getMode(r.last.mode).describe(r.last.options)),
          h('div', { class: 'kpis' },
            h('div', { class: 'kpi' }, h('b', { class: 'num' }, r.best.text), h('span', {}, `🏆 Rekord · ${date(r.best.at)}`)),
            h('div', { class: 'kpi' }, h('b', { class: 'num' }, r.last.text), h('span', {}, `Zuletzt · ${date(r.last.at)}`)),
            h('div', { class: 'kpi' }, h('b', { class: 'num' }, r.count), h('span', {}, 'Mal gespielt')))))));
        body.appendChild(h('p', { class: 'dim small' }, 'Trainings zählen nicht in die Bestwerte, Ränge und Meilensteine der Spiele.'));
        return;
      }
      const global = view === 'all';
      // Umschalter groß oben: eigene Rekorde oder Bestenliste aller Spieler
      body.appendChild(h('div', { class: 'seg two' },
        h('button', { class: global ? '' : 'on', onclick: () => { view = 'mine'; draw(); } }, '👤 Meine Rekorde'),
        h('button', { class: global ? 'on' : '', onclick: () => { view = 'all'; draw(); } }, '🏆 Bestenliste')));
      const nowD = new Date();
      body.appendChild(h('div', { class: global ? '' : 'grid2' },
        global ? null : playerPicker(ids, names, player, (v) => { player = v; draw(); }),
        h('label', { class: 'field' }, h('span', {}, 'Zeitraum'),
          h('select', { onchange: (e) => { period = e.target.value; draw(); } },
            [['all', 'Für immer'], ['season', `Saison (${seasonOf().name})`], ['month', `${MONTHS[nowD.getMonth()]}`]]
              .map(([v, l]) => h('option', { value: v, selected: v === period }, l))))));

      // Abend-Krone
      const crown = crownHolder(usable, realMatches);
      if (crown) {
        body.appendChild(h('div', { class: 'card crowncard' }, h('span', { class: 'crownicon' }, '👑'),
          h('div', {}, h('b', {}, `Abend-Krone: ${crown.name}`), h('div', { class: 'small dim' }, `Bester Average am letzten Spieltag (Ø ${crown.average.toFixed(1)}). Bleibt bis zum nächsten Spieltag.`))));
      }

      // Treppchen je Bestwert
      const from = period === 'month' ? new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime() : period === 'season' ? seasonOf().start : 0;
      const podMatches = realMatches.filter((m) => m.createdAt >= from);
      const pods = global ? allPlayersPodiums(usable, podMatches) : personalPodiums(usable, podMatches, player);
      const step = (e, place) => h('button', {
        class: `step p${place + 1} ${e ? '' : 'empty'} ${e && global && e.playerId === player ? 'me' : ''}`,
        onclick: () => { const m = e && finished.find((x) => x.id === e.matchId); if (m) showMatchDetail(m); },
      },
      h('div', { class: 'medal' }, MEDALS[place]),
      global && e ? h('div', { class: 'who' }, e.name) : null,
      h('div', { class: 'v num' }, e ? e.text : '–'),
      // Eigene Bestwerte: darunter der Gegner („vs. Kevin“), nicht der eigene Name
      h('div', { class: 'd' }, e ? (global ? date(e.at) : `${date(e.at)}${e.opponents.length ? ` · vs. ${e.opponents.join(', ')}` : ''}`) : ''));
      const shown = RECORD_DEFS.filter((d) => pods[d.key]);
      body.appendChild(sec(global ? '🏆 Bestenliste aller Spieler' : `🏆 Bestwerte von ${names.get(player) || '?'}`));
      if (!shown.length) body.appendChild(h('p', { class: 'dim' }, 'Noch keine Bestwerte in diesem Zeitraum – erst ein Match gegen echte Gegner beenden.'));
      body.appendChild(h('div', { class: 'podiums' }, shown.map((d) => h('div', { class: 'podcard' },
        h('div', { class: 'podtitle' }, d.label),
        h('div', { class: 'podium' }, [0, 1, 2].map((i) => step(pods[d.key][i], i)))))));

      if (!global) {
        // Duelle: Bilanz gegen jeden Gegner (Spiele zu zweit)
        const rivals = rivalries(realMatches, player);
        if (rivals.length) {
          body.appendChild(sec('⚔️ Duelle'));
          body.appendChild(h('table', { class: 'hist' }, rivals.map((r) => h('tr', {},
            h('td', {}, `vs. ${r.name}`),
            h('td', { class: `num ${r.wins > r.losses ? 'accent' : ''}` }, `${r.wins} : ${r.losses}`),
            h('td', { class: 'dim', style: { fontSize: '13px' } }, r.streak >= 2 ? `🔥 ${r.streak} Siege in Folge` : r.streak <= -2 ? `${-r.streak} Niederlagen in Folge` : '')))));
        }
      }

      // Monatsrückblick
      const monthOpts = Array.from({ length: 12 }, (_, i) => new Date(nowD.getFullYear(), nowD.getMonth() - i, 1))
        .filter((d) => realMatches.some((m) => m.createdAt >= d.getTime() && m.createdAt < new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()));
      if (monthOpts.length) {
        const sel = h('select', {}, monthOpts.map((d) => h('option', { value: `${d.getFullYear()}-${d.getMonth()}` }, `${MONTHS[d.getMonth()]} ${d.getFullYear()}`)));
        body.appendChild(sec('📅 Monatsrückblick'));
        body.appendChild(h('div', { class: 'grid2', style: { alignItems: 'center' } }, sel,
          h('button', { class: 'btn', onclick: () => { const [y, mo] = sel.value.split('-').map(Number); showMonthRecap(y, mo); } }, 'Anzeigen')));
      }
      body.appendChild(h('p', { class: 'dim small' }, 'Bestwerte aus beendeten X01- und Cricket-Matches gegen echte Spieler. Spiele gegen den Computer und Gäste zählen nicht. Tipp auf eine Treppchen-Stufe öffnet das Match.'));
    };
    draw();
  }).catch((e) => body.appendChild(h('p', { class: 'dim' }, `Rekorde konnten nicht geladen werden: ${e.message}`)));
}

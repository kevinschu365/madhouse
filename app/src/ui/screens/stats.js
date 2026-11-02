import { h, toast } from '../dom.js';
import { dbGetAll } from '../../core/storage.js';
import { getPlayers, displayName, ownerId } from '../../core/settings.js';
import { playerStats, detectionStats, cricketStats, trainingRecords, doubleStats, personalPodiums, allPlayersPodiums, milestones, playerRank, RANKS, RECORD_DEFS, MEDALS, MILESTONE_CATEGORIES, MILESTONE_GROUPS, nextRankText, rankNeed } from '../../stats/stats.js';
import { isBotId } from '../../game/bot.js';
import { derive } from '../../game/match.js';
import { showMatchDetail } from '../matchDetail.js';
import { lineChart } from '../chart.js';
import { crownHolder, weekStreak, dayStreak, getShowcase, toggleShowcase, seasonStatus, pastSeasons, seasonOf, SEASON_RANKS, SEASON_POINTS_NOTE, weekStatus, dayStatus, missionCounts, rivalries } from '../../stats/progress.js';
import { showMonthRecap, MONTHS } from '../recapSheet.js';
import { getMode, isTraining } from '../../rules/index.js';
import { trainingTips } from '../../stats/coach.js';

const TABS = [['x01', 'X01'], ['cricket', 'Cricket'], ['training', 'Training'], ['records', 'Rekorde']];

export function render(root, params, nav) {
  const body = h('div', { class: 'stack', style: { maxWidth: '640px', margin: '0 auto' } },
    h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Statistik')),
    h('p', { class: 'dim' }, 'Lade …'));
  root.appendChild(body);
  let selectedPlayer = params.player || null;
  let tab = params.tab || 'x01';
  const openCats = new Set(); // aufgeklappte Meilenstein-Kategorien
  let podPeriod = 'all';       // Zeitraum der Bestwerte: 'all' | 'season' | 'month'
  let podView = 'mine';        // Bestwerte: 'mine' (eigene) oder 'all' (Bestenliste aller Spieler)
  let msFilter = 'all';        // Meilensteine: 'all' | 'done' (erreicht) | 'open' (offen)

  Promise.all([dbGetAll('throws'), dbGetAll('matches')]).then(([rows, matches]) => {
    const finished = matches.filter((m) => m.status === 'finished');
    // Statistik nur aus beendeten Matches gegen echte Spieler (abgebrochene und Spiele gegen den Computer zählen nicht)
    const vsBot = (m) => m.players.some(isBotId);
    const realIds = new Set(finished.filter((m) => !vsBot(m)).map((m) => m.id));
    const usable = rows.filter((r) => realIds.has(r.matchId));
    const known = getPlayers();
    const names = new Map();
    for (const m of matches) m.players.forEach((id, i) => names.set(id, m.playerNames[i]));
    for (const p of known) names.set(p.id, displayName(p, known));
    // Der Computer-Gegner bekommt keine eigene Statistik
    const ids = [...new Set([...known.map((p) => p.id), ...usable.map((r) => r.playerId)])].filter((id) => !isBotId(id));
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

    // Rekorde (Bestwerte je Match) und Meilensteine – nur Spiele gegen echte Spieler
    const drawRecords = () => {
      const realMatches = finished.filter((m) => !vsBot(m));
      const ms = milestones(usable, realMatches, selectedPlayer);
      const rk = playerRank(ms);
      const me = names.get(selectedPlayer) || '?';
      const crown = crownHolder(usable, realMatches);
      const streak = weekStreak(realMatches, selectedPlayer);
      const days = dayStreak(finished, selectedPlayer); // Tages-Serie: auch Trainings und Spiele gegen den Computer

      const pctOf = (r) => (r.next ? Math.round(((r.points - r.rank.min) / (r.next.min - r.rank.min)) * 100) : 100);
      // Zeitstrahl der Ränge; wird erst beim Aufklappen zum aktuellen Rang geschoben (vorher hat er keine Breite)
      const timelineFold = (label, r, timeline) => {
        const tl = h('div', { class: 'ranktl' }, timeline.map((x, i) => h('div', { class: `tlstep ${i <= r.index ? 'on' : ''} ${i === r.index ? 'cur' : ''}`, style: `--rc: ${x.color}` },
          h('div', { class: 'tldot' }, i <= r.index ? x.icon : '🔒'),
          h('div', { class: 'tlname' }, x.title),
          h('div', { class: 'tldate' }, i <= r.index ? (x.at ? date(x.at) : '') : rankNeed(x)),
        )));
        const det = h('details', { class: 'tlfold' }, h('summary', {}, label), tl);
        det.addEventListener('toggle', () => {
          const cur = tl.querySelector('.cur');
          if (det.open && cur) tl.scrollLeft = cur.offsetLeft - tl.clientWidth / 2 + cur.offsetWidth / 2;
        });
        return det;
      };

      // 1) Kopf: Rang, Fortschritt zum nächsten Rang, Kennzahlen, Serien und Vitrine in einer Karte
      const vitrine = getShowcase(selectedPlayer).map((id) => ms.find((m) => m.id === id)).filter((m) => m && m.at);
      const hasCrown = crown && crown.playerId === selectedPlayer;
      body.appendChild(h('div', { class: 'card mshero', style: `--rc: ${rk.rank.color}` },
        h('div', { class: 'rankhead' },
          h('div', { class: 'badge', style: `--rc: ${rk.rank.color}` }, rk.rank.icon),
          h('div', { class: 'rankinfo' },
            h('div', { class: 'heroname' }, `${hasCrown ? '👑 ' : ''}${me}`),
            h('div', { class: 'rankname' }, rk.rank.title),
            h('div', { class: 'dim small' }, `Rang ${rk.index + 1} von ${RANKS.length}`),
          ),
        ),
        h('div', { class: 'stack', style: { gap: '6px' } },
          h('div', { class: 'ratebar big' }, h('div', { style: { width: `${pctOf(rk)}%` } })),
          h('div', { class: 'small dim' }, nextRankText(rk))),
        h('div', { class: 'kpis' },
          kpi(rk.points.toLocaleString('de-DE'), 'Punkte'),
          kpi(`${rk.done} / ${ms.length}`, 'Meilensteine'),
          kpi(`${rk.elite}★`, 'Elite')),
        h('div', { class: 'heropills' },
          h('span', { class: `pill ${days.current && !days.playedToday ? 'warn' : ''}` }, `📆 ${days.current} ${days.current === 1 ? 'Tag' : 'Tage'}${days.current && !days.playedToday ? ' · heute noch!' : ''}`),
          h('span', { class: 'pill' }, `🔥 ${streak.current} ${streak.current === 1 ? 'Woche' : 'Wochen'}`),
          h('span', { class: 'pill' }, `Beste: ${days.best} T. · ${streak.best} W.`),
          hasCrown ? h('span', { class: 'pill gold' }, `👑 Abend-Krone · Ø ${crown.average.toFixed(1)}`) : null),
        h('div', { class: 'vitrinebox' },
          [0, 1, 2].map((i) => {
            const m = vitrine[i];
            return h('div', { class: `vslot ${m ? 'on' : ''}` }, h('div', { class: 'vicon' }, m ? m.icon : '＋'), h('div', { class: 'vtitle' }, m ? m.title : 'Vitrine frei'));
          })),
        vitrine.length < 3 ? h('div', { class: 'dim small' }, 'Vitrine: Tipp unten auf einen erreichten Meilenstein legt ihn hinein. Sie erscheint neben deinem Namen.') : null,
        timelineFold('Alle Ränge ansehen', rk, rk.timeline),
      ));

      // 2) Saison: kompakt, Einzelheiten zum Aufklappen
      const ss = seasonStatus(usable, realMatches, selectedPlayer, ms);
      const past = pastSeasons(usable, realMatches, selectedPlayer, ms);
      body.appendChild(h('div', { class: 'card seasoncard' },
        h('div', { class: 'rankhead' },
          h('div', { class: 'badge sm', style: `--rc: ${ss.rank.color}` }, ss.rank.icon),
          h('div', { class: 'rankinfo' },
            h('div', { class: 'dim small' }, `Saison ${ss.season.name}`),
            h('div', { class: 'seasonname' }, ss.rank.title, h('span', { class: 'num dim' }, ` · ${ss.points} P.`)),
            h('div', { class: 'ratebar' }, h('div', { style: { width: `${pctOf(ss)}%` } })),
            h('div', { class: 'dim small' }, ss.next ? `noch ${ss.next.min - ss.points} bis ${ss.next.icon} ${ss.next.title}` : 'Champion!'),
          ),
        ),
        timelineFold('Saison-Ränge und Punkte', ss, SEASON_RANKS.map((x) => ({ ...x, at: null }))),
      ));
      body.querySelector('.seasoncard .tlfold').appendChild(h('div', { class: 'dim small', style: { marginTop: '6px' } },
        `${SEASON_POINTS_NOTE} Diese Saison: ${ss.parts.msPts} aus Meilensteinen, ${ss.parts.tasks} Aufgaben, ${ss.parts.medals} Medaillen, ${ss.parts.wins} Siege, ${ss.parts.legs} Legs, ${ss.parts.played} Matches.`,
        past.length ? ` Frühere Saisons: ${past.map((p) => `${p.season.name} ${p.rank.icon} ${p.rank.title}`).join(' · ')}` : ''));

      // 3) Als Nächstes: die offenen Meilensteine, denen am wenigsten fehlt
      const near = ms.filter((m) => !m.at && !m.secret && m.progress && m.progress[0] > 0)
        .map((m) => ({ m, r: m.progress[0] / m.progress[1] }))
        .sort((a, b) => b.r - a.r || b.m.pts - a.m.pts).slice(0, 3);
      if (near.length) {
        body.appendChild(sec('🎯 Als Nächstes'));
        body.appendChild(h('div', { class: 'card nextlist' }, near.map(({ m, r }) => h('div', { class: 'nextrow' },
          h('div', { class: 'nexticon' }, m.icon),
          h('div', { class: 'nextmain' },
            h('div', { class: 'nexttop' }, h('b', {}, `${m.elite ? '★ ' : ''}${m.title}`), h('span', { class: 'num dim' }, `+${m.pts} P.`)),
            h('div', { class: 'ratebar' }, h('div', { style: { width: `${Math.round(r * 100)}%` } })),
            h('div', { class: 'num dim small' }, `${m.progress[0].toLocaleString('de-DE')} / ${m.progress[1].toLocaleString('de-DE')} · noch ${(m.progress[1] - m.progress[0]).toLocaleString('de-DE')}`)),
        ))));
      }

      // 4) Zuletzt erreicht: Leiste zum Wischen
      const latest = ms.filter((m) => m.at).sort((a, b) => b.at - a.at).slice(0, 8);
      if (latest.length) {
        body.appendChild(sec('✨ Zuletzt erreicht'));
        body.appendChild(h('div', { class: 'recentstrip' }, latest.map((m) => h('div', { class: 'recentms' },
          h('div', { class: 'ricon' }, m.icon),
          h('div', { class: 'rtitle' }, m.title),
          h('div', { class: 'rdate num' }, date(m.at))))));
      }

      // 5) Aufgaben: heute (leicht) und diese Woche (gleicher Stil wie auf der Startseite)
      const wk = weekStatus(usable, realMatches, selectedPlayer);
      const dy = dayStatus(usable, realMatches, selectedPlayer);
      const mc = missionCounts(usable, realMatches, selectedPlayer);
      const taskList = (items) => h('ol', { class: 'tasklist' }, items.map((i) => h('li', { class: i.done ? 'done' : '' },
        h('span', { class: 'tasktext' }, i.text),
        h('span', { class: 'taskstate' }, i.done ? 'geschafft' : `${i.cur} / ${i.goal}`))));
      body.appendChild(sec('📋 Aufgaben'));
      body.appendChild(h('div', { class: 'card stack taskcard' },
        h('div', { class: 'taskhead' }, h('b', {}, '☀️ Heute'), h('span', { class: `num ${dy.perfect ? 'accent' : 'dim'}` }, dy.perfect ? '🌟 perfekter Tag' : `${dy.done} / 3`)),
        taskList(dy.items),
        h('div', { class: 'taskhead' }, h('b', {}, '🗓️ Diese Woche'), h('span', { class: `num ${wk.medal ? 'accent' : 'dim'}` }, wk.medal ? '🏅 Medaille' : `${wk.done} / 3`)),
        taskList(wk.items),
        h('div', { class: 'dim small' }, `Bisher: ${mc.daily} Tagesaufgaben · ${mc.perfectDays} perfekte Tage · ${mc.weekly} Wochenaufgaben · ${mc.medals} Medaillen. Dafür gibt es eigene Meilensteine (Kategorie „Aufgaben“). Neue Tagesaufgaben jeden Spieltag ab 5 Uhr, neue Wochenaufgaben jeden Montag.`),
      ));

      // 6) Meilensteine (siehe unten), danach Bestwerte, Duelle und Monatsrückblick
      const msAnchor = h('div');
      body.appendChild(msAnchor);

      // Treppchen: die drei besten Matches je Bestwert – eigene oder über alle Spieler (Bestenliste)
      const global = podView === 'all';
      // Zeitraum: für immer, diese Saison oder dieser Monat (so haben auch Neue eine Chance auf Gold)
      const nowD = new Date();
      const periodFrom = podPeriod === 'month' ? new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime()
        : podPeriod === 'season' ? seasonOf().start : 0;
      const podMatches = realMatches.filter((m) => m.createdAt >= periodFrom);
      const pods = global ? allPlayersPodiums(usable, podMatches) : personalPodiums(usable, podMatches, selectedPlayer);
      body.appendChild(sec('🏆 Bestwerte'));
      body.appendChild(h('div', { class: 'chips' },
        h('button', { class: `chip ${global ? '' : 'on'}`, onclick: () => { podView = 'mine'; draw(); } }, `Meine (${names.get(selectedPlayer) || '?'})`),
        h('button', { class: `chip ${global ? 'on' : ''}`, onclick: () => { podView = 'all'; draw(); } }, '🏆 Alle Spieler'),
      ));
      body.appendChild(h('label', { class: 'field' }, h('span', {}, 'Zeitraum'),
        h('select', { onchange: (e) => { podPeriod = e.target.value; draw(); } },
          [['all', 'Für immer'], ['season', `Diese Saison (${seasonOf().name})`], ['month', `Dieser Monat (${MONTHS[nowD.getMonth()]})`]]
            .map(([v, l]) => h('option', { value: v, selected: v === podPeriod }, l)))));
      const step = (e, place) => h('button', {
        class: `step p${place + 1} ${e ? '' : 'empty'} ${e && global && e.playerId === selectedPlayer ? 'me' : ''}`,
        onclick: () => { const m = e && finished.find((x) => x.id === e.matchId); if (m) showMatchDetail(m); },
      },
      h('div', { class: 'medal' }, MEDALS[place]),
      global && e ? h('div', { class: 'who' }, e.name) : null,
      h('div', { class: 'v num' }, e ? e.text : '–'),
      // Eigene Bestwerte: darunter der Gegner („vs. Kevin“), nicht der eigene Name
      h('div', { class: 'd' }, e ? (global ? date(e.at) : `${date(e.at)}${e.opponents.length ? ` · vs. ${e.opponents.join(', ')}` : ''}`) : ''));
      const shown = RECORD_DEFS.filter((d) => pods[d.key]);
      if (!shown.length) body.appendChild(h('p', { class: 'dim' }, 'Noch keine Bestwerte – erst ein Match gegen echte Gegner beenden.'));
      body.appendChild(h('div', { class: 'podiums' }, shown.map((d) => h('div', { class: 'podcard' },
        h('div', { class: 'podtitle' }, d.label),
        h('div', { class: 'podium' }, [0, 1, 2].map((i) => step(pods[d.key][i], i))),
      ))));
      // Meilensteine in Kategorien: Tipp auf eine Kategorie klappt sie auf. Filter: alle, erreicht, offen.
      const msPart = [];
      msPart.push(sec('🎖️ Meilensteine', h('span', { class: 'num dim' }, `${rk.done} / ${ms.length}`)));
      msPart.push(h('div', { class: 'seg' }, [['all', 'Alle'], ['done', 'Erreicht'], ['open', 'Offen']].map(([k, l]) =>
        h('button', { class: msFilter === k ? 'on' : '', onclick: () => { msFilter = k; draw(); } }, l))));
      const keep = (m) => (msFilter === 'done' ? !!m.at : msFilter === 'open' ? !m.at : true);
      // Tipp auf einen erreichten Meilenstein: in die Vitrine legen bzw. herausnehmen
      const inShowcase = new Set(getShowcase(selectedPlayer));
      const tile = (m) => {
        const showBar = !m.at && !m.secret && m.progress && m.progress[0] > 0;
        return h('div', {
          class: `ms ${m.at ? 'on tap' : ''} ${inShowcase.has(m.id) ? 'shown' : ''}`,
          onclick: () => {
            if (!m.at) return;
            const list = toggleShowcase(selectedPlayer, m.id);
            toast(list.includes(m.id) ? `${m.icon} in der Vitrine` : 'Aus der Vitrine genommen');
            draw();
          },
        },
        h('div', { class: 'msicon' }, m.at ? m.icon : m.secret ? '❓' : m.icon),
        h('div', { class: 'mstext' },
          h('b', {}, m.secret && !m.at ? '???' : `${m.elite ? '★ ' : ''}${m.title}`),
          h('span', { class: 'num' }, `${m.at ? date(m.at) : m.progress && !m.secret ? `${m.progress[0].toLocaleString('de-DE')} / ${m.progress[1].toLocaleString('de-DE')}` : 'noch offen'} · ${m.pts} P.${inShowcase.has(m.id) ? ' · ⭐' : ''}`),
          showBar ? h('div', { class: 'ratebar thin' }, h('div', { style: { width: `${Math.round((m.progress[0] / m.progress[1]) * 100)}%` } })) : null,
        ),
        );
      };
      // Eine aufklappbare Gruppe (Kategorie oder Unterteilung). key merkt sich, was offen ist.
      const fold = (key, icon, title, list, inner, cls = 'mscat') => {
        const n = list.filter((m) => m.at).length;
        const det = h('details', { class: cls },
          h('summary', {},
            h('span', { class: 'mscicon' }, icon),
            h('span', { class: 'msctext' },
              h('b', {}, title),
              h('span', { class: 'ratebar' }, h('span', { style: { width: `${Math.round((n / list.length) * 100)}%` } })),
            ),
            h('span', { class: `msccount num ${n === list.length ? 'accent' : ''}` }, `${n} / ${list.length}`),
          ),
          inner,
        );
        // Aufgeklappte Gruppen bleiben beim Spielerwechsel offen
        if (openCats.has(key)) det.open = true;
        det.addEventListener('toggle', () => { if (det.open) openCats.add(key); else openCats.delete(key); });
        return det;
      };
      for (const c of MILESTONE_CATEGORIES) {
        const list = ms.filter((m) => m.cat === c.id);
        if (!list.some(keep)) continue; // im Filter leere Kategorie ausblenden
        const groups = MILESTONE_GROUPS[c.id];
        msPart.push(fold(c.id, c.icon, c.title, list, [
          h('p', { class: 'dim', style: { fontSize: '13px', margin: '0 0 8px' } }, c.note),
          // Schnelltasten: je Zahl eine eigene Gruppe, sonst wird es zu lang
          groups
            ? groups.map((g) => {
              const sub = list.filter((m) => m.group === g.id);
              return sub.some(keep) ? fold(`${c.id}:${g.id}`, g.icon, g.title, sub, h('div', { class: 'milestones' }, sub.filter(keep).map(tile)), 'mscat sub') : null;
            })
            : h('div', { class: 'milestones' }, list.filter(keep).map(tile)),
        ]));
      }
      msAnchor.replaceWith(...msPart);

      // Rivalen-Bilanz
      const rivals = rivalries(realMatches, selectedPlayer);
      if (rivals.length) {
        body.appendChild(sec('⚔️ Duelle'));
        body.appendChild(h('table', { class: 'hist' }, rivals.map((r) => h('tr', {},
          h('td', {}, `vs. ${r.name}`),
          h('td', { class: `num ${r.wins > r.losses ? 'accent' : ''}` }, `${r.wins} : ${r.losses}`),
          h('td', { class: 'dim', style: { fontSize: '13px' } }, r.streak >= 2 ? `🔥 ${r.streak} Siege in Folge` : r.streak <= -2 ? `${-r.streak} Niederlagen in Folge` : ''),
        ))));
      }

      // Monatsrückblick
      const now = new Date();
      const monthOpts = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1))
        .filter((d) => realMatches.some((m) => m.createdAt >= d.getTime() && m.createdAt < new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()));
      if (monthOpts.length) {
        const sel = h('select', {}, monthOpts.map((d) => h('option', { value: `${d.getFullYear()}-${d.getMonth()}` }, `${MONTHS[d.getMonth()]} ${d.getFullYear()}`)));
        body.appendChild(sec('📅 Monatsrückblick'));
        body.appendChild(h('div', { class: 'grid2', style: { alignItems: 'center' } }, sel,
          h('button', { class: 'btn', onclick: () => { const [y, mo] = sel.value.split('-').map(Number); showMonthRecap(y, mo); } }, 'Anzeigen')));
      }
      body.appendChild(h('p', { class: 'dim', style: { fontSize: '13px' } }, 'Gezählt werden beendete Spiele gegen echte Spieler und Trainings (Bestwerte: X01 und Cricket; Siege: alle Spielarten mit 2+ Spielern). Spiele gegen den Computer zählen nicht. Tipp auf eine Treppchen-Stufe öffnet das Match.'));
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

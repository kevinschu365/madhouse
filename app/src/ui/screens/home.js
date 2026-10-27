import { h, confirmDialog } from '../dom.js';
import { BRAND, APP_VERSION } from '../../config.js';
import { lsGet, lsSet, dbGetAll } from '../../core/storage.js';
import { derive, throwRows } from '../../game/match.js';
import { playerStats } from '../../stats/stats.js';
import { isBotId } from '../../game/bot.js';
import { isTraining } from '../../rules/index.js';
import { GameSession } from '../../game/session.js';
import { showWhatsNewOnce } from '../../changelog.js';
import { getPlayers } from '../../core/settings.js';
import { milestones, playerRank } from '../../stats/stats.js';
import { weeklyChallenges, weekStatus, weekStreak, dayStreak, crownHolder, nearGoals } from '../../stats/progress.js';
import { showEveningRecap } from '../recapSheet.js';

export function render(root, params, nav) {
  const active = lsGet('activeMatch', null);
  let resume = null;
  if (active && active.status === 'running') {
    let info = '';
    try {
      const st = derive(active);
      const label = st.mode.id === 'x01' ? '' : ` · ${st.mode.label}`;
      info = active.players.length === 1
        ? `${active.playerNames[0]} · ${st.mode.describe(active.options)}`
        : active.players.length === 2
          ? `${active.playerNames[0]} ${st.scores[0]} : ${st.scores[1]} ${active.playerNames[1]}${label}`
          : `${active.playerNames.map((n, i) => `${n} ${st.scores[i]}`).join(' · ')}${label}`;
    } catch { info = 'Spiel unterbrochen'; }
    resume = h('div', { class: 'card resume stack' },
      h('div', { class: 'dim' }, active.players.length === 1 ? 'Laufendes Training' : 'Laufendes Spiel'),
      h('div', { style: { fontSize: '20px', fontWeight: 700 } }, info),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => nav.go('game', { match: active }) }, 'Weiterspielen'),
        h('button', {
          class: 'btn ghost',
          onclick: async () => {
            if (await confirmDialog('Spiel abbrechen?', 'Das Spiel wird als abgebrochen gespeichert und taucht nicht in der Match-Statistik auf.', { ok: 'Abbrechen', cancel: 'Zurück', danger: true })) {
              await new GameSession(active).abort();
              lsSet('activeMatch', null);
              nav.go('home');
            }
          },
        }, 'Beenden'),
      ),
    );
  }
  // Abendbilanz: wird nachgeladen und erscheint nur, wenn heute schon gespielt wurde
  const tonight = h('div', { class: 'card tonight hidden', onclick: () => showEveningRecap() });
  // Fortschritt: Wochenaufgaben, Ränge, Serien, „Fast geschafft“ (wird nachgeladen)
  const progress = h('div', { class: 'homeprogress hidden' });
  progressCard(nav).then((parts) => { if (parts) { progress.replaceChildren(...parts); progress.classList.remove('hidden'); } }).catch((e) => console.warn(e));
  eveningSummary().then((parts) => { if (parts) { tonight.replaceChildren(...parts); tonight.classList.remove('hidden'); } }).catch(() => {});
  root.appendChild(h('div', { class: 'home' },
    h('div', { class: 'hero' }, h('span', { class: 'logo', html: BRAND.logoSvg }), h('h1', {}, BRAND.name)),
    resume,
    h('button', { class: 'btn primary', style: { minHeight: '64px', fontSize: '22px' }, onclick: () => nav.go('setup') }, 'Neues Spiel'),
    h('button', { class: 'btn', style: { minHeight: '60px', fontSize: '20px' }, onclick: () => nav.go('training') }, '🎯 Training'),
    tonight,
    progress,
    h('button', { class: 'btn', onclick: () => nav.go('players') }, 'Spieler'),
    h('button', { class: 'btn', onclick: () => nav.go('stats') }, 'Statistik'),
    h('button', { class: 'btn', onclick: () => nav.go('calibrate', { back: 'home' }) }, 'Kamera kalibrieren'),
    h('button', { class: 'btn', onclick: () => nav.go('settings') }, 'Einstellungen'),
    h('button', { class: 'btn', onclick: () => nav.go('help') }, '📖 Anleitung'),
    h('p', { class: 'dim', style: { textAlign: 'center', fontSize: '13px', marginTop: '20px' } }, `${BRAND.name} ${APP_VERSION} · Daten bleiben auf diesem Gerät`),
  ));
  showWhatsNewOnce(); // nach einem Update: Checkliste „Neu in dieser Version“
}

/**
 * Bilanz des Abends: beendete Matches gegen echte Spieler seit 5 Uhr früh
 * (Spiele nach Mitternacht zählen so noch zum Vorabend). null = heute noch nichts gespielt.
 */
async function eveningSummary() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(5, 0, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  const all = await dbGetAll('matches');
  const today = all.filter((m) => m.status === 'finished' && m.createdAt >= start.getTime()
    && !isTraining(m.mode) && m.players.length > 1 && !m.players.some(isBotId));
  if (!today.length) return null;

  // Duelle zu zweit: je Paar die Siege („Kevin 4 : 2 Anna“)
  const duels = new Map();
  const multi = new Map(); // Spiele mit 3+ Spielern: Siege je Name
  for (const m of today) {
    const winner = m.players[m.winner];
    if (m.players.length === 2) {
      const order = [0, 1].sort((a, b) => m.playerNames[a].localeCompare(m.playerNames[b]));
      const key = order.map((i) => m.players[i]).join('|');
      const d = duels.get(key) || { names: order.map((i) => m.playerNames[i]), ids: order.map((i) => m.players[i]), wins: [0, 0] };
      d.wins[d.ids.indexOf(winner)]++;
      duels.set(key, d);
    } else {
      const name = m.playerNames[m.winner];
      multi.set(name, (multi.get(name) || 0) + 1);
    }
  }
  // X01-Average des Abends je Spieler
  const names = new Map();
  const rows = [];
  for (const m of today) {
    m.players.forEach((id, i) => names.set(id, m.playerNames[i]));
    if (m.mode === 'x01') rows.push(...throwRows(m));
  }
  const avgs = [...names.entries()]
    .map(([id, name]) => ({ name, s: playerStats(rows.filter((r) => r.playerId === id)) }))
    .filter((e) => e.s.darts)
    .sort((a, b) => b.s.average - a.s.average);

  return [
    h('div', { class: 'tonighthead' }, h('b', {}, '🌙 Heute'), h('span', { class: 'dim' }, `${today.length} ${today.length === 1 ? 'Spiel' : 'Spiele'} ›`)),
    ...[...duels.values()].map((d) => h('div', { class: 'duel num' },
      h('span', {}, d.names[0]), h('b', {}, `${d.wins[0]} : ${d.wins[1]}`), h('span', {}, d.names[1]))),
    multi.size ? h('div', { class: 'dim small' }, `Mehrspieler-Siege: ${[...multi.entries()].map(([n, w]) => `${n} ${w}`).join(' · ')}`) : null,
    avgs.length ? h('div', { class: 'dim small' }, `Ø heute (X01): ${avgs.map((e) => `${e.name} ${e.s.average.toFixed(1)}`).join(' · ')}`) : null,
  ];
}

/**
 * Fortschritt auf der Startseite, in zwei ruhigen Karten:
 *  - Wochenaufgaben: die drei Aufgaben (für alle gleich) und wer wie viele geschafft hat
 *  - Fortschritt: je Spieler Rang-Abzeichen, Balken zum nächsten Rang, Serie und nächstes Ziel
 */
async function progressCard(nav) {
  const [rows, matches] = await Promise.all([dbGetAll('throws'), dbGetAll('matches')]);
  const finishedAll = matches.filter((m) => m.status === 'finished');
  const real = finishedAll.filter((m) => !m.players.some(isBotId));
  if (!real.length) return null;
  const ids = new Set(real.map((m) => m.id));
  const usable = rows.filter((r) => ids.has(r.matchId));
  const crown = crownHolder(usable, real);
  const people = getPlayers().filter((p) => real.some((m) => m.players.includes(p.id)));
  if (!people.length) return null;

  const data = people.map((p) => {
    const ms = milestones(usable, real, p.id);
    return { p, ms, rk: playerRank(ms), wk: weekStatus(usable, real, p.id), weeks: weekStreak(real, p.id), days: dayStreak(finishedAll, p.id), goal: nearGoals(ms, 1)[0] };
  });

  // Karte 1: Wochenaufgaben
  const tasks = weeklyChallenges();
  const daysLeft = Math.max(1, Math.ceil((data[0].wk.end - Date.now()) / 86400000));
  const dots = (wk) => h('span', { class: 'dots' }, wk.items.map((i) => h('i', { class: i.done ? 'on' : '' })));
  const weekCard = h('div', { class: 'card homecard' },
    h('div', { class: 'cardhead' }, h('span', { class: 'cardtitle' }, 'Wochenaufgaben'), h('span', { class: 'dim small' }, `noch ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'}`)),
    h('ol', { class: 'tasklist' }, tasks.map((t) => h('li', {}, t.text))),
    h('div', { class: 'weekplayers' }, data.map(({ p, wk }) => h('span', { class: `wchip ${wk.medal ? 'medal' : ''}` }, p.name, dots(wk)))),
    h('div', { class: 'dim small' }, 'Alle drei geschafft = Wochen-Medaille. Neue Aufgaben jeden Montag.'),
  );

  // Karte 2: Fortschritt je Spieler
  const rowsEl = data.map(({ p, rk, weeks, days, goal }) => {
    const span = rk.next ? rk.next.min - rk.rank.min : 1;
    const pct = rk.next ? Math.min(100, Math.round(((rk.points - rk.rank.min) / span) * 100)) : 100;
    // Was zum nächsten Rang fehlt, ohne Emoji: „158 P. bis Weltranglisten-Spieler“
    const need = rk.next
      ? `${[rk.next.min > rk.points ? `${(rk.next.min - rk.points).toLocaleString('de-DE')} P.` : null, rk.next.elite > rk.elite ? `${rk.next.elite - rk.elite} Elite` : null].filter(Boolean).join(' + ')} bis ${rk.next.title}`
      : 'Höchster Rang erreicht';
    const atRisk = days.current && !days.playedToday;
    const serie = days.current ? `${days.current} ${days.current === 1 ? 'Tag' : 'Tage'}` : weeks.current ? `${weeks.current} ${weeks.current === 1 ? 'Woche' : 'Wochen'}` : null;
    return h('div', { class: 'prow', onclick: () => nav.go('stats', { player: p.id, tab: 'records' }) },
      h('div', { class: 'badge sm', style: `--rc: ${rk.rank.color}` }, rk.rank.icon),
      h('div', { class: 'prowmain' },
        h('div', { class: 'prowtop' },
          h('div', { class: 'prowname' },
            h('b', {}, p.name, crown && crown.playerId === p.id ? h('span', { class: 'crown', title: 'Abend-Krone' }, ' 👑') : null),
            h('span', { class: 'prowrank', style: `color: ${rk.rank.color}` }, rk.rank.title)),
          serie ? h('span', { class: 'pill', title: 'Tage bzw. Wochen in Folge gespielt' }, `Serie ${serie}`) : null),
        h('div', { class: 'rankbar' }, h('div', { style: { width: `${pct}%`, background: rk.rank.color } })),
        h('div', { class: 'prowmeta' }, need),
        goal ? h('div', { class: 'prowgoal' }, h('span', { class: 'dim' }, 'Nächstes Ziel '), `${goal.title} · noch ${goal.left.toLocaleString('de-DE')}`) : null,
        atRisk ? h('div', { class: 'prowwarn' }, 'Heute noch spielen, damit die Serie hält') : null,
      ),
      h('span', { class: 'chev' }, '›'),
    );
  });
  const progressEl = h('div', { class: 'card homecard' },
    h('div', { class: 'cardhead' }, h('span', { class: 'cardtitle' }, 'Fortschritt'),
      crown ? h('span', { class: 'dim small' }, `Abend-Krone: ${crown.name}`) : null),
    rowsEl,
  );
  return [weekCard, progressEl];
}

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
import { milestones, playerRank, nextRankText } from '../../stats/stats.js';
import { weeklyChallenges, weekStatus, weekStreak, dayStreak, crownHolder, nearGoals, goalText, showcaseIcons } from '../../stats/progress.js';
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
  const progress = h('div', { class: 'card progresscard hidden' });
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
 * Fortschritt auf der Startseite: Wochenaufgaben (für alle gleich) und je Spieler
 * Krone, Vitrine, Rang, Wochen-Serie, erledigte Aufgaben und das nächste erreichbare Ziel.
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
  const tasks = weeklyChallenges();
  const lines = people.map((p) => {
    const ms = milestones(usable, real, p.id);
    const rk = playerRank(ms);
    const wk = weekStatus(usable, real, p.id);
    const streak = weekStreak(real, p.id);
    const days = dayStreak(finishedAll, p.id); // Trainings und Spiele gegen den Computer zählen mit
    const goal = nearGoals(ms, 1)[0];
    const toRank = rk.next ? nextRankText(rk) : '';
    return h('div', { class: 'pline', onclick: () => nav.go('stats', { player: p.id, tab: 'records' }) },
      h('div', { class: 'plinehead' },
        h('b', {}, `${crown && crown.playerId === p.id ? '👑 ' : ''}${p.name}`),
        h('span', { class: 'vitrine' }, showcaseIcons(p.id)),
        h('span', { class: 'dim small', style: { marginLeft: 'auto' } }, `${rk.rank.icon} ${rk.rank.title}`)),
      h('div', { class: 'plinesub' },
        h('span', { class: 'taskdots' }, wk.items.map((i) => (i.done ? '✅' : '⬜')).join('')),
        days.current ? h('span', {}, `📆 ${days.current} ${days.current === 1 ? 'Tag' : 'Tage'}${days.playedToday ? '' : ' – heute noch!'}`) : null,
        streak.current ? h('span', {}, `🔥 ${streak.current} ${streak.current === 1 ? 'Woche' : 'Wochen'}${streak.playedThisWeek ? '' : ' – diese Woche!'}`) : null),
      h('div', { class: 'dim small' }, goal ? `🎯 ${goalText(goal)}` : toRank),
      goal && toRank ? h('div', { class: 'dim small' }, `⬆️ ${toRank}`) : null);
  });
  return [
    h('div', { class: 'tonighthead' }, h('b', {}, '🗓️ Aufgaben dieser Woche'), h('span', { class: 'dim small' }, 'alle 3 = 🏅 Medaille')),
    h('div', { class: 'tasks' }, tasks.map((t) => h('div', {}, `${t.icon} ${t.text}`))),
    crown ? h('div', { class: 'dim small' }, `👑 Abend-Krone: ${crown.name} (Ø ${crown.average.toFixed(1)} am ${new Date(crown.day).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })})`) : null,
    ...lines,
  ];
}

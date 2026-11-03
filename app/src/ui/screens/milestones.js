// Meilensteine (eigener Bereich, Knopf auf der Startseite): Rang, Saison, Aufgaben, „Als Nächstes“, „Zuletzt erreicht“
// und alle Meilensteine mit Suche und Filtern (erreicht/offen, Elite, Punkte, Sortierung).
// Tipp auf einen Meilenstein öffnet die Details: Fortschritt, alle Stufen der Reihe, Vitrine – beim Doppel-Sammler alle 21 Doppel.
import { h, toast, sheet } from '../dom.js';
import { milestones, playerRank, RANKS, MILESTONE_CATEGORIES, MILESTONE_GROUPS, nextRankText, rankNeed, ELITE_PTS } from '../../stats/stats.js';
import { crownHolder, weekStreak, dayStreak, getShowcase, toggleShowcase, seasonStatus, pastSeasons, SEASON_RANKS, SEASON_POINTS_NOTE, weekStatus, dayStatus, missionCounts } from '../../stats/progress.js';
import { loadStatsData, pickDefault, playerPicker, date, sec, kpi, topbar } from '../statsData.js';
import { showMatchDetail } from '../matchDetail.js';

const PTS_FILTERS = [['all', 'Alle Punkte'], ['low', 'bis 9 P.'], ['mid', '10–39 P.'], ['elite', `ab ${ELITE_PTS} P. (★ Elite)`]];
const fmt = (n) => n.toLocaleString('de-DE');

export function render(root, params, nav) {
  const body = h('div', { class: 'stack', style: { maxWidth: '680px', margin: '0 auto' } }, topbar('Meilensteine', nav), h('p', { class: 'dim' }, 'Lade …'));
  root.appendChild(body);
  const openCats = new Set();                                    // aufgeklappte Kategorien
  const f = { text: '', state: 'all', pts: 'all', sort: 'cat' }; // Suche und Filter

  loadStatsData().then((data) => {
    const { finished, realMatches, usable, names, ids } = data;
    let player = pickDefault(ids, params.player);
    let scope = 'games'; // 'games' | 'training'

    // Training: eigene Meilensteine (Trainings, Darts, Spieltage), zählen nicht für Rang und Saison
    const drawTraining = () => {
      const ms = milestones(usable, realMatches, player, { scope: 'training' }).filter((m) => m.cat === 'grind' && !m.id.startsWith('wstreak') && !m.id.startsWith('day-'));
      const done = ms.filter((m) => m.at);
      const trainings = finished.filter((m) => m.players.length === 1 && m.players[0] === player).length;
      body.appendChild(h('div', { class: 'card mshero', style: '--rc: var(--accent)' },
        h('div', { class: 'kpis' }, kpi(trainings, 'Trainings'), kpi(`${done.length} / ${ms.length}`, 'Meilensteine'), kpi(fmt(done.reduce((a, m) => a + m.pts, 0)), 'Punkte')),
        h('div', { class: 'small dim' }, 'Trainings-Meilensteine zählen nicht für Rang und Saison – dort zählen nur Spiele gegen echte Mitspieler. Rekorde je Übung: Rekorde › Training.')));
      body.appendChild(sec('🏋️ Trainings-Meilensteine'));
      body.appendChild(h('div', { class: 'milestones' }, ms.sort((a, b) => (b.at ? 1 : 0) - (a.at ? 1 : 0)).map((m) => h('div', { class: `ms ${m.at ? 'on' : ''}` },
        h('div', { class: 'msicon' }, m.icon),
        h('div', { class: 'mstext' },
          h('b', {}, m.title),
          h('span', { class: 'num' }, `${m.at ? date(m.at) : m.progress ? `${fmt(m.progress[0])} / ${fmt(m.progress[1])}` : 'noch offen'} · ${m.pts} P.`),
          !m.at && m.progress && m.progress[0] > 0 ? h('div', { class: 'ratebar thin' }, h('div', { style: { width: `${Math.round((m.progress[0] / m.progress[1]) * 100)}%` } })) : null)))));
    };

    // 🏆 Trophäenschrank: alle erreichten Meilensteine (Spiele), Filter nach Kategorie, Sortierung, Tipp = Details
    let trophyCat = 'all';
    let trophySort = 'new'; // 'new' | 'old' | 'pts'
    const drawTrophies = (ms, showDetail) => {
      const got = ms.filter((m) => m.at);
      const cats = MILESTONE_CATEGORIES.filter((c) => got.some((m) => m.cat === c.id));
      const shown = got.filter((m) => trophyCat === 'all' || m.cat === trophyCat)
        .sort((a, b) => (trophySort === 'pts' ? b.pts - a.pts || b.at - a.at : trophySort === 'old' ? a.at - b.at : b.at - a.at));
      const elite = got.filter((m) => m.elite).length;
      body.appendChild(h('div', { class: 'card mshero', style: '--rc: #f5c542' },
        h('div', { class: 'kpis' }, kpi(`${got.length} / ${ms.filter((m) => !m.secret || m.at).length}`, 'Trophäen'), kpi(elite, '★ Elite'), kpi(fmt(got.reduce((a, m) => a + m.pts, 0)), 'Punkte'))));
      if (!got.length) { body.appendChild(h('p', { class: 'dim' }, 'Noch keine Trophäe – die erste gibt es oft schon beim ersten Spiel.')); return; }
      body.appendChild(h('div', { class: 'chips trophycats' },
        h('button', { class: `chip ${trophyCat === 'all' ? 'on' : ''}`, onclick: () => { trophyCat = 'all'; draw(); } }, `Alle (${got.length})`),
        cats.map((c) => h('button', { class: `chip ${trophyCat === c.id ? 'on' : ''}`, onclick: () => { trophyCat = c.id; draw(); } }, `${c.icon} ${c.title} (${got.filter((m) => m.cat === c.id).length})`))));
      body.appendChild(h('div', { class: 'seg', style: { gridTemplateColumns: 'repeat(3, 1fr)' } }, [['new', 'Neueste'], ['old', 'Älteste'], ['pts', 'Meiste Punkte']].map(([k, l]) => h('button', {
        class: trophySort === k ? 'on' : '', onclick: () => { trophySort = k; draw(); },
      }, l))));
      body.appendChild(h('div', { class: 'trophies' }, shown.map((m) => h('button', { class: `trophy ${m.elite ? 'elite' : ''}`, onclick: () => showDetail(m) },
        h('div', { class: 'ticon' }, m.icon),
        h('b', {}, m.title),
        h('span', { class: 'dim small' }, `${date(m.at)} · ${m.pts} P.`)))));
      body.appendChild(h('p', { class: 'dim small' }, 'Antippen zeigt, wann und in welchem Spiel die Trophäe erreicht wurde. ⭐ In die Vitrine legen: erscheint neben deinem Namen.'));
    };

    const draw = () => {
      body.replaceChildren(topbar('Meilensteine', nav));
      if (!ids.length) { body.appendChild(h('p', { class: 'dim' }, 'Noch keine Spiele gespeichert.')); return; }
      body.appendChild(playerPicker(ids, names, player, (v) => { player = v; draw(); }));
      // Spiele (zählen für Rang und Saison) oder Training (eigene Ansicht, zählt nicht für den Rang)
      // 🏆 Trophäen: nur die erreichten Meilensteine als Schrank (je Kategorie, neueste zuerst)
      body.appendChild(h('div', { class: 'seg', style: { gridTemplateColumns: 'repeat(3, 1fr)' } },
        h('button', { class: scope === 'games' ? 'on' : '', onclick: () => { scope = 'games'; draw(); } }, '🎯 Spiele'),
        h('button', { class: scope === 'trophies' ? 'on' : '', onclick: () => { scope = 'trophies'; draw(); } }, '🏆 Trophäen'),
        h('button', { class: scope === 'training' ? 'on' : '', onclick: () => { scope = 'training'; draw(); } }, '🏋️ Training')));
      if (scope === 'training') { drawTraining(); return; }
      const ms = milestones(usable, realMatches, player);
      const rk = playerRank(ms);
      const me = names.get(player) || '?';
      const crown = crownHolder(usable, realMatches);
      const streak = weekStreak(realMatches, player);
      const days = dayStreak(finished, player); // Tages-Serie: auch Trainings und Spiele gegen den Computer
      const pctOf = (r) => (r.next ? Math.round(((r.points - r.rank.min) / (r.next.min - r.rank.min)) * 100) : 100);
      const inShowcase = new Set(getShowcase(player));

      // Zeitstrahl der Ränge; wird erst beim Aufklappen zum aktuellen Rang geschoben (vorher hat er keine Breite)
      const timelineFold = (label, r, timeline) => {
        const tl = h('div', { class: 'ranktl' }, timeline.map((x, i) => h('div', { class: `tlstep ${i <= r.index ? 'on' : ''} ${i === r.index ? 'cur' : ''}`, style: `--rc: ${x.color}` },
          h('div', { class: 'tldot' }, i <= r.index ? x.icon : '🔒'),
          h('div', { class: 'tlname' }, x.title),
          h('div', { class: 'tldate' }, i <= r.index ? (x.at ? date(x.at) : '') : rankNeed(x)))));
        const det = h('details', { class: 'tlfold' }, h('summary', {}, label), tl);
        det.addEventListener('toggle', () => {
          const cur = tl.querySelector('.cur');
          if (det.open && cur) tl.scrollLeft = cur.offsetLeft - tl.clientWidth / 2 + cur.offsetWidth / 2;
        });
        return det;
      };

      // Wie erreicht: das Spiel, mit dem der Meilenstein fällig wurde (Zeitpunkt = Beginn dieses Spiels) – antippen öffnet es
      const achievedIn = (m) => {
        const mm = finished.find((x) => x.createdAt === m.at && x.players.includes(player));
        if (!mm) return null;
        const i = mm.players.indexOf(player);
        const opp = mm.playerNames.filter((_, k) => k !== i);
        const won = mm.winner != null ? (mm.winner === i ? 'gewonnen' : 'verloren') : '';
        return h('button', { class: 'btn ghost msmatch', onclick: () => showMatchDetail(mm) },
          `🎯 ${opp.length ? `Im Spiel gegen ${opp.join(', ')}` : 'Im Training'}${won ? ` (${won})` : ''} – Spiel ansehen ›`);
      };

      // ---------- Detailansicht eines Meilensteins ----------
      const showDetail = (m) => {
        const hidden = m.secret && !m.at;
        const cat = MILESTONE_CATEGORIES.find((c) => c.id === m.cat);
        const base = m.id.replace(/-[^-]+$/, '');
        const series = hidden ? [] : ms.filter((x) => x.cat === m.cat && x.id !== m.id && x.id.replace(/-[^-]+$/, '') === base && (m.group ? x.group === m.group : true));
        let s;
        const content = h('div', { class: 'stack msdetail' },
          h('div', { class: `msdicon ${m.at ? 'on' : ''}` }, hidden ? '❓' : m.icon),
          h('h2', {}, hidden ? 'Geheimer Meilenstein' : `${m.elite ? '★ ' : ''}${m.title}`),
          h('div', { class: 'msdmeta' },
            h('span', { class: 'pill' }, `${cat ? cat.icon : ''} ${cat ? cat.title : ''}`),
            h('span', { class: `pill ${m.elite ? 'gold' : ''}` }, `${m.pts} Punkte${m.elite ? ' · Elite' : ''}`)),
          m.at
            ? [h('div', { class: 'msdstate done' }, `✅ Erreicht am ${date(m.at)}`), achievedIn(m)]
            : hidden ? h('div', { class: 'msdstate dim' }, 'Was hier steckt, verrät sich erst, wenn es passiert.')
              : m.progress
                ? h('div', { class: 'stack', style: { gap: '6px' } },
                  h('div', { class: 'ratebar big' }, h('div', { style: { width: `${Math.round((m.progress[0] / m.progress[1]) * 100)}%` } })),
                  h('div', { class: 'num dim' }, `${fmt(m.progress[0])} / ${fmt(m.progress[1])} · noch ${fmt(m.progress[1] - m.progress[0])}`))
                : h('div', { class: 'msdstate dim' }, 'Noch offen'),
          // Doppel-Sammler: alle 21 Doppel, getroffene grün
          m.detail && m.detail.doubles ? doublesGrid(m.detail.doubles) : null,
          series.length ? [h('div', { class: 'sechead', style: { margin: '6px 0 0' } }, h('span', {}, 'Alle Stufen')),
            h('div', { class: 'seriesl' }, [m, ...series].sort((a, b) => (a.progress && b.progress ? a.progress[1] - b.progress[1] : 0)).map((x) => h('div', { class: `seriesrow ${x.at ? 'on' : ''} ${x.id === m.id ? 'cur' : ''}` },
              h('span', {}, x.at ? '✅' : '⬜'),
              h('span', { class: 'stitle' }, x.title),
              h('span', { class: 'num dim' }, x.at ? date(x.at) : `${x.pts} P.`))))] : null,
          m.at ? h('button', {
            class: `btn ${inShowcase.has(m.id) ? '' : 'primary'}`,
            onclick: () => {
              const list = toggleShowcase(player, m.id);
              toast(list.includes(m.id) ? `${m.icon} in der Vitrine` : 'Aus der Vitrine genommen');
              s.close(); draw();
            },
          }, inShowcase.has(m.id) ? 'Aus der Vitrine nehmen' : '⭐ In die Vitrine legen (neben dem Namen)') : null,
          h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Schließen'));
        s = sheet(content);
      };

      if (scope === 'trophies') { drawTrophies(ms, showDetail); return; }

      // ---------- 1) Kopf: Rang, Fortschritt, Kennzahlen, Serien, Vitrine ----------
      const vitrine = getShowcase(player).map((id) => ms.find((m) => m.id === id)).filter((m) => m && m.at);
      const hasCrown = crown && crown.playerId === player;
      body.appendChild(h('div', { class: 'card mshero', style: `--rc: ${rk.rank.color}` },
        h('div', { class: 'rankhead' },
          h('div', { class: 'badge', style: `--rc: ${rk.rank.color}` }, rk.rank.icon),
          h('div', { class: 'rankinfo' },
            h('div', { class: 'heroname' }, `${hasCrown ? '👑 ' : ''}${me}`),
            h('div', { class: 'rankname' }, rk.rank.title),
            h('div', { class: 'dim small' }, `Rang ${rk.index + 1} von ${RANKS.length}`))),
        h('div', { class: 'stack', style: { gap: '6px' } },
          h('div', { class: 'ratebar big' }, h('div', { style: { width: `${pctOf(rk)}%` } })),
          h('div', { class: 'small dim' }, nextRankText(rk))),
        h('div', { class: 'kpis' }, kpi(fmt(rk.points), 'Punkte'), kpi(`${rk.done} / ${ms.length}`, 'Meilensteine'), kpi(`${rk.elite}★`, 'Elite')),
        h('div', { class: 'heropills' },
          h('span', { class: `pill ${days.current && !days.playedToday ? 'warn' : ''}` }, `📆 ${days.current} ${days.current === 1 ? 'Tag' : 'Tage'}${days.current && !days.playedToday ? ' · heute noch!' : ''}`),
          h('span', { class: 'pill' }, `🔥 ${streak.current} ${streak.current === 1 ? 'Woche' : 'Wochen'}`),
          h('span', { class: 'pill' }, `Beste: ${days.best} T. · ${streak.best} W.`),
          hasCrown ? h('span', { class: 'pill gold' }, `👑 Abend-Krone · Ø ${crown.average.toFixed(1)}`) : null),
        h('div', { class: 'vitrinebox' }, [0, 1, 2].map((i) => {
          const m = vitrine[i];
          return h('div', { class: `vslot ${m ? 'on tap' : ''}`, onclick: () => m && showDetail(m) }, h('div', { class: 'vicon' }, m ? m.icon : '＋'), h('div', { class: 'vtitle' }, m ? m.title : 'Vitrine frei'));
        })),
        vitrine.length < 3 ? h('div', { class: 'dim small' }, 'Vitrine: einen erreichten Meilenstein antippen › „In die Vitrine legen“. Sie erscheint neben deinem Namen.') : null,
        timelineFold('Alle Ränge ansehen', rk, rk.timeline)));

      // ---------- 2) Saison ----------
      const ss = seasonStatus(usable, realMatches, player, ms);
      const past = pastSeasons(usable, realMatches, player, ms);
      const seasonFold = timelineFold('Saison-Ränge und Punkte', ss, SEASON_RANKS.map((x) => ({ ...x, at: null })));
      seasonFold.appendChild(h('div', { class: 'dim small', style: { marginTop: '6px' } },
        `${SEASON_POINTS_NOTE} Diese Saison: ${ss.parts.msPts} aus Meilensteinen, ${ss.parts.tasks} Aufgaben, ${ss.parts.medals} Medaillen, ${ss.parts.wins} Siege, ${ss.parts.legs} Legs, ${ss.parts.played} Matches.`,
        past.length ? ` Frühere Saisons: ${past.map((p) => `${p.season.name} ${p.rank.icon} ${p.rank.title}`).join(' · ')}` : ''));
      body.appendChild(h('div', { class: 'card seasoncard' },
        h('div', { class: 'rankhead' },
          h('div', { class: 'badge sm', style: `--rc: ${ss.rank.color}` }, ss.rank.icon),
          h('div', { class: 'rankinfo' },
            h('div', { class: 'dim small' }, `Saison ${ss.season.name}`),
            h('div', { class: 'seasonname' }, ss.rank.title, h('span', { class: 'num dim' }, ` · ${ss.points} P.`)),
            h('div', { class: 'ratebar' }, h('div', { style: { width: `${pctOf(ss)}%` } })),
            h('div', { class: 'dim small' }, ss.next ? `noch ${ss.next.min - ss.points} bis ${ss.next.icon} ${ss.next.title}` : 'Champion!'))),
        seasonFold));

      // ---------- 3) Als Nächstes und Zuletzt erreicht ----------
      const near = ms.filter((m) => !m.at && !m.secret && m.progress && m.progress[0] > 0)
        .map((m) => ({ m, r: m.progress[0] / m.progress[1] }))
        .sort((a, b) => b.r - a.r || b.m.pts - a.m.pts).slice(0, 3);
      if (near.length) {
        body.appendChild(sec('🎯 Als Nächstes'));
        body.appendChild(h('div', { class: 'card nextlist' }, near.map(({ m, r }) => h('div', { class: 'nextrow tap', onclick: () => showDetail(m) },
          h('div', { class: 'nexticon' }, m.icon),
          h('div', { class: 'nextmain' },
            h('div', { class: 'nexttop' }, h('b', {}, `${m.elite ? '★ ' : ''}${m.title}`), h('span', { class: 'num dim' }, `+${m.pts} P.`)),
            h('div', { class: 'ratebar' }, h('div', { style: { width: `${Math.round(r * 100)}%` } })),
            h('div', { class: 'num dim small' }, `${fmt(m.progress[0])} / ${fmt(m.progress[1])} · noch ${fmt(m.progress[1] - m.progress[0])}`))))));
      }
      const latest = ms.filter((m) => m.at).sort((a, b) => b.at - a.at).slice(0, 8);
      if (latest.length) {
        body.appendChild(sec('✨ Zuletzt erreicht'));
        body.appendChild(h('div', { class: 'recentstrip' }, latest.map((m) => h('div', { class: 'recentms tap', onclick: () => showDetail(m) },
          h('div', { class: 'ricon' }, m.icon), h('div', { class: 'rtitle' }, m.title), h('div', { class: 'rdate num' }, date(m.at))))));
      }

      // ---------- 4) Aufgaben ----------
      const wk = weekStatus(usable, realMatches, player);
      const dy = dayStatus(usable, realMatches, player);
      const mc = missionCounts(usable, realMatches, player);
      const taskList = (items) => h('ol', { class: 'tasklist' }, items.map((i) => h('li', { class: i.done ? 'done' : '' },
        h('span', { class: 'tasktext' }, i.text), h('span', { class: 'taskstate' }, i.done ? 'geschafft' : `${i.cur} / ${i.goal}`))));
      body.appendChild(sec('📋 Aufgaben'));
      body.appendChild(h('div', { class: 'card stack taskcard' },
        h('div', { class: 'taskhead' }, h('b', {}, '☀️ Heute'), h('span', { class: `num ${dy.perfect ? 'accent' : 'dim'}` }, dy.perfect ? '🌟 perfekter Tag' : `${dy.done} / 3`)),
        taskList(dy.items),
        h('div', { class: 'taskhead' }, h('b', {}, '🗓️ Diese Woche'), h('span', { class: `num ${wk.medal ? 'accent' : 'dim'}` }, wk.medal ? '🏅 Medaille' : `${wk.done} / 3`)),
        taskList(wk.items),
        h('div', { class: 'dim small' }, `Bisher: ${mc.daily} Tagesaufgaben · ${mc.perfectDays} perfekte Tage · ${mc.weekly} Wochenaufgaben · ${mc.medals} Medaillen.`)));

      // ---------- 5) Alle Meilensteine: Suche und Filter ----------
      body.appendChild(sec('🎖️ Alle Meilensteine', h('span', { class: 'num dim' }, `${rk.done} / ${ms.length}`)));
      const listEl = h('div', { class: 'stack', style: { gap: '8px' } });
      const searchEl = h('input', { type: 'search', placeholder: '🔍 Suchen, z. B. „180“, „Doppel“, „Leg“', value: f.text, oninput: (e) => { f.text = e.target.value; renderList(); } });
      const select = (values, key) => h('select', { onchange: (e) => { f[key] = e.target.value; renderList(); } },
        values.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
      const segEl = h('div', { class: 'seg' });
      const drawSeg = () => segEl.replaceChildren(...[['all', 'Alle'], ['done', 'Erreicht'], ['open', 'Offen']].map(([k, l]) =>
        h('button', { class: f.state === k ? 'on' : '', onclick: () => { f.state = k; drawSeg(); renderList(); } }, l)));
      drawSeg();
      body.appendChild(h('div', { class: 'card stack msfilter' }, searchEl, segEl,
        h('div', { class: 'grid2' }, select(PTS_FILTERS, 'pts'), select([['cat', 'Nach Kategorie'], ['pts', 'Nach Punkten'], ['new', 'Neueste zuerst']], 'sort'))));
      body.appendChild(listEl);

      const matchesFilter = (m) => {
        if (f.state === 'done' && !m.at) return false;
        if (f.state === 'open' && m.at) return false;
        if (f.pts === 'low' && m.pts >= 10) return false;
        if (f.pts === 'mid' && (m.pts < 10 || m.pts >= ELITE_PTS)) return false;
        if (f.pts === 'elite' && !m.elite) return false;
        const q = f.text.trim().toLowerCase();
        if (q) {
          if (m.secret && !m.at) return false; // geheime bleiben geheim
          const cat = MILESTONE_CATEGORIES.find((c) => c.id === m.cat);
          if (!`${m.title} ${cat ? cat.title : ''}`.toLowerCase().includes(q)) return false;
        }
        return true;
      };
      const tile = (m) => {
        const showBar = !m.at && !m.secret && m.progress && m.progress[0] > 0;
        return h('div', { class: `ms tap ${m.at ? 'on' : ''} ${inShowcase.has(m.id) ? 'shown' : ''} ${m.elite ? 'elite' : ''}`, onclick: () => showDetail(m) },
          h('div', { class: 'msicon' }, m.secret && !m.at ? '❓' : m.icon),
          h('div', { class: 'mstext' },
            h('b', {}, m.secret && !m.at ? '???' : `${m.elite ? '★ ' : ''}${m.title}`),
            h('span', { class: 'num' }, `${m.at ? date(m.at) : m.progress && !m.secret ? `${fmt(m.progress[0])} / ${fmt(m.progress[1])}` : 'noch offen'} · ${m.pts} P.${inShowcase.has(m.id) ? ' · ⭐' : ''}`),
            showBar ? h('div', { class: 'ratebar thin' }, h('div', { style: { width: `${Math.round((m.progress[0] / m.progress[1]) * 100)}%` } })) : null));
      };
      // Aufklappbare Gruppe (Kategorie oder Unterteilung); key merkt sich, was offen ist
      const fold = (key, icon, title, list, inner, cls = 'mscat', open = false) => {
        const n = list.filter((m) => m.at).length;
        const det = h('details', { class: cls },
          h('summary', {},
            h('span', { class: 'mscicon' }, icon),
            h('span', { class: 'msctext' }, h('b', {}, title), h('span', { class: 'ratebar' }, h('span', { style: { width: `${Math.round((n / list.length) * 100)}%` } }))),
            h('span', { class: `msccount num ${n === list.length ? 'accent' : ''}` }, `${n} / ${list.length}`)),
          inner);
        if (open || openCats.has(key)) det.open = true;
        det.addEventListener('toggle', () => { if (det.open) openCats.add(key); else openCats.delete(key); });
        return det;
      };
      function renderList() {
        const hits = ms.filter(matchesFilter);
        const filtered = f.text.trim() || f.state !== 'all' || f.pts !== 'all';
        if (!hits.length) { listEl.replaceChildren(h('p', { class: 'dim' }, 'Kein Meilenstein passt zu Suche und Filter.')); return; }
        // Flache Liste bei Suche oder anderer Sortierung
        if (f.text.trim() || f.sort !== 'cat') {
          const sorted = hits.slice().sort(f.sort === 'pts' ? (a, b) => b.pts - a.pts : f.sort === 'new' ? (a, b) => (b.at || 0) - (a.at || 0) || b.pts - a.pts : () => 0);
          listEl.replaceChildren(h('div', { class: 'small dim' }, `${hits.length} Meilensteine`), h('div', { class: 'milestones' }, sorted.map(tile)));
          return;
        }
        listEl.replaceChildren(...MILESTONE_CATEGORIES.map((c) => {
          const list = ms.filter((m) => m.cat === c.id);
          const shown = list.filter(matchesFilter);
          if (!shown.length) return null;
          const groups = MILESTONE_GROUPS[c.id];
          return fold(c.id, c.icon, c.title, list, [
            h('p', { class: 'dim', style: { fontSize: '13px', margin: '0 0 8px' } }, c.note),
            groups
              ? groups.map((g) => {
                const sub = list.filter((m) => m.group === g.id);
                const subShown = sub.filter(matchesFilter);
                return subShown.length ? fold(`${c.id}:${g.id}`, g.icon, g.title, sub, h('div', { class: 'milestones' }, subShown.map(tile)), 'mscat sub', filtered) : null;
              })
              : h('div', { class: 'milestones' }, shown.map(tile)),
          ], 'mscat', filtered);
        }).filter(Boolean));
      }
      renderList();
      body.appendChild(h('p', { class: 'dim small' }, 'Gezählt werden beendete Spiele gegen echte Spieler und Trainings. Spiele gegen den Computer und Gäste zählen nicht. Elite-Meilensteine (★) bringen viele Punkte und werden für die oberen Ränge gebraucht.'));
    };
    draw();
  }).catch((e) => body.appendChild(h('p', { class: 'dim' }, `Meilensteine konnten nicht geladen werden: ${e.message}`)));
}

/** Alle 21 Doppel (D1–D20 und Bull), getroffene hervorgehoben. */
function doublesGrid(hit) {
  const got = new Set(hit);
  const all = [...Array.from({ length: 20 }, (_, i) => `D${i + 1}`), 'BULL'];
  return h('div', { class: 'stack', style: { gap: '6px' } },
    h('div', { class: 'small dim' }, `${all.filter((d) => got.has(d)).length} von 21 Doppeln schon zum Auschecken getroffen:`),
    h('div', { class: 'dblgrid' }, all.map((d) => h('div', { class: `dblcell num ${got.has(d) ? 'on' : ''}` }, d === 'BULL' ? 'Bull' : d))));
}

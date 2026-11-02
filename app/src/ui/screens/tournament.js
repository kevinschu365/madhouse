// Turnier-Modus: Liste der Turniere, neues Turnier anlegen (Auslosung), Turnierbaum bzw. Tabelle,
// Spiele direkt starten oder fortsetzen. Logik in core/tournament.js.
import { h, toast, promptDialog, confirmDialog } from '../dom.js';
import { getPlayers, addPlayer, getSettings, updateSettings, displayName } from '../../core/settings.js';
import { dbGetAll, lsGet } from '../../core/storage.js';
import { unlock } from '../../audio/speech.js';
import { getTournaments, getTournament, saveTournament, deleteTournament, createTournament, tournamentState, matchTag, TOURNAMENT_FORMATS, KO_MIN, RR_MIN, MAX_PLAYERS } from '../../core/tournament.js';
import { confetti } from '../celebrate.js';
import { showMatchDetail } from '../matchDetail.js';

const MODES = [['x01', 'X01'], ['cricket', 'Cricket']];

export function render(root, params, nav) {
  const body = h('div', { class: 'stack', style: { maxWidth: '640px', margin: '0 auto' } });
  root.appendChild(body);
  const topbar = (title, back) => h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: back }, '‹'), h('h1', {}, title));
  const sec = (text, right = null) => h('div', { class: 'sechead' }, h('span', {}, text), right);
  const dropdown = (label, values, current, onPick) => h('label', { class: 'field' }, h('span', {}, label),
    h('select', { onchange: (e) => onPick(e.target.value) },
      values.map(([v, text]) => h('option', { value: String(v), selected: String(v) === String(current) }, text))));

  dbGetAll('matches').then((matches) => {
    if (params.id && getTournament(params.id)) drawDetail(getTournament(params.id), matches);
    else if (params.create) drawCreate();
    else drawList(matches);
  }).catch((e) => body.replaceChildren(topbar('Turnier', () => nav.go('home')), h('p', { class: 'dim' }, `Turniere konnten nicht geladen werden: ${e.message}`)));

  // ---------- Übersicht ----------
  function drawList(matches) {
    const list = getTournaments();
    body.replaceChildren(
      topbar('Turniere', () => nav.go('home')),
      h('button', { class: 'btn primary', style: { minHeight: '60px', fontSize: '20px' }, onclick: () => nav.go('tournament', { create: true }) }, '＋ Neues Turnier'),
      h('p', { class: 'dim small', style: { margin: 0 } }, `K.-o. mit ${KO_MIN}–${MAX_PLAYERS} Spielern oder Jeder gegen Jeden mit ${RR_MIN}–${MAX_PLAYERS}. Die Auslosung macht die App. Jedes Turnier-Match zählt ganz normal in die Statistik, dazu gibt es Turnier-Meilensteine.`),
      list.length ? sec('🏆 Deine Turniere') : null,
      list.map((t) => {
        const st = tournamentState(t, matches);
        const played = st.games.filter((g) => g.status === 'done').length;
        const total = st.games.filter((g) => g.status !== 'bye').length;
        return h('div', { class: 'card tourrow tap', onclick: () => nav.go('tournament', { id: t.id }) },
          h('div', { class: 'tourmain' },
            h('b', {}, t.name),
            h('div', { class: 'small dim' }, `${TOURNAMENT_FORMATS[t.format]} · ${t.players.length} Spieler · ${new Date(t.createdAt).toLocaleDateString('de-DE')}`)),
          st.champion && st.done
            ? h('span', { class: 'pill gold' }, `🏆 ${t.playerNames[st.champion]}`)
            : h('span', { class: 'pill' }, `${played} / ${total} Spiele`),
          h('span', { class: 'dim' }, '›'));
      }),
    );
  }

  // ---------- Neues Turnier ----------
  function drawCreate() {
    const s = getSettings();
    const last = s.lastTournament || {};
    const cfg = {
      name: `Turnier ${new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })}`,
      format: last.format || 'ko', mode: last.mode || 'x01', startScore: last.startScore || 501, cutThroat: !!last.cutThroat,
      legsBestOf: last.legsBestOf || 3, input: last.input || (s.cameraEnabled ? 'camera' : 'dart'),
      selected: (last.players || []).filter((id) => getPlayers().some((p) => p.id === id)),
    };
    const draw = () => {
      const players = getPlayers();
      const min = cfg.format === 'ko' ? KO_MIN : RR_MIN;
      const n = cfg.selected.length;
      const ready = n >= min && n <= MAX_PLAYERS;
      const toggle = (id) => {
        if (cfg.selected.includes(id)) cfg.selected = cfg.selected.filter((x) => x !== id);
        else if (cfg.selected.length < MAX_PLAYERS) cfg.selected.push(id);
        else toast(`Höchstens ${MAX_PLAYERS} Spieler.`);
        draw();
      };
      const nameInput = h('input', { value: cfg.name, oninput: (e) => { cfg.name = e.target.value; } });
      const gamesText = cfg.format === 'ko'
        ? (n >= KO_MIN ? `${n - 1} Spiele${n !== 4 && n !== 8 ? `, ${(n <= 4 ? 4 : 8) - n} Freilos${(n <= 4 ? 4 : 8) - n > 1 ? 'e' : ''} in Runde 1` : ''}` : '')
        : (n >= RR_MIN ? `${(n * (n - 1)) / 2} Spiele, jeder spielt ${n - 1}×` : '');
      body.replaceChildren(
        topbar('Neues Turnier', () => nav.go('tournament')),
        h('div', { class: 'card stack' },
          h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Name'), nameInput),
          h('div', { class: 'seg two' }, Object.entries(TOURNAMENT_FORMATS).map(([k, l]) =>
            h('button', { class: cfg.format === k ? 'on' : '', onclick: () => { cfg.format = k; draw(); } }, k === 'ko' ? '🌳 K.-o.' : '🔄 Jeder gegen Jeden'))),
          h('div', { class: 'chips' }, MODES.map(([k, l]) => h('button', { class: `chip ${cfg.mode === k ? 'on' : ''}`, onclick: () => { cfg.mode = k; draw(); } }, l))),
          h('div', { class: 'grid3' },
            cfg.mode === 'x01'
              ? dropdown('Startwert', [301, 501, 701].map((v) => [v, String(v)]), cfg.startScore, (v) => { cfg.startScore = +v; })
              : dropdown('Variante', [['0', 'Standard'], ['1', 'Cut Throat']], cfg.cutThroat ? '1' : '0', (v) => { cfg.cutThroat = v === '1'; }),
            dropdown('Legs', [1, 3, 5, 7].map((v) => [v, v === 1 ? '1 Leg' : `Best of ${v}`]), cfg.legsBestOf, (v) => { cfg.legsBestOf = +v; }),
            dropdown('Eingabe', [['camera', 'Kamera'], ['dart', 'Pro Dart'], ['board', 'Scheibe'], ...(cfg.mode === 'x01' ? [['total', 'Summe']] : [])], cfg.input, (v) => { cfg.input = v; }),
          ),
        ),
        sec('👥 Spieler', h('span', { class: `num ${ready ? 'accent' : 'dim'}` }, `${n} / ${MAX_PLAYERS}`)),
        h('div', { class: 'chips' },
          players.map((p) => h('button', { class: `chip ${cfg.selected.includes(p.id) ? 'on' : ''}`, onclick: () => toggle(p.id) },
            cfg.selected.includes(p.id) ? h('span', { class: 'pick num' }, cfg.selected.indexOf(p.id) + 1) : null, displayName(p, players))),
          h('button', {
            class: 'chip',
            onclick: async () => {
              const nm = await promptDialog('Neuer Spieler', '', { ok: 'Anlegen', placeholder: 'Name' });
              if (nm == null) return;
              try { const p = addPlayer(nm); if (cfg.selected.length < MAX_PLAYERS) cfg.selected.push(p.id); } catch (e) { toast(e.message); }
              draw();
            },
          }, '＋ Neu')),
        h('p', { class: 'dim small', style: { margin: 0 } }, ready ? gamesText : `Mindestens ${min} Spieler wählen.`),
        h('button', {
          class: 'btn primary', style: { minHeight: '64px', fontSize: '22px' }, disabled: !ready,
          onclick: () => {
            const t = createTournament({
              name: cfg.name.trim() || 'Turnier', format: cfg.format, mode: cfg.mode,
              options: cfg.mode === 'x01' ? { startScore: cfg.startScore, doubleOut: true } : { cutThroat: cfg.cutThroat },
              legsBestOf: cfg.legsBestOf, input: cfg.input === 'camera' ? 'dart' : cfg.input, camera: cfg.input === 'camera',
              players: cfg.selected, playerNames: cfg.selected.map((id) => displayName(players.find((p) => p.id === id), players)),
            });
            saveTournament(t);
            updateSettings({ lastTournament: { format: cfg.format, mode: cfg.mode, startScore: cfg.startScore, cutThroat: cfg.cutThroat, legsBestOf: cfg.legsBestOf, input: cfg.input, players: cfg.selected } });
            toast('🎲 Ausgelost!');
            nav.go('tournament', { id: t.id, fresh: true });
          },
        }, ready ? 'Auslosen und starten' : 'Spieler wählen'),
      );
    };
    draw();
  }

  // ---------- Ein Turnier ----------
  function drawDetail(t, matches) {
    const st = tournamentState(t, matches);
    const name = (id) => (id ? t.playerNames[id] || '?' : null);
    const startGame = (g) => {
      unlock(); // iOS: Sprachausgabe durch diesen Tipp freischalten
      if (g.status === 'running' && g.match) { nav.go('game', { match: g.match }); return; }
      const active = lsGet('activeMatch', null);
      if (active && active.status === 'running') { toast('Es läuft noch ein anderes Spiel – erst beenden.'); return; }
      const gameParams = {
        setup: { mode: t.mode, options: t.options, players: [g.a, g.b], playerNames: [name(g.a), name(g.b)], setsBestOf: 1, legsBestOf: t.legsBestOf, firstStarter: 0, starterMethod: 'tap' },
        camera: t.camera, inputMode: t.input, tournament: matchTag(t, g),
      };
      if (t.camera) nav.go('calibrate', { mode: 'quickcheck', then: 'game', thenParams: gameParams });
      else nav.go('game', gameParams);
    };
    const side = (g, id) => h('div', { class: `tside ${g.winnerId && g.winnerId === id ? 'win' : g.winnerId ? 'lose' : ''}` },
      h('span', {}, id ? name(id) : g.round === 1 && t.format === 'ko' ? 'Freilos' : '–'),
      g.result ? h('b', { class: 'num' }, g.result.legs[id] ?? '') : null);
    const gameCard = (g) => h('div', {
      class: `tgame ${g.status}`,
      onclick: () => { if (g.status === 'done' && g.match) showMatchDetail(g.match); else if (g.status === 'ready' || g.status === 'running') startGame(g); },
    },
    side(g, g.a), side(g, g.b),
    g.status === 'ready' ? h('div', { class: 'tplay' }, '▶ Spielen') : g.status === 'running' ? h('div', { class: 'tplay' }, '⏵ Läuft – weiter') : null);

    const head = st.champion && st.done
      ? h('div', { class: 'card mshero champcard', style: '--rc: #f5c542' },
        h('div', { class: 'champicon' }, '🏆'),
        h('div', { class: 'small dim' }, `${t.name} · ${TOURNAMENT_FORMATS[t.format]}`),
        h('div', { class: 'rankname' }, name(st.champion)),
        h('div', { class: 'small dim' }, 'gewinnt das Turnier!'))
      : h('div', { class: 'card stack' },
        h('div', { class: 'small dim' }, `${TOURNAMENT_FORMATS[t.format]} · ${t.mode === 'x01' ? `${t.options.startScore}` : 'Cricket'} · ${t.legsBestOf === 1 ? '1 Leg' : `Best of ${t.legsBestOf} Legs`} · ${t.players.length} Spieler`),
        st.open.length
          ? [h('b', {}, st.open.length === 1 ? 'Nächstes Spiel' : `${st.open.length} Spiele bereit`),
            st.open.slice(0, 4).map((g) => h('button', { class: `btn ${g === st.open[0] ? 'primary' : ''}`, onclick: () => startGame(g) },
              `${g.status === 'running' ? '⏵' : '▶'} ${name(g.a)} vs. ${name(g.b)}`, h('span', { class: 'small', style: { opacity: 0.7 } }, ` · ${g.roundName}`)))]
          : h('div', { class: 'dim' }, 'Warte auf Ergebnisse.'));

    const plan = t.format === 'ko'
      ? [sec('🌳 Turnierbaum'), h('div', { class: 'bracket' }, st.rounds.map((r) => h('div', { class: 'bcol' }, h('div', { class: 'bhead' }, r.name), h('div', { class: 'bgames' }, r.games.map(gameCard)))))]
      : [sec('📊 Tabelle'),
        h('table', { class: 'hist ttable' },
          h('tr', { class: 'dim small' }, h('td', {}, '#'), h('td', {}, 'Spieler'), h('td', { class: 'num' }, 'Sp.'), h('td', { class: 'num' }, 'S'), h('td', { class: 'num' }, 'N'), h('td', { class: 'num' }, 'Legs')),
          st.table.map((r, i) => h('tr', { class: i === 0 && r.played ? 'lead' : '' },
            h('td', { class: 'num' }, i + 1), h('td', {}, h('b', {}, name(r.id))),
            h('td', { class: 'num' }, r.played), h('td', { class: 'num accent' }, r.won), h('td', { class: 'num' }, r.lost),
            h('td', { class: 'num' }, `${r.legsFor}:${r.legsAgainst}`)))),
        sec('🗓️ Spielplan'),
        st.rounds.map((r) => h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'small dim' }, r.name), h('div', { class: 'rrgames' }, r.games.map(gameCard))))];

    body.replaceChildren(
      topbar(t.name, () => nav.go('tournament')),
      head,
      plan,
      h('p', { class: 'dim small' }, 'Spiele auf einem anderen Handy: Turnier und Spiele kommen über „Abgleich“ (Einstellungen) auf das andere Gerät. Gestartet wird das Spiel dort aus diesem Turnier; das Ergebnis kommt beim nächsten Abgleich zurück.'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn ghost',
          onclick: async () => {
            const nm = await promptDialog('Turnier umbenennen', t.name, { ok: 'Speichern' });
            if (nm && nm.trim()) { t.name = nm.trim(); saveTournament(t); drawDetail(t, matches); }
          },
        }, 'Umbenennen'),
        h('button', {
          class: 'btn danger',
          onclick: async () => {
            if (await confirmDialog('Turnier entfernen?', 'Nur der Turnierplan verschwindet. Gespielte Matches bleiben in der Statistik.', { ok: 'Entfernen', danger: true })) {
              deleteTournament(t.id); nav.go('tournament');
            }
          },
        }, 'Entfernen')),
    );
    if (st.champion && st.done && params.celebrate) confetti(); // gerade das letzte Spiel beendet
  }
}

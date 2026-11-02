// Turnier-Modus: Liste der Turniere, neues Turnier anlegen (Auslosung), Gruppen und K.-o.-Baum,
// Spiele direkt starten oder fortsetzen. Logik in core/tournament.js, Anzeige in ui/tournamentView.js.
// Läuft die App über den Turnier-Server (PC), kann das Turnier live geschaltet werden (ui/screens/live.js).
import { h, toast, promptDialog, confirmDialog } from '../dom.js';
import { getPlayers, addPlayer, getSettings, updateSettings, displayName, newGuest, isGuestId } from '../../core/settings.js';
import { dbGetAll, lsGet } from '../../core/storage.js';
import { unlock } from '../../audio/speech.js';
import { getTournaments, getTournament, saveTournament, deleteTournament, createTournament, tournamentState, matchTag, groupCount, TOURNAMENT_FORMATS, LIMITS, MAX_PLAYERS } from '../../core/tournament.js';
import { liveServer, postTournament, setCloudCode } from '../../core/live.js';
import { cloudEnabled, newCode, normCode, showCode, fetchState } from '../../core/cloud.js';
import { confetti } from '../celebrate.js';
import { showMatchDetail } from '../matchDetail.js';
import { planView, champCard, nameOf } from '../tournamentView.js';

const MODES = [['x01', 'X01'], ['cricket', 'Cricket']];
const FORMAT_ICONS = { ko: '🌳', rr: '🔄', gko: '👥' };

export function render(root, params, nav) {
  const body = h('div', { class: 'stack', style: { maxWidth: '720px', margin: '0 auto' } });
  root.appendChild(body);
  const topbar = (title, back) => h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: back }, '‹'), h('h1', {}, title));
  const sec = (text, right = null) => h('div', { class: 'sechead' }, h('span', {}, text), right);
  const dropdown = (label, values, current, onPick) => h('label', { class: 'field' }, h('span', {}, label),
    h('select', { onchange: (e) => onPick(e.target.value) },
      values.map(([v, text]) => h('option', { value: String(v), selected: String(v) === String(current) }, text))));

  Promise.all([dbGetAll('matches'), liveServer()]).then(([matches, live]) => {
    if (params.id && getTournament(params.id)) drawDetail(getTournament(params.id), matches, live);
    else if (params.create) drawCreate();
    else drawList(matches, live);
  }).catch((e) => body.replaceChildren(topbar('Turnier', () => nav.go('home')), h('p', { class: 'dim' }, `Turniere konnten nicht geladen werden: ${e.message}`)));

  // ---------- Übersicht ----------
  function drawList(matches, live) {
    const list = getTournaments();
    body.replaceChildren(
      topbar('Turniere', () => nav.go('home')),
      h('button', { class: 'btn primary', style: { minHeight: '60px', fontSize: '20px' }, onclick: () => nav.go('tournament', { create: true }) }, '＋ Neues Turnier'),
      // Online-Turnier beitreten (Code von der Turnierleitung)
      cloudEnabled() && !(live && live.cloud) ? h('button', {
        class: 'btn', style: { minHeight: '56px' },
        onclick: async () => {
          const input = await promptDialog('Online-Turnier beitreten', '', { ok: 'Beitreten', placeholder: 'Code, z. B. K7P2-QX9M' });
          if (input == null) return;
          const code = normCode(input);
          if (!code) { toast('Der Code hat 8 Zeichen (Buchstaben und Ziffern).'); return; }
          try {
            const s = await fetchState(code);
            if (!s.tournament) { toast('Kein Turnier mit diesem Code gefunden.'); return; }
            setCloudCode(code); unlock(); nav.go('board');
          } catch (e) { toast(e.message); }
        },
      }, '🌐 Turnier beitreten (Code)') : null,
      live ? h('div', { class: 'card stack' },
        h('b', {}, live.cloud ? `🌐 Online-Turnier · Code ${showCode(live.code)}` : '🏟️ Turnier-Server erkannt'),
        h('div', { class: 'small dim' }, live.cloud ? 'Dieses Gerät ist mit einem Online-Turnier verbunden.' : 'Diese App läuft über den PC. Turnier anlegen, dann „Live schalten“: Der PC ruft die Spiele an die Boards auf, die iPhones zählen.'),
        h('div', { class: 'grid2' },
          h('button', { class: 'btn', onclick: () => nav.go('live') }, '📺 Live-Ansicht'),
          h('button', { class: 'btn', onclick: () => nav.go('board') }, '🎯 Board-Handy'))) : null,
      h('p', { class: 'dim small', style: { margin: 0 } }, `K.-o. mit ${LIMITS.ko.join('–')} Spielern, Jeder gegen Jeden mit ${LIMITS.rr.join('–')}, Gruppen + K.-o. mit ${LIMITS.gko.join('–')}. Die Auslosung macht die App. Jedes Turnier-Match zählt normal in die Statistik, dazu gibt es Turnier-Meilensteine.`),
      list.length ? sec('🏆 Deine Turniere') : null,
      list.map((t) => {
        let st = null;
        try { st = tournamentState(t, matches); } catch { /* Turnier aus älterer Version */ }
        const played = st ? st.games.filter((g) => g.status === 'done').length : 0;
        const total = st ? st.games.filter((g) => !g.bye).length : 0;
        return h('div', { class: 'card tourrow tap', onclick: () => nav.go('tournament', { id: t.id }) },
          h('div', { class: 'tourmain' },
            h('b', {}, t.name),
            h('div', { class: 'small dim' }, `${TOURNAMENT_FORMATS[t.format] || t.format} · ${t.players.length} Spieler · ${new Date(t.createdAt).toLocaleDateString('de-DE')}`)),
          st && st.champion && st.done
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
      legsBestOf: last.legsBestOf || 3, input: last.input || 'total', groupSize: last.groupSize || 5,
      boards: last.boards || 2, pauseMin: last.pauseMin ?? 0,
      selected: (last.players || []).filter((id) => getPlayers().some((p) => p.id === id)),
      guests: [], // Gäste dieses Turniers (ohne Statistik)
    };
    const draw = () => {
      const players = getPlayers();
      const [min, max] = LIMITS[cfg.format];
      const n = cfg.selected.length;
      const ready = n >= min && n <= max;
      const toggle = (id) => {
        if (cfg.selected.includes(id)) cfg.selected = cfg.selected.filter((x) => x !== id);
        else if (cfg.selected.length < MAX_PLAYERS) cfg.selected.push(id);
        else toast(`Höchstens ${MAX_PLAYERS} Spieler.`);
        draw();
      };
      const nameInput = h('input', { value: cfg.name, oninput: (e) => { cfg.name = e.target.value; } });
      const size = (k) => { let x = 4; while (x < k) x *= 2; return x; };
      let info = `Mindestens ${min}, höchstens ${max} Spieler.`;
      if (ready && cfg.format === 'ko') info = `${n - 1} Spiele${size(n) > n ? `, ${size(n) - n} Freilos${size(n) - n > 1 ? 'e' : ''} in Runde 1` : ''}.`;
      if (ready && cfg.format === 'rr') info = `${(n * (n - 1)) / 2} Spiele, jeder spielt ${n - 1}×.`;
      if (ready && cfg.format === 'gko') {
        const g = groupCount(n, cfg.groupSize);
        const sizes = Array.from({ length: g }, (_, i) => Math.floor(n / g) + (i < n % g ? 1 : 0));
        const groupGames = sizes.reduce((a, k) => a + (k * (k - 1)) / 2, 0);
        info = `${g} Gruppen (${[...new Set(sizes)].join(' bzw. ')} Spieler), ${groupGames} Gruppenspiele, dann K.-o. mit ${2 * g} Spielern (${2 * g - 1} Spiele).`;
      }
      body.replaceChildren(
        topbar('Neues Turnier', () => nav.go('tournament')),
        h('div', { class: 'card stack' },
          h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Name'), nameInput),
          h('div', { class: 'seg' }, Object.entries(TOURNAMENT_FORMATS).map(([k, l]) =>
            h('button', { class: cfg.format === k ? 'on' : '', onclick: () => { cfg.format = k; draw(); } }, `${FORMAT_ICONS[k]} ${l}`))),
          h('div', { class: 'chips' }, MODES.map(([k, l]) => h('button', { class: `chip ${cfg.mode === k ? 'on' : ''}`, onclick: () => { cfg.mode = k; if (k !== 'x01' && cfg.input === 'total') cfg.input = 'dart'; draw(); } }, l))),
          h('div', { class: 'grid3' },
            cfg.mode === 'x01'
              ? dropdown('Startwert', [301, 501, 701].map((v) => [v, String(v)]), cfg.startScore, (v) => { cfg.startScore = +v; })
              : dropdown('Variante', [['0', 'Standard'], ['1', 'Cut Throat']], cfg.cutThroat ? '1' : '0', (v) => { cfg.cutThroat = v === '1'; }),
            dropdown('Legs', [1, 3, 5, 7].map((v) => [v, v === 1 ? '1 Leg' : `Best of ${v}`]), cfg.legsBestOf, (v) => { cfg.legsBestOf = +v; }),
            dropdown('Eingabe', [['total', 'Summe'], ['dart', 'Pro Dart'], ['board', 'Scheibe']].filter(([k]) => k !== 'total' || cfg.mode === 'x01'), cfg.input, (v) => { cfg.input = v; }),
            cfg.format === 'gko' ? dropdown('Gruppengröße', [[4, 'etwa 4'], [5, 'etwa 5'], [6, 'etwa 6']], cfg.groupSize, (v) => { cfg.groupSize = +v; draw(); }) : null,
            dropdown('Boards', [1, 2, 3, 4, 5, 6].map((v) => [v, String(v)]), cfg.boards, (v) => { cfg.boards = +v; }),
            cfg.format !== 'rr' ? dropdown('Pause vor K.-o.-Runden', [[0, 'keine'], [5, '5 Minuten'], [10, '10 Minuten'], [15, '15 Minuten']], cfg.pauseMin, (v) => { cfg.pauseMin = +v; }) : null,
          ),
        ),
        sec('👥 Spieler', h('span', { class: `num ${ready ? 'accent' : 'dim'}` }, `${n} / ${max}`)),
        h('div', { class: 'chips' },
          players.map((p) => h('button', { class: `chip ${cfg.selected.includes(p.id) ? 'on' : ''}`, onclick: () => toggle(p.id) },
            cfg.selected.includes(p.id) ? h('span', { class: 'pick num' }, cfg.selected.indexOf(p.id) + 1) : null, displayName(p, players))),
          h('button', {
            class: 'chip',
            onclick: async () => {
              const txt = await promptDialog('Neue Spieler', '', { ok: 'Anlegen', placeholder: 'Namen, mit Komma getrennt' });
              if (txt == null) return;
              for (const nm of txt.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) {
                try { const p = addPlayer(nm); if (cfg.selected.length < MAX_PLAYERS) cfg.selected.push(p.id); } catch (e) { toast(e.message); }
              }
              draw();
            },
          }, '＋ Neu'),
          // Gäste: spielen mit, bekommen aber keine Statistik und keine Meilensteine
          cfg.guests.map((g) => h('button', { class: 'chip on guest', onclick: () => { cfg.guests = cfg.guests.filter((x) => x !== g); cfg.selected = cfg.selected.filter((id) => id !== g.id); draw(); } },
            h('span', { class: 'pick num' }, cfg.selected.indexOf(g.id) + 1), `👤 ${g.name} ✕`)),
          h('button', {
            class: 'chip',
            onclick: async () => {
              const txt = await promptDialog('Gäste (ohne Statistik)', '2', { ok: 'Hinzufügen', placeholder: 'Anzahl (z. B. 5) oder Namen mit Komma' });
              if (txt == null || !txt.trim()) return;
              const count = /^\s*\d+\s*$/.test(txt) ? Math.min(parseInt(txt, 10), MAX_PLAYERS) : 0;
              const wanted = count ? Array(count).fill('') : txt.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
              for (const nm of wanted) {
                if (cfg.selected.length >= MAX_PLAYERS) { toast(`Höchstens ${MAX_PLAYERS} Spieler.`); break; }
                const g = newGuest(nm, cfg.guests.map((x) => x.name));
                cfg.guests.push(g);
                cfg.selected.push(g.id);
              }
              draw();
            },
          }, '＋ Gäste'),
          players.length > 8 ? h('button', { class: 'chip', onclick: () => { cfg.selected = cfg.selected.length ? [] : players.slice(0, MAX_PLAYERS).map((p) => p.id); cfg.guests = []; draw(); } }, cfg.selected.length ? 'Keinen' : 'Alle') : null),
        cfg.guests.length ? h('p', { class: 'dim small', style: { margin: 0 } }, '👤 Gäste spielen mit, bekommen aber keine Statistik und keine Meilensteine. Für ihre Gegner zählt das Match normal.') : null,
        h('p', { class: 'dim small', style: { margin: 0 } }, info),
        h('button', {
          class: 'btn primary', style: { minHeight: '64px', fontSize: '22px' }, disabled: !ready,
          onclick: () => {
            let t;
            try {
              t = createTournament({
                name: cfg.name.trim() || 'Turnier', format: cfg.format, mode: cfg.mode,
                options: cfg.mode === 'x01' ? { startScore: cfg.startScore, doubleOut: true } : { cutThroat: cfg.cutThroat },
                legsBestOf: cfg.legsBestOf, input: cfg.input, camera: false, groupSize: cfg.groupSize, boards: cfg.boards, pauseMin: cfg.pauseMin,
                players: cfg.selected, playerNames: cfg.selected.map((id) => (isGuestId(id) ? cfg.guests.find((g) => g.id === id).name : displayName(players.find((p) => p.id === id), players))),
              });
            } catch (e) { toast(e.message); return; }
            // Spieler-Nummern mitgeben: so ordnet „Turnier-Spiele übernehmen“ die Spieler auf anderen Handys sicher zu
            t.playerInfo = players.filter((p) => cfg.selected.includes(p.id)).map((p) => ({ id: p.id, name: p.name, code: p.code }));
            saveTournament(t);
            updateSettings({ lastTournament: { format: cfg.format, mode: cfg.mode, startScore: cfg.startScore, cutThroat: cfg.cutThroat, legsBestOf: cfg.legsBestOf, input: cfg.input, groupSize: cfg.groupSize, boards: cfg.boards, pauseMin: cfg.pauseMin, players: cfg.selected } });
            toast('🎲 Ausgelost!');
            nav.go('tournament', { id: t.id });
          },
        }, ready ? 'Auslosen' : 'Spieler wählen'),
      );
    };
    draw();
  }

  // ---------- Ein Turnier ----------
  function drawDetail(t, matches, live) {
    let st;
    try { st = tournamentState(t, matches); } catch (e) {
      body.replaceChildren(topbar(t.name, () => nav.go('tournament')), h('p', { class: 'dim' }, 'Dieses Turnier stammt aus einer älteren Version und kann nicht mehr angezeigt werden. Die Matches sind in der Statistik.'),
        h('button', { class: 'btn danger', onclick: () => { deleteTournament(t.id); nav.go('tournament'); } }, 'Turnierplan entfernen'));
      return;
    }
    const startGame = (g) => {
      unlock(); // iOS: Sprachausgabe durch diesen Tipp freischalten
      if (g.status === 'done' && g.match) { showMatchDetail(g.match); return; }
      if (g.status === 'running' && g.match) { nav.go('game', { match: g.match }); return; }
      const active = lsGet('activeMatch', null);
      if (active && active.status === 'running') { toast('Es läuft noch ein anderes Spiel – erst beenden.'); return; }
      nav.go('game', {
        setup: { mode: t.mode, options: t.options, players: [g.a, g.b], playerNames: [nameOf(t, g.a), nameOf(t, g.b)], setsBestOf: 1, legsBestOf: t.legsBestOf, firstStarter: 0, starterMethod: 'tap' },
        camera: false, inputMode: t.input, tournament: matchTag(t, g),
      });
    };
    const head = st.champion && st.done
      ? champCard(t, st)
      : h('div', { class: 'card stack' },
        h('div', { class: 'small dim' }, `${TOURNAMENT_FORMATS[t.format]} · ${t.mode === 'x01' ? `${t.options.startScore}` : 'Cricket'} · ${t.legsBestOf === 1 ? '1 Leg' : `Best of ${t.legsBestOf} Legs`} · ${t.players.length} Spieler · ${t.boards} Board${t.boards > 1 ? 's' : ''}`),
        live && !live.cloud ? h('button', {
          class: 'btn primary',
          onclick: async () => {
            try { await postTournament(t); nav.go('live'); } catch (e) { toast(e.message); }
          },
        }, '📶 Live im WLAN (PC ruft die Spiele auf)') : null,
        // Online: Board-Handys treten per Code aus ihrer normalen App bei (Firebase, siehe core/cloud.js)
        cloudEnabled() ? h('button', {
          class: `btn ${live && !live.cloud ? '' : 'primary'}`,
          onclick: async () => {
            const code = live && live.cloud ? live.code : newCode();
            setCloudCode(code);
            try { await postTournament(t); nav.go('live'); } catch (e) { setCloudCode(null); toast(e.message); }
          },
        }, live && live.cloud ? `🌐 Online-Live öffnen (${showCode(live.code)})` : '🌐 Online live schalten (Beitreten per Code)') : null,
        st.open.length
          ? [h('b', {}, st.open.length === 1 ? 'Nächstes Spiel' : `${st.open.length} Spiele bereit`),
            st.open.slice(0, 4).map((g, i) => h('button', { class: `btn ${i === 0 && !live ? 'primary' : ''}`, onclick: () => startGame(g) },
              `${g.status === 'running' ? '⏵' : '▶'} ${nameOf(t, g.a)} vs. ${nameOf(t, g.b)}`, h('span', { class: 'small', style: { opacity: 0.7 } }, ` · ${g.roundName}`)))]
          : h('div', { class: 'dim' }, 'Warte auf Ergebnisse.'));

    body.replaceChildren(
      topbar(t.name, () => nav.go('tournament')),
      head,
      planView(t, st, { onTap: startGame }),
      h('p', { class: 'dim small' }, live
        ? 'Live: Die Board-Handys öffnen die App über den PC und wählen „Board-Handy“. Ergebnisse kommen sofort hierher.'
        : 'Mehrere Boards gleichzeitig: Turnier-Server auf dem PC starten (werkzeuge › „Turnier-Server starten“), dann zählen die iPhones an den Boards und der PC zeigt alles live. Ohne Server geht es per Abgleich (Einstellungen).'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn ghost',
          onclick: async () => {
            const nm = await promptDialog('Turnier umbenennen', t.name, { ok: 'Speichern' });
            if (nm && nm.trim()) { t.name = nm.trim(); saveTournament(t); drawDetail(t, matches, live); }
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

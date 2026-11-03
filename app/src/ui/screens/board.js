// Board-Handy beim Live-Turnier: Das iPhone an einem Board zeigt, welches Spiel dort aufgerufen ist,
// startet es mit einem Tipp und meldet jede Aufnahme an den PC (über GameSession -> core/live.js).
// Der PC (ui/screens/live.js) entscheidet, welches Spiel an welches Board kommt.
import { h, toast } from '../dom.js';
import { lsGet, lsSet } from '../../core/storage.js';
import { unlock, say } from '../../audio/speech.js';
import { tournamentState, boardStatus, planCalls, matchTag, formatFor, formatText, upcomingQueue } from '../../core/tournament.js';
import { liveServer, liveState, myBoard, setMyBoard, pendingCount, setCloudCode, startHeartbeat, connectedBoards, leaveBoard, isKicked, withoutKicked, deviceId, requestHelp } from '../../core/live.js';
import { keepAwake } from '../../core/wakelock.js';
import { showCode } from '../../core/cloud.js';
import { SYNC_FORMAT } from '../../core/sync.js';
import { BRAND, APP_VERSION } from '../../config.js';
import { importSyncData } from '../syncUi.js';
import { nameOf, liveScore } from '../tournamentView.js';

const POLL_MS = 2000;

export function render(root, params, nav) {
  const body = h('div', { class: 'stack boardscreen', style: { maxWidth: '560px', margin: '0 auto' } });
  root.appendChild(body);
  let board = params.board || myBoard();
  let timer = null;
  let lastCall = null;   // zuletzt angesagter Aufruf (nur einmal ansagen)
  let disposed = false;
  let cloudInfo = null;  // { code } beim Online-Turnier
  let manualPick = false; // „Anderes Board wählen“: Auswahl zeigen statt automatisch zuteilen
  keepAwake(true);       // Bildschirm anlassen, sonst meldet sich das Handy nicht mehr (iOS pausiert gesperrte Apps)
  const topbar = (title) => h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, title));

  const fmtClock = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  async function tick() {
    if (disposed) return;
    let state;
    try { state = await liveState(); } catch (e) {
      body.replaceChildren(topbar(board ? `Board ${board}` : 'Board-Handy'),
        h('div', { class: 'card stack' }, h('b', {}, cloudInfo ? '🌐 Keine Verbindung zum Online-Dienst' : '📡 Keine Verbindung zum PC'), h('div', { class: 'small dim' }, `Ist das WLAN da und der Turnier-Server auf dem PC gestartet? Es wird weiter versucht. ${pendingCount() ? `${pendingCount()} Spielstand wartet auf Übertragung.` : ''}`)));
      return;
    }
    const t = state.tournament;
    if (!t || !t.players) {
      // Online-Turnier wurde am PC beendet: automatisch verlassen
      if (cloudInfo) {
        setCloudCode(null); setMyBoard(null);
        toast('Das Online-Turnier wurde beendet.');
        nav.go('home');
        return;
      }
      body.replaceChildren(topbar('Board-Handy'), h('div', { class: 'card' }, h('b', {}, 'Noch kein Turnier live.'), h('div', { class: 'small dim' }, 'Am PC ein Turnier anlegen und „Live schalten“ tippen.')));
      return;
    }
    // Von der Turnierleitung abgemeldet („📴 Handy abmelden“): Board verlassen, damit ein anderes Handy übernehmen kann
    if (board && isKicked(t, { board, id: deviceId() })) {
      const was = board;
      await leaveBoard();
      toast(`📴 Die Turnierleitung hat dieses Handy von Board ${was} abgemeldet.`);
      nav.go('home');
      return;
    }
    // Beim Beitreten automatisch das erste freie Board (an dem gerade kein anderes Handy angemeldet ist)
    if ((!board || board > t.boards) && !manualPick) {
      const taken = connectedBoards(withoutKicked(state.presence || {}, t));
      const free = Array.from({ length: t.boards }, (_, i) => i + 1).find((b) => !taken.has(b));
      if (free) {
        board = free; setMyBoard(board);
        toast(`📱 Dieses Handy ist Board ${board}`);
        tick();
        return;
      }
    }
    if (!board || board > t.boards || manualPick) {
      body.replaceChildren(topbar(t.name),
        h('div', { class: 'card stack' },
          h('b', {}, 'An welchem Board liegt dieses Handy?'),
          h('div', { class: 'boardpick' }, Array.from({ length: t.boards }, (_, i) => h('button', {
            class: 'btn primary', onclick: () => { unlock(); board = i + 1; manualPick = false; setMyBoard(board); tick(); },
          }, `Board ${i + 1}`)))));
      return;
    }
    const st = tournamentState(t, state.matches);
    const mine = boardStatus(t, st)[board - 1];
    const g = mine && mine.game;
    let active = lsGet('activeMatch', null);
    // Hat die Turnierleitung das Ergebnis am PC eingetragen (Handy war ausgefallen), das alte Spiel hier freigeben
    if (active && active.tournament && active.tournament.id === t.id) {
      const done = st.games.find((x) => x.key === active.tournament.game);
      if (done && done.status === 'done' && done.match && done.match.id !== active.id) { lsSet('activeMatch', null); active = null; }
      // Von der Turnierleitung gestoppt („Neu starten“ / „Später spielen“): altes Spiel hier vergessen
      else if ((t.stopped || {})[active.id]) { lsSet('activeMatch', null); active = null; }
    }
    const content = [];
    // 🙋 Turnierleitung rufen: bestätigt die Leitung (t.helpAck), Hinweis zeigen und den Ruf beenden
    const help = lsGet('liveHelp', null);
    if (help && ((t.helpAck || {})[board] || 0) >= help) {
      requestHelp(false);
      toast('✅ Die Turnierleitung hat deinen Ruf gesehen und kommt.', 5000);
      if (navigator.vibrate) navigator.vibrate([100, 80, 100]);
    }
    // Gerade ein Spiel an diesem Handy beendet: bestätigen, dass das Ergebnis bei der Turnierleitung ist
    if (params.doneGame && !(g && g.status === 'running')) {
      const dg = st.games.find((x) => x.key === params.doneGame);
      const arrived = dg && dg.status === 'done' && dg.result;
      content.push(h('div', { class: `card resultok ${arrived ? 'ok' : ''}` },
        arrived
          ? [h('b', {}, '✅ Ergebnis ist bei der Turnierleitung'), h('div', { class: 'num' }, `${nameOf(t, dg.a)} ${dg.result.legs[dg.a] ?? 0} : ${dg.result.legs[dg.b] ?? 0} ${nameOf(t, dg.b)}`)]
          : [h('b', {}, '⏳ Ergebnis wird übertragen …'), h('div', { class: 'small dim' }, pendingCount() ? 'Noch keine Verbindung – wird automatisch nachgeschickt.' : 'Einen Moment.')]));
    }
    if (st.done && st.champion) {
      content.push(h('div', { class: 'card callcard' }, h('div', { class: 'callicon' }, '🏆'), h('div', { class: 'callnames' }, nameOf(t, st.champion)), h('div', { class: 'dim' }, 'hat das Turnier gewonnen!')));
    } else if (g) {
      const running = g.status === 'running' && g.match;
      const here = active && running && active.id === g.match.id;
      if (lastCall !== g.key) {
        lastCall = g.key;
        if (!running) say(`Board ${board}: ${nameOf(t, g.a)} gegen ${nameOf(t, g.b)}`);
        if (navigator.vibrate) navigator.vibrate(200);
      }
      content.push(h('div', { class: 'card callcard' },
        h('div', { class: 'callhead' }, running ? '⏵ Läuft' : '📣 Aufruf'),
        h('div', { class: 'callnames' }, nameOf(t, g.a), h('span', { class: 'vs' }, 'gegen'), nameOf(t, g.b)),
        h('div', { class: 'dim' }, `${g.roundName} · ${formatText(formatFor(t, g))}${running ? ` · ${liveScore(g.match)}` : ''}`),
        mine.writer ? h('div', { class: 'writer' }, `✍️ Schreiber: ${nameOf(t, mine.writer)}`) : null,
        running
          ? (here || !active
            ? h('button', { class: 'btn primary big', onclick: () => nav.go('game', { match: here ? active : g.match, liveBoard: board }) }, 'Weiterspielen')
            : h('div', { class: 'small dim' }, 'Läuft auf einem anderen Gerät.'))
          : h('button', {
            class: 'btn primary big',
            onclick: () => {
              unlock();
              if (active && active.status === 'running') { toast('Auf diesem Handy läuft noch ein Spiel.'); return; }
              nav.go('game', {
                // Format je Runde (z. B. Gruppe Best of 1, Finale in Sätzen)
                setup: { mode: t.mode, options: t.options, players: [g.a, g.b], playerNames: [nameOf(t, g.a), nameOf(t, g.b)], setsBestOf: formatFor(t, g).setsBestOf, legsBestOf: formatFor(t, g).legsBestOf, firstStarter: 0, starterMethod: 'tap' },
                camera: false, inputMode: t.input, tournament: matchTag(t, g), liveBoard: board,
              });
            },
          }, `Spiel starten (${nameOf(t, g.a)} wirft an)`)));
    } else {
      const { pauseUntil } = planCalls(t, st);
      const left = pauseUntil ? Math.max(0, pauseUntil - Date.now()) : 0;
      // Pause: großer Countdown; danach die ersten Spiele (so viele wie Boards – wer wohin kommt, entscheidet der PC)
      const first = upcomingQueue(t, st).slice(0, pauseUntil ? t.boards || 1 : 1);
      content.push(h('div', { class: `card callcard ${pauseUntil ? 'pausecard' : ''}` },
        h('div', { class: 'callicon' }, pauseUntil ? '☕' : '⏳'),
        h('div', { class: 'callnames small' }, pauseUntil ? `${(t.pausedUntil === pauseUntil && t.pauseReason) || 'Pause'} bis ${fmtClock(pauseUntil)} Uhr` : 'Warte auf das nächste Spiel'),
        pauseUntil ? h('div', { class: 'pcount num' }, `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`)
          : h('div', { class: 'dim small' }, 'Der PC ruft das nächste Spiel auf, sobald es möglich ist.'),
        first.length ? h('div', { class: 'nextup' }, h('span', { class: 'dim small' }, pauseUntil ? 'Nach der Pause als Erstes:' : 'Als Nächstes dran:'),
          first.map((nx) => h('div', {}, h('b', {}, `${nameOf(t, nx.a)} – ${nameOf(t, nx.b)}`), h('span', { class: 'dim small' }, ` · ${nx.roundName}`)))) : null));
    }
    // 🗓️ Geplante Pause: Hinweis am Board (auch während eines Spiels)
    const pp = t.plannedPause;
    if (pp && pp.at > Date.now()) content.push(h('div', { class: 'card plannedinfo' }, `🗓️ ${pp.reason || 'Pause'} um ${fmtClock(pp.at)} Uhr (${pp.min} Min.) – in ${Math.max(1, Math.ceil((pp.at - Date.now()) / 60000))} Min.`));
    const helping = !!lsGet('liveHelp', null);
    body.replaceChildren(
      topbar(`Board ${board}`),
      h('div', { class: 'small dim' }, `${t.name}${pendingCount() ? ` · ⚠️ ${pendingCount()} Spielstand wartet auf Übertragung` : ''}`),
      content,
      // 🙋 Problem am Board (Streit, Handy, Board kaputt): die Turnierleitung bekommt einen Hinweis mit Ton
      h('button', { class: `btn ${helping ? 'helpon' : ''}`, onclick: () => { unlock(); requestHelp(!helping); toast(helping ? 'Ruf zurückgenommen' : `🙋 Die Turnierleitung wurde gerufen (Board ${board})`); tick(); } },
        helping ? '🙋 Turnierleitung gerufen … (tippen = zurücknehmen)' : '🙋 Turnierleitung rufen'),
      h('button', { class: 'btn ghost', onclick: () => { manualPick = true; tick(); } }, 'Anderes Board wählen'),
      // Handy abmelden: die Turnierleitung zeigt sofort wieder den QR-Code dieses Boards (ein anderes Handy kann übernehmen)
      cloudInfo ? null : h('button', { class: 'btn ghost', onclick: async () => { await leaveBoard(); toast(`📴 Board ${board} freigegeben`); nav.go('home'); } }, `📴 Board ${board} freigeben (Handy abmelden)`),
      // Online: Spiele dieses Turniers in die eigene Statistik übernehmen (Spieler wählbar) und das Turnier verlassen
      cloudInfo ? h('button', { class: 'btn', onclick: () => importSyncData(cloudSyncData(t, state.matches)) }, '📥 Turnier-Spiele in meine Statistik übernehmen') : null,
      cloudInfo ? h('button', { class: 'btn ghost', onclick: async () => { await leaveBoard(); toast(`📴 Board ${board} freigegeben`); nav.go('home'); } }, `📴 Board ${board} freigeben (im Turnier bleiben)`) : null,
      cloudInfo ? h('button', { class: 'btn ghost', onclick: async () => { await leaveBoard(); setCloudCode(null); nav.go('home'); } }, `🌐 Turnier verlassen (Code ${showCode(cloudInfo.code)})`) : null,
    );
  }

  liveServer().then((info) => {
    cloudInfo = info && info.cloud ? info : null;
    if (!info) {
      body.replaceChildren(topbar('Board-Handy'), h('div', { class: 'card stack' }, h('b', {}, 'Kein Turnier-Server'),
        h('div', { class: 'small dim' }, 'Das Board-Handy funktioniert nur, wenn die App über den PC geöffnet wird: Turnier-Server starten und am iPhone die Adresse öffnen, die der PC anzeigt (z. B. http://192.168.1.20:8130/app/).')));
      return;
    }
    startHeartbeat(); // dieses Handy meldet sich bei der Turnierleitung (läuft auch im Spiel weiter)
    tick();
    timer = setInterval(tick, POLL_MS);
  });
  return () => { disposed = true; clearInterval(timer); keepAwake(false); };
}

/** Abgleich-Daten aus einem Online-Turnier: beendete Spiele, Spieler mit Nummern (für die sichere Zuordnung). */
function cloudSyncData(t, matches) {
  return {
    app: BRAND.name, format: SYNC_FORMAT, version: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    players: t.playerInfo || [], matches: matches.filter((m) => m.status === 'finished'), showcase: {}, tournaments: [t],
  };
}

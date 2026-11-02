// Board-Handy beim Live-Turnier: Das iPhone an einem Board zeigt, welches Spiel dort aufgerufen ist,
// startet es mit einem Tipp und meldet jede Aufnahme an den PC (über GameSession -> core/live.js).
// Der PC (ui/screens/live.js) entscheidet, welches Spiel an welches Board kommt.
import { h, toast } from '../dom.js';
import { lsGet, lsSet } from '../../core/storage.js';
import { unlock, say } from '../../audio/speech.js';
import { tournamentState, boardStatus, planCalls, matchTag } from '../../core/tournament.js';
import { liveServer, liveState, myBoard, setMyBoard, pendingCount, setCloudCode, startHeartbeat } from '../../core/live.js';
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
      body.replaceChildren(topbar('Board-Handy'), h('div', { class: 'card' }, h('b', {}, 'Noch kein Turnier live.'), h('div', { class: 'small dim' }, 'Am PC ein Turnier anlegen und „Live schalten“ tippen.')));
      return;
    }
    if (!board || board > t.boards) {
      body.replaceChildren(topbar(t.name),
        h('div', { class: 'card stack' },
          h('b', {}, 'An welchem Board liegt dieses Handy?'),
          h('div', { class: 'boardpick' }, Array.from({ length: t.boards }, (_, i) => h('button', {
            class: 'btn primary', onclick: () => { unlock(); board = i + 1; setMyBoard(board); tick(); },
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
    }
    const content = [];
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
        h('div', { class: 'dim' }, `${g.roundName}${running ? ` · ${liveScore(g.match)}` : ''}`),
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
                setup: { mode: t.mode, options: t.options, players: [g.a, g.b], playerNames: [nameOf(t, g.a), nameOf(t, g.b)], setsBestOf: 1, legsBestOf: t.legsBestOf, firstStarter: 0, starterMethod: 'tap' },
                camera: false, inputMode: t.input, tournament: matchTag(t, g), liveBoard: board,
              });
            },
          }, `Spiel starten (${nameOf(t, g.a)} wirft an)`)));
    } else {
      const { pauseUntil } = planCalls(t, st);
      content.push(h('div', { class: 'card callcard' },
        h('div', { class: 'callicon' }, pauseUntil ? '☕' : '⏳'),
        h('div', { class: 'callnames small' }, pauseUntil ? `Pause bis ${fmtClock(pauseUntil)}` : 'Warte auf das nächste Spiel'),
        h('div', { class: 'dim small' }, pauseUntil ? `Noch etwa ${Math.max(1, Math.ceil((pauseUntil - Date.now()) / 60000))} Minuten.` : 'Der PC ruft das nächste Spiel auf, sobald es möglich ist.')));
    }
    body.replaceChildren(
      topbar(`Board ${board}`),
      h('div', { class: 'small dim' }, `${t.name}${pendingCount() ? ` · ⚠️ ${pendingCount()} Spielstand wartet auf Übertragung` : ''}`),
      content,
      h('button', { class: 'btn ghost', onclick: () => { board = null; setMyBoard(null); tick(); } }, 'Anderes Board wählen'),
      // Online: Spiele dieses Turniers in die eigene Statistik übernehmen (Spieler wählbar) und das Turnier verlassen
      cloudInfo ? h('button', { class: 'btn', onclick: () => importSyncData(cloudSyncData(t, state.matches)) }, '📥 Turnier-Spiele in meine Statistik übernehmen') : null,
      cloudInfo ? h('button', { class: 'btn ghost', onclick: () => { setCloudCode(null); setMyBoard(null); nav.go('home'); } }, `🌐 Turnier verlassen (Code ${showCode(cloudInfo.code)})`) : null,
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
  return () => { disposed = true; clearInterval(timer); };
}

/** Abgleich-Daten aus einem Online-Turnier: beendete Spiele, Spieler mit Nummern (für die sichere Zuordnung). */
function cloudSyncData(t, matches) {
  return {
    app: BRAND.name, format: SYNC_FORMAT, version: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    players: t.playerInfo || [], matches: matches.filter((m) => m.status === 'finished'), showcase: {}, tournaments: [t],
  };
}

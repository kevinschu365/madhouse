// Live-Ansicht der Turnierleitung (PC, gern auf dem Fernseher): alle Boards mit laufendem Spielstand,
// Gruppen-Tabellen und K.-o.-Baum. Der PC verteilt die Spiele selbst: Sobald ein Board frei ist, wird das nächste
// spielbare Spiel aufgerufen und angesagt („Board 2: Kevin gegen Tom“). Pausen vor K.-o.-Runden werden angesagt.
// Die Board-Handys melden ihre Spielstände über den Turnier-Server (werkzeuge/turnier-server.ps1).
import { h, toast, confirmDialog } from '../dom.js';
import { getPlayers } from '../../core/settings.js';
import { saveMatchWithThrows, offerFile } from '../../core/storage.js';
import { throwRows } from '../../game/match.js';
import { say, unlock } from '../../audio/speech.js';
import { BRAND, APP_VERSION } from '../../config.js';
import { SYNC_FORMAT, syncFileName } from '../../core/sync.js';
import { getTournaments, saveTournament, tournamentState, boardStatus, planCalls, queueOrder, TOURNAMENT_FORMATS } from '../../core/tournament.js';
import { liveServer, liveState, postTournament, boardUrl, baseUrl, setCloudCode } from '../../core/live.js';
import { showCode, deleteOnline } from '../../core/cloud.js';
import { planView, champCard, nameOf, liveScore } from '../tournamentView.js';
import { confetti } from '../celebrate.js';
import { offerSync } from '../syncUi.js';
import { qrSvg } from '../qr.js';

const qrCache = new Map(); // die Ansicht wird alle 2 Sekunden neu gezeichnet – QR-Codes nur einmal berechnen
const qrFor = (text) => qrCache.get(text) || qrCache.set(text, qrSvg(text, 150)).get(text);

const POLL_MS = 2000;

export function render(root, params, nav) {
  const body = h('div', { class: 'stack livescreen' });
  root.appendChild(body);
  let timer = null;
  let disposed = false;
  let tv = false;
  let info = null;
  const saved = new Map();    // Match-Id -> updatedAt, schon in die eigene Statistik übernommen
  const said = new Set();     // schon angesagt (Aufrufe, Pausen, Sieger)
  const fmtClock = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const sec = (text, right = null) => h('div', { class: 'sechead' }, h('span', {}, text), right);
  const announce = (key, text) => { if (said.has(key)) return; said.add(key); say(text); };

  function pickTournament() {
    const list = getTournaments();
    body.replaceChildren(
      h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Live-Turnier')),
      h('div', { class: 'card stack' }, h('b', {}, 'Welches Turnier soll live laufen?'),
        list.length ? list.map((t) => h('button', {
          class: 'btn', onclick: async () => {
            unlock();
            try { await postTournament(t); tick(); } catch (e) { toast(e.message); }
          },
        }, `${t.name} · ${TOURNAMENT_FORMATS[t.format] || ''} · ${t.players.length} Spieler`)) : h('div', { class: 'dim' }, 'Noch kein Turnier angelegt.'),
        h('button', { class: 'btn primary', onclick: () => nav.go('tournament', { create: true }) }, '＋ Neues Turnier')));
  }

  /** Abgleich-Datei für alle Teilnehmer: in der normalen App einlesen, dann zählen die Spiele für Statistik und Meilensteine. */
  function exportFile(t, matches) {
    const ids = new Set(t.players);
    const data = {
      app: BRAND.name, format: SYNC_FORMAT, version: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
      players: getPlayers().filter((p) => ids.has(p.id)),
      matches: matches.filter((m) => m.status === 'finished'),
      showcase: {},
      tournaments: [t],
    };
    offerSync(data); // mit Auswahl, wessen Spiele in die Datei kommen
  }

  async function tick() {
    if (disposed) return;
    let state;
    try { state = await liveState(); } catch (e) {
      body.replaceChildren(h('div', { class: 'card' }, h('b', {}, info && info.cloud ? '🌐 Online-Dienst nicht erreichbar' : '📡 Turnier-Server nicht erreichbar'), h('div', { class: 'small dim' }, info && info.cloud ? `${e.message}. Es wird weiter versucht.` : 'Läuft das Fenster „Turnier-Server“ auf dem PC noch? Es wird weiter versucht.')));
      return;
    }
    let t = state.tournament;
    if (!t || !t.players) { pickTournament(); return; }
    const matches = state.matches || [];

    // Fertige Spiele in die eigene Statistik übernehmen (PC-Speicher)
    for (const m of matches) {
      if (m.status !== 'finished' || saved.get(m.id) === m.updatedAt) continue;
      saved.set(m.id, m.updatedAt);
      saveMatchWithThrows(m, throwRows(m)).catch(() => saved.delete(m.id));
    }

    let st = tournamentState(t, matches);
    // Freie Boards sofort mit dem nächsten Spiel belegen und ansagen
    const plan = planCalls(t, st);
    if (plan.calls.length) {
      t = { ...t, calls: { ...(t.calls || {}) } };
      for (const c of plan.calls) {
        t.calls[c.game.key] = { board: c.board, at: Date.now() };
        announce(`call:${c.game.key}`, `Board ${c.board}: ${nameOf(t, c.game.a)} gegen ${nameOf(t, c.game.b)}`);
      }
      try { await postTournament(t); } catch { /* nächster Durchlauf versucht es erneut */ }
      st = tournamentState(t, matches);
    }
    saveTournament(t); // Kopie am PC (Turnierliste, Statistik)
    if (plan.pauseUntil) {
      const minutes = Math.max(1, Math.round((plan.pauseUntil - Date.now()) / 60000));
      announce(`pause:${plan.pauseUntil}`, `Pause. Es geht in ${minutes} Minuten weiter, um ${fmtClock(plan.pauseUntil)} Uhr.`);
    }
    if (st.done && st.champion && !said.has('champ')) {
      announce('champ', `Turniersieger: ${nameOf(t, st.champion)}! Herzlichen Glückwunsch!`);
      confetti(4000);
    }
    draw(t, st, matches, plan);
  }

  function draw(t, st, matches, plan) {
    const boards = boardStatus(t, st);
    const boardOf = (g) => boards.find((b) => b.game && b.game.key === g.key)?.board || null;
    const played = st.games.filter((g) => g.status === 'done').length;
    const total = st.games.filter((g) => !g.bye).length;
    const phase = st.done ? 'Beendet' : t.format === 'gko' && !st.groupsDone ? 'Gruppenphase' : t.ko ? (st.koRounds.find((r) => r.games.some((g) => g.status !== 'done' && g.status !== 'bye'))?.name || 'K.-o.') : 'Spiele';
    const url = baseUrl(info); // nur WLAN
    const called = new Set(Object.keys(t.calls || {}));
    const next = queueOrder(st.games.filter((g) => g.status === 'ready' && !called.has(g.key))).slice(0, 6);

    const tile = (b) => {
      const g = b.game;
      if (!g) {
        return h('div', { class: 'boardtile free' }, h('div', { class: 'bnum' }, `Board ${b.board}`),
          h('div', { class: 'bfree' }, plan.pauseUntil ? `☕ Pause bis ${fmtClock(plan.pauseUntil)}` : st.done ? '—' : 'frei'));
      }
      const running = g.status === 'running' && g.match;
      return h('div', {
        class: `boardtile ${running ? 'running' : 'called'}`,
        onclick: async () => {
          if (tv || running) return;
          if (await confirmDialog(`Aufruf an Board ${b.board} zurücknehmen?`, `${nameOf(t, g.a)} gegen ${nameOf(t, g.b)} kommt dann wieder in die Warteschlange.`, { ok: 'Zurücknehmen' })) {
            const calls = { ...(t.calls || {}) };
            delete calls[g.key];
            said.delete(`call:${g.key}`);
            try { await postTournament({ ...t, calls }); } catch (e) { toast(e.message); }
            tick();
          }
        },
      },
      h('div', { class: 'bnum' }, `Board ${b.board}`, h('span', { class: 'bstate' }, running ? '⏵ läuft' : `📣 aufgerufen ${fmtClock(b.since)}`)),
      h('div', { class: 'bnames' }, h('span', {}, nameOf(t, g.a)), h('span', { class: 'vs' }, 'vs.'), h('span', {}, nameOf(t, g.b))),
      running ? h('div', { class: 'bscore num' }, liveScore(g.match)) : null,
      h('div', { class: 'bround dim' }, g.roundName));
    };

    body.replaceChildren(
      h('div', { class: 'livehead' },
        tv ? null : h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'),
        h('div', { class: 'livetitle' }, h('h1', {}, t.name), h('div', { class: 'dim' }, `${phase} · ${played} / ${total} Spiele`)),
        h('button', { class: 'iconbtn', title: 'Fernseher-Ansicht', onclick: () => { tv = !tv; body.classList.toggle('tv', tv); if (tv && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); draw(t, st, matches, plan); } }, tv ? '✕' : '📺')),
      // QR-Code je Board: mit der iPhone-Kamera scannen, dann öffnet sich direkt das Board-Handy für dieses Board
      // Online: Code groß – in der eigenen App unter Turnier › Beitreten eingeben
      info && info.cloud && !st.done ? h('div', { class: 'card codecard' },
        h('div', { class: 'small dim' }, '🌐 Online-Turnier · in der Madhouse-App: Turnier › „Beitreten“ › Code'),
        h('div', { class: 'bigcode num' }, showCode(info.code))) : null,
      (url || info?.cloud) && !st.done ? h('details', { class: 'card joincard', open: !played },
        h('summary', {}, info.cloud ? '📱 Ohne installierte App: QR-Code mit der iPhone-Kamera scannen' : '📱 Board-Handys verbinden: QR-Code mit der iPhone-Kamera scannen'),
        h('div', { class: 'qrrow' }, boards.map((b) => h('div', { class: 'qrbox' },
          h('div', { class: 'qrimg', html: qrFor(boardUrl(info, b.board)) }),
          h('b', {}, `Board ${b.board}`)))),
        info.cloud
          ? h('div', { class: 'small dim' }, 'Der QR-Code öffnet Madhouse in Safari direkt am richtigen Board. Wer die App installiert hat, gibt besser den Code oben ein.')
          : h('div', { class: 'small dim' }, 'Ohne QR: in Safari ', h('b', { class: 'num' }, url), ' öffnen › „Board-Handy“ › Board wählen. iPhone und PC müssen im selben WLAN sein.')) : null,
      st.done && st.champion ? champCard(t, st) : null,
      h('div', { class: 'boardgrid' }, boards.map(tile)),
      plan.pauseUntil && !st.done ? h('div', { class: 'card pausecard' }, `☕ Pause – weiter um ${fmtClock(plan.pauseUntil)} Uhr (noch ${Math.max(1, Math.ceil((plan.pauseUntil - Date.now()) / 60000))} min)`) : null,
      next.length ? [sec('⏭️ Als Nächstes'), h('div', { class: 'nextgames' }, next.map((g) => h('div', { class: 'nextgame' }, h('b', {}, `${nameOf(t, g.a)} – ${nameOf(t, g.b)}`), h('span', { class: 'small dim' }, g.roundName))))] : null,
      planView(t, st, { boardOf, compact: true }),
      tv ? null : h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn', onclick: () => exportFile(t, matches) }, '📤 Abgleich-Datei für alle'),
        h('button', { class: 'btn ghost', onclick: () => nav.go('tournament', { id: t.id }) }, 'Turnierplan')),
      tv || !(info && info.cloud) ? null : h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (!(await confirmDialog('Online-Turnier beenden?', 'Turnier und Spielstände werden online gelöscht. Vorher „Abgleich-Datei für alle“ erstellen oder die Board-Handys „Turnier-Spiele übernehmen“ lassen – auf diesem PC bleiben die Spiele erhalten.', { ok: 'Beenden und löschen', danger: true }))) return;
          try { await deleteOnline(info.code); } catch (e) { toast(e.message); }
          setCloudCode(null);
          nav.go('tournament', { id: t.id });
        },
      }, '🌐 Online-Turnier beenden'),
      tv ? null : h('p', { class: 'small dim' }, 'Spiele werden automatisch an freie Boards verteilt und angesagt (Lautsprecher am PC an). Tipp auf ein aufgerufenes Board nimmt den Aufruf zurück, z. B. wenn ein Spieler fehlt. Nach dem Turnier: „Abgleich-Datei für alle“ in der normalen App jedes Spielers einlesen (Einstellungen › Abgleich).'),
    );
  }

  liveServer().then((i) => {
    info = i;
    if (!i) {
      body.replaceChildren(h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Live-Turnier')),
        h('div', { class: 'card stack' }, h('b', {}, 'Kein Turnier-Server'),
          h('div', { class: 'small dim' }, 'Die Live-Ansicht braucht den Turnier-Server auf dem PC: im Projektordner unter werkzeuge „Turnier-Server starten“ doppelklicken, dann am PC http://localhost:8130/app/ öffnen.')));
      return;
    }
    tick();
    timer = setInterval(tick, POLL_MS);
  });
  return () => { disposed = true; clearInterval(timer); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
}

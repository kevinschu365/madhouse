// Zuschauer-Seite („?zuschauer=1“, Link/QR in der Turnierleitung unter 🖥️): Jeder Spieler öffnet sie auf dem
// eigenen Handy, wählt seinen Namen und sieht sein nächstes Spiel, den Live-Stand an den Boards und die Tabellen.
// Nur lesen – schreibt nichts ins Turnier. Optional: Hinweis (Benachrichtigung, Vibration, Ansage), wenn man bald
// dran ist oder aufgerufen wird. Das klappt nur, solange die Seite offen ist (kein Push-Server).
import { h, toast } from '../dom.js';
import { lsGet, lsSet } from '../../core/storage.js';
import { say, unlock } from '../../audio/speech.js';
import { keepAwake } from '../../core/wakelock.js';
import { liveServer, liveState } from '../../core/live.js';
import { tournamentState, boardStatus, upcomingQueue, scheduleEstimate, TIEBREAK_TEXT } from '../../core/tournament.js';
import { nameOf, liveScore, groupTable, bracket, champCard } from '../tournamentView.js';

const POLL_MS = 3000;

export function render(root, params, nav) {
  const body = h('div', { class: 'stack watchscreen', style: { maxWidth: '640px', margin: '0 auto' } });
  root.appendChild(body);
  let timer = null;
  let disposed = false;
  let last = null;
  let picking = false;
  const notified = new Set(); // schon gemeldet (je Spiel und Art)
  const fmtClock = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const me = () => lsGet('watchPlayer', null);
  const alerts = () => !!lsGet('watchAlerts', false);
  const sec = (text) => h('div', { class: 'sechead' }, h('span', {}, text));
  const topbar = (title) => h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, title));

  /** Hinweis ausgeben: Systembenachrichtigung (falls erlaubt), Vibration und Ansage. */
  async function notify(key, title, text) {
    if (!alerts() || notified.has(key)) return;
    notified.add(key);
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    say(`${title}. ${text}`, { interrupt: true });
    try {
      if (window.Notification && Notification.permission === 'granted') {
        const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
        if (reg && reg.showNotification) reg.showNotification(title, { body: text, tag: key });
        else new Notification(title, { body: text, tag: key });
      }
    } catch { /* nur Vibration und Ansage */ }
    toast(`🔔 ${title}: ${text}`, 6000);
  }

  async function toggleAlerts() {
    unlock(); // iOS: Ton erst nach einem Tipp
    if (alerts()) { lsSet('watchAlerts', false); keepAwake(false); draw(); return; }
    lsSet('watchAlerts', true);
    keepAwake(true); // Hinweise kommen nur, solange die Seite offen und der Bildschirm an ist
    try { if (window.Notification && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* ohne Systembenachrichtigung */ }
    toast('🔔 Hinweis an – Seite offen lassen');
    draw();
  }

  function draw() {
    if (!last) return;
    const { t, st } = last;
    const id = me();
    if (picking || !id || (id !== 'none' && !t.players.includes(id))) {
      body.replaceChildren(topbar(t.name),
        h('div', { class: 'card stack' }, h('b', {}, 'Wer bist du?'), h('div', { class: 'small dim' }, 'Dann siehst du oben dein nächstes Spiel. Nur ansehen – am Turnier ändert diese Seite nichts.'),
          h('div', { class: 'chips' }, t.players.slice().sort((a, b) => nameOf(t, a).localeCompare(nameOf(t, b), 'de')).map((p) => h('button', { class: `chip ${p === id ? 'on' : ''}`, onclick: () => { lsSet('watchPlayer', p); picking = false; notified.clear(); draw(); } }, nameOf(t, p)))),
          h('button', { class: 'btn ghost', onclick: () => { lsSet('watchPlayer', 'none'); picking = false; draw(); } }, 'Nur zuschauen (ohne Namen)')),
        tables(t, st));
      return;
    }
    const boards = boardStatus(t, st);
    const myBoard = boards.find((b) => b.game && (b.game.a === id || b.game.b === id));
    const queue = upcomingQueue(t, st);
    const qi = queue.findIndex((g) => g.a === id || g.b === id);
    const fc = scheduleEstimate(t, st);
    const opp = (g) => nameOf(t, g.a === id ? g.b : g.a, g.a === id ? g.bLabel : g.aLabel);
    const lostKo = st.games.find((g) => g.phase === 'ko' && g.status === 'done' && g.winnerId && g.winnerId !== id && (g.a === id || g.b === id) && !g.third);
    let card;
    if (id === 'none') card = h('div', { class: 'card mecard' }, h('div', { class: 'mebig' }, '👀 Du schaust zu'), h('div', { class: 'small dim' }, 'Mitspieler? Unten „anderer Name“ – dann siehst du dein nächstes Spiel.'));
    else if (st.done && st.champion === id) card = h('div', { class: 'card mecard on' }, h('div', { class: 'mebig' }, '🏆 Du hast das Turnier gewonnen!'));
    else if (myBoard && myBoard.game.status === 'running') card = h('div', { class: 'card mecard on' }, h('div', { class: 'mebig' }, `🎯 Du spielst an Board ${myBoard.board}`), h('div', {}, `gegen ${opp(myBoard.game)} · ${liveScore(myBoard.game.match)}`));
    else if (myBoard) {
      card = h('div', { class: 'card mecard call' }, h('div', { class: 'mebig' }, `📣 Du bist dran: Board ${myBoard.board}!`), h('div', {}, `gegen ${opp(myBoard.game)} · ${myBoard.game.roundName}`), myBoard.writer ? h('div', { class: 'small dim' }, `Schreiber: ${nameOf(t, myBoard.writer)}`) : null);
      notify(`call:${myBoard.game.key}:${myBoard.board}`, `Du bist dran: Board ${myBoard.board}`, `gegen ${opp(myBoard.game)}`);
    } else if (myBoard == null && boards.some((b) => b.game && b.writer === id)) {
      const wb = boards.find((b) => b.game && b.writer === id);
      card = h('div', { class: 'card mecard call' }, h('div', { class: 'mebig' }, `✍️ Du schreibst an Board ${wb.board}`), h('div', {}, `${nameOf(t, wb.game.a)} – ${nameOf(t, wb.game.b)}`));
      notify(`write:${wb.game.key}`, `Du schreibst an Board ${wb.board}`, `${nameOf(t, wb.game.a)} gegen ${nameOf(t, wb.game.b)}`);
    } else if (qi >= 0) {
      const at = fc && fc.starts.get(queue[qi].key);
      card = h('div', { class: 'card mecard' }, h('div', { class: 'mebig' }, qi === 0 ? '⏭️ Als Nächstes bist du dran' : `⏳ Noch ${qi} Spiel${qi > 1 ? 'e' : ''} vor dir`),
        h('div', {}, `gegen ${opp(queue[qi])} · ${queue[qi].roundName}`), at ? h('div', { class: 'small dim' }, `ca. ${fmtClock(at)} Uhr (geschätzt)`) : null);
      if (qi <= Math.max(1, (t.boards || 1) - 1)) notify(`soon:${queue[qi].key}`, 'Gleich bist du dran', `gegen ${opp(queue[qi])} – bitte in der Nähe bleiben`);
    } else if ((t.withdrawn || {})[id]) card = h('div', { class: 'card mecard' }, h('div', { class: 'mebig' }, '🏳 Du hast aufgegeben'));
    else if (lostKo) card = h('div', { class: 'card mecard' }, h('div', { class: 'mebig' }, `Ausgeschieden im ${lostKo.roundName}`), h('div', { class: 'small dim' }, 'Danke fürs Mitspielen!'));
    else card = h('div', { class: 'card mecard' }, h('div', { class: 'mebig' }, st.done ? 'Turnier beendet' : '⏳ Gerade kein Spiel für dich geplant'), h('div', { class: 'small dim' }, st.done ? '' : 'Deine nächsten Gegner stehen noch nicht fest.'));

    body.replaceChildren(
      topbar(t.name),
      h('div', { class: 'small dim' }, `👀 Zuschauer${id === 'none' ? '' : ` · ${nameOf(t, id)}`} · `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); picking = true; draw(); } }, 'anderer Name')),
      card,
      t.pausedUntil && t.pausedUntil > Date.now() ? h('div', { class: 'card pausebanner' }, h('div', { class: 'pbicon' }, '☕'), h('div', { class: 'pbtext' }, h('div', { class: 'pbtitle' }, t.pauseReason || 'Pause'), h('div', { class: 'pbsub' }, `Weiter um ${fmtClock(t.pausedUntil)} Uhr`))) : null,
      (t.absent || {})[id] ? h('div', { class: 'card small warn' }, '⏸ Die Turnierleitung hat dich als „nicht da“ markiert – du wirst nicht aufgerufen. Bitte bei der Turnierleitung melden.') : null,
      id === 'none' ? null : h('button', { class: `btn ${alerts() ? '' : 'primary'}`, onclick: toggleAlerts }, alerts() ? '🔕 Hinweis ausschalten' : '🔔 Hinweis, wenn ich bald dran bin (optional)'),
      alerts() && id !== 'none' ? h('div', { class: 'small dim' }, 'Kommt nur, solange diese Seite offen ist (Bildschirm bleibt an). Vibration und Ansage, wo erlaubt auch eine Mitteilung.') : null,
      st.done && st.champion ? champCard(t, st) : null,
      sec('🎯 Boards'),
      h('div', { class: 'stack', style: { gap: '6px' } }, boards.map((b) => h('div', { class: `list-item ${b.game && (b.game.a === id || b.game.b === id) ? 'mine' : ''}` },
        h('b', {}, `Board ${b.board}`),
        h('span', { class: 'name' }, b.game ? `${nameOf(t, b.game.a)} – ${nameOf(t, b.game.b)}` : h('span', { class: 'dim' }, 'frei')),
        h('span', { class: 'num small dim' }, b.game ? (b.game.status === 'running' && b.game.match ? liveScore(b.game.match) : 'aufgerufen') : '')))),
      queue.length ? [sec('⏭️ Als Nächstes'), h('div', { class: 'stack', style: { gap: '4px' } }, queue.slice(0, 6).map((g, i) => h('div', { class: `list-item ${g.a === id || g.b === id ? 'mine' : ''}` },
        h('b', { class: 'num' }, String(i + 1)), h('span', { class: 'name' }, `${nameOf(t, g.a)} – ${nameOf(t, g.b)}`), h('span', { class: 'small dim' }, fc && fc.starts.get(g.key) ? `ca. ${fmtClock(fc.starts.get(g.key))}` : ''))))] : null,
      tables(t, st));
  }

  function tables(t, st) {
    return [
      st.groups.length ? [sec(t.format === 'rr' ? '📊 Tabelle' : '👥 Gruppen'), t.format === 'gko' ? h('div', { class: 'small dim' }, `Platz 1 und 2 kommen weiter · ✓ sicher weiter · ✗ raus. ${TIEBREAK_TEXT}`) : null,
        st.groups.map((g) => h('div', { class: 'card groupcard' }, st.groups.length > 1 ? h('div', { class: 'grouphead' }, h('b', {}, g.name)) : null, groupTable(t, g, !!t.ko)))] : null,
      st.koRounds.length ? [sec('🌳 K.-o.'), bracket(t, st)] : null,
    ];
  }

  async function tick() {
    if (disposed) return;
    let state;
    try { state = await liveState(); } catch (e) {
      if (!last) body.replaceChildren(topbar('Zuschauer'), h('div', { class: 'card' }, h('b', {}, 'Keine Verbindung'), h('div', { class: 'small dim' }, `${e.message}. Es wird weiter versucht.`)));
      return;
    }
    const t = state.tournament;
    if (!t || !t.players) { body.replaceChildren(topbar('Zuschauer'), h('div', { class: 'card' }, h('b', {}, 'Gerade läuft kein Turnier.'))); return; }
    last = { t, st: tournamentState(t, state.matches || []) };
    draw();
  }

  liveServer().then((info) => {
    if (!info) {
      body.replaceChildren(topbar('Zuschauer'), h('div', { class: 'card stack' }, h('b', {}, 'Kein Turnier gefunden'),
        h('div', { class: 'small dim' }, 'Den Zuschauer-Link bzw. QR-Code bekommst du von der Turnierleitung (im WLAN: gleiches WLAN wie der PC).')));
      return;
    }
    if (alerts()) keepAwake(true);
    tick();
    timer = setInterval(tick, POLL_MS);
  });
  return () => { disposed = true; clearInterval(timer); keepAwake(false); };
}

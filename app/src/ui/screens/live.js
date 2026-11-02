// Live-Ansicht der Turnierleitung (PC, gern auf dem Fernseher): alle Boards mit Handy-Status und laufendem
// Spielstand, Gruppen-Tabellen und K.-o.-Baum. Der PC verteilt die Spiele selbst: Sobald ein Board frei ist
// (und, je nach Einstellung, ein Handy daran angemeldet ist), wird das nächste spielbare Spiel aufgerufen und
// angesagt („Board 2: Kevin gegen Tom. Schreiber: Nils“). Dazu: Pausen, Highlights (180, Finish 100+),
// Zeitplan, Warnung bei Verzögerung, Boards hinzufügen/entfernen, Ergebnis am PC eintragen.
// Einstellungen: Einstellungen › Turnier & Live. Verbindung: WLAN-Server oder online (core/live.js).
import { h, toast, confirmDialog, sheet } from '../dom.js';
import { getPlayers, getSettings, updateSettings } from '../../core/settings.js';
import { saveMatchWithThrows } from '../../core/storage.js';
import { throwRows, createMatch, winsNeeded, derive } from '../../game/match.js';
import { playerStats } from '../../stats/stats.js';
import { checkoutPaths } from '../../rules/checkout.js';
import { hitLabel } from '../../core/board.js';
import { say, unlock } from '../../audio/speech.js';
import { BRAND, APP_VERSION } from '../../config.js';
import { SYNC_FORMAT } from '../../core/sync.js';
import { getTournaments, saveTournament, tournamentState, boardStatus, planCalls, queueOrder, matchTag, pickWriter, highlightsOf, scheduleEstimate, TOURNAMENT_FORMATS } from '../../core/tournament.js';
import { liveServer, liveState, postTournament, postMatch, boardUrl, baseUrl, presenceTracker, endLive } from '../../core/live.js';
import { showCode } from '../../core/cloud.js';
import { planView, champCard, nameOf, liveScore } from '../tournamentView.js';
import { confetti } from '../celebrate.js';
import { offerSync } from '../syncUi.js';
import { qrSvg } from '../qr.js';

const qrCache = new Map(); // die Ansicht wird alle 2 Sekunden neu gezeichnet – QR-Codes nur einmal berechnen
const qrFor = (text) => qrCache.get(text) || qrCache.set(text, qrSvg(text, 150)).get(text);

const POLL_MS = 2000;
const LATE_MS = 5 * 60000; // aufgerufen, aber nach 5 Minuten noch nicht begonnen
const MAX_BOARDS = 8;

export function render(root, params, nav) {
  const body = h('div', { class: 'stack livescreen' });
  const flash = h('div', { class: 'hilite hidden' }); // Highlight-Einblendung (180, Finish)
  root.append(body, flash);
  let timer = null;
  let disposed = false;
  let tv = false;
  let qrOpen = null;          // QR-Codes: null = automatisch, sonst von Hand ein/aus
  let info = null;
  let last = null;            // letzter Stand { t, st, matches, plan, presence }
  const saved = new Map();    // Match-Id -> updatedAt, schon in die eigene Statistik übernommen
  const said = new Set();     // schon angesagt (Aufrufe, Pausen, Sieger, Verspätungen)
  let seenHighlights = null;  // beim ersten Laden alte Highlights nicht nachholen
  const presence = presenceTracker(); // welche Boards gerade ein Handy haben
  const flashQueue = [];
  let flashing = false;
  const fmtClock = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const sec = (text, right = null) => h('div', { class: 'sechead' }, h('span', {}, text), right);
  const announce = (key, text) => { if (said.has(key)) return; said.add(key); if (getSettings().tourSound) say(text); };

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

  /** Abgleich-Datei für alle Teilnehmer (Spieler wählbar): in der normalen App einlesen. */
  function exportFile(t, matches) {
    const ids = new Set(t.players);
    offerSync({
      app: BRAND.name, format: SYNC_FORMAT, version: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
      players: [...getPlayers().filter((p) => ids.has(p.id)), ...(t.playerInfo || []).filter((p) => !getPlayers().some((x) => x.id === p.id))],
      matches: matches.filter((m) => m.status === 'finished'), showcase: {}, tournaments: [t],
    });
  }

  /** Highlights nacheinander groß einblenden (und je nach Einstellung ansagen). */
  function showFlash(item) {
    flashQueue.push(item);
    if (flashing) return;
    const next = () => {
      const it = flashQueue.shift();
      if (!it || disposed) { flashing = false; flash.classList.add('hidden'); return; }
      flashing = true;
      flash.replaceChildren(h('div', { class: `hilitebox k${it.kind}` }, h('div', { class: 'hilitetext' }, it.text), it.board ? h('div', { class: 'hilitesub' }, `Board ${it.board}`) : null));
      flash.classList.remove('hidden');
      if (getSettings().tourSound && getSettings().tourHighlightSpeech) say(it.speech + (it.board ? ` An Board ${it.board}.` : ''));
      if (it.kind === '180' || it.kind === 'finish') confetti(1800, 80);
      setTimeout(next, 5500);
    };
    next();
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
    const s = getSettings();

    // Fertige Spiele in die eigene Statistik übernehmen (PC-Speicher)
    for (const m of matches) {
      if (m.status !== 'finished' || saved.get(m.id) === m.updatedAt) continue;
      saved.set(m.id, m.updatedAt);
      saveMatchWithThrows(m, throwRows(m)).catch(() => saved.delete(m.id));
    }

    let st = tournamentState(t, matches);
    // Freie Boards sofort mit dem nächsten Spiel belegen und ansagen (je nach Einstellung nur mit angemeldetem Handy)
    presence.update(state.presence || {}); // Anwesenheit nach eigener Uhr (siehe core/live.js)
    const plan = planCalls(t, st, Date.now(), { boards: s.tourOnlyConnected ? presence.connected() : null });
    if (plan.calls.length) {
      t = { ...t, calls: { ...(t.calls || {}) } };
      const busy = new Set();
      for (const b of boardStatus(t, st)) if (b.game) { busy.add(b.game.a); busy.add(b.game.b); }
      for (const c of plan.calls) { busy.add(c.game.a); busy.add(c.game.b); }
      for (const c of plan.calls) {
        const writer = s.tourWriter ? pickWriter(t, st, c.board, c.game, busy) : null;
        if (writer) busy.add(writer);
        t.calls[c.game.key] = { board: c.board, at: Date.now(), writer };
        announce(`call:${c.game.key}`, `Board ${c.board}: ${nameOf(t, c.game.a)} gegen ${nameOf(t, c.game.b)}.${writer ? ` Schreiber: ${nameOf(t, writer)}.` : ''}`);
      }
      try { await postTournament(t); } catch { /* nächster Durchlauf versucht es erneut */ }
      st = tournamentState(t, matches);
    }
    saveTournament(t); // Kopie am PC (Turnierliste, Statistik)

    // Highlights: neue 180er und Finishes ab 100 (beim ersten Laden nur merken, nicht nachholen)
    const boards = boardStatus(t, st);
    const hl = matches.flatMap((m) => highlightsOf(m).map((x) => ({ ...x, board: boards.find((b) => b.game && b.game.match && b.game.match.id === m.id)?.board || null })));
    if (!seenHighlights) seenHighlights = new Set(hl.map((x) => x.key));
    for (const x of hl) {
      if (seenHighlights.has(x.key)) continue;
      seenHighlights.add(x.key);
      if (s.tourHighlights) showFlash(x);
    }

    // Verzögerung: aufgerufen, aber nach 5 Minuten noch nicht begonnen -> nochmal ansagen
    if (s.tourDelayWarn) {
      for (const b of boards) {
        if (b.game && b.game.status === 'ready' && Date.now() - b.since > LATE_MS) {
          announce(`late:${b.game.key}`, `Board ${b.board}: ${nameOf(t, b.game.a)} und ${nameOf(t, b.game.b)}, bitte ans Board.`);
        }
      }
    }
    if (plan.pauseUntil) {
      const minutes = Math.max(1, Math.round((plan.pauseUntil - Date.now()) / 60000));
      announce(`pause:${plan.pauseUntil}`, `Pause. Es geht in ${minutes} Minuten weiter, um ${fmtClock(plan.pauseUntil)} Uhr.`);
    }
    if (st.done && st.champion && !said.has('champ')) {
      announce('champ', `Turniersieger: ${nameOf(t, st.champion)}! Herzlichen Glückwunsch!`);
      confetti(4000);
    }
    last = { t, st, matches, plan, raw: state.presence || {} };
    draw();
  }

  // ---------- Aktionen der Turnierleitung ----------

  /** Boards hinzufügen (+1) oder entfernen (-1). Ein Board mit laufendem Spiel wird nicht entfernt. */
  async function changeBoards(t, st, delta) {
    const n = Math.max(1, Math.min(MAX_BOARDS, (t.boards || 1) + delta));
    if (n === t.boards) return;
    const calls = { ...(t.calls || {}) };
    if (delta < 0) {
      const gone = boardStatus(t, st)[t.boards - 1];
      if (gone && gone.game && gone.game.status === 'running') { toast(`An Board ${t.boards} läuft noch ein Spiel.`); return; }
      if (gone && gone.game) { delete calls[gone.game.key]; said.delete(`call:${gone.game.key}`); }
    }
    try { await postTournament({ ...t, boards: n, calls }); toast(`${n} Board${n > 1 ? 's' : ''}`); } catch (e) { toast(e.message); }
    tick();
  }

  /** Board antippen: Aufruf zurücknehmen oder Ergebnis eintragen (z. B. wenn ein Handy ausfällt). */
  function boardMenu(t, b) {
    const g = b.game;
    const running = g.status === 'running';
    let s;
    const need = winsNeeded(t.legsBestOf);
    const legOpts = Array.from({ length: need + 1 }, (_, i) => i);
    const selA = h('select', {}, legOpts.map((v) => h('option', { value: v, selected: v === need }, String(v))));
    const selB = h('select', {}, legOpts.map((v) => h('option', { value: v, selected: v === 0 }, String(v))));
    const saveResult = async () => {
      const la = +selA.value;
      const lb = +selB.value;
      if (!((la === need) !== (lb === need))) { toast(`Genau einer braucht ${need} Leg${need > 1 ? 's' : ''}.`); return; }
      const m = createMatch({ mode: t.mode, options: t.options, players: [g.a, g.b], playerNames: [nameOf(t, g.a), nameOf(t, g.b)], legsBestOf: t.legsBestOf });
      m.tournament = matchTag(t, g);
      m.status = 'finished';
      m.winner = la === need ? 0 : 1;
      m.manualResult = { legs: { [g.a]: la, [g.b]: lb }, by: 'pc' }; // ohne Würfe: zählt fürs Turnier, nicht für Averages
      m.updatedAt = Date.now();
      try { await postMatch(m); } catch { /* wird nachgeschickt */ }
      saveMatchWithThrows(m, []).catch(() => {});
      s.close();
      toast(`Ergebnis eingetragen: ${nameOf(t, g.a)} ${la} : ${lb} ${nameOf(t, g.b)}`);
      tick();
    };
    s = sheet(h('div', { class: 'stack' },
      h('h2', {}, `Board ${b.board}: ${nameOf(t, g.a)} gegen ${nameOf(t, g.b)}`),
      running ? h('p', { class: 'dim', style: { margin: 0 } }, 'Das Spiel läuft am Handy. Nur eintragen, wenn das Handy ausgefallen ist.') : null,
      h('b', {}, 'Ergebnis eintragen (Legs)'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, nameOf(t, g.a)), selA),
        h('label', { class: 'field' }, h('span', {}, nameOf(t, g.b)), selB)),
      h('button', { class: 'btn primary', onclick: saveResult }, 'Ergebnis speichern'),
      running ? null : h('button', {
        class: 'btn',
        onclick: async () => {
          const calls = { ...(t.calls || {}) };
          delete calls[g.key];
          said.delete(`call:${g.key}`); said.delete(`late:${g.key}`);
          s.close();
          try { await postTournament({ ...t, calls }); } catch (e) { toast(e.message); }
          tick();
        },
      }, 'Aufruf zurücknehmen (z. B. Spieler fehlt)'),
      h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Abbrechen')));
  }

  /** Einstellungen der Live-Ansicht (⚙️ in der Leiste oben): Ton, Anzeige, Ablauf. Wirkt sofort. */
  function liveSettings() {
    const box = h('div', { class: 'stack' });
    const toggle = (key, label, note) => {
      const s = getSettings();
      return h('div', { class: 'list-item' },
        h('span', { class: 'name' }, label, note ? h('div', { class: 'dim', style: { fontSize: '13px' } }, note) : null),
        h('button', { class: `chip ${s[key] ? 'on' : ''}`, onclick: () => { updateSettings({ [key]: !s[key] }); fill(); draw(); } }, s[key] ? 'An' : 'Aus'));
    };
    const seg = (key, opts) => h('div', { class: `seg ${opts.length === 2 ? 'two' : ''}` }, opts.map(([v, label]) => h('button', {
      class: getSettings()[key] === v ? 'on' : '', onclick: () => { updateSettings({ [key]: v }); fill(); draw(); },
    }, label)));
    const fill = () => {
      const s = getSettings();
      box.replaceChildren(
        h('h2', {}, '⚙️ Live-Ansicht'),
        sec('🔊 Ton'),
        toggle('tourSound', 'Ansagen am PC', 'Aufrufe, Pausen, Sieger. Aus = alles nur auf dem Bildschirm'),
        s.tourSound ? toggle('tourHighlightSpeech', 'Highlights ansagen', '„180! Kevin an Board 2“') : null,
        s.tourSound ? h('button', { class: 'btn ghost', onclick: () => { unlock(); say('Test. Board 1: Ansage funktioniert.', { interrupt: true }); } }, '🔊 Ton testen') : null,
        sec('🖥️ Anzeige'),
        h('div', { class: 'small dim' }, 'Turnierbaum und Tabellen'),
        seg('tourPlan', [['auto', 'Daneben'], ['below', 'Darunter'], ['off', 'Aus']]),
        h('div', { class: 'small dim' }, 'Schriftgröße'),
        seg('tourBig', [[false, 'Normal'], [true, 'Groß']]),
        toggle('tourHighlights', 'Highlights einblenden', '180 und Finishes ab 100 groß auf dem Bildschirm'),
        toggle('tourSchedule', 'Zeitplan anzeigen', 'Geschätztes Turnierende'),
        sec('🎯 Ablauf'),
        toggle('tourWriter', 'Schreiber ansagen', 'Verlierer des letzten Spiels an diesem Board'),
        toggle('tourOnlyConnected', 'Nur Boards mit Handy aufrufen', 'Spiele gehen nur an Boards, an denen ein Handy angemeldet ist'),
        toggle('tourDelayWarn', 'Warnung bei Verzögerung', 'Nach 5 Minuten nicht begonnen: gelb markieren und nochmal ansagen'),
        h('button', { class: 'btn primary', onclick: () => sh.close() }, 'Fertig'));
    };
    fill();
    const sh = sheet(box);
  }

  /** Spielstand je Spieler für die Board-Kachel: Rest, Legs, Average, laufende und letzte Aufnahme. */
  function detail(m) {
    try {
      const d = derive(m);
      const rows = throwRows(m);
      const leg = d.legs[d.legs.length - 1];
      const x01 = m.mode === 'x01';
      return m.players.map((id, i) => {
        const active = !d.finished && i === d.current;
        const rest = active && x01 && d.turnEval && d.turnEval.remaining != null ? d.turnEval.remaining : d.scores[i];
        const stats = x01 ? playerStats(rows.filter((r) => r.playerId === id)) : null;
        const lastTurn = leg ? [...leg.turns].reverse().find((x) => x.player === i) : null;
        return {
          rest, active, legs: d.legsWon[i], sets: d.setsWon[i], showSets: d.setsNeeded > 1,
          avg: stats && stats.average ? stats.average : null,
          now: active ? d.turnDarts.map(hitLabel) : null,
          dartsLeft: active ? d.dartsLeft : 0,
          way: active && x01 && rest <= 170 ? (checkoutPaths(rest, d.dartsLeft || 3, 1)[0] || null) : null,
          last: lastTurn,
        };
      });
    } catch { return null; }
  }

  const turnText = (x) => {
    if (!x) return '';
    if (x.ev && x.ev.bust) return 'Überworfen';
    const darts = (x.darts || []).filter((dt) => dt.source !== 'filled');
    return darts.length ? `${darts.map(hitLabel).join(' ')} = ${x.ev.points}` : `${x.ev ? x.ev.points : ''}`;
  };
  const avgText = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // ---------- Anzeige ----------
  function draw() {
    if (!last) return;
    const { t, st, matches, plan, raw } = last;
    const s = getSettings();
    const boards = boardStatus(t, st);
    const connected = presence.connected();
    const boardOf = (g) => boards.find((b) => b.game && b.game.key === g.key)?.board || null;
    const played = st.games.filter((g) => g.status === 'done').length;
    const total = st.games.filter((g) => !g.bye).length;
    const phase = st.done ? 'Beendet' : t.format === 'gko' && !st.groupsDone ? 'Gruppenphase' : t.ko ? (st.koRounds.find((r) => r.games.some((g) => g.status !== 'done' && g.status !== 'bye'))?.name || 'K.-o.') : 'Spiele';
    const url = baseUrl(info); // nur WLAN
    const called = new Set(Object.keys(t.calls || {}));
    const next = queueOrder(st.games.filter((g) => g.status === 'ready' && !called.has(g.key))).slice(0, 6);
    const eta = s.tourSchedule && !st.done ? scheduleEstimate(t, st) : null;
    const canJoin = (url || info?.cloud) && !st.done;
    // QR-Codes: von Hand ein/aus, sonst offen, solange noch Handys fehlen und nichts gespielt ist
    const qr = canJoin && (qrOpen ?? (connected.size < t.boards && !played));
    body.classList.toggle('big', !!s.tourBig);

    const phonePill = (b) => {
      const p = raw[b.board];
      return connected.has(b.board)
        ? h('span', { class: 'phone ok' }, `📱 ${p && p.device ? p.device : 'verbunden'}`)
        : h('span', { class: 'phone off' }, '⚠️ kein Handy');
    };
    const head = (b, g) => h('div', { class: 'bnum' },
      h('span', {}, `Board ${b.board}`, g ? h('span', { class: 'bmeta' }, ` · ${g.roundName} · Best of ${t.legsBestOf}`) : null),
      phonePill(b));

    // Eine Hälfte der Kachel: Name, großer Rest, Legs/Average, darunter laufende bzw. letzte Aufnahme
    const half = (id, p) => h('div', { class: `bside ${p && p.active ? 'on' : ''}` },
      h('div', { class: 'bname' }, p && p.active ? '▶ ' : '', nameOf(t, id)),
      p ? [
        h('div', { class: 'brest num' }, String(p.rest)),
        h('div', { class: 'bline num' }, p.showSets ? `Sets ${p.sets} · ` : '', `Legs ${p.legs}`, p.avg ? ` · Ø ${avgText(p.avg)}` : ''),
        p.active
          ? h('div', { class: 'bturn' },
            h('span', { class: 'dim' }, 'Wirft: '),
            h('b', { class: 'num' }, [...p.now, ...Array(Math.max(0, p.dartsLeft)).fill('–')].join(' ') || '–'),
            p.way ? h('div', { class: 'bway num' }, `Weg: ${p.way.join(' ')}`) : null)
          : h('div', { class: 'bturn dim' }, p.last ? ['Zuletzt: ', h('span', { class: 'num' }, turnText(p.last))] : ' '),
      ] : null);

    const tile = (b) => {
      const g = b.game;
      if (!g) {
        return h('div', { class: 'boardtile free' },
          head(b, null),
          h('div', { class: 'bfree' }, plan.pauseUntil ? `☕ Pause bis ${fmtClock(plan.pauseUntil)}` : st.done ? '—' : s.tourOnlyConnected && !connected.has(b.board) ? 'wartet auf ein Handy' : 'frei'));
      }
      const running = g.status === 'running' && g.match;
      const late = !running && s.tourDelayWarn && Date.now() - b.since > LATE_MS;
      const ps = running ? detail(g.match) : null;
      const mins = running && g.match.createdAt ? Math.max(0, Math.floor((Date.now() - g.match.createdAt) / 60000)) : null;
      return h('div', {
        class: `boardtile ${running ? 'running' : 'called'} ${late ? 'late' : ''}`,
        onclick: () => { if (!tv) boardMenu(t, b); },
      },
      head(b, g),
      h('div', { class: 'bsides' }, half(g.a, ps && ps[0]), h('div', { class: 'bvs' }, 'vs.'), half(g.b, ps && ps[1])),
      h('div', { class: 'bfoot' },
        h('span', { class: 'bstate' }, running ? `⏵ läuft${mins != null ? ` seit ${mins} Min.` : ''}` : late ? `⏰ seit ${Math.floor((Date.now() - b.since) / 60000)} Min. nicht begonnen` : `📣 aufgerufen ${fmtClock(b.since)}`),
        b.writer ? h('span', {}, `✍️ Schreiber: ${nameOf(t, b.writer)}`) : null));
    };

    const tool = (label, title, onclick, on = false) => h('button', { class: `toolbtn ${on ? 'on' : ''}`, title, onclick }, label);
    const main = h('div', { class: 'livemain stack' },
      // Online: Code groß – in der eigenen App unter Turnier › Beitreten eingeben (oder den QR-Code scannen)
      info && info.cloud && !st.done
        ? (qr
          ? h('div', { class: 'card codecard joinrow' },
            h('div', { class: 'qrimg big', html: qrFor(`${location.origin}${location.pathname}?live=${info.code}`) }),
            h('div', { class: 'stack', style: { gap: '4px' } },
              h('div', { class: 'small dim' }, '🌐 Online-Turnier beitreten'),
              h('div', { class: 'bigcode num' }, showCode(info.code)),
              h('div', { class: 'small dim' }, 'In der Madhouse-App: Turnier › „📷 Beitreten: QR scannen“ (oder Code eintippen). Das erste Handy wird Board 1, das nächste Board 2 …'),
              h('div', { class: 'small dim' }, `${connected.size} von ${t.boards} Handys verbunden`)))
          : h('div', { class: 'card codeline' }, h('span', { class: 'dim' }, '🌐 Beitreten mit Code'), h('b', { class: 'num' }, showCode(info.code)), h('span', { class: 'dim' }, `· ${connected.size} / ${t.boards} Handys`)))
        : null,
      // QR-Code je Board: mit der iPhone-Kamera scannen, dann öffnet sich direkt das Board-Handy für dieses Board
      qr ? h('div', { class: 'card joincard' },
        h('b', { class: 'small' }, `${info.cloud ? '📱 Ohne installierte App: QR-Code mit der iPhone-Kamera scannen' : '📱 Board-Handys verbinden: QR-Code mit der iPhone-Kamera scannen'} · ${connected.size} / ${t.boards} verbunden`),
        h('div', { class: 'qrrow' }, boards.map((b) => h('div', { class: 'qrbox' },
          h('div', { class: 'qrimg', html: qrFor(boardUrl(info, b.board)) }),
          h('b', {}, `Board ${b.board}`, connected.has(b.board) ? ' ✅' : '')))),
        info.cloud
          ? h('div', { class: 'small dim' }, 'Der QR-Code öffnet Madhouse in Safari direkt am richtigen Board. Wer die App installiert hat, gibt besser den Code oben ein.')
          : h('div', { class: 'small dim' }, 'Ohne QR: in Safari ', h('b', { class: 'num' }, url), ' öffnen › „Board-Handy“ › Board wählen. iPhone und PC müssen im selben WLAN sein.')) : null,
      st.done && st.champion ? champCard(t, st) : null,
      h('div', { class: 'boardgrid' }, boards.map(tile)),
      plan.pauseUntil && !st.done ? h('div', { class: 'card pausecard' }, `☕ Pause – weiter um ${fmtClock(plan.pauseUntil)} Uhr (noch ${Math.max(1, Math.ceil((plan.pauseUntil - Date.now()) / 60000))} min)`) : null,
      next.length ? [sec('⏭️ Als Nächstes'), h('div', { class: 'nextgames' }, next.map((g) => h('div', { class: 'nextgame' }, h('b', {}, `${nameOf(t, g.a)} – ${nameOf(t, g.b)}`), h('span', { class: 'small dim' }, g.roundName))))] : null);

    body.replaceChildren(
      h('div', { class: 'livehead' },
        tv ? null : h('button', { class: 'iconbtn', title: 'Zur Turnier-Seite', onclick: () => nav.go('tournament', { id: t.id }) }, '‹'),
        h('div', { class: 'livetitle' }, h('h1', {}, t.name),
          h('div', { class: 'dim' }, `${phase} · ${played} / ${total} Spiele`, eta ? ` · ⏱️ Ende ca. ${fmtClock(eta.at)} (noch ~${eta.minutes >= 60 ? `${Math.floor(eta.minutes / 60)} Std. ${eta.minutes % 60} Min.` : `${eta.minutes} Min.`})` : '')),
        // Leiste: Boards −/＋, Ton, QR-Codes, Einstellungen, Fernseher
        h('div', { class: 'toolbar' },
          tv ? null : h('div', { class: 'boardctl' },
            h('button', { class: 'toolbtn', title: 'Board entfernen', onclick: () => changeBoards(t, st, -1) }, '−'),
            h('span', { class: 'num' }, `${t.boards} 🎯`),
            h('button', { class: 'toolbtn', title: 'Board hinzufügen', onclick: () => changeBoards(t, st, +1) }, '＋')),
          tool(s.tourSound ? '🔊' : '🔇', s.tourSound ? 'Ansagen ausschalten' : 'Ansagen einschalten', () => {
            updateSettings({ tourSound: !s.tourSound });
            if (!getSettings().tourSound && window.speechSynthesis) window.speechSynthesis.cancel(); else unlock();
            toast(getSettings().tourSound ? '🔊 Ansagen an' : '🔇 Ansagen aus');
            draw();
          }, !s.tourSound),
          canJoin ? tool('QR', qr ? 'QR-Codes ausblenden' : 'QR-Codes einblenden', () => { qrOpen = !qr; draw(); }, qr) : null,
          tool('⚙️', 'Einstellungen der Live-Ansicht', liveSettings),
          tool(tv ? '✕' : '📺', tv ? 'Fernseher-Ansicht beenden' : 'Fernseher-Ansicht', () => {
            tv = !tv; body.classList.toggle('tv', tv);
            if (tv && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
            if (!tv && document.fullscreenElement) document.exitFullscreen().catch(() => {});
            draw();
          }))),
      // Boards groß oben; Turnierbaum/Tabellen auf breiten Bildschirmen rechts daneben, sonst darunter
      h('div', { class: `livegrid plan-${s.tourPlan || 'auto'}` },
        main,
        s.tourPlan === 'off' ? null : h('div', { class: 'liveside' }, planView(t, st, { boardOf, compact: true }))),
      tv ? null : h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: () => exportFile(t, matches) }, '📤 Abgleich-Datei für alle'),
      // Live-Turnier beenden: online löschen bzw. den Turnier-Server leeren (die Spiele bleiben auf diesem PC)
      tv ? null : h('button', {
        class: 'btn danger',
        onclick: async () => {
          const online = info && info.cloud;
          if (!(await confirmDialog(online ? 'Online-Turnier beenden?' : 'Live-Turnier beenden?',
            online
              ? 'Turnier und Spielstände werden online gelöscht. Vorher „Abgleich-Datei für alle“ erstellen oder die Board-Handys „Turnier-Spiele übernehmen“ lassen – auf diesem PC bleiben die Spiele erhalten.'
              : 'Der Turnier-Server vergisst das Turnier, die Board-Handys werden abgemeldet. Die Spiele bleiben auf diesem PC (Turnierplan und Statistik).',
            { ok: 'Beenden', danger: true }))) return;
          try { await endLive(); } catch (e) { toast(e.message); }
          nav.go('tournament', { id: t.id });
        },
      }, info && info.cloud ? '🌐 Online-Turnier beenden' : '⏹️ Live-Turnier beenden'),
      tv ? null : h('p', { class: 'small dim' }, 'Freie Boards bekommen automatisch das nächste Spiel, mit Ansage (Lautsprecher am PC an). Tipp auf ein belegtes Board: Aufruf zurücknehmen oder Ergebnis eintragen, falls ein Handy ausfällt. Oben: − / ＋ Boards, 🔊 Ansagen, QR-Codes, ⚙️ Einstellungen, 📺 Fernseher.'),
    );
  }

  liveServer().then((i) => {
    info = i;
    if (!i) {
      body.replaceChildren(h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Live-Turnier')),
        h('div', { class: 'card stack' }, h('b', {}, 'Kein Turnier-Server'),
          h('div', { class: 'small dim' }, 'Die Live-Ansicht braucht den Turnier-Server auf dem PC (werkzeuge › „Turnier-Server starten“, dann http://localhost:8130/app/) oder ein Online-Turnier (Turnier › „Online live schalten“).')));
      return;
    }
    tick();
    timer = setInterval(tick, POLL_MS);
  });
  return () => { disposed = true; clearInterval(timer); flash.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
}

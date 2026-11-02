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
import { liveServer, liveState, postTournament, postMatch, boardUrl, baseUrl, presenceTracker, endLive, withoutKicked } from '../../core/live.js';
import { showCode } from '../../core/cloud.js';
import { planView, champCard, nameOf, liveScore, groupTable, bracket } from '../tournamentView.js';
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
  // Zuschauer (Fernseher-Fenster „?tv=1“): zeigt nur die Fokus-Ansicht. Ruft keine Spiele auf, sagt nichts an und
  // speichert nichts – das macht allein die Turnierleitung am Laptop (sonst liefe alles doppelt).
  const viewer = !!params.viewer;
  let autoTab = false;        // Seite wurde vom automatischen Wechsel gesetzt (nicht von Hand)
  let manualUntil = 0;        // nach einem Klick auf eine Seite 60 Sekunden nicht automatisch wechseln
  let podiumShown = false;    // Siegerehrung schon einmal von selbst gezeigt
  let qrOpen = null;          // QR-Codes: null = automatisch, sonst von Hand ein/aus
  let phonesOpen = false;     // Karte „📱 Handys“ aufgeklappt
  let focusTab = 'boards';    // Fokus-Seite: 'boards' | 'groups' | 'ko' (oben in der Leiste durchklicken)
  let info = null;
  let last = null;            // letzter Stand { t, st, matches, plan, presence }
  const saved = new Map();    // Match-Id -> updatedAt, schon in die eigene Statistik übernommen
  const said = new Set();     // schon angesagt (Aufrufe, Pausen, Sieger, Verspätungen)
  let seenHighlights = null;  // beim ersten Laden alte Highlights nicht nachholen
  let seenLeft = null;        // schon gesehene Abmeldungen der Board-Handys („Board freigeben“)
  const presence = presenceTracker(); // welche Boards gerade ein Handy haben
  const flashQueue = [];
  let flashing = false;
  const fmtClock = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const sec = (text, right = null) => h('div', { class: 'sechead' }, h('span', {}, text), right);
  const announce = (key, text) => { if (said.has(key)) return; said.add(key); if (getSettings().tourSound && !viewer) say(text); };

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
      if (!viewer && getSettings().tourSound && getSettings().tourHighlightSpeech) say(it.speech + (it.board ? ` An Board ${it.board}.` : ''));
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
    if (!t || !t.players) {
      if (viewer) { body.replaceChildren(h('div', { class: 'card viewerwait' }, h('b', {}, '📺 Fernseher'), h('div', { class: 'dim' }, 'Noch kein Turnier live. Sobald die Turnierleitung eins live schaltet, erscheint es hier.'))); return; }
      pickTournament(); return;
    }
    const matches = state.matches || [];
    const s = getSettings();

    // Fertige Spiele in die eigene Statistik übernehmen (PC-Speicher; nicht im Fernseher-Fenster)
    for (const m of viewer ? [] : matches) {
      if (m.status !== 'finished' || saved.get(m.id) === m.updatedAt) continue;
      saved.set(m.id, m.updatedAt);
      saveMatchWithThrows(m, throwRows(m)).catch(() => saved.delete(m.id));
    }

    let st = tournamentState(t, matches);
    // Von der Turnierleitung abgemeldete Handys („📴 Handy abmelden“) zählen sofort als weg. Hat sich das Handy
    // selbst abgemeldet (oder sitzt dort schon ein anderes), wird die Abmeldung wieder gelöscht – sonst dürfte es nie zurück.
    if (!viewer && t.kick && Object.keys(t.kick).length) {
      const kick = { ...t.kick };
      for (const [b, id] of Object.entries(t.kick)) {
        const p = (state.presence || {})[b];
        if (!p || p.id !== id || p.left) delete kick[b];
      }
      if (Object.keys(kick).length !== Object.keys(t.kick).length) {
        t = { ...t, kick };
        try { await postTournament(t); } catch { /* nächster Durchlauf */ }
      }
    }
    const pres = withoutKicked(state.presence || {}, t);
    // Handy hat sein Board freigegeben („📴 Board freigeben“): einen dort noch nicht begonnenen Aufruf zurücknehmen,
    // damit das Spiel an ein Board mit Handy geht. Abmeldungen von vor dem Öffnen dieser Ansicht nur merken.
    const leftNow = Object.values(pres).filter((p) => p && p.left).map((p) => ({ board: Number(p.board), key: `${p.board}:${p.at}` }));
    if (!seenLeft) seenLeft = new Set(leftNow.map((x) => x.key));
    const freed = leftNow.filter((x) => !seenLeft.has(x.key));
    freed.forEach((x) => seenLeft.add(x.key));
    if (freed.length && !viewer) {
      const calls = { ...(t.calls || {}) };
      for (const x of freed) {
        for (const [key, c] of Object.entries(calls)) {
          const g = st.games.find((y) => y.key === key);
          if (c.board === x.board && g && g.status === 'ready') { delete calls[key]; said.delete(`call:${key}`); said.delete(`late:${key}`); }
        }
      }
      if (Object.keys(calls).length !== Object.keys(t.calls || {}).length) {
        t = { ...t, calls };
        try { await postTournament(t); } catch { /* nächster Durchlauf */ }
        st = tournamentState(t, matches);
      }
    }
    // Freie Boards sofort mit dem nächsten Spiel belegen und ansagen (je nach Einstellung nur mit angemeldetem Handy)
    presence.update(pres); // Anwesenheit nach eigener Uhr (siehe core/live.js)
    const plan = planCalls(t, st, Date.now(), { boards: s.tourOnlyConnected ? presence.connected() : null });
    if (plan.calls.length && !viewer) {
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
    if (!viewer) saveTournament(t); // Kopie am PC (Turnierliste, Statistik)

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
    last = { t, st, matches, plan, raw: pres };
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
      // Aufruf wiederholen (jemand hat die Ansage nicht gehört)
      running ? null : h('button', {
        class: 'btn',
        onclick: () => { s.close(); unlock(); say(`Board ${b.board}: ${nameOf(t, g.a)} gegen ${nameOf(t, g.b)}.${b.writer ? ` Schreiber: ${nameOf(t, b.writer)}.` : ''}`, { interrupt: true }); },
      }, '🔁 Aufruf nochmal ansagen'),
      // Auf ein anderes Board verschieben (Scheibe kaputt, Licht aus …) – nur solange das Spiel noch nicht läuft
      running ? null : (() => {
        const others = boardStatus(t, last.st).filter((x) => x.board !== b.board && !x.game);
        return others.length ? h('div', { class: 'stack', style: { gap: '6px' } },
          h('b', {}, '↔ Auf anderes Board verschieben'),
          h('div', { class: 'chips' }, others.map((x) => h('button', {
            class: 'chip',
            onclick: async () => {
              s.close();
              const calls = { ...(t.calls || {}), [g.key]: { ...(t.calls || {})[g.key], board: x.board, at: Date.now() } };
              said.delete(`call:${g.key}`); said.delete(`late:${g.key}`);
              try { await postTournament({ ...t, calls }); } catch (e) { toast(e.message); return; }
              announce(`call:${g.key}`, `Achtung, Board-Wechsel. ${nameOf(t, g.a)} gegen ${nameOf(t, g.b)} jetzt an Board ${x.board}.`);
              toast(`↔ Spiel an Board ${x.board} verschoben`);
              tick();
            },
          }, `Board ${x.board}${presence.connected().has(x.board) ? ' 📱' : ' (kein Handy)'}`)))) : h('div', { class: 'small dim' }, 'Zum Verschieben ist gerade kein anderes Board frei.');
      })(),
      // Handy hängt an diesem Board (z. B. vergessen abzumelden): abmelden, damit ein anderes übernehmen kann
      !running && phoneAt(b.board) ? h('button', { class: 'btn', onclick: () => { s.close(); kickPhone(t, b.board); } }, `📴 Handy an Board ${b.board} abmelden`) : null,
      h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Abbrechen')));
  }

  /** Platzierung für die Siegerehrung: K.-o. = Sieger, Finalgegner, Halbfinal-Verlierer (beide Platz 3); sonst Tabelle. */
  function podiumOf(t, st) {
    const loser = (g) => (g && g.winnerId ? (g.winnerId === g.a ? g.b : g.a) : null);
    if (t.ko && st.koRounds.length) {
      const fin = st.koRounds[st.koRounds.length - 1].games[0];
      const semis = st.koRounds.length > 1 ? st.koRounds[st.koRounds.length - 2].games.map(loser).filter(Boolean) : [];
      return { first: fin.winnerId, second: loser(fin), third: semis };
    }
    const tb = (st.groups[0] && st.groups[0].table) || [];
    return { first: tb[0] && tb[0].id, second: tb[1] && tb[1].id, third: tb[2] ? [tb[2].id] : [] };
  }

  /** Fokus-Seite 🏆 Siegerehrung: Podest 2 – 1 – 3, darunter die Turnier-Bestwerte. */
  function podiumPage(t, st, best) {
    const p = podiumOf(t, st);
    const place = (n, ids) => h('div', { class: `pod p${n}` },
      h('div', { class: 'podnames' }, ids.filter(Boolean).map((id) => h('div', { class: 'podname' }, nameOf(t, id)))),
      h('div', { class: 'podblock' }, h('span', { class: 'podnum' }, n === 1 ? '🏆' : `${n}.`)));
    return h('div', { class: 'focuspage stack podiumpage' },
      h('div', { class: 'podtitle' }, `Siegerehrung · ${t.name}`),
      h('div', { class: 'podium' }, place(2, [p.second]), place(1, [p.first]), place(3, p.third)),
      best.length ? h('div', { class: 'bestgrid' }, best.map((x) => h('div', { class: 'bestcard' },
        h('div', { class: 'besticon' }, x.icon), h('div', { class: 'bestval num' }, x.value),
        h('div', { class: 'besttext' }, h('div', { class: 'bestlabel' }, x.label), h('div', { class: 'bestwho' }, x.who))))) : null);
  }

  /** 🛠️ Turnier steuern: von Hand anhalten/weiter, Spieler gibt auf (kampflos) bzw. Aufgabe zurücknehmen. */
  function controlMenu() {
    if (!last) return;
    const { t, st } = last;
    const paused = t.pausedUntil && t.pausedUntil > Date.now();
    const out = t.withdrawn || {};
    // Wer noch im Turnier ist: in der Gruppe sowieso, im K.-o. solange er kein Spiel verloren hat
    const lost = new Set(st.games.filter((g) => g.phase === 'ko' && g.status === 'done' && g.winnerId).map((g) => (g.winnerId === g.a ? g.b : g.a)));
    const active = t.players.filter((id) => !out[id] && !lost.has(id));
    const save = async (patch, msg) => {
      sh.close();
      try { await postTournament({ ...last.t, ...patch }); toast(msg); } catch (e) { toast(e.message); }
      tick();
    };
    const sh = sheet(h('div', { class: 'stack' },
      h('h2', {}, '🛠️ Turnier steuern'),
      sec('⏸ Turnier anhalten'),
      paused
        ? [h('div', { class: 'dim' }, `Angehalten bis ${fmtClock(t.pausedUntil)} Uhr. Laufende Spiele werden zu Ende gespielt, neue werden nicht aufgerufen.`),
          h('button', { class: 'btn primary', onclick: () => { said.delete(`pause:${t.pausedUntil}`); save({ pausedUntil: 0 }, '▶ Turnier läuft weiter'); } }, '▶ Jetzt weiter')]
        : [h('div', { class: 'small dim' }, 'Für eine Pause (z. B. Essen): Laufende Spiele werden zu Ende gespielt, danach wird bis zur gewählten Zeit nichts aufgerufen.'),
          h('div', { class: 'chips' }, [10, 15, 20, 30, 45, 60].map((min) => h('button', { class: 'chip', onclick: () => save({ pausedUntil: Date.now() + min * 60000 }, `⏸ Pause für ${min} Minuten`) }, `${min} Min.`)))],
      sec('🏳 Spieler gibt auf'),
      h('div', { class: 'small dim' }, 'Alle offenen Spiele dieses Spielers gewinnt der Gegner kampflos (w.o.). Er wird nicht mehr aufgerufen und schreibt nicht mehr. Ein laufendes Spiel von ihm zählt dann nicht.'),
      active.length ? h('div', { class: 'chips' }, active.map((id) => h('button', {
        class: 'chip',
        onclick: async () => {
          if (!(await confirmDialog(`${nameOf(t, id)} gibt auf?`, 'Alle offenen Spiele gehen kampflos an die Gegner. Das lässt sich hier wieder zurücknehmen, solange danach nichts weitergespielt wurde.', { ok: 'Aufgabe eintragen', danger: true }))) return;
          save({ withdrawn: { ...out, [id]: Date.now() } }, `🏳 ${nameOf(t, id)} hat aufgegeben`);
        },
      }, nameOf(t, id)))) : h('div', { class: 'dim' }, 'Kein Spieler mehr im Turnier.'),
      Object.keys(out).length ? [h('b', {}, 'Aufgabe zurücknehmen'), h('div', { class: 'chips' }, Object.keys(out).map((id) => h('button', {
        class: 'chip on',
        onclick: () => { const w = { ...out }; delete w[id]; save({ withdrawn: w }, `${nameOf(t, id)} ist wieder dabei`); },
      }, `↩ ${nameOf(t, id)}`)))] : null,
      h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Schließen')));
  }

  /** Das an einem Board angemeldete Handy (oder null). */
  const phoneAt = (board) => (last && presence.connected().has(board) ? last.raw[board] || null : null);

  /**
   * Handy von der Turnierleitung abmelden: Im Turnier wird seine Kennung vermerkt (t.kick). Das Handy merkt es beim
   * nächsten Abruf und verlässt das Board; hier zählt das Board sofort als frei (QR-Code erscheint wieder).
   */
  async function kickPhone(t, board) {
    const p = phoneAt(board);
    if (!p) { toast(`An Board ${board} ist kein Handy angemeldet.`); return; }
    const bs = boardStatus(t, last.st)[board - 1];
    if (bs && bs.game && bs.game.status === 'running') { toast(`An Board ${board} läuft ein Spiel – erst beenden oder Ergebnis eintragen.`); return; }
    if (!p.id) { toast('Dieses Handy hat eine ältere App-Version und kann nicht abgemeldet werden – dort „Board freigeben“ tippen.'); return; }
    if (!(await confirmDialog(`Handy an Board ${board} abmelden?`, `${p.device || 'Handy'} wird von Board ${board} abgemeldet. Danach kann sich ein anderes Handy verbinden (QR-Code in der Kachel).`, { ok: 'Abmelden', danger: true }))) return;
    try {
      await postTournament({ ...t, kick: { ...(t.kick || {}), [board]: p.id } });
      toast(`📴 Handy an Board ${board} abgemeldet`);
    } catch (e) { toast(e.message); }
    tick();
  }

  /** Freies Board antippen (Turnierleitung): Handy abmelden, falls eins angemeldet ist. */
  function freeBoardMenu(t, b) {
    const p = phoneAt(b.board);
    if (!p) return;
    const s = sheet(h('div', { class: 'stack' },
      h('h2', {}, `Board ${b.board}`),
      h('p', { class: 'dim', style: { margin: 0 } }, `Angemeldet: ${p.device || 'Handy'}`),
      h('button', { class: 'btn', onclick: () => { s.close(); kickPhone(t, b.board); } }, `📴 Handy an Board ${b.board} abmelden`),
      h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Abbrechen')));
  }

  /** Einstellungen der Live-Ansicht (⚙️ in der Leiste oben): Ton, Anzeige, Ablauf. Wirkt sofort. */
  // ---------- Bereiche unter den Boards: Reihenfolge, Ein/Aus, Fokus ----------
  const SECTIONS = { best: '🔥 Turnier-Bestwerte', next: '⏭️ Als Nächstes', results: '🏁 Letzte Ergebnisse', plan: '🌳 Turnierbaum / Tabellen' };
  const FOCUS_DEFAULT = { next: true, best: true };
  const sectionOrder = () => {
    const o = (getSettings().tourOrder || []).filter((k) => SECTIONS[k]);
    return [...o, ...Object.keys(SECTIONS).filter((k) => !o.includes(k))];
  };
  const sectionVisible = (k) => {
    const s = getSettings();
    if (s.tourFocus) return !!(s.tourFocusShow || FOCUS_DEFAULT)[k];
    if (k === 'plan' && s.tourPlan === 'off') return false; // ältere Einstellung „Turnierbaum: Aus“
    return !(s.tourHide || {})[k];
  };
  /** Zeilen je Bereich: ↑ / ↓ (Reihenfolge) und An/Aus. focus: stattdessen „im Fokus zeigen“. */
  function sectionRows(refresh, { order = true, focus = false } = {}) {
    const s = getSettings();
    const list = sectionOrder().filter((k) => !(focus && k === 'plan')); // im Fokus hat der Turnierplan eigene Seiten
    const on = (k) => (focus ? !!(s.tourFocusShow || FOCUS_DEFAULT)[k] : !(s.tourHide || {})[k] && !(k === 'plan' && s.tourPlan === 'off'));
    const flip = (k) => {
      if (focus) updateSettings({ tourFocusShow: { ...(s.tourFocusShow || FOCUS_DEFAULT), [k]: !on(k) } });
      else updateSettings({ tourHide: { ...(s.tourHide || {}), [k]: on(k) }, ...(k === 'plan' && s.tourPlan === 'off' ? { tourPlan: 'auto' } : {}) });
      refresh(); draw();
    };
    const move = (i, d) => {
      const o = list.slice();
      [o[i], o[i + d]] = [o[i + d], o[i]];
      updateSettings({ tourOrder: o });
      refresh(); draw();
    };
    return list.map((k, i) => h('div', { class: 'list-item sectionrow' },
      order ? h('div', { class: 'orderbtns' },
        h('button', { class: 'toolbtn', disabled: i === 0, title: 'Nach oben', onclick: () => move(i, -1) }, '↑'),
        h('button', { class: 'toolbtn', disabled: i === list.length - 1, title: 'Nach unten', onclick: () => move(i, 1) }, '↓')) : null,
      h('span', { class: 'name' }, SECTIONS[k]),
      h('button', { class: `chip ${on(k) ? 'on' : ''}`, onclick: () => flip(k) }, on(k) ? 'An' : 'Aus')));
  }
  /** 👁 in der Leiste: Bereiche schnell ein- und ausblenden (im Fokus: was der Fokus zeigt). */
  function showSections() {
    const box = h('div', { class: 'stack' });
    const fill = () => {
      const focus = !!getSettings().tourFocus;
      box.replaceChildren(
        h('h2', {}, focus ? '🎯 Im Fokus zeigen' : '👁 Bereiche anzeigen'),
        h('div', { class: 'small dim' }, 'Reihenfolge mit ↑ / ↓, ein- und ausblenden mit An/Aus. Die Boards stehen immer oben.'),
        sectionRows(fill, { focus }),
        h('button', { class: 'btn primary', onclick: () => sh.close() }, 'Fertig'));
    };
    fill();
    const sh = sheet(box);
  }

  /** Adresse des Fernseher-Fensters (nur anzeigen): online mit Code, im WLAN über den Turnier-Server. */
  const tvUrl = () => `${location.origin}${location.pathname}?tv=1${info && info.cloud ? `&live=${info.code}` : ''}`;

  /** Fernseher-Fenster auf diesem PC öffnen – wenn möglich gleich auf dem zweiten Bildschirm (Chrome/Edge fragen nach). */
  async function openTvWindow() {
    let feat = 'popup,width=1280,height=720';
    let second = false;
    try {
      if (window.getScreenDetails) {
        const sd = await window.getScreenDetails();
        const other = sd.screens.find((x) => x !== sd.currentScreen);
        if (other) { feat = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`; second = true; }
      }
    } catch { /* keine Erlaubnis: normales Fenster */ }
    const w = window.open(tvUrl(), 'madhouse-tv', feat);
    if (!w) { toast('Das Fenster wurde blockiert – Pop-ups für diese Seite erlauben.'); return; }
    toast(second ? '📺 Fenster auf dem zweiten Bildschirm – dort ⛶ für Vollbild' : '📺 Fenster auf den Fernseher ziehen, dort ⛶ (oder F11) für Vollbild');
  }

  /** 🖥️ Fernseher: drei Wege – zweiter Bildschirm, anderes Gerät, nur dieser Laptop. */
  function screenMenu() {
    const url = tvUrl();
    const sh = sheet(h('div', { class: 'stack' },
      h('h2', {}, '🖥️ Fernseher'),
      h('b', {}, 'Laptop mit zweitem Bildschirm (Fernseher am Kabel)'),
      h('div', { class: 'small dim' }, 'Am Laptop bleibt die Turnierleitung mit allen Knöpfen und QR-Codes. Auf dem Fernseher läuft nur die Fokus-Ansicht – sie ruft nichts auf und sagt nichts an.'),
      h('button', { class: 'btn primary', onclick: () => { sh.close(); openTvWindow(); } }, '📺 Fernseher-Fenster öffnen'),
      h('b', {}, 'Anderes Gerät als Fernseher (Smart-TV, zweiter Laptop, Tablet)'),
      h('div', { class: 'small dim' }, info && info.cloud ? 'Diese Adresse im Browser des Geräts öffnen:' : 'Diese Adresse im Browser des Geräts öffnen (gleiches WLAN wie der PC):'),
      h('div', { class: 'tvurlrow' },
        h('div', { class: 'qrimg', html: qrFor(info && info.cloud ? url : `${baseUrl(info) || location.origin + location.pathname}?tv=1`) }),
        h('b', { class: 'num tvurl' }, info && info.cloud ? url : `${baseUrl(info) || location.origin + location.pathname}?tv=1`)),
      h('b', {}, 'Nur dieser Laptop'),
      h('div', { class: 'small dim' }, '🎯 Fokus oben einschalten und 📺 für Vollbild. Zum Verbinden neuer Handys: Der QR-Code steht in der Kachel des freien Boards – oder kurz 🎯 tippen, dann sind alle Knöpfe und QR-Codes wieder da.'),
      h('button', { class: 'btn', onclick: () => { sh.close(); updateSettings({ tourFocus: true }); draw(); } }, '🎯 Fokus auf diesem Laptop'),
      h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Schließen')));
  }

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
        sec('📐 Anordnung unter den Boards'),
        h('div', { class: 'small dim' }, 'Reihenfolge mit ↑ / ↓, ein- und ausblenden mit An/Aus (schnell auch mit 👁 oben in der Leiste).'),
        sectionRows(fill),
        h('div', { class: 'small dim' }, 'Turnierbaum auf breiten Bildschirmen'),
        seg('tourPlan', [['auto', 'Rechts daneben'], ['below', 'In der Reihenfolge oben']]),
        sec('🎯 Fokus-Ansicht'),
        h('div', { class: 'small dim' }, 'Knopf 🎯 oben: nur Uhr, Boards und diese Bereiche – alles andere wird ausgeblendet.'),
        sectionRows(fill, { order: false, focus: true }),
        toggle('tourRotate', 'In Pausen automatisch wechseln', 'Wenn kein Spiel läuft: Boards → Gruppen → K.-o. (auch im Fernseher-Fenster). Bei einem Aufruf sofort zurück zu den Boards'),
        s.tourRotate ? seg('tourRotateSec', [[10, '10 s'], [20, '20 s'], [40, '40 s']]) : null,
        sec('🖥️ Anzeige'),
        h('div', { class: 'small dim' }, 'Boards nebeneinander (Auto: höchstens 2, ab 5 Boards 3)'),
        h('div', { class: 'seg', style: { gridTemplateColumns: 'repeat(4, 1fr)' } }, [['auto', 'Auto'], ['1', '1'], ['2', '2'], ['3', '3']].map(([v, label]) => h('button', {
          class: String(getSettings().tourCols || 'auto') === v ? 'on' : '', onclick: () => { updateSettings({ tourCols: v }); fill(); draw(); },
        }, label))),
        h('div', { class: 'small dim' }, 'Größe: oben in der Leiste mit A− / A+ (alles) und − 📋 ＋ (nur die Bereiche unter den Boards und der Turnierbaum).'),
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
        // Letzte Aufnahme: im laufenden Leg, sonst die letzte aus einem früheren Leg (am Leg-Anfang steht sonst nichts)
        const lastTurn = [...d.legs].reverse().map((l) => [...l.turns].reverse().find((x) => x.player === i)).find(Boolean) || null;
        return {
          x01, rest, active, legs: d.legsWon[i], sets: d.setsWon[i], showSets: d.setsNeeded > 1, legsNeeded: d.legsNeeded, setsNeeded: d.setsNeeded,
          avg: stats && stats.average ? stats.average : null,
          now: active ? d.turnDarts.map(hitLabel) : null,
          dartsLeft: active ? d.dartsLeft : 0,
          // Checkout-Weg bei jedem Spieler mit auscheckbarem Rest (Werfer: mit seinen restlichen Darts, sonst 3)
          way: !d.finished && x01 && m.options && m.options.doubleOut !== false && rest <= 170
            ? (checkoutPaths(rest, active ? (d.dartsLeft || 3) : 3, 1)[0] || null) : null,
          last: lastTurn,
          // Neues Leg: in diesem Leg noch nicht geworfen (dann nicht die alte Aufnahme aus dem vorigen Leg zeigen)
          newLeg: d.legs.length > 1 && leg && !leg.turns.some((x) => x.player === i),
          // Zusatzinfos: Darts im laufenden Leg, höchste Aufnahme, First 9 (Schnitt der ersten 9 Darts je Leg), 180er
          legDarts: leg ? leg.turns.filter((x) => x.player === i).reduce((a, x) => a + ((x.ev && x.ev.usedDarts) || (x.darts || []).length || 3), 0) : 0,
          // Leg-Average: Punkte / Darts im laufenden Leg × 3 (null = in diesem Leg noch nicht geworfen)
          legAvg: (() => {
            if (!x01 || !leg) return null;
            const own = leg.turns.filter((x) => x.player === i);
            const darts = own.reduce((a, x) => a + ((x.ev && x.ev.usedDarts) || (x.darts || []).length || 3), 0);
            return darts ? (own.reduce((a, x) => a + ((x.ev && x.ev.points) || 0), 0) / darts) * 3 : null;
          })(),
          highest: stats ? stats.highest : 0,
          first9: stats && stats.first9 ? stats.first9 : null,
          c180: stats ? stats.c180 : 0,
        };
      });
    } catch { return null; }
  }

  /** Turnier-Bestwerte (nur X01): 180er, höchstes Finish, bester Average, beste Aufnahme – mit Namen. */
  const rowCache = new Map(); // Match-Id -> { at, rows }: die Ansicht zeichnet alle 2 Sekunden neu
  const rowsOf = (m) => {
    const c = rowCache.get(m.id);
    if (c && c.at === m.updatedAt) return c.rows;
    let rows = [];
    try { rows = throwRows(m); } catch { /* defektes Match: ohne Werte */ }
    rowCache.set(m.id, { at: m.updatedAt, rows });
    return rows;
  };
  function bests(t, matches) {
    const byPlayer = new Map();
    for (const m of matches) {
      if (!m.tournament || m.tournament.id !== t.id || m.status === 'aborted' || m.mode !== 'x01') continue;
      for (const r of rowsOf(m)) (byPlayer.get(r.playerId) || byPlayer.set(r.playerId, []).get(r.playerId)).push(r);
    }
    const stats = [...byPlayer].map(([id, rows]) => ({ id, s: playerStats(rows) }));
    const top = (val, ok = () => true) => {
      const list = stats.filter((x) => ok(x.s) && val(x.s) > 0).sort((a, b) => val(b.s) - val(a.s));
      return list.length ? { v: val(list[0].s), names: list.filter((x) => val(x.s) === val(list[0].s)).map((x) => nameOf(t, x.id)) } : null;
    };
    const out = [];
    const c180 = stats.filter((x) => x.s.c180 > 0).sort((a, b) => b.s.c180 - a.s.c180);
    if (c180.length) out.push({ icon: '🎯', value: String(c180.reduce((a, x) => a + x.s.c180, 0)), label: '180er', who: c180.map((x) => `${nameOf(t, x.id)}${x.s.c180 > 1 ? ` ×${x.s.c180}` : ''}`).join(', ') });
    const fin = top((s) => s.highestCheckout);
    if (fin) out.push({ icon: '✅', value: String(fin.v), label: 'Höchstes Finish', who: fin.names.join(', ') });
    const avg = top((s) => s.average, (s) => s.darts >= 9);
    if (avg) out.push({ icon: '📈', value: avgText(avg.v), label: 'Bester Average', who: avg.names.join(', ') });
    const hi = top((s) => s.highest);
    if (hi) out.push({ icon: '💥', value: String(hi.v), label: 'Beste Aufnahme', who: hi.names.join(', ') });
    return out;
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
    // QR-Code und Hinweis in der Beitreten-Zeile: von Hand ein/aus (Knopf QR), sonst solange noch Handys fehlen
    const qr = canJoin && (qrOpen ?? connected.size < t.boards);
    // Größe: das Fernseher-Fenster merkt sich eigene Werte (Laptop und Fernseher sind verschieden groß)
    const ZK = viewer ? 'tourZoomTv' : 'tourZoom';
    const PZK = viewer ? 'tourPlanZoomTv' : 'tourPlanZoom';
    const zoom = s[ZK] || 1;
    const planZoom = s[PZK] || 1;
    body.style.zoom = String(zoom);
    body.style.setProperty('--z', String(zoom)); // für die volle Bildschirmhöhe im Fokus (CSS rechnet 100vh / Zoom)
    const n = boardStatus(t, st).length;
    const boardCols = Math.min(n, s.tourCols && s.tourCols !== 'auto' ? +s.tourCols : n <= 1 ? 1 : n <= 4 ? 2 : 3);
    const setZoom = (key, delta, lo, hi) => {
      const v = Math.round(Math.max(lo, Math.min(hi, (getSettings()[key] || 1) + delta)) * 10) / 10;
      updateSettings({ [key]: v });
      draw();
    };
    const pct = (v) => `${Math.round(v * 100)} %`;
    // Freie Boards: welches Spiel käme als Nächstes dorthin (in der Pause oder ohne Handy)
    const freeBoards = boards.filter((b) => !b.game).map((b) => b.board);
    const upcoming = (board) => next[freeBoards.indexOf(board)] || null;

    const phonePill = (b) => {
      const p = raw[b.board];
      return connected.has(b.board)
        ? h('span', { class: 'phone ok' }, `📱 ${p && p.device ? p.device : 'verbunden'}`)
        : h('span', { class: 'phone off' }, '⚠️ kein Handy');
    };
    const head = (b, g) => h('div', { class: 'bnum' },
      h('span', {}, `Board ${b.board}`, g ? h('span', { class: 'bmeta' }, ` · ${g.roundName} · Best of ${t.legsBestOf}`) : null),
      phonePill(b));

    // Eine Hälfte der Kachel (ab 1.23.1) als Raster: oben Name und „wirft jetzt“, links der Rest so groß wie möglich,
    // rechts oben die Legs, rechts unten Zuletzt und die Averages, am unteren Rand die kleinen Infos und der Checkout-Weg.
    // Die Schrift richtet sich nach der Hälfte (Container-Einheiten in styles.css).
    const half = (id, p) => h('div', { class: `bside ${p && p.active ? 'on' : ''}` }, h('div', { class: 'bgrid' }, // inneres Raster: Container-Abfragen gelten nur für Kind-Elemente
      h('div', { class: 'bstop' },
        h('div', { class: 'bname' }, p && p.active ? '▶ ' : '', nameOf(t, id)),
        // Werfer ohne eingegebene Darts: rotes Schild oben rechts (bei Summen-Eingabe kommen keine einzelnen Darts an)
        p && p.active && !p.now.length ? h('span', { class: 'bnow' }, 'wirft jetzt') : null),
      p ? [
        h('div', { class: 'brest num' }, String(p.rest)),
        h('div', { class: 'bstats num' },
          // Punkte je nötigem Leg: ●○ = 1 von 2 gewonnen
          h('div', { class: 'blegs' },
            h('span', { class: 'legdots', title: `Legs ${p.legs} von ${p.legsNeeded}` }, Array.from({ length: p.legsNeeded }, (_, k) => h('i', { class: k < p.legs ? 'on' : '' }))),
            h('span', {}, p.showSets ? `Sets ${p.sets}/${p.setsNeeded} · ` : '', `Legs ${p.legs} von ${p.legsNeeded}`)),
          h('div', { class: 'bstatsend' },
            // Werfer mit eingegebenen Darts: die laufende Aufnahme
            p.active && p.now.length ? h('div', { class: 'bdarts' }, 'Wirft ', h('b', {}, [...p.now, ...Array(Math.max(0, p.dartsLeft)).fill('–')].join(' '))) : null,
            // Letzte Aufnahme (immer, notfalls aus dem vorigen Leg)
            p.newLeg ? h('div', { class: 'blast newleg' }, 'Neues Leg') : h('div', { class: 'blast' }, 'Zuletzt ', h('b', {}, p.last ? turnText(p.last) : '–')),
            // Beide Averages: über das ganze Spiel und nur im laufenden Leg
            p.x01 ? h('div', {}, 'Ø Spiel ', h('b', {}, p.avg ? avgText(p.avg) : '–')) : null,
            p.x01 ? h('div', {}, 'Ø Leg ', h('b', {}, p.legAvg != null ? avgText(p.legAvg) : '–')) : null)),
        // Unterer Rand: kleine Infos links, Checkout-Weg rechts
        h('div', { class: 'bbottom num' },
          h('div', { class: 'bchips' },
            p.legDarts ? h('span', {}, `${p.legDarts} Darts`) : null,
            p.highest ? h('span', {}, `Max ${p.highest}`) : null,
            p.first9 ? h('span', {}, `F9 ${avgText(p.first9)}`) : null,
            p.c180 ? h('span', { class: 'gold' }, `180 ×${p.c180}`) : null),
          p.way ? h('span', { class: 'bway' }, 'Checkout ', h('b', {}, p.way.join(' '))) : null),
      ] : null));

    const tile = (b) => {
      const g = b.game;
      if (!g) {
        const soon = st.done ? null : upcoming(b.board);
        const noPhone = !connected.has(b.board);
        // QR-Code und Code nur an der Turnierleitung – nie im Fernseher-Fenster (sonst könnte sich jeder übers Fernsehbild verbinden)
        const showJoin = noPhone && canJoin && !viewer;
        return h('div', {
          class: `boardtile free ${!noPhone && !viewer ? 'tap' : ''}`,
          onclick: () => { if (!tv && !viewer && !noPhone) freeBoardMenu(t, b); },
        },
          head(b, null),
          h('div', { class: 'bfreebody' },
            // Ohne Handy: QR-Code für genau dieses Board direkt in der Kachel
            showJoin ? h('div', { class: 'qrimg', html: qrFor(boardUrl(info, b.board)) }) : null,
            h('div', { class: 'stack', style: { gap: '6px' } },
              h('div', { class: 'bfree' }, plan.pauseUntil ? `☕ Pause bis ${fmtClock(plan.pauseUntil)}` : st.done ? '—' : noPhone ? (viewer ? 'Board frei – wartet auf ein Handy' : '📱 Handy verbinden') : 'frei'),
              showJoin ? h('div', { class: 'small dim' }, info.cloud
                ? ['Mit der iPhone-Kamera scannen – oder in der App „Beitreten“ mit Code ', h('b', { class: 'num accent' }, showCode(info.code))]
                : 'Mit der iPhone-Kamera scannen (gleiches WLAN wie der PC).') : null,
              soon ? h('div', { class: 'bsoon' }, h('span', { class: 'dim' }, plan.pauseUntil ? 'Nach der Pause hier: ' : 'Gleich hier: '), h('b', {}, `${nameOf(t, soon.a)} – ${nameOf(t, soon.b)}`), h('span', { class: 'dim small' }, ` · ${soon.roundName}`)) : null)));
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
    // Fokus: nur Uhr, Boards und die gewählten Bereiche (Standard: Als Nächstes und Bestwerte)
    const focus = viewer || !!s.tourFocus;
    const main = h('div', { class: 'livemain stack' },
      // Beitreten: eine schmale Zeile. Online ein QR-Code für die App (jedes Handy bekommt das nächste freie Board),
      // den QR-Code für ein bestimmtes Board (auch ohne App, mit der iPhone-Kamera) zeigt die Kachel des freien Boards.
      canJoin && !focus ? h('div', { class: 'card joinbar' },
        info.cloud && qr ? h('div', { class: 'qrimg', html: qrFor(`${location.origin}${location.pathname}?live=${info.code}`) }) : null,
        h('div', { class: 'joinmain' },
          info.cloud
            ? h('div', { class: 'joinline' }, h('span', { class: 'dim' }, '🌐 Beitreten mit Code'), h('b', { class: 'num joincode' }, showCode(info.code)))
            : h('div', { class: 'joinline' }, h('span', { class: 'dim' }, '📶 Im WLAN in Safari öffnen:'), h('b', { class: 'num' }, url)),
          qr ? h('div', { class: 'small dim' }, info.cloud
            ? 'In der Madhouse-App: Turnier › „📷 Beitreten: QR scannen“ oder Code eintippen – jedes Handy bekommt das nächste freie Board. Ohne App: QR-Code in der Kachel des Boards mit der iPhone-Kamera scannen.'
            : 'Dann „Board-Handy“ wählen – oder den QR-Code in der Kachel des Boards mit der iPhone-Kamera scannen. iPhone und PC im selben WLAN.') : null),
        h('div', { class: `joincount num ${connected.size >= t.boards ? 'ok' : ''}` }, `📱 ${connected.size} / ${t.boards}`)) : null,
      // Überwachung (nur Turnierleitung, nicht im Fokus): je Board das Handy, letzte Meldung, was dort läuft, Abmelden
      !focus && !viewer && canJoin ? h('details', { class: 'card phonecard', open: phonesOpen },
        h('summary', { onclick: (e) => { e.preventDefault(); phonesOpen = !phonesOpen; draw(); } },
          h('b', {}, '📱 Handys'), h('span', { class: 'dim small' }, ` · ${connected.size} von ${t.boards} verbunden`),
          boards.some((b) => connected.has(b.board) && raw[b.board] && raw[b.board].pending) ? h('b', { class: 'warn small' }, ' · ⚠️ Spielstände warten') : null),
        h('div', { class: 'phonelist' }, boards.map((b) => {
          const p = connected.has(b.board) ? raw[b.board] : null;
          const ago = p ? Math.max(0, Math.round((Date.now() - (presence.lastSeen(b.board) || Date.now())) / 1000)) : null;
          const g = b.game;
          return h('div', { class: `phonerow ${p ? 'ok' : 'off'}` },
            h('b', {}, `Board ${b.board}`),
            h('span', {}, p ? `📱 ${p.device || 'Handy'}` : '— kein Handy'),
            h('span', { class: `num ${ago != null && ago > 15 ? 'warn' : 'dim'}` }, p ? `Meldung vor ${ago} s` : ''),
            h('span', { class: 'dim' }, g ? `${g.status === 'running' ? 'spielt' : 'aufgerufen'}: ${nameOf(t, g.a)} – ${nameOf(t, g.b)}` : 'frei', p && p.pending ? h('b', { class: 'warn' }, ` · ⚠️ ${p.pending} ${p.pending > 1 ? 'Spielstände warten' : 'Spielstand wartet'} auf Übertragung`) : null),
            p && !(g && g.status === 'running') ? h('button', { class: 'btn ghost small', onclick: () => kickPhone(t, b.board) }, '📴 Abmelden') : h('span', {}));
        })),
        h('div', { class: 'small dim' }, 'Ein Handy gilt nach 30 Sekunden ohne Meldung als weg (App zu oder iPhone gesperrt). „Abmelden“ gibt das Board sofort für ein anderes Handy frei.')) : null,
      st.done && st.champion ? champCard(t, st) : null,
      // Höchstens 2 Boards nebeneinander (ab 5 Boards 3) – so werden die Kacheln groß; einstellbar unter ⚙️
      h('div', { class: `boardgrid cols${boardCols}` }, boards.map(tile)),
      plan.pauseUntil && !st.done ? h('div', { class: 'card pausecard' }, `☕ Pause – weiter um ${fmtClock(plan.pauseUntil)} Uhr (noch ${Math.max(1, Math.ceil((plan.pauseUntil - Date.now()) / 60000))} min)`) : null);

    // Bereiche unter den Boards – Reihenfolge und Ein/Aus: 👁 in der Leiste bzw. ⚙️ › Anordnung
    const recent = st.games.filter((g) => g.status === 'done' && g.result && !g.bye).sort((x, y) => (y.result.at || 0) - (x.result.at || 0)).slice(0, 4);
    const best = bests(t, matches);
    const parts = {
      // im Fokus nur eine Zeile (die nächsten 4)
      next: () => (next.length ? [sec(SECTIONS.next), h('div', { class: 'livenext' }, next.slice(0, focus ? 4 : 6).map((g, i) => h('div', { class: 'nextcard' },
        h('span', { class: 'nextno num' }, String(i + 1)),
        h('div', { class: 'nexttext' }, h('b', {}, nameOf(t, g.a), h('span', { class: 'vs' }, ' – '), nameOf(t, g.b)), h('span', { class: 'dim' }, g.roundName)))))] : null),
      best: () => (best.length ? [sec(SECTIONS.best), h('div', { class: 'bestgrid' }, best.map((x) => h('div', { class: 'bestcard' },
        h('div', { class: 'besticon' }, x.icon), h('div', { class: 'bestval num' }, x.value),
        h('div', { class: 'besttext' }, h('div', { class: 'bestlabel' }, x.label), h('div', { class: 'bestwho' }, x.who)))))] : null),
      results: () => (recent.length ? [sec(SECTIONS.results), h('div', { class: 'resultlist' }, recent.map((g) => h('div', { class: 'resultrow' },
        h('span', { class: g.winnerId === g.a ? 'win' : '' }, nameOf(t, g.a)),
        h('b', { class: 'num' }, `${g.result.legs[g.a] ?? 0} : ${g.result.legs[g.b] ?? 0}`),
        h('span', { class: g.winnerId === g.b ? 'win' : '' }, nameOf(t, g.b)),
        h('span', { class: 'dim small' }, g.roundName))))] : null),
      plan: () => planView(t, st, { boardOf, compact: true }),
    };
    const shown = sectionOrder().filter((k) => sectionVisible(k));
    // Turnierbaum „Daneben“: auf breiten Bildschirmen rechte Spalte (im Fokus immer unten)
    const planSide = shown.includes('plan') && s.tourPlan !== 'below' && !focus;
    // Im Fokus steht der Turnierplan nie unter den Boards – dafür gibt es die eigenen Seiten 👥 Gruppen und 🌳 K.-o.
    const below = shown.filter((k) => !(k === 'plan' && (planSide || focus)));
    if (below.length) main.append(h('div', { class: 'liveinfo stack', style: { zoom: String(planZoom) } }, below.map((k) => parts[k]())));
    const side = planSide ? h('div', { class: 'liveside stack', style: { zoom: String(planZoom) } }, parts.plan()) : null;

    // Fokus-Seiten: 🎯 Boards (Standard), 👥 Gruppen und 🌳 K.-o. jeweils bildschirmfüllend (z. B. in einer Pause)
    const tabs = [st.done && st.champion ? ['podium', '🏆 Siegerehrung'] : null, ['boards', '🎯 Boards'], st.groups.length ? ['groups', t.format === 'rr' ? '📊 Tabelle' : '👥 Gruppen'] : null, st.koRounds.length ? ['ko', '🌳 K.-o.'] : null].filter(Boolean);
    // Turnier beendet: Fokus und Fernseher springen einmal von selbst zur Siegerehrung
    if (focus && st.done && st.champion && !podiumShown) { focusTab = 'podium'; podiumShown = true; }
    if (!tabs.some(([k]) => k === focusTab)) focusTab = 'boards';
    // Automatisch wechseln (Fokus und Fernseher): nur wenn kein Spiel läuft oder aufgerufen ist bzw. in der Pause.
    // Wird ein Spiel aufgerufen, sofort zurück zu den Boards. Nach einem Klick 60 Sekunden lang nichts von selbst.
    const idle = !st.done && (!boards.some((b) => b.game) || !!plan.pauseUntil);
    if (focus && s.tourRotate !== false && tabs.length > 1 && Date.now() > manualUntil) {
      if (idle) {
        const sec = Math.max(5, s.tourRotateSec || 20);
        focusTab = tabs[Math.floor(Date.now() / (sec * 1000)) % tabs.length][0];
        autoTab = true;
      } else if (autoTab) { focusTab = 'boards'; autoTab = false; }
    }
    const page = !focus || focusTab === 'boards' ? null
      : focusTab === 'podium' ? podiumPage(t, st, best)
      : focusTab === 'groups'
        ? h('div', { class: 'focuspage stack', style: { zoom: String(planZoom) } },
          t.format === 'gko' ? h('div', { class: 'pagehint' }, 'Platz 1 und 2 kommen weiter') : null,
          h('div', { class: `groupgrid ${st.groups.length <= 1 ? 'gcols1' : st.groups.length <= 4 ? 'gcols2' : 'gcols3'}` }, st.groups.map((grp) => h('div', { class: 'card groupcard' },
            st.groups.length > 1 ? h('div', { class: 'grouphead' }, h('b', {}, grp.name), h('span', { class: 'small dim' }, grp.done ? 'fertig ✓' : `${grp.games.filter((g) => g.status === 'done').length} / ${grp.games.length} Spiele`)) : null,
            groupTable(t, grp, !!t.ko)))))
        : h('div', { class: 'focuspage stack', style: { zoom: String(planZoom) } }, bracket(t, st, { boardOf }));
    const tabBar = focus && tabs.length > 1 ? h('div', { class: 'focustabs' }, tabs.map(([k, label]) => h('button', {
      class: `toolbtn ${focusTab === k ? 'on' : ''}`, onclick: () => { focusTab = k; autoTab = false; manualUntil = Date.now() + 60000; window.scrollTo(0, 0); draw(); },
    }, label))) : null;

    const focusBtn = tool('🎯', focus ? 'Fokus beenden: alles wieder zeigen' : 'Fokus: nur Uhr, Boards und das Wichtigste', () => { updateSettings({ tourFocus: !focus }); draw(); }, focus);
    const tvBtn = tool(tv ? '✕' : '📺', tv ? 'Fernseher-Ansicht beenden' : 'Fernseher-Ansicht', () => {
      tv = !tv; body.classList.toggle('tv', tv);
      if (tv && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      if (!tv && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      draw();
    });
    const rotateBtn = tabs.length > 1 ? tool('🔄', s.tourRotate !== false ? 'Automatischer Seitenwechsel in Pausen: an' : 'Automatischer Seitenwechsel: aus',
      () => { updateSettings({ tourRotate: s.tourRotate === false }); toast(getSettings().tourRotate ? '🔄 Seiten wechseln in Pausen automatisch' : 'Seiten wechseln nur von Hand'); draw(); }, s.tourRotate !== false) : null;
    const fullBtn = tool('⛶', 'Vollbild (Esc beendet)', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Vollbild nicht möglich – F11 drücken.'));
    });
    const zoomCtl = h('div', { class: 'boardctl' },
      h('button', { class: 'toolbtn', title: 'Alles kleiner', onclick: () => setZoom(ZK, -0.1, 0.8, 1.6) }, 'A−'),
      h('span', { class: 'num small' }, pct(zoom)),
      h('button', { class: 'toolbtn', title: 'Alles größer', onclick: () => setZoom(ZK, 0.1, 0.8, 1.6) }, 'A+'));
    body.classList.toggle('focus', focus);
    body.classList.toggle('onerow', focus && n <= boardCols); // nur eine Reihe Boards (z. B. 2): Boards begrenzen, unten mehr Platz
    body.replaceChildren(
      h('div', { class: 'livehead' },
        tv || focus ? null : h('button', { class: 'iconbtn', title: 'Zur Turnier-Seite', onclick: () => nav.go('tournament', { id: t.id }) }, '‹'),
        h('div', { class: 'livetitle' }, h('h1', {}, t.name),
          focus ? h('div', { class: 'dim' }, phase) : h('div', { class: 'dim' }, `${phase} · ${played} / ${total} Spiele`, eta ? ` · ⏱️ Ende ca. ${fmtClock(eta.at)} (noch ~${eta.minutes >= 60 ? `${Math.floor(eta.minutes / 60)} Std. ${eta.minutes % 60} Min.` : `${eta.minutes} Min.`})` : ''),
          focus ? null : h('div', { class: 'liveprog' }, h('i', { style: { width: `${total ? Math.round((played / total) * 100) : 0}%` } }))),
        // Uhr und darunter die Turnierlaufzeit (ab dem ersten begonnenen Spiel), ggf. mit geschätztem Ende
        h('div', { class: 'liveclockbox' },
          h('div', { class: 'liveclock num' }, fmtClock(Date.now())),
          h('div', { class: 'liveruntime num' }, (() => {
            const starts = matches.filter((m) => m.tournament && m.tournament.id === t.id && m.status !== 'aborted' && m.createdAt).map((m) => m.createdAt);
            if (!starts.length) return 'Turnier startet gleich';
            const end = st.done ? Math.max(...matches.filter((m) => m.tournament && m.tournament.id === t.id && m.status === 'finished').map((m) => m.updatedAt || m.createdAt)) : Date.now();
            const min = Math.max(0, Math.floor((end - Math.min(...starts)) / 60000));
            return `Turnier ${st.done ? 'dauerte' : 'läuft'} ${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std.${eta ? ` · Ende ca. ${fmtClock(eta.at)}` : ''}`;
          })())),
        // Leiste: Größe, Boards −/＋, Ton, QR-Codes, Bereiche, Fokus, Einstellungen, Fernseher (im Fokus nur Fokus und Fernseher)
        // Fernseher-Fenster: Seiten, Größe, Wechsel, Vollbild. Fokus am Laptop: dazu 🎯 (zurück zu allen Knöpfen) und 📺
        viewer ? h('div', { class: 'toolbar' }, tabBar, zoomCtl, rotateBtn, fullBtn)
        : focus ? h('div', { class: 'toolbar' }, tabBar, zoomCtl, rotateBtn, focusBtn, tvBtn) : h('div', { class: 'toolbar' },
          zoomCtl,
          // Größe nur der Bereiche unter den Boards und des Turnierbaums
          h('div', { class: 'boardctl', title: 'Größe der Bereiche unter den Boards und des Turnierbaums' },
            h('button', { class: 'toolbtn', title: 'Bereiche kleiner', onclick: () => setZoom(PZK, -0.1, 0.7, 2) }, '−'),
            h('span', { class: 'num small' }, `📋 ${pct(planZoom)}`),
            h('button', { class: 'toolbtn', title: 'Bereiche größer', onclick: () => setZoom(PZK, 0.1, 0.7, 2) }, '＋')),
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
          tool('👁', 'Bereiche ein- und ausblenden', showSections),
          focusBtn,
          tool('🛠️', 'Turnier steuern: anhalten, Spieler gibt auf', controlMenu, !!(t.pausedUntil && t.pausedUntil > Date.now())),
          tool('🖥️', 'Fernseher: zweiter Bildschirm, anderes Gerät oder nur dieser Laptop', screenMenu),
          tool('⚙️', 'Einstellungen der Live-Ansicht', liveSettings),
          tvBtn)),
      // Boards groß oben; Turnierbaum/Tabellen auf breiten Bildschirmen rechts daneben, sonst darunter
      page ? h('div', { class: 'livegrid pagegrid' }, page) : h('div', { class: `livegrid ${planSide ? 'plan-auto' : ''}` }, main, side),
      tv || focus ? null : h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: () => exportFile(t, matches) }, '📤 Abgleich-Datei für alle'),
      // Live-Turnier beenden: online löschen bzw. den Turnier-Server leeren (die Spiele bleiben auf diesem PC)
      tv || focus ? null : h('button', {
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
      tv || focus ? null : h('p', { class: 'small dim' }, 'Freie Boards bekommen automatisch das nächste Spiel, mit Ansage (Lautsprecher am PC an). Tipp auf ein belegtes Board: Aufruf zurücknehmen oder Ergebnis eintragen, falls ein Handy ausfällt. Oben: A− / A+ Größe, − / ＋ Boards, 🔊 Ansagen, QR-Codes, 👁 Bereiche, 🎯 Fokus, ⚙️ Einstellungen, 📺 Fernseher.'),
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

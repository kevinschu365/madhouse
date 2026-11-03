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
import { say as appSay, unlock, availableVoices } from '../../audio/speech.js';
import { BRAND, APP_VERSION } from '../../config.js';
import { SYNC_FORMAT } from '../../core/sync.js';
import { getTournaments, saveTournament, tournamentState, boardStatus, planCalls, upcomingQueue, matchTag, pickWriter, highlightsOf, scheduleEstimate, forecast, resolvedRules, formatFor, formatText, gameMinutes, withLog, plannedPauseStart, TOURNAMENT_FORMATS, TIEBREAK_TEXT } from '../../core/tournament.js';
import { exportSheet } from '../tourExport.js';
import { liveServer, liveState, postTournament, postMatch, boardUrl, baseUrl, presenceTracker, endLive, withoutKicked, deviceId, deviceName } from '../../core/live.js';
import { handoverSheet } from '../handover.js';
import { showCode } from '../../core/cloud.js';
import { planView, champCard, nameOf, liveScore, groupTable, bracket } from '../tournamentView.js';
import { confetti } from '../celebrate.js';
import { offerSync } from '../syncUi.js';
import { qrSvg } from '../qr.js';

// Ansagen der Turnierleitung mit eigener Lautstärke, Stimme und Tempo (⚙️ › Ton), sonst wie in der App
const say = (text, o = {}) => {
  const s = getSettings();
  return appSay(text, { ...o, volume: s.tourVolume ?? 1, voiceURI: s.tourVoiceURI || null, rate: s.tourRate || null, ignoreQuiet: true });
};

/** Offene Rufe der Board-Handys (🙋), die die Turnierleitung noch nicht bestätigt hat (t.helpAck). */
const helpCalls = (pres, t) => Object.values(pres || {}).filter((p) => p && p.help && !p.left && ((t.helpAck || {})[p.board] || 0) < p.help);

const qrCache = new Map(); // die Ansicht wird alle 2 Sekunden neu gezeichnet – QR-Codes nur einmal berechnen
const qrFor = (text) => qrCache.get(text) || qrCache.set(text, qrSvg(text, 150)).get(text);

// Zeiten oben im Fokus/Fernseher, einzeln an/aus. Einstellung: true/undefined = alle, false = keine (bis 1.35.0),
// sonst { run, groups, final, end } – fehlender Schlüssel = an
const TIMES = [['run', '⏱ Läuft'], ['groups', '👥 Gruppen fertig'], ['final', '🏆 Finale'], ['end', '🏁 Ende']];
// Kacheln oben in der Turnierleitung (⚙️ › Ansicht), einzeln an/aus – gleiche Logik wie die Zeiten
const HEAD = [['prog', '🎯 Spiele'], ['boards', '🎯 Boards'], ['next', '📣 Nächster Aufruf'], ['planned', '☕ Pause geplant'], ...TIMES];
const timeOn = (cfg, k) => cfg !== false && !(cfg && cfg[k] === false);
/** Kleine Punkte zum Antippen, je Kachel einer. onChange bekommt die neue Einstellung (Objekt). */
const dotPicker = (list, cfg, onChange) => h('div', { class: 'timedots' }, list.map(([k, label]) => h('button', {
  class: `timedot ${timeOn(cfg, k) ? 'on' : ''}`,
  onclick: () => onChange({ ...Object.fromEntries(list.map(([x]) => [x, timeOn(cfg, x)])), [k]: !timeOn(cfg, k) }),
}, h('i'), label)));
const timePicker = (cfg, onChange) => dotPicker(TIMES, cfg, onChange);

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
  let viewer = !!params.viewer;
  // Nur eine Turnierleitung (Online): t.leader = { id, device } – wer nicht führt, zeigt nur an (wie der Fernseher).
  // claim: Leitung übernehmen (Start über „?leitung=…“ / „Turnierleitung übernehmen“ oder „Leitung zurückholen“)
  let claim = !!params.takeover;
  let passive = false;
  let autoTab = false;        // Seite wurde vom automatischen Wechsel gesetzt (nicht von Hand)
  let manualUntil = 0;        // nach einem Klick auf eine Seite 60 Sekunden nicht automatisch wechseln
  let podiumShown = false;    // Siegerehrung schon einmal von selbst gezeigt
  let pauseWas = 0;           // Ende der zuletzt gesehenen Pause (für „Es geht weiter“)
  let qrOpen = null;          // QR-Codes: null = automatisch, sonst von Hand ein/aus
  let openPanel = null;       // aufgeklappte Kachel unter der Beitreten-Zeile: 'phones' | 'pause' | 'call' | null
  let seenCalls = null;       // schon groß eingeblendete Aufrufe (Fokus und Fernseher)
  let seenCeremony = null;    // zuletzt gestartete Siegerehrung (t.ceremony.at)
  let focusTab = 'boards';    // Fokus-Seite: 'boards' | 'groups' | 'ko' | 'results' | 'podium' (⚙️ › Ansicht oder automatisch)
  let curTabs = [];           // die Fokus-Seiten, die es gerade gibt (für ⚙️ › Ansicht)
  let tvWin = null;           // auf diesem PC geöffnetes Fernseher-Fenster (🖥️ zeigt dann gleich die Steuerung)
  // Felder der Pause-Karte bleiben dieselben Elemente – die Ansicht zeichnet alle 2 s neu, Eingaben gehen so nicht verloren
  const pauseReasonIn = h('input', { type: 'text', placeholder: 'Grund (optional), z. B. Essenspause', maxlength: 40 });
  const pauseTimeIn = h('input', { type: 'time', title: 'Bis Uhrzeit' });
  const startTimeIn = h('input', { type: 'time', title: 'Startzeit' });
  const callPlayerSel = h('select', {});
  const callGameSel = h('select', {});
  const callTextIn = h('input', { type: 'text', placeholder: 'Eigene Durchsage, z. B. „Essen ist fertig“', maxlength: 80 });
  const planEndIn = h('input', { type: 'time', title: 'Geplantes Ende' });
  const keepFields = [pauseReasonIn, pauseTimeIn, startTimeIn, callPlayerSel, callGameSel, callTextIn, planEndIn];
  let info = null;
  let last = null;            // letzter Stand { t, st, matches, plan, presence }
  const saved = new Map();    // Match-Id -> updatedAt, schon in die eigene Statistik übernommen
  const said = new Set();     // schon angesagt (Aufrufe, Pausen, Sieger, Verspätungen)
  let seenHighlights = null;  // beim ersten Laden alte Highlights nicht nachholen
  let seenLeft = null;        // schon gesehene Abmeldungen der Board-Handys („Board freigeben“)
  let seenNotice = null;      // zuletzt gezeigte Durchsage (t.notice) – auch im Fernseher-Fenster einblenden
  let ticker = [];            // alle Highlights des Turniers, neueste zuerst (Fokus-Reiter „🏁 Ergebnisse“)
  let bestPage = -1;          // zuletzt gezeigte Seite der Bestwert-Karten (Durchlauf)
  const presence = presenceTracker(); // welche Boards gerade ein Handy haben
  const flashQueue = [];
  // Fernseher-Fenster: Doppelklick schaltet Vollbild um (oben gibt es dort keine Knöpfe)
  const dbl = () => {
    if (!viewer) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  };
  document.addEventListener('dblclick', dbl);
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
      if (it.say && !viewer && getSettings().tourSound) say(it.say, { interrupt: true });
      if (it.confetti) confetti(4000);
      if (it.after) it.after();
      flash.replaceChildren(h('div', { class: `hilitebox k${it.kind}` },
        it.title ? h('div', { class: 'hilitetitle' }, it.title) : null,
        h('div', { class: 'hilitetext' }, it.text),
        it.sub ? h('div', { class: 'hilitesub' }, it.sub) : it.board ? h('div', { class: 'hilitesub' }, `Board ${it.board}`) : null));
      flash.classList.remove('hidden');
      if (it.speech && !viewer && getSettings().tourSound && getSettings().tourHighlightSpeech) say(it.speech + (it.board ? ` An Board ${it.board}.` : ''));
      if (it.kind === '180' || it.kind === 'finish' || it.kind === 'nine') confetti(1800, 80);
      // Aufrufe und Durchsagen länger stehen lassen (man muss sie aus der Entfernung lesen können)
      setTimeout(next, it.ms || (it.kind === 'call' || it.kind === 'msg' ? 9000 : 5500));
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
    if (!params.viewer && info && info.cloud) {
      const me = deviceId();
      if (claim || !t.leader) {
        t = { ...t, leader: { id: me, device: deviceName(), at: Date.now() } };
        claim = false;
        try { await postTournament(t); } catch { /* nächster Durchlauf */ }
      }
      passive = t.leader.id !== me;
      viewer = passive;
    }

    // Fertige Spiele in die eigene Statistik übernehmen (PC-Speicher; nicht im Fernseher-Fenster).
    // Unentschieden (am PC gewertet) haben keinen Sieger und keine Würfe – die bleiben nur im Turnier.
    for (const m of viewer ? [] : matches) {
      if (m.status !== 'finished' || saved.get(m.id) === m.updatedAt || (m.manualResult && (m.manualResult.draw || m.manualResult.walkover)) || (t.stopped || {})[m.id]) continue;
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
        // erledigt, sobald sich genau dieses Handy abgemeldet hat – spätestens nach 10 Minuten (Handy ganz weg)
        if ((p && p.left && p.id === id) || Date.now() - ((t.kickAt || {})[b] || 0) > 10 * 60000) delete kick[b];
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
    // Nicht da (t.absent) seit mehr als ⚙️ „Abwesend → kampflos“ Minuten: sein nächstes Spiel geht kampflos an den
    // Gegner, danach läuft die Zeit für das nächste Spiel neu. Höchstens ein Spiel je Durchlauf.
    const woMin = s.tourAbsentWo || 0;
    if (!viewer && woMin) {
      for (const [id, at] of Object.entries(t.absent || {})) {
        if (Date.now() - at < woMin * 60000 || (t.withdrawn || {})[id]) continue;
        const g = nextGameOf(t, st, id);
        if (!g) continue;
        const opp = g.a === id ? g.b : g.a;
        if (await walkover(t, st, g, id, `⏱ Kampflos (${nameOf(t, id)} seit ${woMin} Min. nicht da)`, { absent: { ...t.absent, [id]: Date.now() } })) {
          announce(`wo:${g.key}`, `${nameOf(t, id)} ist nicht da. Das Spiel gegen ${nameOf(t, opp)} geht kampflos an ${nameOf(t, opp)}.`);
        }
        return;
      }
    }
    // Protokoll: neue und geänderte Ergebnisse eintragen (kampflose nicht – die Aufgabe selbst steht schon drin)
    let dirty = false;
    if (!viewer) {
      const refs = new Set((t.log || []).filter((e) => e.kind === 'result').map((e) => e.ref));
      const keys = new Set([...refs].map((r) => String(r).split('|')[0]));
      for (const g of st.games) {
        if (g.status !== 'done' || g.bye || !g.result || g.result.walkover) continue;
        const ref = `${g.key}|${g.score}`;
        if (refs.has(ref)) continue;
        const changed = keys.has(g.key);
        const how = g.match && g.match.manualResult ? 'am PC eingetragen' : 'am Board';
        t = withLog(t, `${changed ? '✏️ Ergebnis geändert' : '🏁 Ergebnis'}: ${nameOf(t, g.a)} ${g.score} ${nameOf(t, g.b)} · ${g.roundName} (${how})`,
          { kind: 'result', ref, at: changed ? Date.now() : g.result.at || Date.now(), undo: g.match ? { op: 'result', key: g.key, matchId: g.match.id } : null });
        refs.add(ref); keys.add(g.key);
        dirty = true;
      }
      // 🗓️ Geplante Pause ist dran: jetzt starten (laufende Spiele werden zu Ende gespielt)
      const pp = t.plannedPause;
      const ppStart = plannedPauseStart(t);
      if (ppStart) {
        t = { ...t, ...ppStart };
        if (ppStart.pausedUntil) t = withLog(t, `☕ Geplante Pause beginnt – bis ${fmtClock(ppStart.pausedUntil)} Uhr${pp.reason ? ` – ${pp.reason}` : ''}`, { undo: { op: 'pause' } });
        dirty = true;
      }
    }
    // Geplante Pause: 5 Minuten vorher ansagen
    if (t.plannedPause && t.plannedPause.at - Date.now() < 5 * 60000 && t.plannedPause.at > Date.now()) {
      const pp = t.plannedPause;
      announce(`ppsoon:${pp.at}`, `In ${Math.max(1, Math.round((pp.at - Date.now()) / 60000))} Minuten ist Pause${pp.reason ? `: ${pp.reason}` : ''}, bis ${fmtClock(pp.at + pp.min * 60000)} Uhr.`);
    }
    // Freie Boards sofort mit dem nächsten Spiel belegen und ansagen (je nach Einstellung nur mit angemeldetem Handy)
    presence.update(pres); // Anwesenheit nach eigener Uhr (siehe core/live.js)
    // 🙋 Ein Board-Handy ruft die Turnierleitung: einmal ansagen (Hinweis oben, bestätigen mit „Bin unterwegs“)
    for (const p of helpCalls(pres, t)) announce(`help:${p.board}:${p.help}`, `Board ${p.board} ruft die Turnierleitung.`);
    const plan = planCalls(t, st, Date.now(), { boards: s.tourOnlyConnected ? presence.connected() : null, rest: (s.tourRest || 0) * 60000, gap: (s.tourBoardGap || 0) * 60000, beforePause: s.tourBeforePause !== false });
    // Pause ist eben zu Ende: „Es geht weiter“ – vor den Aufrufen (abschaltbar unter ⚙️ › Ablauf)
    if (pauseWas && !plan.manualPause) { // abgelaufen oder vorzeitig beendet
      if (s.tourPauseEndCalls !== false) announce(`resume:${pauseWas}`, 'Die Pause ist vorbei. Es geht weiter!');
      pauseWas = 0;
    }
    if ((plan.calls.length || dirty) && !viewer) {
      t = { ...t, calls: { ...(t.calls || {}) } };
      const busy = new Set();
      for (const b of boardStatus(t, st)) if (b.game) { busy.add(b.game.a); busy.add(b.game.b); }
      for (const c of plan.calls) { busy.add(c.game.a); busy.add(c.game.b); }
      for (const c of plan.calls) {
        const writer = s.tourWriter ? pickWriter(t, st, c.board, c.game, busy) : null;
        if (writer) busy.add(writer);
        t.calls[c.game.key] = { board: c.board, at: Date.now(), writer };
        callOut(`call:${c.game.key}`, c.board, c.game, writer, t);
      }
      // ein zurückgestelltes Spiel ist wieder aufgerufen: aus „Später spielen“ streichen
      if (plan.calls.some((c) => (t.defer || {})[c.game.key])) {
        const defer = { ...t.defer };
        for (const c of plan.calls) delete defer[c.game.key];
        t = { ...t, defer };
      }
      try { await postTournament(t); } catch { /* nächster Durchlauf versucht es erneut */ }
      st = tournamentState(t, matches);
    }
    if (!viewer) saveTournament(t); // Kopie am PC (Turnierliste, Statistik)

    // Highlights: neue 180er, Finishes ab 100 und Short Legs (beim ersten Laden nur merken, nicht nachholen)
    const boards = boardStatus(t, st);
    const hl = matches.filter((m) => m.tournament && m.tournament.id === t.id && m.status !== 'aborted' && !(t.stopped || {})[m.id])
      .flatMap((m) => highlightsOf(m).map((x) => ({ ...x, board: boards.find((b) => b.game && b.game.match && b.game.match.id === m.id)?.board || null })));
    ticker = hl.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    // Durchsage der Turnierleitung (t.notice): auf allen Bildschirmen groß einblenden
    // Neue Aufrufe groß einblenden – im Fokus und im Fernseher-Fenster (dort hört man die Ansage oft nicht)
    const callNow = Object.entries(t.calls || {}).map(([key, c]) => ({ key, c, id: `${key}@${c.at}@${c.board}` }));
    if (!seenCalls) seenCalls = new Set(callNow.map((x) => x.id));
    for (const x of callNow) {
      if (seenCalls.has(x.id)) continue;
      seenCalls.add(x.id);
      const g = st.games.find((y) => y.key === x.key);
      if (!g || g.status !== 'ready' || !(viewer || s.tourFocus)) continue;
      showFlash({ kind: 'call', title: `📣 Aufruf · Board ${x.c.board}`, text: `${nameOf(t, g.a)} – ${nameOf(t, g.b)}`, sub: `${g.roundName}${x.c.writer ? ` · Schreiber: ${nameOf(t, x.c.writer)}` : ''}`, speech: '' });
    }
    // 🏆 Siegerehrung (Knopf an der Turnierleitung, t.ceremony): Platz 3, 2, 1 nacheinander groß – auf allen Bildschirmen
    if (seenCeremony === null) seenCeremony = t.ceremony ? t.ceremony.at : 0;
    if (t.ceremony && t.ceremony.at !== seenCeremony && st.done && st.champion) {
      seenCeremony = t.ceremony.at;
      const p = podiumOf(t, st);
      const names = (ids) => ids.filter(Boolean).map((id) => nameOf(t, id)).join(' und ');
      if (p.third.length) showFlash({ kind: 'ceremony', title: '🥉 Platz 3', text: names(p.third), say: `Platz 3: ${names(p.third)}.`, ms: 7000 });
      if (p.second) showFlash({ kind: 'ceremony', title: '🥈 Platz 2', text: names([p.second]), say: `Platz 2: ${names([p.second])}.`, ms: 7000 });
      showFlash({ kind: 'ceremony', title: `🏆 Turniersieger · ${t.name}`, text: names([p.first]), say: `Und der Turniersieger ist: ${names([p.first])}! Herzlichen Glückwunsch!`, confetti: true, ms: 10000,
        after: () => { focusTab = 'podium'; autoTab = false; manualUntil = Date.now() + 5 * 60000; } });
    }
    if (seenNotice === null) seenNotice = t.notice ? t.notice.at : 0;
    if (t.notice && t.notice.at !== seenNotice) { seenNotice = t.notice.at; showFlash({ kind: 'msg', text: `📣 ${t.notice.text}`, speech: '' }); }
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
      const why = plan.manualPause && t.pauseReason ? `${t.pauseReason}. ` : 'Pause. ';
      const isStart = plan.manualPause && t.startAt && t.startAt === t.pausedUntil;
      announce(`pause:${plan.pauseUntil}`, isStart ? `Das Turnier beginnt um ${fmtClock(plan.pauseUntil)} Uhr.` : `${why}Es geht in ${minutes} Minuten weiter, um ${fmtClock(plan.pauseUntil)} Uhr.`);
      // eine Minute vorher erinnern (nur wenn die Pause länger als 2 Minuten war) – auf Wunsch mit den ersten Spielen
      if (plan.pauseUntil - Date.now() < 60000 && minutes >= 1 && said.has(`pause:${plan.pauseUntil}`)) {
        const first = s.tourPauseEndCalls !== false ? upcomingQueue(t, st).slice(0, t.boards || 1) : [];
        const firstText = first.length ? ` Als Erstes: ${first.map((g) => `${nameOf(t, g.a)} gegen ${nameOf(t, g.b)}`).join(', ')}.` : '';
        announce(`pauseend:${plan.pauseUntil}`, (isStart ? 'In einer Minute geht es los. Bitte an die Boards.' : 'In einer Minute geht es weiter. Bitte zurück an die Boards.') + firstText);
      }
      if (plan.manualPause) pauseWas = plan.pauseUntil;
    }
    if (st.done && st.champion && !said.has('champ')) {
      announce('champ', `Turniersieger: ${nameOf(t, st.champion)}! Herzlichen Glückwunsch!`);
      confetti(4000);
    }
    last = { t, st, matches, plan, raw: pres };
    draw();
    // Ein anderes Gerät führt: Hinweis oben, Leitung jederzeit zurückholbar
    if (passive) {
      body.prepend(h('div', { class: 'card passivebar' },
        h('span', {}, `🖥️ Die Turnierleitung läuft auf einem anderen Gerät (${(t.leader && t.leader.device) || 'Gerät'}). Hier wird nur angezeigt.`),
        h('button', { class: 'btn small', onclick: () => { claim = true; tick(); } }, 'Leitung zurückholen')));
    }
  }

  // ---------- Aktionen der Turnierleitung ----------

  /** Aufruf ansagen (je nach Einstellung zweimal, für laute Räume). */
  function callOut(key, board, g, writer, t, prefix = '') {
    const text = `${prefix}Board ${board}: ${nameOf(t, g.a)} gegen ${nameOf(t, g.b)}.${writer ? ` Schreiber: ${nameOf(t, writer)}.` : ''}`;
    announce(key, getSettings().tourCallTwice ? `${text} Ich wiederhole: ${text}` : text);
  }

  /** Turnier mit Protokoll-Eintrag senden und neu zeichnen. Gibt false zurück, wenn das Senden scheitert. */
  async function commit(t, text, opts = {}) {
    const next = text ? withLog(t, text, opts) : t;
    try { await postTournament(next); } catch (e) { toast(e.message); return false; }
    tick();
    return true;
  }

  /** Grenze für „läuft ungewöhnlich lange“ in Minuten (0 = aus): Auto = doppelte übliche Dauer, mindestens 15. */
  const staleMinutes = (t, g) => {
    const v = getSettings().tourStaleMin ?? 'auto';
    if (v === 0) return 0;
    if (v !== 'auto') return +v;
    const f = formatFor(t, g);
    return Math.max(15, 2 * gameMinutes(f.legsBestOf, f.setsBestOf));
  };

  /** 📣 Durchsage: am PC ansagen und auf allen Bildschirmen (auch Fernseher) einblenden. */
  async function broadcast(text) {
    if (!text || !last) return;
    unlock();
    say(text, { interrupt: true });
    await commit({ ...last.t, notice: { text, at: Date.now() } }, `📣 Durchsage: ${text}`, { kind: 'notice' });
  }

  /**
   * 📣 Aufruf-Kachel: Spieler rufen (an sein Board bzw. zur Turnierleitung), ein Spiel ausrufen (an einem Board nochmal,
   * aus der Warteschlange „bitte bereithalten“) oder eine eigene Durchsage. Alles wird am PC angesagt und auf allen
   * Bildschirmen groß eingeblendet (t.notice).
   */
  function callPanel(t, st) {
    const boards = boardStatus(t, st);
    const queue = upcomingQueue(t, st).slice(0, 8);
    const keep = (sel, opts) => {
      const v = sel.value;
      sel.replaceChildren(...opts.map(([val, label]) => h('option', { value: val }, label)));
      if (opts.some(([val]) => val === v)) sel.value = v;
    };
    const active = t.players.filter((id) => !(t.withdrawn || {})[id]).sort((a, b) => nameOf(t, a).localeCompare(nameOf(t, b), 'de'));
    keep(callPlayerSel, [['', 'Spieler wählen …'], ...active.map((id) => [id, nameOf(t, id)])]);
    keep(callGameSel, [['', 'Spiel wählen …'],
      ...boards.filter((b) => b.game).map((b) => [`b:${b.board}`, `Board ${b.board}: ${nameOf(t, b.game.a)} – ${nameOf(t, b.game.b)}${b.game.status === 'running' ? ' (läuft)' : ''}`]),
      ...queue.map((g, i) => [`q:${g.key}`, `Als Nächstes ${i + 1}: ${nameOf(t, g.a)} – ${nameOf(t, g.b)}`])]);
    const callPlayer = () => {
      const id = callPlayerSel.value;
      if (!id) { toast('Bitte einen Spieler wählen.'); return; }
      const b = boards.find((x) => x.game && (x.game.a === id || x.game.b === id));
      const w = boards.find((x) => x.game && x.writer === id);
      callPlayerSel.blur();
      broadcast(b ? `${nameOf(t, id)}, bitte an Board ${b.board}.` : w ? `${nameOf(t, id)}, bitte zum Schreiben an Board ${w.board}.` : `${nameOf(t, id)}, bitte zur Turnierleitung.`);
    };
    const callGame = () => {
      const v = callGameSel.value;
      if (!v) { toast('Bitte ein Spiel wählen.'); return; }
      callGameSel.blur();
      if (v.startsWith('b:')) {
        const b = boards.find((x) => x.board === +v.slice(2));
        if (b && b.game) broadcast(`Board ${b.board}: ${nameOf(t, b.game.a)} gegen ${nameOf(t, b.game.b)}.${b.writer ? ` Schreiber: ${nameOf(t, b.writer)}.` : ''}`);
      } else {
        const g = queue.find((x) => x.key === v.slice(2));
        if (g) broadcast(`Bitte bereithalten: ${nameOf(t, g.a)} gegen ${nameOf(t, g.b)}. Ihr seid gleich dran.`);
      }
    };
    const callText = () => { const v = callTextIn.value.trim(); if (!v) return; callTextIn.blur(); callTextIn.value = ''; broadcast(v); };
    return h('div', { class: 'card callpanel' },
      h('div', { class: 'small dim' }, 'Wird am PC angesagt und auf allen Bildschirmen groß eingeblendet – auch auf dem Fernseher.'),
      h('div', { class: 'cprow' }, h('span', { class: 'cplabel' }, '🙋 Spieler'), callPlayerSel, h('button', { class: 'btn small', onclick: callPlayer }, '📣 Rufen')),
      h('div', { class: 'cprow' }, h('span', { class: 'cplabel' }, '🎯 Spiel'), callGameSel, h('button', { class: 'btn small', onclick: callGame }, '📣 Ausrufen')),
      h('div', { class: 'cprow' }, h('span', { class: 'cplabel' }, '💬 Text'), callTextIn, h('button', { class: 'btn small', onclick: callText }, '📣 Durchsage')),
      h('div', { class: 'chips' }, ['Alle Spieler bitte zur Turnierleitung.', 'Die nächste Runde beginnt gleich.', 'Bitte die Boards freihalten.'].map((txt) => h('button', { class: 'chip', onclick: () => broadcast(txt) }, txt))));
  }

  /**
   * ☕ Pause einlegen: Dauer oder Uhrzeit, optional ein Grund (erscheint im Banner und in der Ansage).
   * Laufende Spiele werden zu Ende gespielt, danach wird bis zur Zeit nichts aufgerufen. Fokus und Fernseher
   * zeigen ein großes Banner mit Uhrzeit und Countdown.
   */
  /** Pause bis ts beginnen bzw. neu setzen (why: Grund oder leer; undefined = bisherigen Grund behalten). */
  async function startPause(ts, why) {
    if (!(ts > Date.now())) { toast('Die Uhrzeit liegt in der Vergangenheit.'); return false; }
    const t = last.t;
    said.delete(`pause:${t.pausedUntil}`);
    const reason = why === undefined ? t.pauseReason || null : (why || '').trim() || null;
    const min = Math.round((ts - Date.now()) / 60000);
    const ok = await commit({ ...last.t, pausedUntil: ts, pauseReason: reason }, `☕ Pause bis ${fmtClock(ts)} Uhr (${min} Min.)${reason ? ` – ${reason}` : ''}`, { undo: { op: 'pause' } });
    if (ok) toast(`☕ Pause bis ${fmtClock(ts)} Uhr`);
    return ok;
  }
  /** 🗓️ Pause für später planen: beginnt um at, dauert min Minuten (startet von selbst, siehe tick). */
  async function planPause(at, min, why) {
    if (!(at > Date.now())) { toast('Die Uhrzeit liegt in der Vergangenheit.'); return false; }
    const reason = (why || '').trim() || null;
    const ok = await commit({ ...last.t, plannedPause: { at, min, reason } }, `🗓️ Pause geplant: ${fmtClock(at)}–${fmtClock(at + min * 60000)} Uhr${reason ? ` – ${reason}` : ''}`);
    if (ok) toast(`🗓️ Pause um ${fmtClock(at)} Uhr geplant (${min} Min.)`);
    return ok;
  }
  async function cancelPlanned() {
    await commit({ ...last.t, plannedPause: null }, '🗓️ Geplante Pause gestrichen');
    toast('Geplante Pause gestrichen');
  }
  async function endPause() {
    said.delete(`pause:${last.t.pausedUntil}`);
    // vorzeitig gestartet: auch die Startzeit löschen (sonst zählt die Startseite weiter herunter)
    const early = last.t.startAt && last.t.startAt > Date.now();
    await commit({ ...last.t, pausedUntil: 0, pauseReason: null, ...(early ? { startAt: null } : {}) }, early ? '🚀 Turnier gestartet' : '▶ Pause beendet – Turnier läuft weiter');
    toast('▶ Es geht weiter');
  }
  /** Uhrzeit „21:30“ -> Zeitpunkt heute (nach Mitternacht: morgen) oder null. */
  function timeToTs(value) {
    const [hh, mm] = (value || '').split(':').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) { toast('Bitte eine Uhrzeit wählen.'); return null; }
    const d = new Date(); d.setHours(hh, mm, 0, 0);
    if (d.getTime() < Date.now() - 60000) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  /**
   * ⏱ Zeitplan-Ampel (nur Turnierleitung): geplantes Ende (t.planEnd, sonst Start + „Zeit bis Turnierende“ vom Anlegen)
   * gegen die Prognose. { planEnd, fc, delta (ms, + = zu spät), level: 'ok'|'tight'|'late'|null }
   */
  function timeStatus(t, st, matches) {
    const fc = st.done ? null : scheduleEstimate(t, st);
    const starts = matches.filter((m) => m.tournament && m.tournament.id === t.id && m.createdAt && m.status !== 'aborted').map((m) => m.createdAt);
    const begin = starts.length ? Math.min(...starts) : t.startAt || null;
    const planEnd = t.planEnd || (t.timeLimit && begin ? begin + t.timeLimit * 60000 : null);
    if (!fc || !planEnd) return { planEnd, fc, delta: null, level: null };
    const delta = fc.at - planEnd;
    return { planEnd, fc, delta, level: delta <= 0 ? 'ok' : delta <= 15 * 60000 ? 'tight' : 'late' };
  }

  /** ⏱ Zeitplan-Karte: Plan setzen, Stand der Ampel, Vorschläge mit geschätzter Ersparnis (anwendbar). */
  function timePanel(t, st, matches) {
    const ts = timeStatus(t, st, matches);
    const R = resolvedRules(t.rules, t.legsBestOf);
    const mins = (ms) => Math.round(ms / 60000);
    const ideas = [];
    if (ts.fc) {
      const save = (t2) => { const f = forecast(t2, tournamentState(t2, matches)); return f ? ts.fc.at - f.at : 0; };
      if (t.boards < MAX_BOARDS) ideas.push({ text: '＋ 1 Board mehr', ms: save({ ...t, boards: t.boards + 1 }), apply: () => changeBoards(t, st, +1) });
      if (t.ko && R.ko > 1) ideas.push({ text: `K.-o.-Runden auf ${R.ko > 3 ? 'Best of 3' : '1 Leg'}`, ms: save({ ...t, rules: { ...R, ko: R.ko > 3 ? 3 : 1 } }), apply: () => setRules({ ...R, ko: R.ko > 3 ? 3 : 1 }, `K.-o.-Runden jetzt ${R.ko > 3 ? 'Best of 3' : '1 Leg'}`) });
      if (t.format !== 'ko' && !st.groupsDone && R.group > 1) ideas.push({ text: `Restliche Gruppenspiele auf ${R.group > 3 ? 'Best of 3' : '1 Leg'}`, ms: save({ ...t, rules: { ...R, group: R.group > 3 ? 3 : 1 } }), apply: () => setRules({ ...R, group: R.group > 3 ? 3 : 1 }, `Gruppenspiele jetzt ${R.group > 3 ? 'Best of 3' : '1 Leg'}`) });
      if (t.pauseMin) ideas.push({ text: `Pause vor dem K.-o. (${t.pauseMin} Min.) streichen`, ms: save({ ...t, pauseMin: 0 }), apply: () => commit({ ...last.t, pauseMin: 0 }, '⏱ Pause vor dem K.-o. gestrichen') });
    }
    const setPlan = async (v) => { if (v == null) return; planEndIn.blur(); await commit({ ...last.t, planEnd: v }, v ? `⏱ Geplantes Ende: ${fmtClock(v)} Uhr` : '⏱ Geplantes Ende entfernt'); };
    const lv = { ok: ['🟢', 'Im Plan'], tight: ['🟡', 'Knapp'], late: ['🔴', 'Zu spät'] }[ts.level] || ['⚪', 'Kein Plan'];
    return h('div', { class: `card timepanel ${ts.level || ''}` },
      h('div', { class: 'tphead' },
        h('div', { class: 'tplight' }, lv[0]),
        h('div', {},
          h('b', {}, ts.level ? `${lv[1]}: Ende ~${fmtClock(ts.fc.at)} Uhr, geplant ${fmtClock(ts.planEnd)} Uhr` : ts.fc ? `Ende ~${fmtClock(ts.fc.at)} Uhr – noch kein geplantes Ende` : 'Noch keine Prognose'),
          ts.level ? h('div', { class: 'small dim' }, ts.delta > 0 ? `${mins(ts.delta)} Min. hinter dem Plan` : `${mins(-ts.delta)} Min. Luft`) : null)),
      h('div', { class: 'ppuntil' }, h('span', { class: 'small dim' }, 'Geplantes Ende'), planEndIn, h('button', { class: 'chip', onclick: () => setPlan(timeToTs(planEndIn.value)) }, 'OK'),
        t.planEnd ? h('button', { class: 'chip', onclick: () => setPlan(0) }, 'entfernen') : null),
      ideas.length ? [h('b', {}, ts.level === 'late' || ts.level === 'tight' ? '💡 So holt ihr Zeit auf' : '💡 Falls es eng wird'),
        h('div', { class: 'stack', style: { gap: '6px' } }, ideas.filter((x) => x.ms > 60000).sort((a, b) => b.ms - a.ms).map((x) => h('div', { class: 'list-item' },
          h('span', { class: 'name' }, x.text, h('div', { class: 'small dim' }, `spart ca. ${mins(x.ms)} Min.`)),
          h('button', { class: 'chip', onclick: async () => { if (await confirmDialog(`${x.text}?`, `Spart nach der Prognose etwa ${mins(x.ms)} Minuten. Laufende Spiele bleiben, wie sie sind.`, { ok: 'Anwenden' })) x.apply(); } }, 'Anwenden'))))] : null,
      h('div', { class: 'small dim' }, 'Nur hier an der Turnierleitung sichtbar. Die Prognose rechnet mit dem bisherigen Tempo.'));
  }

  /** Legs je Runde während des Turniers ändern (gilt für Spiele, die noch nicht begonnen haben). */
  async function setRules(rules, text) {
    await commit({ ...last.t, rules }, `⏱ ${text}`);
    toast(`⏱ ${text}`);
  }

  /** Hat schon ein Spiel dieses Turniers begonnen? (vorher: Seite „Gleich geht's los“) */
  const startedOf = (t, matches) => matches.some((m) => m.tournament && m.tournament.id === t.id && m.status !== 'aborted' && !(t.stopped || {})[m.id]);

  /** 🚀 Turnierstart festlegen (vor dem ersten Spiel): bis dahin wird nichts aufgerufen, Fokus/Fernseher zählen herunter. */
  async function setStart(ts) {
    if (!ts) return;
    if (!(ts > Date.now())) { toast('Die Uhrzeit liegt in der Vergangenheit.'); return; }
    said.delete(`pause:${last.t.pausedUntil}`);
    // Schon aufgerufene, noch nicht begonnene Spiele zurücknehmen – zum Start werden sie neu (mit Ansage) aufgerufen
    const calls = { ...(last.t.calls || {}) };
    for (const [key] of Object.entries(calls)) {
      const g = last.st.games.find((x) => x.key === key);
      if (g && g.status === 'ready') { delete calls[key]; said.delete(`call:${key}`); said.delete(`late:${key}`); }
    }
    await commit({ ...last.t, calls, startAt: ts, pausedUntil: ts, pauseReason: 'Turnierstart' }, `🚀 Turnierstart um ${fmtClock(ts)} Uhr`, { undo: { op: 'pause' } });
    toast(`🚀 Start um ${fmtClock(ts)} Uhr`);
  }

  /** 🚀 Kachel „Gleich geht's los“ (nur vor dem ersten Spiel): Startzeit festlegen, verschieben oder sofort starten. */
  function startPanel(t) {
    const paused = t.pausedUntil && t.pausedUntil > Date.now();
    if (paused && t.startAt === t.pausedUntil) {
      const left = Math.max(1, Math.ceil((t.pausedUntil - Date.now()) / 60000));
      return h('div', { class: 'card pausepanel on' },
        h('div', { class: 'pphead' }, h('b', {}, `🚀 Turnierstart um ${fmtClock(t.pausedUntil)} Uhr`), h('span', { class: 'small dim' }, `noch ${left} Min. – Fokus und Fernseher zeigen „Gleich geht's los“ mit Countdown`)),
        h('div', { class: 'chips' },
          [5, 10].map((min) => h('button', { class: 'chip', onclick: () => setStart(t.pausedUntil + min * 60000) }, `＋${min} Min.`)),
          h('button', { class: 'chip on', onclick: endPause }, '▶ Jetzt starten')));
    }
    const go = (ts) => { startTimeIn.blur(); setStart(ts); };
    return h('div', { class: 'card pausepanel' },
      h('div', { class: 'pphead' }, h('b', {}, '🚀 Gleich geht\'s los'), h('span', { class: 'small dim' }, 'Noch läuft kein Spiel. Mit Startzeit zeigen Fokus und Fernseher „Gleich geht\'s los“ mit Countdown, vorher wird nichts aufgerufen. Ohne Startzeit geht es sofort los.')),
      h('div', { class: 'pprow' },
        h('div', { class: 'chips' }, [5, 10, 15, 30].map((min) => h('button', { class: 'chip', onclick: () => go(Date.now() + min * 60000) }, `in ${min}′`))),
        h('div', { class: 'ppuntil' }, h('span', { class: 'small dim' }, 'oder um'), startTimeIn, h('button', { class: 'chip', onclick: () => go(timeToTs(startTimeIn.value)) }, 'OK'))));
  }

  /** ☕ Pause-Karte der Turnierleitung: Grund, Dauer oder Uhrzeit – bzw. bei laufender Pause verlängern/beenden. */
  function pausePanel(t) {
    const paused = t.pausedUntil && t.pausedUntil > Date.now();
    if (paused) {
      const left = Math.max(1, Math.ceil((t.pausedUntil - Date.now()) / 60000));
      return h('div', { class: 'card pausepanel on' },
        h('div', { class: 'pphead' }, h('b', {}, `☕ ${t.pauseReason || 'Pause'} bis ${fmtClock(t.pausedUntil)} Uhr`), h('span', { class: 'small dim' }, `noch ${left} Min.`)),
        h('div', { class: 'chips' },
          [5, 10, 15].map((min) => h('button', { class: 'chip', onclick: () => startPause(t.pausedUntil + min * 60000) }, `＋${min} Min.`)),
          h('button', { class: 'chip on', onclick: endPause }, '▶ Pause beenden')));
    }
    const go = async (ts) => {
      if (!ts) return;
      pauseReasonIn.blur(); pauseTimeIn.blur(); // sonst bleibt die Ansicht beim alten Stand stehen (siehe draw)
      if (await startPause(ts, pauseReasonIn.value)) { pauseReasonIn.value = ''; pauseTimeIn.value = ''; draw(); }
    };
    const pp = t.plannedPause;
    return h('div', { class: 'card pausepanel' },
      h('div', { class: 'pphead' }, h('b', {}, '☕ Pause'), h('span', { class: 'small dim' }, 'Laufende Spiele werden zu Ende gespielt, danach wird bis zum Ende nichts aufgerufen.')),
      // 🗓️ geplante Pause bzw. Knopf zum Planen
      h('div', { class: 'planned' },
        h('span', {}, pp ? `🗓️ Geplant: ${fmtClock(pp.at)}–${fmtClock(pp.at + pp.min * 60000)} Uhr${pp.reason ? ` · ${pp.reason}` : ''} (in ${Math.max(1, Math.ceil((pp.at - Date.now()) / 60000))} Min.)` : '🗓️ Pause für später festlegen (z. B. in 20 Min. oder um 21:30)'),
        h('button', { class: 'chip', onclick: pauseSheet }, pp ? 'Ändern' : 'Planen …')),
      h('div', { class: 'pprow' }, pauseReasonIn,
        h('div', { class: 'chips' }, [5, 10, 15, 20, 30, 45, 60].map((min) => h('button', { class: 'chip', onclick: () => go(Date.now() + min * 60000) }, `${min}′`))),
        h('div', { class: 'ppuntil' }, h('span', { class: 'small dim' }, 'oder bis'), pauseTimeIn, h('button', { class: 'chip', onclick: () => go(timeToTs(pauseTimeIn.value)) }, 'OK'))));
  }

  function pauseSheet() {
    if (!last) return;
    const t = last.t;
    const paused = t.pausedUntil && t.pausedUntil > Date.now();
    const reason = h('input', { type: 'text', placeholder: 'Grund (optional), z. B. Essenspause', value: (paused && t.pauseReason) || '', maxlength: 40 });
    const until = h('input', { type: 'time', value: paused ? fmtClock(t.pausedUntil) : '' });
    const start = async (ts) => { if (!ts) return; sh.close(); await startPause(ts, reason.value); };
    const atTime = () => start(timeToTs(until.value));
    const planBox = planPauseBox(reason, () => sh.close());
    const sh = sheet(h('div', { class: 'stack' },
      h('h2', {}, paused ? `☕ Pause bis ${fmtClock(t.pausedUntil)} Uhr` : '☕ Pause einlegen'),
      h('div', { class: 'small dim' }, 'Laufende Spiele werden zu Ende gespielt, danach wird bis zum Ende der Pause nichts aufgerufen. Fokus und Fernseher zeigen ein großes Banner mit Countdown, eine Minute vorher kommt eine Ansage.'),
      reason,
      h('b', {}, paused ? 'Neu ab jetzt' : 'Dauer ab jetzt'),
      h('div', { class: 'chips' }, [5, 10, 15, 20, 30, 45, 60].map((min) => h('button', { class: 'chip', onclick: () => start(Date.now() + min * 60000) }, `${min} Min.`))),
      paused ? h('div', { class: 'chips' }, [5, 10, 15].map((min) => h('button', { class: 'chip', onclick: () => start(t.pausedUntil + min * 60000) }, `＋${min} Min. verlängern`))) : null,
      h('b', {}, 'Oder bis Uhrzeit'),
      h('div', { class: 'grid2' }, until, h('button', { class: 'btn', onclick: atTime }, 'Bis dahin Pause')),
      paused ? h('button', {
        class: 'btn primary',
        onclick: async () => { sh.close(); await endPause(); },
      }, '▶ Pause beenden – jetzt weiter') : null,
      planBox,
      h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Abbrechen')));
  }

  /**
   * 🗓️ Pause für später planen (im ☕-Fenster): Beginn in X Min. oder um Uhrzeit, Dauer, Grund wie oben.
   * Fokus und Fernseher zeigen sie vorher an („☕ Pause um 12:30 · in 14 Min.“), 5 Min. vorher kommt eine Ansage.
   */
  function planPauseBox(reasonIn, close) {
    const box = h('div', { class: 'card stack planbox' });
    let startIn = 20;  // Minuten ab jetzt (oder null, wenn Uhrzeit gewählt)
    let dur = 15;
    const atIn = h('input', { type: 'time', title: 'Beginn um Uhrzeit', onchange: () => { startIn = null; fill(); } });
    const fill = () => {
      const pp = last.t.plannedPause;
      const startTs = startIn != null ? Date.now() + startIn * 60000 : (atIn.value ? timeToTs(atIn.value) : null);
      box.replaceChildren(
        h('b', {}, '🗓️ Pause für später planen'),
        pp ? h('div', { class: 'planned' }, h('span', {}, `Geplant: ${fmtClock(pp.at)}–${fmtClock(pp.at + pp.min * 60000)} Uhr${pp.reason ? ` · ${pp.reason}` : ''}`),
          h('button', { class: 'chip', onclick: async () => {
            close();
            const until = Date.now() + pp.min * 60000;
            await commit({ ...last.t, plannedPause: null, pausedUntil: until, pauseReason: pp.reason || null }, `☕ Geplante Pause vorgezogen – bis ${fmtClock(until)} Uhr`, { undo: { op: 'pause' } });
          } }, '▶ Jetzt starten'),
          h('button', { class: 'chip dangerchip', onclick: async () => { await cancelPlanned(); fill(); } }, '✕ Streichen')) : null,
        h('div', { class: 'small dim' }, 'Beginn'),
        h('div', { class: 'chips' }, [10, 20, 30, 45, 60, 90].map((m) => h('button', { class: `chip ${startIn === m ? 'on' : ''}`, onclick: () => { startIn = m; atIn.value = ''; fill(); } }, `in ${m} Min.`)),
          h('span', { class: 'small dim' }, 'oder um'), atIn),
        h('div', { class: 'small dim' }, 'Dauer'),
        h('div', { class: 'chips' }, [10, 15, 20, 30, 45, 60].map((m) => h('button', { class: `chip ${dur === m ? 'on' : ''}`, onclick: () => { dur = m; fill(); } }, `${m} Min.`))),
        h('button', {
          class: 'btn', disabled: !startTs,
          onclick: async () => { if (await planPause(startTs, dur, reasonIn.value)) close(); },
        }, startTs ? `${pp ? 'Neu planen' : 'Planen'}: ${fmtClock(startTs)}–${fmtClock(startTs + dur * 60000)} Uhr` : 'Uhrzeit wählen'));
    };
    fill();
    return box;
  }

  /**
   * 📺 Fernseher steuern (Turnierleitung): Einstellungen des Fernseher-Fensters liegen im Turnier (t.tv) und gelten
   * dort sofort – auch auf einem anderen Gerät. { page: 'auto'|'boards'|'groups'|'ko'|'results', zoom, planZoom, rotate, rotateSec, times }
   */
  function tvControlPanel() {
    const box = h('div', { class: 'stack tvpanel' });
    // Änderungen in diesem Fenster sammeln: schnelle Klicks überschreiben sich so nicht gegenseitig
    let pending = {};
    const set = async (patch) => {
      pending = { ...pending, ...patch };
      fill(); // sofort anzeigen, nicht erst nach dem nächsten Abruf
      await commit({ ...last.t, tv: { ...(last.t.tv || {}), ...pending } }, null);
    };
    const fill = () => {
      if (!last) return;
      const { t, st } = last;
      const c = { page: 'auto', zoom: 1, rotate: true, rotateSec: 20, ...(t.tv || {}), ...pending };
      const pages = [['auto', '🔄 Automatisch'], ['boards', '🎯 Boards'], st.groups.length ? ['groups', t.format === 'rr' ? '📊 Tabelle' : '👥 Gruppen'] : null, st.koRounds.length ? ['ko', '🌳 K.-o.'] : null, ['results', '🏁 Ergebnisse'], st.done ? ['podium', '🏆 Siegerehrung'] : null].filter(Boolean);
      const step = (key, d, lo, hi) => set({ [key]: Math.round(Math.max(lo, Math.min(hi, (c[key] || 1) + d)) * 10) / 10 });
      const pct = (v) => `${Math.round(v * 100)} %`;
      box.replaceChildren(
        sec('Seite'),
        h('div', { class: 'chips' }, pages.map(([k, label]) => h('button', { class: `chip ${c.page === k ? 'on' : ''}`, onclick: () => set({ page: k }) }, label))),
        h('div', { class: 'small dim' }, 'Automatisch: Boards, solange gespielt wird – in Pausen wechseln die Seiten von selbst.'),
        c.page === 'auto' ? h('div', { class: 'list-item' }, h('span', { class: 'name' }, 'In Pausen wechseln'),
          h('button', { class: `chip ${c.rotate ? 'on' : ''}`, onclick: () => set({ rotate: !c.rotate }) }, c.rotate ? 'An' : 'Aus')) : null,
        c.page === 'auto' && c.rotate ? h('div', { class: 'seg' }, [10, 20, 40].map((v) => h('button', { class: c.rotateSec === v ? 'on' : '', onclick: () => set({ rotateSec: v }) }, `alle ${v} s`))) : null,
        h('div', { class: 'list-item' }, h('span', { class: 'name' }, 'Größe'),
          h('div', { class: 'boardctl' }, h('button', { class: 'toolbtn', onclick: () => step('zoom', -0.1, 0.6, 1.8) }, 'A−'), h('span', { class: 'num small' }, pct(c.zoom)), h('button', { class: 'toolbtn', onclick: () => step('zoom', 0.1, 0.6, 1.8) }, 'A+'))),
        h('div', { class: 'timesrow' }, h('span', { class: 'name' }, '⏱ Zeiten oben', h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Antippen zum Ein- und Ausblenden')),
          timePicker(c.times, (v) => set({ times: v }))),
        h('div', { class: 'list-item' }, h('span', { class: 'name' }, 'Farben', h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Hell für helle Räume oder Beamer')),
          h('div', { class: 'seg two', style: { minWidth: '190px', margin: 0 } }, [['dark', '🌙 Dunkel'], ['light', '☀️ Hell']].map(([v, label]) => h('button', { class: (c.theme || 'dark') === v ? 'on' : '', onclick: () => set({ theme: v }) }, label)))),
        brandRow(t));
    };
    // Vereinsname und Logo oben im Fernseher-Bild (und im Fokus): im Turnier (t.brand), Logo verkleinert als Bild-Daten
    const brandRow = (t) => {
      const b = t.brand || {};
      const save = (patch) => commit({ ...last.t, brand: { ...(last.t.brand || {}), ...patch } }, null).then(() => { fill(); draw(); });
      const nameIn = h('input', { type: 'text', placeholder: 'Vereinsname (optional)', value: b.name || '', maxlength: 40, onchange: () => save({ name: nameIn.value.trim() }) });
      const fileIn = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: () => {
        const f = fileIn.files && fileIn.files[0];
        if (!f) return;
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 160 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(img.src);
          save({ logo: cv.toDataURL('image/png') });
        };
        img.onerror = () => toast('Bild konnte nicht gelesen werden.');
        img.src = URL.createObjectURL(f);
      } });
      return h('div', { class: 'timesrow' }, h('span', { class: 'name' }, '🏷️ Verein oben', h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Name und Logo links neben dem Turniernamen')),
        nameIn,
        h('div', { class: 'chips' }, b.logo ? h('img', { class: 'brandlogo', src: b.logo, alt: 'Logo' }) : null,
          h('button', { class: 'chip', onclick: () => fileIn.click() }, b.logo ? '🖼️ Logo ändern' : '🖼️ Logo wählen'),
          b.logo ? h('button', { class: 'chip', onclick: () => save({ logo: null }) }, '✕ Logo entfernen') : null, fileIn));
    };
    fill();
    return box;
  }

  /** Nächstes offenes Spiel eines Spielers mit feststehendem Gegner, der selbst da ist (oder null). */
  function nextGameOf(t, st, id) {
    const away = t.absent || {};
    return upcomingQueue(t, st).find((g) => (g.a === id || g.b === id) && !away[g.a === id ? g.b : g.a]) || null;
  }

  /**
   * Spiel kampflos werten (Spieler nicht da): Gegner gewinnt mit allen nötigen Legs, ohne Würfe. Ein Aufruf des
   * Spiels wird zurückgenommen. patch: weitere Änderungen am Turnier im selben Schritt. Rückgängig im 📜 Protokoll.
   */
  async function walkover(t, st, g, loserId, label, patch = {}) {
    const f = formatFor(t, g);
    const need = winsNeeded(f.setsBestOf > 1 ? f.setsBestOf : f.legsBestOf);
    const winA = loserId === g.b;
    const m = createMatch({ mode: t.mode, options: t.options, players: [g.a, g.b], playerNames: [nameOf(t, g.a), nameOf(t, g.b)], legsBestOf: f.legsBestOf, setsBestOf: f.setsBestOf });
    m.tournament = matchTag(t, g);
    m.status = 'finished';
    m.winner = winA ? 0 : 1;
    m.manualResult = { legs: { [g.a]: winA ? need : 0, [g.b]: winA ? 0 : need }, by: 'pc', conceded: loserId, walkover: true };
    m.updatedAt = Date.now();
    try { await postMatch(m); } catch { /* wird nachgeschickt */ }
    const calls = { ...(t.calls || {}) };
    delete calls[g.key];
    said.delete(`call:${g.key}`); said.delete(`late:${g.key}`);
    const nt = { ...t, calls, ...patch, ...(g.status === 'running' && g.match ? { stopped: { ...(t.stopped || {}), [g.match.id]: Date.now() } } : {}) };
    const winner = winA ? g.a : g.b;
    return commit(nt, `${label}: ${nameOf(t, winner)} gewinnt gegen ${nameOf(t, loserId)} · ${g.roundName}`, { kind: 'result', ref: `${g.key}|kampflos`, undo: { op: 'manual', key: g.key, matchId: m.id } });
  }

  /**
   * Karte unter „Als Nächstes“ antippen: Spieler nicht angetreten (kampflos für den anderen), nicht da markieren,
   * später spielen. Die Namen öffnen das Spielerprofil.
   */
  function nextMenu(g) {
    if (!last) return;
    const { t, st } = last;
    const A = nameOf(t, g.a);
    const B = nameOf(t, g.b);
    const fc = scheduleEstimate(t, st);
    const at = fc && fc.starts.get(g.key);
    const away = t.absent || {};
    const sh = sheet(h('div', { class: 'stack' },
      h('h2', {}, h('span', { class: 'namelink', onclick: () => { sh.close(); profile(g.a); } }, A), ' – ', h('span', { class: 'namelink', onclick: () => { sh.close(); profile(g.b); } }, B)),
      h('div', { class: 'small dim' }, `${g.roundName} · ${formatText(formatFor(t, g))}${at ? ` · ca. ${fmtClock(at)} Uhr` : ''}${(t.defer || {})[g.key] ? ' · zurückgestellt' : ''}`),
      sec('🏳 Nicht angetreten'),
      h('div', { class: 'small dim' }, 'Der andere gewinnt kampflos (alle nötigen Legs). Beide bleiben im Turnier. Rückgängig im 📜 Protokoll.'),
      h('div', { class: 'chips' }, [[g.a, B], [g.b, A]].map(([loser, winner]) => h('button', {
        class: 'chip',
        onclick: async () => {
          if (!(await confirmDialog(`${nameOf(t, loser)} nicht angetreten?`, `${winner} gewinnt ${A} – ${B} kampflos.`, { ok: `Kampflos an ${winner}`, danger: true }))) return;
          sh.close();
          walkover(last.t, last.st, g, loser, `🏳 Kampflos (${nameOf(t, loser)} nicht angetreten)`);
        },
      }, `${nameOf(t, loser)} fehlt → Sieg ${winner}`))),
      sec('⏸ Nicht da'),
      h('div', { class: 'small dim' }, 'Wird nicht aufgerufen, seine Spiele warten – die anderen spielen weiter.'),
      h('div', { class: 'chips' }, [g.a, g.b].map((id) => (away[id]
        ? h('button', { class: 'chip on', onclick: () => { sh.close(); setAbsent(id, false); } }, `🙋 ${nameOf(t, id)} ist wieder da`)
        : h('button', { class: 'chip', onclick: () => { sh.close(); setAbsent(id, true); } }, `⏸ ${nameOf(t, id)} nicht da`)))),
      sec('⏭ Reihenfolge'),
      (t.defer || {})[g.key]
        ? h('button', { class: 'chip', onclick: async () => { sh.close(); const defer = { ...t.defer }; delete defer[g.key]; await commit({ ...last.t, defer }, `↩ Wieder normal eingereiht: ${A} – ${B}`); } }, '↩ wieder normal einreihen')
        : h('button', { class: 'chip', onclick: async () => { sh.close(); await commit({ ...last.t, defer: { ...(last.t.defer || {}), [g.key]: Date.now() } }, `⏭ Später spielen: ${A} – ${B} (ans Ende der Warteschlange)`, { undo: { op: 'defer', key: g.key } }); } }, '⏭ später spielen (ans Ende)'),
      h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Schließen')));
  }

  /** Spieler als abwesend (true) oder wieder da (false) markieren – abwesende werden nicht aufgerufen. */
  async function setAbsent(id, away) {
    const t = last.t;
    const absent = { ...(t.absent || {}) };
    if (away) absent[id] = Date.now(); else delete absent[id];
    await commit({ ...t, absent }, `${away ? '⏸' : '🙋'} ${nameOf(t, id)} ${away ? 'ist nicht da' : 'ist wieder da'}`, { undo: { op: 'absent', id, was: !away } });
    toast(away ? `⏸ ${nameOf(t, id)} wird nicht aufgerufen, bis er wieder da ist` : `🙋 ${nameOf(t, id)} ist wieder da`);
  }

  /** Protokoll-Eintrag zurücknehmen (siehe withLog in core/tournament.js). */
  async function undoEntry(e) {
    const t = last.t;
    const u = e.undo || {};
    let next = { ...t };
    if (u.op === 'result' || u.op === 'manual') {
      if (!(await confirmDialog('Ergebnis löschen?', 'Das Spiel kommt wieder in die Warteschlange und wird neu angesetzt. Die Würfe des alten Spiels zählen nicht mehr.', { ok: 'Ergebnis löschen', danger: true }))) return;
      const m = last.matches.find((x) => x.id === u.matchId);
      if (m) next.stopped = { ...(next.stopped || {}), [m.id]: Date.now() };
      const calls = { ...(next.calls || {}) }; delete calls[u.key]; next.calls = calls;
      said.delete(`call:${u.key}`);
    } else if (u.op === 'unstop') {
      const newer = last.matches.some((m) => m.tournament && m.tournament.game === u.key && m.id !== u.matchId && m.status !== 'aborted' && !(t.stopped || {})[m.id]);
      if (newer) { toast('Das Spiel wurde inzwischen neu begonnen – der alte Stand kann nicht zurückgeholt werden.'); return; }
      const stopped = { ...(next.stopped || {}) }; delete stopped[u.matchId]; next.stopped = stopped;
    } else if (u.op === 'defer') {
      const defer = { ...(next.defer || {}) }; delete defer[u.key]; next.defer = defer;
    } else if (u.op === 'move') {
      const c = (t.calls || {})[u.key];
      if (!c) { toast('Das Spiel steht an keinem Board mehr.'); return; }
      if (boardStatus(t, last.st).some((b) => b.board === u.from && b.game && b.game.key !== u.key)) { toast(`Board ${u.from} ist inzwischen belegt.`); return; }
      next.calls = { ...t.calls, [u.key]: { ...c, board: u.from, at: Date.now() } };
    } else if (u.op === 'absent') {
      const absent = { ...(next.absent || {}) };
      if (u.was) absent[u.id] = Date.now(); else delete absent[u.id];
      next.absent = absent;
    } else if (u.op === 'absentAll') {
      next.absent = u.was || {};
    } else if (u.op === 'withdraw') {
      const w = { ...(next.withdrawn || {}) }; delete w[u.id]; next.withdrawn = w;
    } else if (u.op === 'pause') {
      next.pausedUntil = 0;
    } else return;
    next.log = (next.log || []).map((x) => (x.id === e.id ? { ...x, undone: Date.now() } : x));
    await commit(next, `↩ Rückgängig: ${e.text}`, { kind: 'undo' });
    toast('↩ Zurückgenommen');
  }

  /**
   * 📊 Turnier-Statistik: wie lange die Spiele dauern – gesamt, je Phase (Gruppe, K.-o., Halbfinale, Finale) und je
   * Board, dazu Anlauf (Aufruf bis Beginn), Tempo und die längsten Spiele. Nur am Board gespielte Spiele zählen
   * (am PC eingetragene und kampflose haben keine echte Dauer).
   */
  function tourStatsSheet() {
    if (!last) return;
    const { t, st } = last;
    const min = (ms) => ms / 60000;
    const games = st.games.filter((g) => g.status === 'done' && g.match && !g.match.manualResult && g.match.createdAt && g.match.updatedAt > g.match.createdAt)
      .map((g) => ({ g, dur: min(g.match.updatedAt - g.match.createdAt), board: (t.calls || {})[g.key]?.board || null, call: (t.calls || {})[g.key]?.at || null }));
    const avg = (l) => (l.length ? l.reduce((a, x) => a + x.dur, 0) / l.length : 0);
    const fm = (m) => (m >= 60 ? `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')} Std.` : `${Math.round(m)} Min.`);
    const phaseOf = (g) => (g.phase === 'group' ? 'Gruppenphase' : g.third ? 'Spiel um Platz 3' : g.round === t.ko.rounds ? 'Finale' : g.round === t.ko.rounds - 1 ? 'Halbfinale' : 'K.-o.-Runden');
    const row = (label, l, note = '') => h('div', { style: { display: 'contents' } }, h('span', {}, label, note ? h('span', { class: 'dim small' }, ` · ${note}`) : null), h('span', { class: 'num dim' }, `${l.length}×`), h('span', { class: 'num' }, l.length ? `Ø ${fm(avg(l))}` : '–'));
    const phases = ['Gruppenphase', 'K.-o.-Runden', 'Halbfinale', 'Spiel um Platz 3', 'Finale'].map((p) => [p, games.filter((x) => phaseOf(x.g) === p)]).filter(([, l]) => l.length);
    const boardsList = Array.from({ length: t.boards || 1 }, (_, i) => [i + 1, games.filter((x) => x.board === i + 1)]).filter(([, l]) => l.length);
    // Anlauf: vom Aufruf bis zum ersten Wurf (Match angelegt)
    const lead = games.filter((x) => x.call && x.g.match.createdAt >= x.call).map((x) => min(x.g.match.createdAt - x.call));
    const own = last.matches.filter((m) => m.tournament && m.tournament.id === t.id && m.createdAt);
    const span = own.length ? min(Date.now() - Math.min(...own.map((m) => m.createdAt))) : 0;
    const longest = games.slice().sort((a, b) => b.dur - a.dur).slice(0, 3);
    const fmtOf = (g) => formatText(formatFor(t, g));
    const sh = sheet(h('div', { class: 'stack' },
      h('h2', {}, '📊 Turnier-Statistik'),
      games.length ? [
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi' }, h('b', { class: 'num' }, fm(avg(games))), h('span', {}, 'Ø je Spiel')),
          h('div', { class: 'kpi' }, h('b', { class: 'num' }, span > 10 ? (games.length / (span / 60)).toFixed(1).replace('.', ',') : '–'), h('span', {}, 'Spiele pro Std.')),
          h('div', { class: 'kpi' }, h('b', { class: 'num' }, lead.length ? fm(lead.reduce((a, b) => a + b, 0) / lead.length) : '–'), h('span', {}, 'Ø Aufruf → Start'))),
        sec('⏱ Dauer je Phase'),
        h('div', { class: 'tstat' }, phases.map(([p, l]) => row(p, l, fmtOf(l[0].g)))),
        boardsList.length ? [sec('🎯 Dauer je Board'), h('div', { class: 'tstat' }, boardsList.map(([b, l]) => row(`Board ${b}`, l)))] : null,
        sec('🐢 Längste Spiele'),
        h('div', { class: 'tstat' }, longest.map((x) => h('div', { style: { display: 'contents' } },
          h('span', {}, `${nameOf(t, x.g.a)} – ${nameOf(t, x.g.b)}`, h('span', { class: 'dim small' }, ` · ${x.g.roundName}`)),
          h('span', { class: 'num dim' }, x.board ? `B${x.board}` : ''),
          h('span', { class: 'num' }, fm(x.dur))))),
        h('div', { class: 'small dim' }, `${games.length} Spiele mit gemessener Dauer. Am PC eingetragene und kampflose Spiele zählen nicht.`),
      ] : h('p', { class: 'dim' }, 'Noch kein Spiel fertig – die Dauer wird ab dem ersten Ergebnis gemessen.'),
      h('button', { class: 'btn primary', onclick: () => sh.close() }, 'Schließen')));
  }

  /** 🔍 Spieler suchen: Namen tippen, Treffer zeigen, wo der Spieler gerade ist – Tipp öffnet sein Profil. */
  function searchSheet() {
    if (!last) return;
    const { t, st } = last;
    const input = h('input', { type: 'search', placeholder: 'Name eintippen …', autocomplete: 'off' });
    const list = h('div', { class: 'searchlist' });
    const where = (id) => {
      const b = boardStatus(t, st).find((x) => x.game && (x.game.a === id || x.game.b === id));
      if (b) return b.game.status === 'running' ? `🎯 spielt an Board ${b.board}` : `📣 aufgerufen an Board ${b.board}`;
      if (boardStatus(t, st).some((x) => x.writer === id)) return '✍️ schreibt';
      if ((t.absent || {})[id]) return '⏸ nicht da';
      const n = upcomingQueue(t, st).findIndex((g) => g.a === id || g.b === id);
      return n >= 0 ? `⏭️ ${n === 0 ? 'als Nächstes dran' : `noch ${n} Spiel${n > 1 ? 'e' : ''} davor`}` : '–';
    };
    const fill = () => {
      const q = input.value.trim().toLowerCase();
      const ids = t.players.filter((id) => !q || nameOf(t, id).toLowerCase().includes(q)).sort((a, b) => nameOf(t, a).localeCompare(nameOf(t, b)));
      list.replaceChildren(...(ids.length ? ids.map((id) => h('button', { class: 'searchrow', onclick: () => { sh.close(); profile(id); } },
        h('b', {}, nameOf(t, id)), h('span', { class: 'dim' }, where(id)))) : [h('p', { class: 'dim' }, 'Kein Spieler gefunden.')]));
    };
    input.addEventListener('input', fill);
    fill();
    const sh = sheet(h('div', { class: 'stack' }, h('h2', {}, '🔍 Spieler suchen'), input, list,
      h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Schließen')));
    setTimeout(() => input.focus(), 50);
  }

  /** 📜 Protokoll: alle Ergebnisse und Eingriffe der Turnierleitung, neueste zuerst, mit Rückgängig. */
  function logSheet() {
    if (!last) return;
    const box = h('div', { class: 'stack' });
    const fill = () => {
      const t = last.t;
      const list = (t.log || []).slice().reverse();
      box.replaceChildren(
        h('h2', {}, '📜 Protokoll'),
        h('div', { class: 'small dim' }, 'Jedes Ergebnis und jeder Eingriff der Turnierleitung mit Uhrzeit. „↩“ nimmt eine Aktion zurück (ein Ergebnis löschen setzt das Spiel neu an).'),
        list.length ? h('div', { class: 'loglist' }, list.map((e) => h('div', { class: `logrow ${e.undone ? 'undone' : ''} k${e.kind}` },
          h('span', { class: 'num dim' }, fmtClock(e.at)),
          h('span', { class: 'logtext' }, e.text, e.undone ? h('span', { class: 'dim small' }, ` · zurückgenommen ${fmtClock(e.undone)}`) : null),
          e.undo && !e.undone && !viewer ? h('button', { class: 'btn ghost small', onclick: async () => { await undoEntry(e); fill(); } }, '↩') : null)))
          : h('div', { class: 'dim' }, 'Noch keine Einträge.'),
        h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Schließen'));
    };
    fill();
    const sh = sheet(box);
  }

  /** Spielerprofil (Klick auf einen Namen): Stand, nächstes Spiel, Werte im Turnier, Spiele – an der Leitung mit Aktionen. */
  function profile(id) {
    if (!last) return;
    const { t, st, matches } = last;
    const grp = st.groups.find((g) => g.players.includes(id));
    const place = grp ? grp.table.findIndex((r) => r.id === id) : -1;
    const look = grp && grp.outlook ? grp.outlook[id] : null;
    const koLost = st.games.find((g) => g.phase === 'ko' && g.status === 'done' && g.winnerId && (g.a === id || g.b === id) && g.winnerId !== id && !g.third);
    const koIn = st.games.some((g) => g.phase === 'ko' && (g.a === id || g.b === id));
    const status = st.champion === id ? '🏆 Turniersieger'
      : (t.withdrawn || {})[id] ? '🏳 hat aufgegeben'
        : koLost ? `ausgeschieden im ${koLost.roundName}`
          : koIn ? '🌳 im K.-o.'
            : grp ? `${grp.name} · Platz ${place + 1}${look === 'safe' ? ' · ✓ sicher weiter' : look === 'out' ? ' · ✗ kann nicht mehr weiter' : ''}` : '';
    const board = boardStatus(t, st).find((b) => b.game && (b.game.a === id || b.game.b === id));
    const queue = upcomingQueue(t, st);
    const qi = queue.findIndex((g) => g.a === id || g.b === id);
    const fc = scheduleEstimate(t, st);
    const opp = (g) => nameOf(t, g.a === id ? g.b : g.a, g.a === id ? g.bLabel : g.aLabel);
    const rows = matches.filter((m) => m.tournament && m.tournament.id === t.id && m.status !== 'aborted' && !(t.stopped || {})[m.id] && m.mode === 'x01').flatMap((m) => rowsOf(m)).filter((r) => r.playerId === id);
    const ps = rows.length ? playerStats(rows) : null;
    const mine = st.games.filter((g) => (g.a === id || g.b === id) && !g.bye);
    const stat = (label, v) => h('div', { class: 'pstat' }, h('div', { class: 'num pstatv' }, v), h('div', { class: 'small dim' }, label));
    let sh;
    const leader = !viewer;
    sh = sheet(h('div', { class: 'stack profile' },
      h('h2', {}, nameOf(t, id)),
      h('div', { class: 'dim' }, status, (t.absent || {})[id] ? h('b', { class: 'warn' }, ' · ⏸ nicht da') : null),
      // Nicht da: was mit seinen Spielen passiert
      (t.absent || {})[id] ? h('div', { class: 'card small awaycard' },
        `⏸ Nicht da seit ${fmtClock(t.absent[id])} Uhr. Er wird nicht aufgerufen – seine Spiele warten, die anderen spielen weiter.`,
        getSettings().tourAbsentWo ? ` Nach ${getSettings().tourAbsentWo} Min. geht sein nächstes Spiel automatisch kampflos an den Gegner.` : ' Automatisch kampflos: ⚙️ › „Nicht da → kampflos“.') : null,
      board ? h('div', { class: 'card nowcard' }, h('b', {}, `🎯 ${board.game.status === 'running' ? 'Spielt jetzt' : 'Aufgerufen'} an Board ${board.board}`), h('div', {}, `gegen ${opp(board.game)}${board.game.status === 'running' && board.game.match ? ` · ${liveScore(board.game.match)}` : ''}`))
        : qi >= 0 ? h('div', { class: 'card' }, h('b', {}, `⏭️ Als Nächstes: gegen ${opp(queue[qi])}`), h('div', { class: 'small dim' }, `${qi === 0 ? 'Als nächstes Spiel dran' : `Noch ${qi} Spiel${qi > 1 ? 'e' : ''} davor`}${fc && fc.starts.get(queue[qi].key) ? ` · ca. ${fmtClock(fc.starts.get(queue[qi].key))} Uhr` : ''} · ${queue[qi].roundName}`)) : null,
      ps ? h('div', { class: 'pstats' },
        stat('Ø Average', avgText(ps.average)), stat('First 9', ps.first9 ? avgText(ps.first9) : '–'), stat('Beste Aufnahme', String(ps.highest || '–')),
        stat('Höchstes Finish', String(ps.highestCheckout || '–')), stat('180er', String(ps.c180 || 0)), stat('Checkout-Quote', ps.checkoutAttempts ? `${Math.round(ps.checkoutRate * 100)} %` : '–'))
        : h('div', { class: 'small dim' }, 'Noch keine Würfe in diesem Turnier.'),
      sec('Spiele'),
      h('div', { class: 'stack', style: { gap: '4px' } }, mine.map((g) => h('div', { class: 'list-item' },
        h('span', { class: 'name' }, `gegen ${opp(g)}`, h('div', { class: 'small dim' }, g.roundName)),
        h('b', { class: `num ${g.status === 'done' ? (g.winnerId === id ? 'accent' : g.winnerId ? 'warn' : '') : 'dim'}` },
          g.status === 'done' ? (g.result.walkover ? (g.winnerId === id ? 'w.o. ✓' : 'w.o.') : `${g.result.legs[id] ?? 0} : ${g.result.legs[g.a === id ? g.b : g.a] ?? 0}${g.result.draw ? ' U' : g.winnerId === id ? ' ✓' : ''}`)
            : g.status === 'running' ? 'läuft' : g.status === 'ready' ? 'offen' : 'wartet')))),
      leader && !(t.withdrawn || {})[id] ? [sec('Turnierleitung'), h('div', { class: 'chips' },
        h('button', { class: 'chip', onclick: () => broadcast(board ? `${nameOf(t, id)}, bitte an Board ${board.board}.` : `${nameOf(t, id)}, bitte zur Turnierleitung.`) }, board ? `📣 an Board ${board.board} rufen` : '📣 zur Turnierleitung rufen'),
        (t.absent || {})[id]
          ? h('button', { class: 'chip on', onclick: () => { sh.close(); setAbsent(id, false); } }, '🙋 ist wieder da')
          : h('button', { class: 'chip', onclick: () => { sh.close(); setAbsent(id, true); } }, '⏸ nicht da (nicht aufrufen)')),
      h('div', { class: 'chips' },
        // Nur das nächste Spiel kampflos an den Gegner (Spieler kommt nicht rechtzeitig)
        (() => {
          const ng = board && board.game.status !== 'running' ? board.game : nextGameOf(t, st, id);
          if (!ng) return null;
          const opp = ng.a === id ? ng.b : ng.a;
          return h('button', {
            class: 'chip',
            onclick: async () => {
              if (!(await confirmDialog(`Spiel kampflos an ${nameOf(t, opp)}?`, `${nameOf(t, id)} – ${nameOf(t, opp)} (${ng.roundName}) wird als kampflos gewonnen für ${nameOf(t, opp)} gewertet. ${nameOf(t, id)} bleibt im Turnier. Rückgängig im 📜 Protokoll.`, { ok: 'Kampflos werten', danger: true }))) return;
              sh.close();
              walkover(last.t, last.st, ng, id, `🏳 Kampflos (${nameOf(t, id)} nicht angetreten)`);
            },
          }, `🏳 nächstes Spiel kampflos an ${nameOf(t, opp)}`);
        })(),
        // Ganz aus dem Turnier nehmen: alle offenen Spiele kampflos an die Gegner
        h('button', {
          class: 'chip dangerchip',
          onclick: async () => {
            if (!(await confirmDialog(`${nameOf(t, id)} aus dem Turnier nehmen?`, 'Alle offenen Spiele gehen kampflos an die Gegner (w.o.). Er wird nicht mehr aufgerufen und schreibt nicht mehr. Rückgängig im 📜 Protokoll oder unter 🛠️.', { ok: 'Aus dem Turnier nehmen', danger: true }))) return;
            sh.close();
            const absent = { ...(last.t.absent || {}) };
            delete absent[id];
            await commit({ ...last.t, absent, withdrawn: { ...(last.t.withdrawn || {}), [id]: Date.now() } }, `🚫 ${nameOf(t, id)} aus dem Turnier genommen (alle offenen Spiele kampflos)`, { undo: { op: 'withdraw', id } });
          },
        }, '🚫 aus dem Turnier nehmen'))] : null,
      h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Schließen')));
  }

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

  /**
   * Board antippen: Ergebnis eintragen, Unentschieden, Aufgabe in diesem Spiel, neu starten, später spielen,
   * auf ein anderes Board verschieben, fehlende Spieler, Aufruf zurücknehmen, Handy abmelden/verbinden.
   * Gedacht vor allem für Spiele, die hängen oder viel zu lange dauern.
   */
  function boardMenu(t, b) {
    const g = b.game;
    const running = g.status === 'running' && g.match;
    const A = nameOf(t, g.a);
    const B = nameOf(t, g.b);
    let s;
    // Format dieses Spiels (Legs je Runde; im Finale ggf. Sätze – dann werden Sätze eingetragen)
    const f = formatFor(t, g);
    const sets = f.setsBestOf > 1;
    const unit = sets ? 'Sätze' : 'Legs';
    const need = winsNeeded(sets ? f.setsBestOf : f.legsBestOf);
    // aktueller Stand am Handy (gewonnene Legs bzw. Sätze)
    let cur = [0, 0];
    if (running) { try { const d = derive(g.match); cur = (sets ? d.setsWon : d.legsWon).slice(0, 2).map((v) => Math.min(v, need)); } catch { /* ohne Stand */ } }
    const mins = running && g.match.createdAt ? Math.max(0, Math.floor((Date.now() - g.match.createdAt) / 60000)) : null;
    const legOpts = Array.from({ length: need + 1 }, (_, i) => i);
    const selA = h('select', {}, legOpts.map((v) => h('option', { value: v, selected: v === (running ? cur[0] : need) }, String(v))));
    const selB = h('select', {}, legOpts.map((v) => h('option', { value: v, selected: v === (running ? cur[1] : 0) }, String(v))));

    /** Ergebnis als eigenes Match ohne Würfe speichern; ein laufendes Spiel am Handy wird dabei beendet. */
    const writeResult = async ({ la, lb, draw = false, conceded = null, label }) => {
      const m = createMatch({ mode: t.mode, options: t.options, players: [g.a, g.b], playerNames: [A, B], legsBestOf: f.legsBestOf, setsBestOf: f.setsBestOf });
      m.tournament = matchTag(t, g);
      m.status = 'finished';
      m.winner = draw ? null : la > lb ? 0 : 1;
      // ohne Würfe: zählt fürs Turnier, nicht für Averages
      m.manualResult = { legs: { [g.a]: la, [g.b]: lb }, by: 'pc', ...(draw ? { draw: true } : {}), ...(conceded ? { conceded } : {}) };
      m.updatedAt = Date.now();
      try { await postMatch(m); } catch { /* wird nachgeschickt */ }
      if (!draw) saveMatchWithThrows(m, []).catch(() => {});
      s.close();
      let nt = { ...last.t };
      if (running) nt.stopped = { ...(nt.stopped || {}), [g.match.id]: Date.now() };
      const score = `${la} : ${lb}${draw ? ' (unentschieden)' : ''}`;
      await commit(nt, `${label}: ${A} ${score} ${B} · ${g.roundName}`, { kind: 'result', ref: `${g.key}|${score}`, undo: { op: 'manual', key: g.key, matchId: m.id } });
      toast(`${label}: ${A} ${score} ${B}`);
    };
    const saveResult = () => {
      const la = +selA.value;
      const lb = +selB.value;
      if (!((la === need) !== (lb === need))) { toast(`Genau einer braucht ${need} ${sets ? (need > 1 ? 'Sätze' : 'Satz') : (need > 1 ? 'Legs' : 'Leg')}.`); return; }
      writeResult({ la, lb, label: '✍️ Ergebnis am PC' });
    };
    /** Spieler gibt dieses eine Spiel auf: der Gegner gewinnt, der Aufgebende behält seine Legs. */
    const concede = async (loserId) => {
      const winA = loserId === g.b;
      const la = winA ? need : Math.min(cur[0], need - 1);
      const lb = winA ? Math.min(cur[1], need - 1) : need;
      if (!(await confirmDialog(`${nameOf(t, loserId)} gibt dieses Spiel auf?`, `${nameOf(t, winA ? g.a : g.b)} gewinnt ${winA ? `${la} : ${lb}` : `${lb} : ${la}`}. Nur dieses Spiel – im Turnier bleibt ${nameOf(t, loserId)} dabei. Rückgängig im 📜 Protokoll.`, { ok: 'Aufgabe eintragen', danger: true }))) return;
      writeResult({ la, lb, conceded: loserId, label: `🏳 Aufgabe ${nameOf(t, loserId)}` });
    };
    const draw = async () => {
      if (!(await confirmDialog('Unentschieden werten?', `${A} ${cur[0]} : ${cur[1]} ${B} – beide bekommen einen halben Sieg (1 Punkt). Nur in der Gruppenphase möglich.`, { ok: 'Unentschieden' }))) return;
      writeResult({ la: cur[0], lb: cur[1], draw: true, label: '🤝 Unentschieden' });
    };
    /** Neu starten: Stand verwerfen, gleiches Board, das Handy zeigt wieder „Spiel starten“. */
    const restart = async () => {
      if (!(await confirmDialog('Spiel neu starten?', `Der Stand ${liveScore(g.match)} wird verworfen. ${A} und ${B} beginnen an Board ${b.board} von vorn (am Handy „Spiel starten“).`, { ok: 'Neu starten', danger: true }))) return;
      s.close();
      const nt = { ...last.t, stopped: { ...(last.t.stopped || {}), [g.match.id]: Date.now() }, calls: { ...last.t.calls, [g.key]: { ...last.t.calls[g.key], at: Date.now() } } };
      await commit(nt, `🔄 Neu gestartet: ${A} – ${B} an Board ${b.board} (Stand ${liveScore(g.match)} verworfen)`, { undo: { op: 'unstop', key: g.key, matchId: g.match.id } });
      callOut(`restart:${g.key}:${Date.now()}`, b.board, g, b.writer, last.t, 'Neustart. ');
    };
    /** Später spielen: Spiel vom Board nehmen (ein laufender Stand wird verworfen) und ans Ende der Warteschlange stellen. */
    const later = async () => {
      if (running && !(await confirmDialog('Später spielen?', `Der Stand ${liveScore(g.match)} wird verworfen. Das Spiel kommt ans Ende der Warteschlange, Board ${b.board} bekommt das nächste Spiel.`, { ok: 'Später spielen', danger: true }))) return;
      s.close();
      const calls = { ...(last.t.calls || {}) };
      delete calls[g.key];
      said.delete(`call:${g.key}`); said.delete(`late:${g.key}`);
      const nt = { ...last.t, calls, defer: { ...(last.t.defer || {}), [g.key]: Date.now() }, ...(running ? { stopped: { ...(last.t.stopped || {}), [g.match.id]: Date.now() } } : {}) };
      await commit(nt, `⏭ Später spielen: ${A} – ${B} (ans Ende der Warteschlange)`, { undo: { op: 'defer', key: g.key } });
    };
    const move = async (x) => {
      s.close();
      const calls = { ...(last.t.calls || {}), [g.key]: { ...(last.t.calls || {})[g.key], board: x.board, at: Date.now() } };
      said.delete(`call:${g.key}`); said.delete(`late:${g.key}`);
      if (!(await commit({ ...last.t, calls }, `↔ Verschoben: ${A} – ${B} von Board ${b.board} an Board ${x.board}${running ? ' (Spiel läuft weiter)' : ''}`, { undo: { op: 'move', key: g.key, from: b.board } }))) return;
      announce(`call:${g.key}`, `Achtung, Board-Wechsel. ${A} gegen ${B} jetzt an Board ${x.board}.`);
      toast(running ? `↔ An Board ${x.board} verlegt – dort am Handy „Weiterspielen“ tippen` : `↔ Spiel an Board ${x.board} verschoben`);
    };
    const others = boardStatus(t, last.st).filter((x) => x.board !== b.board && !x.game);
    const late = mins != null && staleMinutes(t, g) && mins >= staleMinutes(t, g);

    s = sheet(h('div', { class: 'stack' },
      h('h2', {}, `Board ${b.board}: ${A} gegen ${B}`),
      h('div', { class: `small ${late ? 'warn' : 'dim'}` }, running
        ? `${late ? '⚠️ ' : ''}Läuft seit ${mins} Min. · Stand ${liveScore(g.match)} · ${g.roundName} · ${formatText(f)}`
        : `Aufgerufen um ${fmtClock(b.since)} · noch nicht begonnen · ${g.roundName}`),
      sec('🏁 Ergebnis'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, A), selA),
        h('label', { class: 'field' }, h('span', {}, B), selB)),
      h('button', { class: 'btn primary', onclick: saveResult }, `Ergebnis speichern (${unit})`),
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onclick: () => concede(g.a) }, `🏳 ${A} gibt auf`),
        h('button', { class: 'chip', onclick: () => concede(g.b) }, `🏳 ${B} gibt auf`),
        g.phase === 'group' ? h('button', { class: 'chip', onclick: draw }, `🤝 Unentschieden${running ? ` (${cur[0]} : ${cur[1]})` : ''}`) : null),
      h('div', { class: 'small dim' }, running ? 'Am PC gespeicherte Ergebnisse beenden das Spiel am Handy. Alles lässt sich im 📜 Protokoll zurücknehmen.' : 'Z. B. wenn ein Spieler nicht antritt (Aufgabe = Sieg für den Gegner).'),
      sec('🎯 Spiel'),
      h('div', { class: 'chips' },
        running ? h('button', { class: 'chip', onclick: restart }, '🔄 Neu starten') : null,
        h('button', { class: 'chip', onclick: later }, '⏭ Später spielen'),
        running ? null : h('button', { class: 'chip', onclick: () => { s.close(); unlock(); say(`Board ${b.board}: ${A} gegen ${B}.${b.writer ? ` Schreiber: ${nameOf(t, b.writer)}.` : ''}`, { interrupt: true }); } }, '🔁 Aufruf nochmal ansagen'),
        running ? null : h('button', {
          class: 'chip',
          onclick: async () => {
            s.close();
            const calls = { ...(last.t.calls || {}) };
            delete calls[g.key];
            said.delete(`call:${g.key}`); said.delete(`late:${g.key}`);
            await commit({ ...last.t, calls }, `✋ Aufruf zurückgenommen: ${A} – ${B} (Board ${b.board})`);
          },
        }, '✋ Aufruf zurücknehmen')),
      // Spieler fehlt: als „nicht da“ markieren – das Spiel geht zurück in die Warteschlange, bis er wieder da ist
      running ? null : h('div', { class: 'chips' }, [g.a, g.b].map((id) => h('button', {
        class: 'chip',
        onclick: async () => {
          s.close();
          const calls = { ...(last.t.calls || {}) };
          delete calls[g.key];
          said.delete(`call:${g.key}`); said.delete(`late:${g.key}`);
          await commit({ ...last.t, calls, absent: { ...(last.t.absent || {}), [id]: Date.now() } }, `⏸ ${nameOf(t, id)} fehlt an Board ${b.board} – Aufruf zurückgenommen`, { undo: { op: 'absent', id, was: false } });
        },
      }, `⏸ ${nameOf(t, id)} fehlt`))),
      // Auf ein anderes Board verschieben (Scheibe kaputt, Licht aus …) – ein laufendes Spiel geht dort am Handy weiter
      others.length ? h('div', { class: 'stack', style: { gap: '6px' } },
        h('b', {}, '↔ Auf anderes Board verschieben'),
        h('div', { class: 'chips' }, others.map((x) => h('button', { class: 'chip', onclick: () => move(x) }, `Board ${x.board}${presence.connected().has(x.board) ? ' 📱' : ' (kein Handy)'}`))))
        : h('div', { class: 'small dim' }, 'Zum Verschieben ist gerade kein anderes Board frei.'),
      // Handy hängt an diesem Board (z. B. vergessen abzumelden): abmelden, damit ein anderes übernehmen kann
      phoneAt(b.board) ? h('button', { class: 'btn', onclick: () => { s.close(); kickPhone(t, b.board); } }, `📴 Handy an Board ${b.board} abmelden${running ? ' (Spiel geht mit neuem Handy weiter)' : ''}`) : null,
      !phoneAt(b.board) ? h('button', { class: 'btn', onclick: () => { s.close(); connectSheet(t, b); } }, `📱 Handy für Board ${b.board} verbinden${running ? ' – Spiel weiterführen' : ''}`) : null,
      h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Abbrechen')));
  }

  /** Platzierung für die Siegerehrung: K.-o. = Sieger, Finalgegner, Halbfinal-Verlierer (beide Platz 3); sonst Tabelle. */
  function podiumOf(t, st) {
    const loser = (g) => (g && g.winnerId ? (g.winnerId === g.a ? g.b : g.a) : null);
    if (t.ko && st.koRounds.length) {
      const fin = st.koRounds[st.koRounds.length - 1].games[0];
      const semis = st.koRounds.length > 1 ? st.koRounds[st.koRounds.length - 2].games.map(loser).filter(Boolean) : [];
      // Mit Spiel um Platz 3 steht nur dessen Sieger auf Platz 3, sonst beide Halbfinal-Verlierer
      const third = st.koRounds[st.koRounds.length - 1].games.find((g) => g.third);
      return { first: fin.winnerId, second: loser(fin), third: third && third.winnerId ? [third.winnerId] : semis };
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
    const save = async (patch, msg, undo = null) => {
      sh.close();
      if (await commit({ ...last.t, ...patch }, msg, { undo })) toast(msg);
    };
    const absent = t.absent || {};
    const msgIn = h('input', { type: 'text', placeholder: 'Eigene Durchsage, z. B. „Essen ist fertig“' });
    const sh = sheet(h('div', { class: 'stack' },
      h('h2', {}, '🛠️ Turnier steuern'),
      sec('☕ Pause'),
      h('div', { class: 'small dim' }, paused ? `Pause bis ${fmtClock(t.pausedUntil)} Uhr.` : 'Auch direkt mit ☕ oben in der Leiste.'),
      h('button', { class: 'btn', onclick: () => { sh.close(); pauseSheet(); } }, paused ? '☕ Pause ändern / beenden' : '☕ Pause einlegen'),
      sec('🙋 Anwesenheit / Check-in'),
      h('div', { class: 'small dim' }, 'Grün = da. Antippen schaltet um. Wer nicht da ist, wird nicht aufgerufen – seine Spiele warten, bis er wieder da ist. Zum Check-in vor dem Start: „Check-in starten“, dann jeden beim Eintreffen antippen.'),
      h('div', { class: 'chips' }, active.map((id) => h('button', {
        class: `chip ${absent[id] ? '' : 'on'}`,
        onclick: () => { sh.close(); setAbsent(id, !absent[id]); },
      }, `${absent[id] ? '⏸' : '🙋'} ${nameOf(t, id)}`))),
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onclick: () => save({ absent: Object.fromEntries(active.map((id) => [id, Date.now()])) }, '🙋 Check-in gestartet – alle auf „nicht da“', { op: 'absentAll', was: absent }) }, '🙋 Check-in starten'),
        Object.keys(absent).length ? h('button', { class: 'chip', onclick: () => save({ absent: {} }, '🙋 Alle sind da', { op: 'absentAll', was: absent }) }, '✓ Alle da') : null),
      sec('📣 Durchsage'),
      h('div', { class: 'small dim' }, 'Wird am PC angesagt und auf allen Bildschirmen (auch dem Fernseher) groß eingeblendet. Einen einzelnen Spieler rufen: auf seinen Namen klicken.'),
      h('div', { class: 'chips' },
        ['Alle Spieler bitte zur Turnierleitung.', 'Die nächste Runde beginnt gleich.', 'Bitte die Boards freihalten.'].map((txt) => h('button', { class: 'chip', onclick: () => { sh.close(); broadcast(txt); } }, txt))),
      h('div', { class: 'grid2' }, msgIn, h('button', { class: 'btn', onclick: () => { const v = msgIn.value.trim(); if (!v) return; sh.close(); broadcast(v); } }, '📣 Ansagen')),
      sec('🏳 Spieler gibt auf (ganzes Turnier)'),
      h('div', { class: 'small dim' }, 'Alle offenen Spiele dieses Spielers gewinnt der Gegner kampflos (w.o.). Er wird nicht mehr aufgerufen und schreibt nicht mehr. Ein laufendes Spiel von ihm zählt dann nicht. Nur ein einzelnes Spiel aufgeben: das Board antippen.'),
      active.length ? h('div', { class: 'chips' }, active.map((id) => h('button', {
        class: 'chip',
        onclick: async () => {
          if (!(await confirmDialog(`${nameOf(t, id)} gibt auf?`, 'Alle offenen Spiele gehen kampflos an die Gegner. Das lässt sich hier wieder zurücknehmen, solange danach nichts weitergespielt wurde.', { ok: 'Aufgabe eintragen', danger: true }))) return;
          save({ withdrawn: { ...out, [id]: Date.now() } }, `🏳 ${nameOf(t, id)} hat aufgegeben (ganzes Turnier)`, { op: 'withdraw', id });
        },
      }, nameOf(t, id)))) : h('div', { class: 'dim' }, 'Kein Spieler mehr im Turnier.'),
      Object.keys(out).length ? [h('b', {}, 'Aufgabe zurücknehmen'), h('div', { class: 'chips' }, Object.keys(out).map((id) => h('button', {
        class: 'chip on',
        onclick: () => { const w = { ...out }; delete w[id]; save({ withdrawn: w }, `↩ ${nameOf(t, id)} ist wieder dabei`); },
      }, `↩ ${nameOf(t, id)}`)))] : null,
      h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Schließen')));
  }

  /** 📱 Handy für ein Board verbinden: QR-Code genau dieses Boards (läuft dort ein Spiel: am Handy „Weiterspielen“). */
  function connectSheet(t, b) {
    if (!info) return;
    const game = b.game && b.game.status === 'running' ? b.game : null;
    const s = sheet(h('div', { class: 'stack', style: { textAlign: 'center', alignItems: 'center' } },
      h('h2', {}, `📱 Handy für Board ${b.board}`),
      h('div', { class: 'qrimg hoqr', html: qrFor(boardUrl(info, b.board)) }),
      h('div', { class: 'small dim' }, info.cloud
        ? ['Mit der iPhone-Kamera scannen – oder in der Madhouse-App „Beitreten“ mit Code ', h('b', { class: 'num accent' }, showCode(info.code)), ' (bekommt dann das nächste freie Board).']
        : 'Mit der iPhone-Kamera scannen (gleiches WLAN wie der PC).'),
      game ? h('div', { class: 'card', style: { borderColor: 'var(--accent)' } }, h('b', {}, `Hier läuft ${nameOf(t, game.a)} – ${nameOf(t, game.b)}`), h('div', { class: 'small dim' }, 'Das neue Handy zeigt das Spiel an: „Weiterspielen“ tippen – es geht mit dem aktuellen Stand weiter.')) : null,
      h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Schließen')));
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
    const running = bs && bs.game && bs.game.status === 'running';
    if (!p.id) { toast('Dieses Handy hat eine ältere App-Version und kann nicht abgemeldet werden – dort „Board freigeben“ tippen.'); return; }
    if (!(await confirmDialog(`Handy an Board ${board} abmelden?`, running
      ? `${p.device || 'Handy'} wird von Board ${board} abgemeldet und beendet dort das Spiel. Der Spielstand bleibt erhalten: Ein neues Handy verbindet sich mit dem QR-Code dieses Boards und tippt „Weiterspielen“.`
      : `${p.device || 'Handy'} wird von Board ${board} abgemeldet. Danach kann sich ein anderes Handy verbinden (QR-Code in der Kachel).`, { ok: 'Abmelden', danger: true }))) return;
    try {
      await postTournament({ ...t, kick: { ...(t.kick || {}), [board]: p.id }, kickAt: { ...(t.kickAt || {}), [board]: Date.now() } });
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
  // Bestwerte und Highlight-Ticker sind ein Bereich (1.32.1). Im Fokus haben Ergebnisse und Turnierplan eigene Seiten.
  const SECTIONS = { best: '🔥 Bestwerte & Highlights', next: '⏭️ Als Nächstes', results: '🏁 Letzte Ergebnisse', plan: '🌳 Turnierbaum / Tabellen' };
  const PAGED = new Set(['plan', 'results']); // im Fokus nicht unter den Boards, sondern als Reiter oben
  const FOCUS_DEFAULT = { next: true, best: true };
  const sectionOrder = () => {
    const o = (getSettings().tourOrder || []).filter((k) => SECTIONS[k]);
    return [...o, ...Object.keys(SECTIONS).filter((k) => !o.includes(k))];
  };
  const sectionVisible = (k) => {
    const s = getSettings();
    // Fokus am Laptop und Fernseher-Fenster: nur die Fokus-Bereiche (der Fernseher zeigt nie die letzten Ergebnisse darunter)
    if (s.tourFocus || viewer) return !PAGED.has(k) && !!(s.tourFocusShow || FOCUS_DEFAULT)[k];
    if (k === 'plan' && s.tourPlan === 'off') return false; // ältere Einstellung „Turnierbaum: Aus“
    return !(s.tourHide || {})[k];
  };
  /** Zeilen je Bereich: ↑ / ↓ (Reihenfolge) und An/Aus. focus: stattdessen „im Fokus zeigen“. */
  function sectionRows(refresh, { order = true, focus = false } = {}) {
    const s = getSettings();
    const list = sectionOrder().filter((k) => !(focus && PAGED.has(k))); // im Fokus haben Turnierplan und Ergebnisse eigene Seiten
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

  /** Zuschauer-Link für die Handys der Spieler (nur ansehen, eigenes nächstes Spiel, optional Benachrichtigung). */
  const watchUrl = () => (info && info.cloud
    ? `${location.origin}${location.pathname}?zuschauer=1&live=${info.code}`
    : `${baseUrl(info) || location.origin + location.pathname}?zuschauer=1`);

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
    tvWin = w;
    toast(second ? '📺 Fenster auf dem zweiten Bildschirm – dort ⛶ für Vollbild' : '📺 Fenster auf den Fernseher ziehen, dort ⛶ (oder F11) für Vollbild');
  }

  /**
   * 🖥️ Fernseher: oben das Fenster öffnen (oder, wenn es schon offen ist, nach vorn holen/schließen) und gleich darunter
   * steuern (Seite, Wechsel, Größe). Weitere Wege (anderes Gerät, Übergabe, Zuschauer-Link) aufklappbar darunter.
   */
  /** 🖥️ › Fokus auf diesem Laptop: Zeiten oben einzeln und Farben (früher unter ⚙️ › Ansicht). */
  function focusBox() {
    const box = h('div', { class: 'stack tvpanel' });
    const fill = () => {
      const s = getSettings();
      box.replaceChildren(
        h('div', { class: 'timesrow' }, h('span', { class: 'name' }, '⏱ Zeiten oben', h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Antippen zum Ein- und Ausblenden')),
          timePicker(s.tourFocusTimes, (v) => { updateSettings({ tourFocusTimes: v }); fill(); draw(); })),
        h('div', { class: 'list-item' }, h('span', { class: 'name' }, 'Farben'),
          h('div', { class: 'seg two', style: { minWidth: '190px', margin: 0 } }, [['dark', '🌙 Dunkel'], ['light', '☀️ Hell']].map(([v, label]) => h('button', {
            class: (s.tourTheme || 'dark') === v ? 'on' : '', onclick: () => { updateSettings({ tourTheme: v }); fill(); draw(); },
          }, label)))));
    };
    fill();
    return box;
  }

  function screenMenu() {
    const url = tvUrl();
    const open = tvWin && !tvWin.closed;
    const sh = sheet(h('div', { class: 'stack' },
      h('h2', {}, '🖥️ Fernseher'),
      open
        ? h('div', { class: 'card tvopen' }, h('b', {}, '📺 Fernseher-Fenster ist offen'),
          h('div', { class: 'chips' },
            h('button', { class: 'chip', onclick: () => { try { tvWin.focus(); } catch { /* anderes Fenster */ } } }, '↗ nach vorn holen'),
            h('button', { class: 'chip', onclick: () => { try { tvWin.close(); } catch { /* schon zu */ } tvWin = null; sh.close(); screenMenu(); } }, '✕ schließen')))
        : h('button', { class: 'btn primary', onclick: () => { sh.close(); openTvWindow(); } }, '📺 Fernseher-Fenster öffnen'),
      h('b', {}, '📺 Fernseher steuern'),
      h('div', { class: 'small dim' }, 'Wirkt sofort im Fernseher-Fenster – auch auf einem anderen Gerät. Vollbild: dort F11 oder Doppelklick.'),
      tvControlPanel(),
      // 🎯 Fokus auf diesem Laptop: eigene Zeiten und Farben (das Fernseher-Fenster hat seine oben)
      h('b', {}, '🎯 Fokus auf diesem Laptop'),
      focusBox(),
      h('details', { class: 'infofold morefold' }, h('summary', {}, '➕ Weitere Möglichkeiten: anderes Gerät, Übergabe, Zuschauer-Link'),
      h('div', { class: 'stack' },
      h('b', {}, 'Anderes Gerät als Fernseher (Smart-TV, zweiter Laptop, Tablet)'),
      h('div', { class: 'small dim' }, info && info.cloud ? 'Diese Adresse im Browser des Geräts öffnen:' : 'Diese Adresse im Browser des Geräts öffnen (gleiches WLAN wie der PC):'),
      h('div', { class: 'tvurlrow' },
        h('div', { class: 'qrimg', html: qrFor(info && info.cloud ? url : `${baseUrl(info) || location.origin + location.pathname}?tv=1`) }),
        h('b', { class: 'num tvurl' }, info && info.cloud ? url : `${baseUrl(info) || location.origin + location.pathname}?tv=1`)),
      // Online: Turnierleitung an einen anderen PC übergeben (z. B. unterwegs nur mit dem iPhone)
      info && info.cloud ? [h('b', {}, 'Turnierleitung an einen anderen PC übergeben'),
        h('div', { class: 'small dim' }, 'Der PC übernimmt Aufrufe, Ansagen und Fernseher. Dieses Gerät zeigt danach nur noch an.'),
        h('button', { class: 'btn', onclick: () => { sh.close(); handoverSheet(info.code); } }, '🖥️ An PC übergeben (Adresse + QR-Code)')] : null,
      h('b', {}, '👀 Zuschauer-Link für die Spieler'),
      h('div', { class: 'small dim' }, 'Jeder öffnet ihn auf dem eigenen Handy, wählt seinen Namen und sieht sein nächstes Spiel, den Live-Stand und die Tabellen – auf Wunsch mit Benachrichtigung, wenn er bald dran ist. Nur ansehen, steuern geht damit nichts.' + (info && info.cloud ? '' : ' Nur im selben WLAN wie der PC.')),
      h('div', { class: 'tvurlrow' }, h('div', { class: 'qrimg', html: qrFor(watchUrl()) }), h('b', { class: 'num tvurl' }, watchUrl())),
      h('div', { class: 'list-item' },
        h('span', { class: 'name' }, 'Zuschauer-QR im Fokus und auf dem Fernseher immer zeigen', h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Ein kleiner QR-Code unten. In Pausen erscheint er ohnehin unten rechts (Schalter darunter).')),
        h('button', { class: `chip ${getSettings().tourWatchQr ? 'on' : ''}`, onclick: (e) => { updateSettings({ tourWatchQr: !getSettings().tourWatchQr }); e.target.classList.toggle('on'); e.target.textContent = getSettings().tourWatchQr ? 'An' : 'Aus'; draw(); } }, getSettings().tourWatchQr ? 'An' : 'Aus')),
      h('div', { class: 'list-item' },
        h('span', { class: 'name' }, 'In Pausen QR unten rechts', h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Wenn kein Spiel läuft oder Pause ist – Fokus und Fernseher-Fenster auf diesem PC.')),
        h('button', { class: `chip ${getSettings().tourWatchQrPause !== false ? 'on' : ''}`, onclick: (e) => { updateSettings({ tourWatchQrPause: getSettings().tourWatchQrPause === false }); e.target.classList.toggle('on'); e.target.textContent = getSettings().tourWatchQrPause !== false ? 'An' : 'Aus'; draw(); } }, getSettings().tourWatchQrPause !== false ? 'An' : 'Aus')),
      h('b', {}, 'Nur dieser Laptop'),
      h('div', { class: 'small dim' }, '🎯 Fokus oben einschalten (Vollbild: F11). Zum Verbinden neuer Handys: Der QR-Code steht in der Kachel des freien Boards – oder kurz 🎯 tippen, dann sind alle Knöpfe wieder da.'),
      h('button', { class: 'btn', onclick: () => { sh.close(); updateSettings({ tourFocus: true }); draw(); } }, '🎯 Fokus auf diesem Laptop'))),
      h('button', { class: 'btn primary', onclick: () => sh.close() }, 'Fertig')));
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
        // Ansicht dieses Geräts: Seite (im Fokus), Größe, QR-Codes – früher als Knöpfe oben in der Leiste
        sec('🔍 Ansicht'),
        s.tourFocus && curTabs.length > 1 ? h('div', { class: 'chips' }, curTabs.map(([k, label]) => h('button', {
          class: `chip ${focusTab === k ? 'on' : ''}`, onclick: () => { focusTab = k; autoTab = false; manualUntil = Date.now() + 60000; window.scrollTo(0, 0); draw(); fill(); },
        }, label))) : null,
        h('div', { class: 'list-item' }, h('span', { class: 'name' }, 'Größe'),
          h('div', { class: 'boardctl' },
            h('button', { class: 'toolbtn', onclick: () => { updateSettings({ tourZoom: Math.round(Math.max(0.7, (getSettings().tourZoom || 1) - 0.1) * 10) / 10 }); fill(); draw(); } }, 'A−'),
            h('span', { class: 'num small' }, `${Math.round((s.tourZoom || 1) * 100)} %`),
            h('button', { class: 'toolbtn', onclick: () => { updateSettings({ tourZoom: Math.round(Math.min(1.6, (getSettings().tourZoom || 1) + 0.1) * 10) / 10 }); fill(); draw(); } }, 'A+'))),
        h('div', { class: 'timesrow' },
          h('span', { class: 'name' }, '📊 Kacheln der Turnierleitung', h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Antippen zum Ein- und Ausblenden – Fokus und Fernseher stellst du unter 🖥️ Fernseher ein')),
          dotPicker(HEAD, s.tourHeadShow, (v) => { updateSettings({ tourHeadShow: v }); fill(); draw(); }),
          seg('tourHeadPlace', [['top', '▔ Oben in der Leiste'], ['cards', '▭ Groß als Karten darunter']])),
        h('div', { class: 'small dim' }, 'QR-Codes zum Verbinden (Auto: solange noch Handys fehlen)'),
        h('div', { class: 'seg', style: { gridTemplateColumns: 'repeat(3, 1fr)' } }, [[null, 'Auto'], [true, 'An'], [false, 'Aus']].map(([v, label]) => h('button', {
          class: qrOpen === v ? 'on' : '', onclick: () => { qrOpen = v; fill(); draw(); },
        }, label))),
        sec('🔊 Ton'),
        toggle('tourSound', 'Ansagen am PC', 'Aufrufe, Pausen, Sieger. Aus = alles nur auf dem Bildschirm'),
        s.tourSound ? toggle('tourHighlightSpeech', 'Highlights ansagen', '„180! Kevin an Board 2“') : null,
        s.tourSound ? h('div', { class: 'list-item' }, h('span', { class: 'name' }, 'Lautstärke'),
          h('input', { type: 'range', min: 0.1, max: 1, step: 0.1, value: s.tourVolume ?? 1, style: { maxWidth: '200px' }, onchange: (e) => { updateSettings({ tourVolume: +e.target.value }); unlock(); say('Board 1.', { interrupt: true }); } })) : null,
        s.tourSound ? h('div', { class: 'small dim' }, 'Tempo der Ansagen') : null,
        s.tourSound ? seg('tourRate', [[null, 'Wie App'], [0.85, 'Langsam'], [1, 'Normal'], [1.15, 'Schnell']]) : null,
        s.tourSound && availableVoices().length > 1 ? h('label', { class: 'field' }, h('span', {}, 'Stimme der Turnierleitung'),
          h('select', { onchange: (e) => { updateSettings({ tourVoiceURI: e.target.value || null }); unlock(); say('Board 1: Ansage mit dieser Stimme.', { interrupt: true }); } },
            h('option', { value: '' }, 'Wie in der App'),
            availableVoices().map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === s.tourVoiceURI }, v.name)))) : null,
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
        toggle('tourHighlights', 'Highlights einblenden', '180 und Finishes ab 100 groß auf dem Bildschirm'),
        toggle('tourSchedule', 'Zeitplan anzeigen', 'Geschätztes Turnierende'),
        sec('🎯 Ablauf'),
        toggle('tourWriter', 'Schreiber ansagen', 'Verlierer des letzten Spiels an diesem Board'),
        toggle('tourCallTwice', 'Aufrufe zweimal ansagen', 'Für laute Räume: „… Ich wiederhole: …“'),
        h('div', { class: 'small dim' }, '😮‍💨 Ruhezeit: Wer gerade gespielt hat, kommt möglichst erst danach wieder dran (gibt es kein anderes Spiel, trotzdem – kein Board bleibt leer)'),
        seg('tourRest', [[0, 'Aus'], [3, '3 Min.'], [5, '5 Min.'], [10, '10 Min.']]),
        h('div', { class: 'small dim' }, '⏳ Board kurz frei lassen: nach Spielende so lange nichts Neues an dieses Board (Zeit zum Aufräumen und Wechseln)'),
        seg('tourBoardGap', [[0, 'Sofort'], [1, '1 Min.'], [2, '2 Min.'], [3, '3 Min.']]),
        toggle('tourBeforePause', 'Vor einer geplanten Pause nichts Langes mehr aufrufen', 'Nur Spiele, die nach üblicher Dauer noch vor der Pause fertig werden'),
        toggle('tourPauseEndCalls', 'Pausenende mit den ersten Spielen ansagen', '1 Min. vorher „… Als Erstes: Anna gegen Ben“, am Ende „Es geht weiter!“'),
        h('div', { class: 'small dim' }, '⚠️ Spiel läuft ungewöhnlich lange: Kachel orange ab … (Auto = doppelte übliche Dauer des Formats, mindestens 15 Min.)'),
        seg('tourStaleMin', [['auto', 'Auto'], [30, '30'], [45, '45'], [60, '60'], [0, 'Aus']]),
        toggle('tourOnlyConnected', 'Nur Boards mit Handy aufrufen', 'Spiele gehen nur an Boards, an denen ein Handy angemeldet ist'),
        toggle('tourDelayWarn', 'Warnung bei Verzögerung', 'Nach 5 Minuten nicht begonnen: gelb markieren und nochmal ansagen'),
        h('div', { class: 'small dim' }, '⏸ Nicht da → kampflos: Ist ein Spieler so lange als „nicht da“ markiert, geht sein nächstes Spiel kampflos an den Gegner (danach beginnt die Zeit fürs nächste Spiel neu)'),
        seg('tourAbsentWo', [[0, 'Aus'], [10, '10 Min.'], [15, '15 Min.'], [30, '30 Min.']]),
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
    // Je Wert genau eine Karte – nichts doppelt (die einzelnen Highlights stehen im Fokus-Reiter „🏁 Ergebnisse“)
    const out = [];
    const c180 = stats.filter((x) => x.s.c180 > 0).sort((a, b) => b.s.c180 - a.s.c180);
    if (c180.length) out.push({ icon: '🎯', value: String(c180.reduce((a, x) => a + x.s.c180, 0)), label: '180er', who: c180.map((x) => `${nameOf(t, x.id)}${x.s.c180 > 1 ? ` ×${x.s.c180}` : ''}`).join(', ') });
    const fin = top((s) => s.highestCheckout);
    if (fin) out.push({ icon: '✅', value: String(fin.v), label: 'Höchstes Finish', who: fin.names.join(', ') });
    const avg = top((s) => s.average, (s) => s.darts >= 9);
    if (avg) out.push({ icon: '📈', value: avgText(avg.v), label: 'Bester Average', who: avg.names.join(', ') });
    // Kürzestes Leg (gewonnene Legs, wenigste Darts)
    const legs = matches.filter((m) => m.tournament && m.tournament.id === t.id && m.status !== 'aborted' && !(t.stopped || {})[m.id] && m.mode === 'x01').flatMap((m) => legsOf(m));
    if (legs.length) {
      const min = Math.min(...legs.map((l) => l.darts));
      const who = [...new Set(legs.filter((l) => l.darts === min).map((l) => nameOf(t, l.id)))];
      out.push({ icon: min <= 9 ? '💎' : '⚡', value: String(min), label: min <= 9 ? '9-Darter!' : 'Kürzestes Leg (Darts)', who: who.join(', ') });
    }
    // Finishes ab 100: Anzahl, wer
    const ton = matches.filter((m) => m.tournament && m.tournament.id === t.id && m.status !== 'aborted' && !(t.stopped || {})[m.id]).flatMap((m) => highlightsOf(m)).filter((x) => x.kind === 'finish');
    if (ton.length > 1) {
      const cnt = new Map();
      for (const x of ton) cnt.set(x.playerId, (cnt.get(x.playerId) || 0) + 1);
      out.push({ icon: '🏁', value: String(ton.length), label: 'Finishes ab 100', who: [...cnt].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${nameOf(t, id)}${n > 1 ? ` ×${n}` : ''}`).join(', ') });
    }
    // Beste Aufnahme nur, wenn sie unter 180 liegt – sonst sagt die 180er-Karte dasselbe
    const hi = top((s) => s.highest);
    if (hi && hi.v < 180) out.push({ icon: '💥', value: String(hi.v), label: 'Beste Aufnahme', who: hi.names.join(', ') });
    return out;
  }

  /** Gewonnene Legs eines Matches: [{ id (Sieger), darts }] (zwischengespeichert wie rowsOf). */
  const legCache = new Map();
  function legsOf(m) {
    const c = legCache.get(m.id);
    if (c && c.at === m.updatedAt) return c.legs;
    const out = [];
    try {
      for (const leg of derive(m).legs) {
        const darts = new Map();
        for (const info of leg.turns) {
          darts.set(info.player, (darts.get(info.player) || 0) + ((info.ev && info.ev.usedDarts) || (info.darts || []).length || 3));
          if (info.ev && info.ev.finished) out.push({ id: m.players[info.player], darts: darts.get(info.player) });
        }
      }
    } catch { /* defektes Match */ }
    legCache.set(m.id, { at: m.updatedAt, legs: out });
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
    // Während in der Pause-Karte getippt wird, nicht neu zeichnen (sonst verliert das Feld den Fokus)
    if (keepFields.includes(document.activeElement)) return;
    const { t, st, matches, plan, raw } = last;
    const s = getSettings();
    const boards = boardStatus(t, st);
    const connected = presence.connected();
    const boardOf = (g) => boards.find((b) => b.game && b.game.key === g.key)?.board || null;
    const played = st.games.filter((g) => g.status === 'done').length;
    const total = st.games.filter((g) => !g.bye).length;
    const phase = st.done ? 'Beendet' : t.format === 'gko' && !st.groupsDone ? 'Gruppenphase' : t.ko ? (st.koRounds.find((r) => r.games.some((g) => g.status !== 'done' && g.status !== 'bye'))?.name || 'K.-o.') : 'Spiele';
    const url = baseUrl(info); // nur WLAN
    const next = upcomingQueue(t, st).slice(0, 6);
    const eta = s.tourSchedule && !st.done ? scheduleEstimate(t, st) : null;
    const nameBtn = (id, extra = {}) => h('span', { class: 'namelink', ...extra, onclick: (e) => { e.stopPropagation(); profile(id); } }, nameOf(t, id));
    const canJoin = (url || info?.cloud) && !st.done;
    // QR-Code und Hinweis in der Beitreten-Zeile: von Hand ein/aus (Knopf QR), sonst solange noch Handys fehlen
    const qr = canJoin && (qrOpen ?? connected.size < t.boards);
    // Größe: das Fernseher-Fenster merkt sich eigene Werte (Laptop und Fernseher sind verschieden groß)
    const ZK = viewer ? 'tourZoomTv' : 'tourZoom';
    const PZK = viewer ? 'tourPlanZoomTv' : 'tourPlanZoom';
    // Fernseher-Fenster: Größe, Seite und Wechsel kommen von der Turnierleitung (t.tv, 🖥️ › „Fernseher steuern“)
    const tvc = viewer ? (t.tv || {}) : {};
    // Handy (schmaler Bildschirm): kein Fokus-/Fernseher-Layout und keine Größe vom PC – alles untereinander, mit Zurück
    const phone = matchMedia('(max-width: 760px)').matches;
    const zoom = phone ? 1 : tvc.zoom || s[ZK] || 1;
    const planZoom = phone ? 1 : tvc.planZoom || s[PZK] || 1;
    body.style.zoom = String(zoom);
    body.style.setProperty('--z', String(zoom)); // für die volle Bildschirmhöhe im Fokus (CSS rechnet 100vh / Zoom)
    const n = boardStatus(t, st).length;
    const boardCols = Math.min(n, s.tourCols && s.tourCols !== 'auto' ? +s.tourCols : n <= 1 ? 1 : n <= 4 ? 2 : 3);
    // Freie Boards: welches Spiel käme als Nächstes dorthin (in der Pause oder ohne Handy)
    const freeBoards = boards.filter((b) => !b.game).map((b) => b.board);
    const upcoming = (board) => next[freeBoards.indexOf(board)] || null;

    const phonePill = (b) => {
      const p = raw[b.board];
      return connected.has(b.board)
        ? h('span', { class: 'phone ok' }, `📱 ${p && p.device ? p.device : 'verbunden'}`)
        : h('span', {
          class: `phone off ${canJoin && !viewer ? 'tap' : ''}`,
          title: 'Handy für dieses Board verbinden',
          onclick: (e) => { if (!canJoin || viewer) return; e.stopPropagation(); connectSheet(t, b); },
        }, canJoin && !viewer ? '⚠️ kein Handy · 📱 verbinden' : '⚠️ kein Handy');
    };
    const head = (b, g) => h('div', { class: 'bnum' },
      h('span', {}, `Board ${b.board}`, g ? h('span', { class: 'bmeta' }, ` · ${g.roundName} · ${formatText(formatFor(t, g))}`) : null),
      phonePill(b));

    // Eine Hälfte der Kachel (ab 1.23.1) als Raster: oben Name und „wirft jetzt“, links der Rest so groß wie möglich,
    // rechts oben die Legs, rechts unten Zuletzt und die Averages, am unteren Rand die kleinen Infos und der Checkout-Weg.
    // Die Schrift richtet sich nach der Hälfte (Container-Einheiten in styles.css).
    const half = (id, p) => h('div', { class: `bside ${p && p.active ? 'on' : ''}` }, h('div', { class: 'bgrid' }, // inneres Raster: Container-Abfragen gelten nur für Kind-Elemente
      h('div', { class: 'bstop' },
        h('div', { class: 'bname' }, p && p.active ? '▶ ' : '', nameBtn(id)),
        // Werfer ohne eingegebene Darts: rotes Schild oben rechts (bei Summen-Eingabe kommen keine einzelnen Darts an)
        p && p.active && !p.now.length ? h('span', { class: 'bnow' }, 'wirft jetzt') : null),
      p ? [
        h('div', { class: 'brest num' }, String(p.rest)),
        h('div', { class: 'bstats num' },
          // Punkte je nötigem Leg: ●○ = 1 von 2 gewonnen
          h('div', { class: 'blegs' },
            h('span', { class: 'legdots', title: `Legs ${p.legs} von ${p.legsNeeded}` }, Array.from({ length: p.legsNeeded }, (_, k) => h('i', { class: k < p.legs ? 'on' : '' }))),
            h('span', {}, p.showSets ? `Sätze ${p.sets}/${p.setsNeeded} · ` : '', `Legs ${p.legs} von ${p.legsNeeded}`)),
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
      // Hängendes Spiel: läuft viel länger als üblich -> orange, Tipp öffnet die Optionen (neu starten, Ergebnis, …)
      const stale = running && mins != null && staleMinutes(t, g) > 0 && mins >= staleMinutes(t, g);
      // Handy weg während des Spiels: nach 1½ Min. deutlich rot (nur Turnierleitung). Kommt es zurück, geht es dort weiter.
      const seenAt = presence.lastSeen(b.board);
      const awayMs = running && !viewer && seenAt && !connected.has(b.board) ? Date.now() - seenAt : 0;
      const away = awayMs > 90000;
      if (away && s.tourSound) announce(`away:${b.board}:${seenAt}`, `Achtung, Board ${b.board}: Das Handy ist nicht mehr verbunden.`);
      return h('div', {
        class: `boardtile ${running ? 'running' : 'called'} ${late ? 'late' : ''} ${stale ? 'stale' : ''} ${away ? 'phoneaway' : ''}`,
        onclick: () => { if (!tv) boardMenu(t, b); },
      },
      head(b, g),
      h('div', { class: 'bsides' }, half(g.a, ps && ps[0]), h('div', { class: 'bvs' }, 'vs.'), half(g.b, ps && ps[1])),
      away ? h('div', { class: 'awaybar' }, `📵 Handy seit ${Math.floor(awayMs / 60000)} Min. weg – kommt es zurück (App öffnen), geht das Spiel dort weiter. Sonst antippen: anderes Handy verbinden oder Ergebnis eintragen.`) : null,
      h('div', { class: 'bfoot' },
        h('span', { class: 'bstate' }, stale ? `⚠️ läuft seit ${mins} Min. – ungewöhnlich lang${viewer ? '' : ' · antippen'}` : running ? `⏵ läuft${mins != null ? ` seit ${mins} Min.` : ''}` : late ? `⏰ seit ${Math.floor((Date.now() - b.since) / 60000)} Min. nicht begonnen` : `📣 aufgerufen ${fmtClock(b.since)}`),
        b.writer ? h('span', {}, `✍️ Schreiber: ${nameOf(t, b.writer)}`) : null));
    };

    const tool = (label, title, onclick, on = false) => h('button', { class: `toolbtn ${on ? 'on' : ''}`, title, onclick }, label);
    // Knopf mit Beschriftung (Leiste der Turnierleitung)
    const ltool = (icon, text, title, onclick, on = false) => h('button', { class: `ltool ${on ? 'on' : ''}`, title, onclick }, h('span', { class: 'licon' }, icon), h('span', { class: 'tlabel' }, text));
    // Wer steht gerade am Board (für die Tabellen): spielt / aufgerufen / schreibt – mit Board-Nummer
    const busyMap = {};
    for (const b of boards) {
      if (!b.game) continue;
      for (const id of [b.game.a, b.game.b]) busyMap[id] = { kind: b.game.status === 'running' ? 'play' : 'called', board: b.board };
      if (b.writer && !busyMap[b.writer]) busyMap[b.writer] = { kind: 'write', board: b.board };
    }
    // Fokus: nur Uhr, Boards und die gewählten Bereiche (Standard: Als Nächstes und Bestwerte)
    const focus = viewer || (!!s.tourFocus && !phone);
    // Fernseher/Fokus: Vereinslogo und -name (im Turnier, t.brand) und helles Farbschema für helle Räume
    const brand = t.brand || {};
    document.documentElement.classList.toggle('tvlight', focus && !phone && (viewer ? tvc.theme : s.tourTheme) === 'light');
    // 🗓️ Geplante Pause (Fokus/Fernseher, auf allen Seiten): schmaler Hinweis mit Uhrzeit und Countdown bis zum Beginn
    const plannedBar = () => {
      const pp = t.plannedPause;
      if (!focus || !pp || st.done || pp.at <= Date.now()) return null;
      const left = pp.at - Date.now();
      const mm = Math.floor(left / 60000);
      const ss = Math.floor((left % 60000) / 1000);
      return h('div', { class: `pausebanner slim planned ${viewer ? '' : 'tap'}`, onclick: () => { if (!viewer) pauseSheet(); } },
        h('div', { class: 'pbicon' }, '🗓️'),
        h('div', { class: 'pbtext' },
          h('div', { class: 'pbtitle' }, `${pp.reason || 'Pause'} um ${fmtClock(pp.at)} Uhr`),
          h('div', { class: 'pbsub' }, `${pp.min} Minuten, bis ${fmtClock(pp.at + pp.min * 60000)} Uhr · laufende Spiele werden noch zu Ende gespielt`)),
        h('div', { class: 'pbcount num' }, h('span', { class: 'pbin' }, 'in '), left >= 3600000 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')} h` : `${mm}:${String(ss).padStart(2, '0')}`));
    };
    // Pause: Banner mit Grund, Uhrzeit und Countdown – groß über den Boards, schmal über allen anderen Seiten
    // (Gruppen, K.-o., Ergebnisse), damit die Restzeit auch beim Durchwechseln immer zu sehen ist
    const pauseBar = (slim = false) => {
      if (!plan.pauseUntil || st.done) return null;
      const left = Math.max(0, plan.pauseUntil - Date.now());
      const mm = Math.floor(left / 60000);
      const ss = Math.floor((left % 60000) / 1000);
      const running = boards.filter((b) => b.game && b.game.status === 'running').length;
      return h('div', { class: `pausebanner ${slim ? 'slim' : ''} ${viewer ? '' : 'tap'}`, onclick: () => { if (!viewer && plan.manualPause) pauseSheet(); } },
        h('div', { class: 'pbicon' }, '☕'),
        h('div', { class: 'pbtext' },
          h('div', { class: 'pbtitle' }, plan.manualPause ? (t.pauseReason || 'Pause') : `Pause vor ${(st.koRounds.find((r) => r.games.some((g) => g.status !== 'done' && g.status !== 'bye')) || {}).name || 'der nächsten Runde'}`),
          h('div', { class: 'pbsub' }, `Nächste Spiele um ${fmtClock(plan.pauseUntil)} Uhr${running ? ` · ${running} Spiel${running > 1 ? 'e laufen' : ' läuft'} noch zu Ende` : ' · gerade läuft kein Spiel'}`)),
        h('div', { class: 'pbcount num' }, left >= 3600000 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')} h` : `${mm}:${String(ss).padStart(2, '0')}`));
    };
    // Gibt es die rechte Spalte (Turnierbaum daneben)? Dann steht die Pause-Karte dort oben, sonst unter den Boards
    const main = h('div', { class: 'livemain stack' },
      // 🙋 Rufe der Board-Handys: rot oben, bis „Bin unterwegs“ getippt wird (das Handy bekommt eine Bestätigung)
      viewer ? null : helpCalls(raw, t).map((p) => h('div', { class: 'helpbar' },
        h('span', { class: 'hbicon' }, '🙋'),
        h('div', { class: 'hbtext' }, h('b', {}, `Board ${p.board} ruft die Turnierleitung`), h('span', { class: 'small' }, `seit ${fmtClock(p.help)} Uhr`)),
        h('button', { class: 'chip on', onclick: () => commit({ ...last.t, helpAck: { ...(last.t.helpAck || {}), [p.board]: p.help } }, `🙋 Ruf von Board ${p.board} bestätigt`) }, '✅ Bin unterwegs'))),
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
      // Kacheln nebeneinander: 📱 Handys, ☕ Pause (bzw. 🚀 Start), 📣 Aufruf – antippen klappt den Inhalt darunter auf
      !focus && !viewer && !st.done ? (() => {
        const pending = boards.some((b) => connected.has(b.board) && raw[b.board] && raw[b.board].pending);
        const pausedNow = t.pausedUntil && t.pausedUntil > Date.now();
        const notStarted = !startedOf(t, matches);
        const startSet = notStarted && pausedNow && t.startAt === t.pausedUntil;
        const tiles = [
          canJoin ? ['phones', '📱 Handys', `${connected.size} von ${t.boards} verbunden${pending ? ' · ⚠️ Stände warten' : ''}`, connected.size < t.boards || pending] : null,
          notStarted ? ['start', '🚀 Gleich geht\'s los', startSet ? `Start um ${fmtClock(t.startAt)} Uhr` : 'Startzeit mit Countdown', startSet] : null,
          ['pause', '☕ Pause', pausedNow && !startSet ? `bis ${fmtClock(t.pausedUntil)} Uhr` : 'keine Pause', pausedNow && !startSet],
          ['call', '📣 Aufruf', 'Spieler, Spiel oder Durchsage', false],
          (() => {
            const ts = timeStatus(t, st, matches);
            const icon = { ok: '🟢', tight: '🟡', late: '🔴' }[ts.level] || '⏱';
            const sub = ts.level ? `Ende ~${fmtClock(ts.fc.at)} · ${ts.delta > 0 ? `${Math.round(ts.delta / 60000)} Min. zu spät` : 'im Plan'}` : 'geplantes Ende festlegen';
            return ['time', `${icon} Zeitplan`, sub, ts.level === 'late', `tl-${ts.level || 'none'}`];
          })(),
        ].filter(Boolean);
        if (openPanel && !tiles.some(([k]) => k === openPanel)) openPanel = null;
        return h('div', { class: 'panelwrap' },
          h('div', { class: `panelrow n${tiles.length}` }, tiles.map(([k, label, sub, hot, extra]) => h('button', {
            class: `card panelhead ${openPanel === k ? 'open' : ''} ${hot ? 'hot' : ''} ${extra || ''}`, onclick: () => { openPanel = openPanel === k ? null : k; draw(); },
          }, h('div', {}, h('b', {}, label), h('div', { class: 'small dim' }, sub)), h('span', { class: 'pharrow' }, openPanel === k ? '▴' : '▾')))),
          openPanel === 'start' ? startPanel(t) : null,
          openPanel === 'pause' ? pausePanel(t) : null,
          openPanel === 'call' ? callPanel(t, st) : null,
          openPanel === 'time' ? timePanel(t, st, matches) : null,
          openPanel === 'phones' ? h('div', { class: 'card phonecard' }, h('div', { class: 'phonelist' }, boards.map((b) => {
          const p = connected.has(b.board) ? raw[b.board] : null;
          const ago = p ? Math.max(0, Math.round((Date.now() - (presence.lastSeen(b.board) || Date.now())) / 1000)) : null;
          const g = b.game;
          return h('div', { class: `phonerow ${p ? 'ok' : 'off'}` },
            h('b', {}, `Board ${b.board}`),
            h('span', {}, p ? `📱 ${p.device || 'Handy'}` : '— kein Handy'),
            h('span', { class: `num ${ago != null && ago > 15 ? 'warn' : 'dim'}` }, p ? `Meldung vor ${ago} s` : ''),
            h('span', { class: 'dim' }, g ? `${g.status === 'running' ? 'spielt' : 'aufgerufen'}: ${nameOf(t, g.a)} – ${nameOf(t, g.b)}` : 'frei', p && p.pending ? h('b', { class: 'warn' }, ` · ⚠️ ${p.pending} ${p.pending > 1 ? 'Spielstände warten' : 'Spielstand wartet'} auf Übertragung`) : null),
            p ? h('button', { class: 'btn ghost small', onclick: () => kickPhone(t, b.board) }, '📴 Abmelden')
              : h('button', { class: 'btn ghost small', onclick: () => connectSheet(t, b) }, '📱 Verbinden'));
        })),
        h('div', { class: 'small dim' }, 'Ein Handy gilt nach 30 Sekunden ohne Meldung als weg (App zu oder iPhone gesperrt). „Abmelden“ gibt das Board sofort für ein anderes Handy frei.')) : null);
      })() : null,
      st.done && st.champion ? champCard(t, st) : null,
      // 🏆 Siegerehrung: Platz 3, 2, 1 nacheinander ansagen und groß einblenden (auch Fernseher), dann das Podest
      st.done && st.champion && !viewer && !focus ? h('button', {
        class: 'btn primary ceremonybtn',
        onclick: async () => { unlock(); await commit({ ...last.t, ceremony: { at: Date.now() } }, '🏆 Siegerehrung gestartet'); },
      }, t.ceremony ? '🏆 Siegerehrung nochmal starten' : '🏆 Siegerehrung starten (Platz 3, 2, 1 – mit Ansage)') : null,
      // Höchstens 2 Boards nebeneinander (ab 5 Boards 3) – so werden die Kacheln groß; einstellbar unter ⚙️
      // Pause: großes Banner über den Boards (auch Fokus und Fernseher) mit Grund, Uhrzeit und Countdown
      pauseBar() || plannedBar(),
      h('div', { class: `boardgrid cols${boardCols}` }, boards.map(tile)),
      // ☕ Pause-Karte (Turnierleitung): rechts neben dem Turnierbaum, ohne rechte Spalte direkt unter den Boards
      // Wer nicht da ist (Check-in / Abwesenheit) – nur an der Leitung
      !focus && !viewer && Object.keys(t.absent || {}).length ? h('div', { class: 'card awaycard' }, h('b', {}, '⏸ Nicht da: '),
        Object.keys(t.absent).map((id, i) => [i ? ', ' : '', nameBtn(id)]), h('span', { class: 'small dim' }, ' – werden nicht aufgerufen. Antippen: Profil, dort „ist wieder da“.')) : null);

    // Bereiche unter den Boards – Reihenfolge und Ein/Aus: 👁 in der Leiste bzw. ⚙️ › Anordnung
    const recent = st.games.filter((g) => g.status === 'done' && g.result && !g.bye).sort((x, y) => (y.result.at || 0) - (x.result.at || 0)).slice(0, 4);
    const best = bests(t, matches);
    const parts = {
      // im Fokus nur eine Zeile (die nächsten 4)
      // Pause steckt hier im Dashboard (☕ rechts neben „Als Nächstes“) statt oben in der Leiste
      next: () => (next.length ? [sec(SECTIONS.next, viewer || st.done || !focus ? null : h('button', { class: `chip pausechip ${plan.manualPause ? 'on' : ''}`, onclick: pauseSheet }, plan.manualPause ? `☕ Pause bis ${fmtClock(plan.pauseUntil)}` : '☕ Pause einlegen')), h('div', { class: 'livenext' }, next.slice(0, focus ? 4 : 6).map((g, i) => {
        const away = [g.a, g.b].filter((id) => (t.absent || {})[id]);
        const at = eta && eta.starts.get(g.key);
        return h('div', { class: `nextcard ${away.length ? 'away' : ''} ${viewer ? '' : 'tap'}`, onclick: () => { if (!viewer) nextMenu(g); } },
          h('span', { class: 'nextno num' }, String(i + 1)),
          h('div', { class: 'nexttext' }, h('b', {}, nameBtn(g.a), h('span', { class: 'vs' }, ' – '), nameBtn(g.b)),
            h('span', { class: 'dim' }, g.roundName, at ? ` · ca. ${fmtClock(at)}` : '', (t.defer || {})[g.key] ? ' · zurückgestellt' : ''),
            away.length ? h('span', { class: 'warn small' }, `⏸ wartet auf ${away.map((id) => nameOf(t, id)).join(' und ')}`) : null));
      }))] : null),
      // Bestwerte & Highlights: nur große Karten. Mehr als 4: seitenweise durchlaufen (alle 8 Sekunden, Punkte unten)
      best: () => {
        if (!best.length) return null;
        const per = 4;
        const pages = Math.ceil(best.length / per);
        const page = pages > 1 ? Math.floor(Date.now() / 8000) % pages : 0;
        const fresh = pages > 1 && page !== bestPage; // nur beim Seitenwechsel einblenden (die Ansicht zeichnet alle 2 s neu)
        bestPage = page;
        return [sec(SECTIONS.best),
          h('div', { class: 'bestgrid' }, best.slice(page * per, page * per + per).map((x) => h('div', { class: `bestcard ${fresh ? 'fadein' : ''}` },
            h('div', { class: 'besticon' }, x.icon), h('div', { class: 'bestval num' }, x.value),
            h('div', { class: 'besttext' }, h('div', { class: 'bestlabel' }, x.label), h('div', { class: 'bestwho' }, x.who))))),
          pages > 1 ? h('div', { class: 'bestdots' }, Array.from({ length: pages }, (_, i) => h('i', { class: i === page ? 'on' : '' }))) : null];
      },
      results: () => (recent.length ? [sec(SECTIONS.results), h('div', { class: 'resultlist' }, recent.map((g) => h('div', { class: 'resultrow' },
        h('span', { class: g.winnerId === g.a ? 'win' : '' }, nameBtn(g.a)),
        h('b', { class: 'num' }, g.result.walkover ? 'w.o.' : `${g.result.legs[g.a] ?? 0} : ${g.result.legs[g.b] ?? 0}${g.result.draw ? ' U' : ''}`),
        h('span', { class: g.winnerId === g.b ? 'win' : '' }, nameBtn(g.b)),
        h('span', { class: 'dim small' }, g.roundName))))] : null),
      plan: () => planView(t, st, { boardOf, compact: true, onName: profile, busy: busyMap }),
    };
    const shown = sectionOrder().filter((k) => sectionVisible(k));
    // Turnierbaum „Daneben“: auf breiten Bildschirmen rechte Spalte (im Fokus immer unten)
    const planSide = shown.includes('plan') && s.tourPlan !== 'below' && !focus;
    // Im Fokus steht der Turnierplan nie unter den Boards – dafür gibt es die eigenen Seiten 👥 Gruppen und 🌳 K.-o.
    const below = shown.filter((k) => !(k === 'plan' && (planSide || focus)));
    if (below.length) main.append(h('div', { class: 'liveinfo stack', style: { zoom: String(planZoom) } }, below.map((k) => parts[k]())));
    // Zuschauer-QR (optional, 🖥️ › Zuschauer-Link): klein unten im Fokus und im Fernseher-Fenster
    if (focus && s.tourWatchQr && info && !st.done) main.append(h('div', { class: 'watchqr' }, h('div', { class: 'qrimg', html: qrFor(watchUrl()) }), h('div', {}, h('b', {}, '📱 Live mitverfolgen'), h('div', { class: 'small dim' }, 'Scannen, Namen wählen – dein nächstes Spiel, Live-Stand und Tabellen. Auf Wunsch mit Hinweis, wenn du bald dran bist.'))));
    const side = planSide ? h('div', { class: 'liveside stack', style: { zoom: String(planZoom) } }, parts.plan()) : null;
    // Zuschauer-QR in Pausen (und solange kein Spiel läuft) klein in der Ecke – Fokus und Fernseher
    const idleNow = !boards.some((b) => b.game);
    const cornerQr = focus && info && !st.done && getSettings().tourWatchQrPause !== false && (idleNow || !!plan.pauseUntil)
      ? h('div', { class: 'cornerqr' }, h('div', { class: 'qrimg', html: qrFor(watchUrl()) }), h('div', { class: 'cqtext' }, h('b', {}, '📱 Live mitverfolgen'), h('span', {}, 'Scannen, Namen wählen – du siehst, wann du dran bist'))) : null;

    // Fokus-Seiten: 🎯 Boards (Standard), 👥 Gruppen und 🌳 K.-o. jeweils bildschirmfüllend (z. B. in einer Pause)
    const allResults = st.games.filter((g) => g.status === 'done' && g.result && !g.bye).sort((x, y) => (y.result.at || 0) - (x.result.at || 0));
    const tabs = [st.done && st.champion ? ['podium', '🏆 Siegerehrung'] : null, ['boards', '🎯 Boards'], st.groups.length ? ['groups', t.format === 'rr' ? '📊 Tabelle' : '👥 Gruppen'] : null, st.koRounds.length ? ['ko', '🌳 K.-o.'] : null, allResults.length ? ['results', '🏁 Ergebnisse'] : null].filter(Boolean);
    // Turnier beendet: Fokus und Fernseher springen einmal von selbst zur Siegerehrung
    if (focus && st.done && st.champion && !podiumShown) { focusTab = 'podium'; podiumShown = true; }
    if (!tabs.some(([k]) => k === focusTab)) focusTab = 'boards';
    // Automatisch wechseln (Fokus und Fernseher): nur wenn kein Spiel läuft oder aufgerufen ist bzw. in der Pause.
    // Wird ein Spiel aufgerufen, sofort zurück zu den Boards. Nach einem Klick 60 Sekunden lang nichts von selbst.
    const idle = !st.done && (!boards.some((b) => b.game) || !!plan.pauseUntil);
    const rotateOn = viewer && tvc.rotate != null ? tvc.rotate : s.tourRotate !== false;
    const forced = viewer && tvc.page && tvc.page !== 'auto' && tabs.some(([k]) => k === tvc.page) ? tvc.page : null;
    if (forced) { focusTab = forced; autoTab = false; }
    else if (focus && rotateOn && tabs.length > 1 && Date.now() > manualUntil) {
      if (idle) {
        const sec = Math.max(5, (viewer && tvc.rotateSec) || s.tourRotateSec || 20);
        focusTab = tabs[Math.floor(Date.now() / (sec * 1000)) % tabs.length][0];
        autoTab = true;
      } else if (autoTab) { focusTab = 'boards'; autoTab = false; }
    }
    // Fokus-Seite 🏁 Ergebnisse: alle Ergebnisse, neueste zuerst, daneben alle Highlights
    const resultsPage = () => h('div', { class: 'focuspage stack resultspage', style: { zoom: String(planZoom) } },
      h('div', { class: 'resultscols' },
        h('div', { class: 'stack' }, sec(`🏁 Ergebnisse (${allResults.length})`), h('div', { class: 'resultlist big' }, allResults.slice(0, 40).map((g) => h('div', { class: 'resultrow' },
          h('span', { class: 'num dim small' }, g.result.at ? fmtClock(g.result.at) : ''),
          h('span', { class: g.winnerId === g.a ? 'win' : '' }, nameBtn(g.a)),
          h('b', { class: 'num' }, g.result.walkover ? 'w.o.' : `${g.result.legs[g.a] ?? 0} : ${g.result.legs[g.b] ?? 0}${g.result.draw ? ' U' : ''}`),
          h('span', { class: g.winnerId === g.b ? 'win' : '' }, nameBtn(g.b)),
          h('span', { class: 'dim small' }, g.roundName))))),
        ticker.length ? h('div', { class: 'stack' }, sec(`🔥 Highlights (${ticker.length})`), h('div', { class: 'stack hllist' }, ticker.slice(0, 30).map((x) => h('div', { class: `tickeritem k${x.kind}` }, x.text, x.board ? h('span', { class: 'dim' }, ` · Board ${x.board}`) : null)))) : null));
    // „Gleich geht's los“: vor dem ersten Spiel, solange eine Startzeit läuft oder noch nichts aufgerufen ist
    const started = startedOf(t, matches);
    const showStart = focus && !started && !st.done && ((t.startAt && t.startAt > Date.now()) || idleNow);
    const startPage = () => {
      const left = t.startAt && t.startAt > Date.now() ? t.startAt - Date.now() : 0;
      const mm = Math.floor(left / 60000);
      const ss = Math.floor((left % 60000) / 1000);
      const first = upcomingQueue(t, st).slice(0, Math.max(2, (t.boards || 2) * 2));
      return h('div', { class: 'focuspage startpage' },
        h('div', { class: 'spmain' },
          h('div', { class: 'spkicker' }, `${TOURNAMENT_FORMATS[t.format] || ''} · ${t.players.length} Spieler · ${t.boards} Board${t.boards > 1 ? 's' : ''}`),
          h('div', { class: 'sptitle' }, t.name),
          h('div', { class: 'spgo' }, '🎯 Gleich geht\'s los!'),
          left ? h('div', { class: 'spcount num' }, left >= 3600000 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')} h` : `${mm}:${String(ss).padStart(2, '0')}`) : null,
          left ? h('div', { class: 'spat' }, `Start um ${fmtClock(t.startAt)} Uhr`) : h('div', { class: 'spat' }, 'Die ersten Spiele werden gleich aufgerufen')),
        h('div', { class: 'spside' },
          first.length ? h('div', { class: 'card spfirst' }, h('b', {}, '⏭️ Die ersten Spiele'),
            first.map((g, i) => h('div', { class: 'spgame' }, h('span', { class: 'nextno num' }, String(i + 1)), h('span', {}, h('b', {}, `${nameOf(t, g.a)} – ${nameOf(t, g.b)}`), h('span', { class: 'dim small' }, ` · ${g.roundName}`))))) : null,
          info ? h('div', { class: 'card spqr' }, h('div', { class: 'qrimg', html: qrFor(watchUrl()) }), h('div', {}, h('b', {}, '📱 Live mitverfolgen'), h('div', { class: 'small dim' }, 'Scannen, Namen wählen – du siehst, wann du dran bist.'))) : null));
    };
    const page = showStart ? startPage()
      : !focus || focusTab === 'boards' ? null
      : focusTab === 'podium' ? podiumPage(t, st, best)
      : focusTab === 'results' ? resultsPage()
      : focusTab === 'groups'
        ? h('div', { class: 'focuspage stack', style: { zoom: String(planZoom) } },
          t.format === 'gko' ? h('div', { class: 'pagehint', title: TIEBREAK_TEXT }, 'Platz 1 und 2 kommen weiter · ✓ = sicher weiter, ✗ = raus') : null,
          h('div', { class: `groupgrid ${st.groups.length <= 1 ? 'gcols1' : st.groups.length <= 4 ? 'gcols2' : 'gcols3'}` }, st.groups.map((grp) => h('div', { class: 'card groupcard' },
            st.groups.length > 1 ? h('div', { class: 'grouphead' }, h('b', {}, grp.name), h('span', { class: 'small dim' }, grp.done ? 'fertig ✓' : `${grp.games.filter((g) => g.status === 'done').length} / ${grp.games.length} Spiele`)) : null,
            groupTable(t, grp, !!t.ko, { onName: profile, busy: busyMap })))))
        : h('div', { class: 'focuspage stack', style: { zoom: String(planZoom) } }, bracket(t, st, { boardOf }));
    curTabs = tabs;

    const settingsBtn = tool('⚙️', 'Einstellungen: Ansicht (Seite, Größe, QR-Codes), Ton, Anordnung, Ablauf', liveSettings);
    const focusBtn = tool('🎯', focus ? 'Fokus beenden: alles wieder zeigen' : 'Fokus: nur Uhr, Boards und das Wichtigste', () => { updateSettings({ tourFocus: !focus }); draw(); }, focus);
    const fullBtn = tool('⛶', 'Vollbild (Esc beendet)', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Vollbild nicht möglich – F11 drücken.'));
    });
    // Fernseher-Fenster: oben keine Knöpfe – nur ein unauffälliges ⛶ (Vollbild geht nur am Gerät selbst)
    const tvFull = h('button', { class: 'toolbtn tvfull', title: 'Vollbild (oder F11)', onclick: () => fullBtn.click() }, '⛶');
    // Fernseher-Link auf dem Handy geöffnet: ‹ zur Startseite, 👀 zur Zuschauer-Ansicht (fürs Handy gemacht)
    const leaveTv = (to) => { history.replaceState(null, '', location.pathname); nav.go(to); };
    const phoneTv = viewer && phone ? h('button', { class: 'chip phonewatch', onclick: () => leaveTv('watch') }, '👀 Zuschauer-Ansicht') : null;
    body.classList.toggle('focus', focus && !phone);
    body.classList.toggle('phone', phone);
    body.classList.toggle('onerow', focus && !phone && n <= boardCols); // nur eine Reihe Boards (z. B. 2): Boards begrenzen, unten mehr Platz
    // Kacheln (Spiele, Boards, Zeiten …): oben in der Leiste oder – nur Turnierleitung – groß als Karten darunter (⚙️ › Ansicht)
    const cardsBelow = !focus && s.tourHeadPlace === 'cards';
    let headChips = null;
    body.replaceChildren(
      h('div', { class: 'livehead' },
        viewer && phone ? h('button', { class: 'iconbtn', title: 'Zur Startseite', onclick: () => leaveTv('home') }, '‹')
        : tv || focus ? null : h('button', { class: 'iconbtn', title: 'Zur Turnier-Seite', onclick: () => nav.go('tournament', { id: t.id }) }, '‹'),
        // Titel mit Phase als Schild; im Fokus/Fernseher davor Vereinslogo und -name (🖥️ › Fernseher steuern)
        h('div', { class: 'livetitle' },
          h('div', { class: 'titlerow' },
            focus && brand.logo ? h('img', { class: 'brandlogo', src: brand.logo, alt: '' }) : null,
            focus && brand.name ? h('span', { class: 'brandname' }, brand.name) : null,
            h('h1', {}, t.name), h('span', { class: 'phasepill' }, phase))),
        // Laufzeit und Prognose als ruhige Kacheln: jede Angabe genau einmal
        // Fokus/Fernseher: jede Zeit einzeln abschaltbar (⚙️ › Ansicht bzw. 🖥️ › Fernseher steuern)
        // Turnierleitung: davor Fortschritt, Board-Status und nächster Aufruf
        (headChips = (() => {
          // Turnierleitung: ⚙️ › Ansicht › Kacheln oben; Fokus: 🖥️ › Fokus; Fernseher-Fenster: 🖥️ › Fernseher steuern
          const cfg = focus ? (viewer ? tvc.times : s.tourFocusTimes) : s.tourHeadShow;
          const chip = (label, value, cls = '', extra = null) => h('div', { class: `ichip ${cls}` }, h('span', { class: 'ilabel' }, label), h('b', { class: 'ival num' }, value), extra);
          const own = matches.filter((m) => m.tournament && m.tournament.id === t.id && m.status !== 'aborted' && m.createdAt);
          const out = [];
          if (!focus) {
            if (timeOn(cfg, 'prog')) out.push(chip('🎯 Spiele', `${played} / ${total}`, 'prog', h('div', { class: 'liveprog' }, h('i', { style: { width: `${total ? Math.round((played / total) * 100) : 0}%` } }))));
            const playing = boards.filter((b) => b.game && b.game.status === 'running').length;
            const called = boards.filter((b) => b.game && b.game.status !== 'running').length;
            const free = boards.length - playing - called;
            if (timeOn(cfg, 'boards')) out.push(h('div', { class: 'ichip', title: 'Boards: spielen · aufgerufen · frei' }, h('span', { class: 'ilabel' }, '🎯 Boards'),
              h('b', { class: 'ival num bstat' }, h('span', { class: 'bs play' }, `● ${playing}`), h('span', { class: 'bs call' }, `● ${called}`), h('span', { class: 'bs free' }, `○ ${free}`))));
            const first = next[0];
            if (first && !st.done && timeOn(cfg, 'next')) {
              // Wann das nächste Spiel aufgerufen wird: freie Boards ohne Handy rufen nichts auf (Einstellung
              // „Nur Boards mit Handy“) – dann „wartet auf Handy“ statt eines irreführenden „jetzt“
              const at = eta && eta.starts.get(first.key);
              const freeBoards = boards.filter((b) => !b.game);
              const usable = freeBoards.filter((b) => !s.tourOnlyConnected || connected.has(b.board));
              const pp = t.plannedPause;
              const val = plan.manualPause ? `~${fmtClock(plan.pauseUntil)}`
                : freeBoards.length && !usable.length ? 'wartet auf Handy'
                : pp && s.tourBeforePause !== false && pp.at > Date.now() && at && at >= pp.at ? `nach der Pause ~${fmtClock(at)}`
                : !at || at - Date.now() < 60000 ? (usable.length ? 'jetzt' : 'gleich') : `~${fmtClock(at)}`;
              out.push(h('div', { class: 'ichip', title: `Wann das nächste Spiel (${nameOf(t, first.a)} – ${nameOf(t, first.b)}) aufgerufen wird. „wartet auf Handy“: Ein Board ist frei, aber dort ist kein Handy angemeldet.` },
                h('span', { class: 'ilabel' }, '📣 Nächster Aufruf'), h('b', { class: 'ival num' }, val)));
            }
            if (t.plannedPause && !plan.manualPause && timeOn(cfg, 'planned')) {
              const pp = t.plannedPause;
              out.push(chip('☕ Pause geplant', `${fmtClock(pp.at)}–${fmtClock(pp.at + pp.min * 60000)}`, 'planchip'));
            }
          }
          if (!timeOn(cfg, 'run')) { /* aus */ } else if (own.length) {
            const end = st.done ? Math.max(...own.filter((m) => m.status === 'finished').map((m) => m.updatedAt || m.createdAt)) : Date.now();
            const min = Math.max(0, Math.floor((end - Math.min(...own.map((m) => m.createdAt))) / 60000));
            out.push(chip(st.done ? '⏱ Dauer' : '⏱ Läuft', `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std.`));
          } else if (!st.done) out.push(chip('⏱ Start', 'gleich'));
          if (eta && eta.groupsAt && timeOn(cfg, 'groups')) out.push(chip('👥 Gruppen fertig', `~${fmtClock(eta.groupsAt)}`));
          if (eta && eta.finalAt && timeOn(cfg, 'final')) out.push(chip('🏆 Finale', `~${fmtClock(eta.finalAt)}`));
          if (eta && timeOn(cfg, 'end')) out.push(chip('🏁 Ende', `~${fmtClock(eta.at)}`, 'end'));
          return out.length ? h('div', { class: `infochips ${cardsBelow ? 'headcards' : ''}`, title: 'Geschätzt aus dem bisherigen Tempo und dem Format jeder Runde. Wird mit jedem fertigen Spiel genauer.' }, out) : null;
        })(), cardsBelow ? null : headChips),
        h('div', { class: 'liveclockbox' }, h('div', { class: 'liveclock num' }, fmtClock(Date.now()))),
        // Leiste: Größe, Boards −/＋, Ton, QR-Codes, Bereiche, Fokus, Einstellungen, Fernseher (im Fokus nur Fokus und Fernseher)
        // Fernseher-Fenster: Seiten, Größe, Wechsel, Vollbild. Fokus am Laptop: dazu 🎯 (zurück zu allen Knöpfen) und 📺
        viewer ? phoneTv || tvFull
        : focus ? h('div', { class: 'toolbar' }, settingsBtn, focusBtn) : h('div', { class: 'toolbar' },
          // Turnierleitung: jeder Knopf mit Beschriftung darunter (ab 1.36.0)
          tv ? null : h('div', { class: 'boardctl labeled' },
            h('div', { class: 'bcrow' },
              h('button', { class: 'toolbtn', title: 'Board entfernen', onclick: () => changeBoards(t, st, -1) }, '−'),
              h('span', { class: 'num' }, `${t.boards}`),
              h('button', { class: 'toolbtn', title: 'Board hinzufügen', onclick: () => changeBoards(t, st, +1) }, '＋')),
            h('span', { class: 'tlabel' }, 'Boards')),
          phone ? null : ltool('🎯', 'Fokus', 'Fokus: nur Uhr, Boards und das Wichtigste', () => { updateSettings({ tourFocus: true }); draw(); }), // Fokus ist fürs große Bild – auf dem Handy nicht
          st.done ? null : ltool('☕', plan.manualPause ? `noch ${Math.max(1, Math.ceil((plan.pauseUntil - Date.now()) / 60000))}′` : t.plannedPause ? `um ${fmtClock(t.plannedPause.at)}` : 'Pause', 'Pause einlegen, planen, verlängern oder beenden', pauseSheet, !!plan.manualPause),
          ltool(s.tourSound ? '🔊' : '🔇', s.tourSound ? 'Ton an' : 'Ton aus', 'Ansagen am PC an/aus (z. B. während einer Rede)', () => { const on = !getSettings().tourSound; updateSettings({ tourSound: on }); if (on) unlock(); draw(); }, !s.tourSound),
          ltool('🛠️', 'Steuern', 'Turnier steuern: Pause, Anwesenheit/Check-in, Durchsage, Spieler gibt auf', controlMenu),
          ltool('📜', 'Protokoll', 'Protokoll: alle Ergebnisse und Eingriffe, mit Rückgängig', logSheet),
          ltool('📊', 'Statistik', 'Turnier-Statistik: Spieldauer je Phase und Board, Tempo, längste Spiele', tourStatsSheet),
          ltool('🔍', 'Suchen', 'Spieler suchen: wo er gerade ist, wann er dran ist', searchSheet),
          ltool('🖥️', 'Fernseher', 'Fernseher: Fenster öffnen, Fernseher steuern, Zuschauer-Link', screenMenu),
          ltool('⚙️', 'Ansicht', 'Einstellungen: Ansicht (Seite, Größe, QR-Codes, Zeiten), Ton, Anordnung, Ablauf', liveSettings))),
      cardsBelow ? headChips : null,
      // Boards groß oben; Turnierbaum/Tabellen auf breiten Bildschirmen rechts daneben, sonst darunter
      page ? h('div', { class: 'livegrid pagegrid' }, showStart ? null : pauseBar(true) || plannedBar(), page) : h('div', { class: `livegrid ${planSide ? 'plan-auto' : ''}` }, main, side),
      showStart ? null : cornerQr,
      tv || focus ? null : h('div', { class: 'grid2', style: { marginTop: '12px' } },
        h('button', { class: 'btn', onclick: () => exportSheet(t, st, matches) }, '📄 Drucken: Aushang, Ergebnisse, Urkunden'),
        h('button', { class: 'btn', onclick: () => exportFile(t, matches) }, '📤 Abgleich-Datei für alle')),
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
      tv || focus ? null : h('p', { class: 'small dim' }, 'Freie Boards bekommen automatisch das nächste Spiel, mit Ansage (Lautsprecher am PC an). Tipp auf ein belegtes Board: Aufruf zurücknehmen oder Ergebnis eintragen, falls ein Handy ausfällt. Oben: − / ＋ Boards, 🎯 Fokus, 🛠️ Steuern, 📜 Protokoll, 🖥️ Fernseher, ⚙️ Ansicht, Ton und Ablauf. Darunter die Kacheln Handys, Start, Pause, Aufruf und Zeitplan.'),
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
  return () => { disposed = true; clearInterval(timer); document.documentElement.classList.remove('tvlight'); flash.remove(); document.removeEventListener('dblclick', dbl); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
}

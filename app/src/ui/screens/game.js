// Spielbildschirm: großer Spielstand, aktuelle Aufnahme, Eingabe/Korrektur, Kamera.
import { h, banner, toast, sheet, confirmDialog } from '../dom.js';
import { createMatch, throwRows } from '../../game/match.js';
import { GameSession } from '../../game/session.js';
import { hitLabel } from '../../core/board.js';
import { boardSvg, hitFromSvgEvent } from '../boardSvg.js';
import { keepAwake } from '../../core/wakelock.js';
import { getSettings, updateSettings } from '../../core/settings.js';
import { say, unlock, t as speechText } from '../../audio/speech.js';
import { lsGet } from '../../core/storage.js';
import { playerStats } from '../../stats/stats.js';

export function render(root, params, nav) {
  const match = params.match || createMatch(params.setup);
  const session = new GameSession(match);
  const useCamera = params.camera ?? (match.camera || false);
  session.match.camera = useCamera;
  let selected = null;       // { turnIndex, dartIndex } zum Korrigieren
  let mult = 1;              // Eingabe-Multiplikator
  let showBoard = false;     // Board-Eingabe statt Zahlen
  let padOpen = !useCamera;  // Mit Kamera ist das Zahlenfeld eingeklappt
  let cam = null;            // Kamera-Steuerung (Stufe 3)
  let disposed = false;
  let statsCache = {};

  keepAwake(true);

  // ---------- Aufbau ----------
  const infoEl = h('div', { class: 'info num' });
  const panels = [0, 1].map(() => {
    const name = h('div', { class: 'pname' });
    const score = h('div', { class: 'score num' });
    const sets = h('span');
    const legs = h('span');
    const avg = h('div', { class: 'avg num' });
    const el = h('div', { class: 'pp' }, name, score, h('div', { class: 'sl num' }, sets, legs), avg);
    return { el, name, score, sets, legs, avg };
  });
  const slots = [0, 1, 2].map((i) => h('button', { class: 'slot num', onclick: () => selectSlot(i) }));
  const sumSlot = h('div', { class: 'slot sum num' });
  const hintEl = h('div', { class: 'hint num' });
  const statusEl = h('div', { class: 'status' });
  const alertEl = h('div', { class: 'alert hidden' });
  const camPanel = h('div', { class: 'campanel' });
  const padEl = h('div', { class: 'pad' });
  const nextBtn = h('button', { class: 'btn primary next', onclick: () => doNext('manual') }, 'WEITER');

  const actions = h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => { selected = null; session.undoDart(); } }, '↶ Dart'),
    h('button', { class: 'btn', onclick: () => { selected = null; session.undoTurn(); } }, '↶ Aufn.'),
    nextBtn,
  );
  // Hochformat: Kamera oben, Eingabe darunter, Knöpfe unten. Querformat: Knöpfe links unter dem Spielstand.
  const landscape = window.matchMedia('(orientation: landscape) and (min-width: 640px)');
  const left = h('div', { class: 'left' },
    h('div', { class: 'players' }, panels.map((p) => p.el)),
    h('div', { class: 'turnrow' }, slots, sumSlot),
    hintEl,
  );
  const right = h('div', { class: 'right' }, alertEl, statusEl, camPanel, padEl);
  const placeActions = () => (landscape.matches ? left : right).appendChild(actions);
  placeActions();
  landscape.addEventListener?.('change', placeActions);
  const screen = h('div', { class: 'game' },
    h('div', { class: 'bar' },
      h('button', { class: 'iconbtn', onclick: openMenu, 'aria-label': 'Menü' }, '☰'),
      infoEl,
      h('button', { class: 'iconbtn', onclick: () => { showBoard = !showBoard; padOpen = true; drawPad(); }, 'aria-label': 'Eingabeart' }, '◎'),
    ),
    left, right,
  );
  root.appendChild(screen);

  // ---------- Eingabe ----------
  function selectSlot(i) {
    const st = session.state;
    let turnIndex = st.openTurnIndex;
    if (turnIndex < 0) {
      // Noch kein Dart in dieser Aufnahme: Slot 0 = neuer Dart
      selected = null;
      return;
    }
    if (i > st.turnDarts.length) { selected = null; draw(); return; }
    if (selected && selected.turnIndex === turnIndex && selected.dartIndex === i) selected = null;
    else selected = { turnIndex, dartIndex: i };
    if (selected && useCamera) {
      if (!padOpen) { padOpen = true; drawPad(); }
      toast('Richtiges Feld antippen: im Kamerabild, auf der Scheibe oder im Zahlenfeld.');
    }
    draw();
  }

  function enter(hit, source = 'manual', extra = {}) {
    unlock();
    const st = session.state;
    if (st.finished) return;
    if (selected && selected.dartIndex < st.turnDarts.length) {
      const old = st.turnDarts[selected.dartIndex];
      if (old && old.source === 'camera' && cam && getSettings().saveCorrectionImages) {
        extra = { ...extra, imageId: cam.saveCorrectionImage(old, hit) };
      }
      const sel = selected;
      selected = null;
      session.correct(sel.turnIndex, sel.dartIndex, hit, extra);
    } else {
      selected = null;
      if (!session.addDart(hit, source, extra)) toast('Aufnahme ist voll – „Weiter“ oder einen Dart antippen zum Korrigieren.');
    }
    mult = 1;
    drawPad();
  }

  function drawPad() {
    padEl.replaceChildren();
    if (!padOpen) {
      padEl.appendChild(h('button', { class: 'btn ghost', onclick: () => { padOpen = true; drawPad(); } }, '⌨ Eingabe / Korrektur'));
      return;
    }
    if (useCamera) padEl.appendChild(h('button', { class: 'btn ghost', style: { minHeight: '40px', fontSize: '15px' }, onclick: () => { padOpen = false; selected = null; drawPad(); draw(); } }, 'Eingabe einklappen'));
    if (showBoard) {
      const wrap = h('div', { html: boardSvg() });
      const svg = wrap.firstChild;
      svg.addEventListener('click', (e) => enter(hitFromSvgEvent(svg, e).hit));
      padEl.appendChild(wrap);
      padEl.appendChild(h('div', { class: 'mults' },
        h('button', { class: 'key', onclick: () => enter({ segment: 0, multiplier: 0 }) }, '0 / Daneben'),
        h('button', { class: 'key', onclick: () => { showBoard = false; drawPad(); } }, 'Zahlenfeld')));
      return;
    }
    const mk = (m, label) => h('button', { class: `key ${mult === m ? 'on' : ''}`, onclick: () => { mult = mult === m ? 1 : m; drawPad(); } }, label);
    padEl.appendChild(h('div', { class: 'mults' }, mk(2, 'Double'), mk(3, 'Triple'),
      h('button', { class: 'key', onclick: () => enter({ segment: 0, multiplier: 0 }) }, '0 / Daneben')));
    const keys = [];
    for (let n = 1; n <= 20; n++) keys.push(h('button', { class: 'key num', onclick: () => enter({ segment: n, multiplier: mult }) }, n));
    padEl.appendChild(h('div', { class: 'keys' }, keys));
    padEl.appendChild(h('div', { class: 'mults' },
      h('button', { class: 'key', onclick: () => enter({ segment: 25, multiplier: 1 }) }, '25'),
      h('button', { class: 'key', onclick: () => enter({ segment: 25, multiplier: 2 }) }, 'BULL'),
      h('button', { class: 'key', onclick: () => { showBoard = true; drawPad(); } }, 'Scheibe'),
    ));
  }

  // ---------- Anzeige ----------
  function draw() {
    const st = session.state;
    const m = session.match;
    const setTxt = m.format.setsBestOf > 1 ? `Set ${st.setNo} · ` : '';
    infoEl.textContent = `${setTxt}Leg ${st.legInSet} · ${st.mode.describe(m.options)}`;
    panels.forEach((p, i) => {
      p.el.classList.toggle('active', !st.finished && st.current === i);
      p.name.textContent = m.playerNames[i];
      const showScore = i === st.current && !st.finished ? st.turnEval.remaining : st.scores[i];
      p.score.textContent = showScore;
      p.sets.innerHTML = m.format.setsBestOf > 1 ? `Sets <b>${st.setsWon[i]}</b>` : '';
      p.legs.innerHTML = `Legs <b>${st.legsWon[i]}</b>`;
      const s = statsCache[m.players[i]];
      p.avg.textContent = s ? `Ø ${s.toFixed(1)}` : '';
    });
    const darts = st.turnDarts;
    const ev = st.turnEval;
    slots.forEach((el, i) => {
      const d = darts[i];
      el.className = 'slot num' + (d && d.source === 'camera' ? ' cam' : '') + (selected && selected.dartIndex === i ? ' sel' : '');
      el.replaceChildren(d ? hitLabel(d) : '–', d ? h('small', {}, d.source === 'camera' ? 'Kamera' : d.source === 'corrected' ? 'korrigiert' : '') : '');
    });
    sumSlot.className = 'slot sum num' + (ev.bust ? ' bust' : '');
    sumSlot.textContent = ev.bust ? 'BUST' : ev.finished ? 'CHECK' : String(ev.points);
    hintEl.textContent = st.hint ? st.hint.join('  ') : '';
    nextBtn.textContent = ev.closed ? `${darts.slice(0, ev.usedDarts).map(hitLabel).join(', ')} = ${ev.bust ? 'Bust' : ev.points}  ▶` : 'WEITER';
    nextBtn.style.fontSize = ev.closed ? '20px' : '';
  }

  // Durchschnitt pro Spieler im aktuellen Match
  function updateAverages() {
    // throwRows berücksichtigt nur abgeschlossene Aufnahmen
    const all = throwRows(session.match);
    session.match.players.forEach((pid) => {
      const s = playerStats(all.filter((r) => r.playerId === pid));
      statsCache[pid] = s.darts ? s.average : null;
    });
  }

  // ---------- Ablauf ----------
  async function doNext(reason) {
    if (session.state.finished) { showMatchEnd(); return; }
    const before = session.state;
    const ev = before.turnEval;
    const labels = [...before.turnDarts.slice(0, ev.usedDarts).map(hitLabel)];
    while (!ev.bust && !ev.finished && labels.length < 3) labels.push('0');
    selected = null;
    await session.next(reason);
    const st = session.state;
    const summary = `${labels.join(', ')} = ${ev.bust ? 'Bust' : ev.points}`;
    if (!st.finished && st.legOverall === before.legOverall) {
      banner(`${summary}\n${session.match.playerNames[st.current]} ist dran`, 1600);
    }
    if (cam) cam.turnClosed();
  }

  session.on((type, data) => {
    if (type === 'next' || type === 'undo' || type === 'correct') updateAverages();
    if (type === 'legWon') {
      const name = session.match.playerNames[data.winner];
      banner(data.setWon ? `Set für ${name}!` : `Leg für ${name}!`, 2200);
    }
    if (type === 'matchWon') showMatchEnd();
    if (type === 'error') toast(data.message);
    draw();
    if (cam) cam.sessionChanged(type, data);
  });

  function showMatchEnd() {
    const st = session.state;
    const m = session.match;
    if (!st.finished) return;
    keepAwake(false);
    const name = m.playerNames[st.winner];
    const s = sheet(h('div', { class: 'stack' },
      h('h2', {}, `🏆 ${name} gewinnt!`),
      h('div', { class: 'confirmturn num' }, m.format.setsBestOf > 1 ? `${st.setsWon[0]} : ${st.setsWon[1]} Sets` : `${st.legsWon[0]} : ${st.legsWon[1]} Legs`),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          s.close();
          const setup = { mode: m.mode, options: m.options, players: m.players, playerNames: m.playerNames, setsBestOf: m.format.setsBestOf, legsBestOf: m.format.legsBestOf, firstStarter: 1 - m.firstStarter, starterMethod: 'tap' };
          nav.go('game', { setup, camera: useCamera });
        },
      }, 'Revanche'),
      h('button', { class: 'btn', onclick: () => { s.close(); nav.go('stats'); } }, 'Statistik'),
      h('button', { class: 'btn ghost', onclick: () => { s.close(); nav.go('home'); } }, 'Startseite'),
      h('button', { class: 'btn ghost', onclick: () => { s.close(); session.undoDart(); keepAwake(true); } }, 'Letzten Dart zurücknehmen'),
    ), { dismissable: false });
  }

  function openMenu() {
    const st = getSettings();
    const s = sheet(h('div', { class: 'stack' },
      h('h2', {}, 'Menü'),
      h('button', { class: 'btn', onclick: () => { updateSettings({ announceDart: !st.announceDart }); s.close(); } }, `Dart-Ansage: ${st.announceDart ? 'an' : 'aus'}`),
      h('button', { class: 'btn', onclick: () => { updateSettings({ announceTurn: !st.announceTurn }); s.close(); } }, `Summen-Ansage: ${st.announceTurn ? 'an' : 'aus'}`),
      useCamera ? h('button', { class: 'btn', onclick: () => { s.close(); cam && cam.recalibrate(); } }, 'Neu kalibrieren') : null,
      useCamera ? h('button', { class: 'btn', onclick: () => { updateSettings({ autoAdvance: !st.autoAdvance }); s.close(); } }, `Automatisch weiter: ${st.autoAdvance ? 'an' : 'aus'}`) : null,
      h('button', { class: 'btn', onclick: () => { s.close(); nav.go('home'); } }, 'Pause (Startseite)'),
      h('button', {
        class: 'btn danger',
        onclick: async () => {
          s.close();
          if (await confirmDialog('Spiel abbrechen?', 'Das Spiel wird als abgebrochen gespeichert.', { ok: 'Spiel abbrechen', cancel: 'Weiterspielen', danger: true })) {
            await session.abort();
            nav.go('home');
          }
        },
      }, 'Spiel abbrechen'),
    ));
  }

  // ---------- Kamera (Stufe 3) ----------
  async function startCamera() {
    const calibration = lsGet('calibration', null);
    if (!calibration) { toast('Keine Kalibrierung – nur Handeingabe.'); return; }
    try {
      const { CameraGame } = await import('../../vision/cameraGame.js');
      if (disposed) return;
      cam = new CameraGame({
        container: camPanel,
        statusEl,
        alertEl,
        calibration,
        session,
        onHit: (hit, info) => { unlock(); session.addDart(hit, 'camera', info); },
        onTapHit: (hit) => enter(hit, 'manual'),
        onBoardEmpty: () => { if (getSettings().autoAdvance && session.state.openTurnIndex >= 0) doNext('auto'); },
        onRecalibrate: () => nav.go('calibrate', { mode: 'full', then: 'game', thenParams: { match: session.match, camera: true } }),
        onBullOff: (winnerIdx) => {
          session.match.firstStarter = winnerIdx;
          session.set(session.match, 'starter', {});
          say(speechText().next(session.match.playerNames[winnerIdx]));
          banner(`${session.match.playerNames[winnerIdx]} beginnt`, 2000);
        },
      });
      await cam.start({ bullOff: session.match.starterMethod === 'bull' && session.match.turns.length === 0 });
    } catch (e) {
      console.error(e);
      toast('Kamera konnte nicht gestartet werden – Handeingabe bleibt aktiv.', 4000);
    }
  }

  drawPad();
  draw();
  updateAverages();
  if (useCamera) startCamera();
  else statusEl.replaceChildren(h('span', { class: 'dot' }), 'Handeingabe');

  // Match sofort lokal sichern
  session.set(session.match, 'init', {});

  return () => {
    disposed = true;
    landscape.removeEventListener?.('change', placeActions);
    keepAwake(false);
    if (cam) cam.stop();
  };
}

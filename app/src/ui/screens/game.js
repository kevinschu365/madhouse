// Spielbildschirm: großer Spielstand, aktuelle Aufnahme, Eingabe/Korrektur, Kamera.
import { h, banner, toast, sheet, confirmDialog } from '../dom.js';
import { createMatch, throwRows } from '../../game/match.js';
import { GameSession } from '../../game/session.js';
import { hitLabel } from '../../core/board.js';
import { checkoutPath } from '../../rules/checkout.js';
import { boardSvg, hitFromSvgEvent } from '../boardSvg.js';
import { keepAwake } from '../../core/wakelock.js';
import { getSettings, updateSettings } from '../../core/settings.js';
import { say, unlock, t as speechText, SPEECH_LANGS, voiceLangOf } from '../../audio/speech.js';
import { lsGet, dbGetAll } from '../../core/storage.js';
import { playerStats, cricketStats, trainingRecords, trainingKey } from '../../stats/stats.js';
import { CRICKET_NUMBERS } from '../../rules/cricket.js';
import { getMode } from '../../rules/index.js';

export function render(root, params, nav) {
  const match = params.match || createMatch(params.setup);
  const session = new GameSession(match);
  const useCamera = params.camera ?? (match.camera || false);
  session.match.camera = useCamera;
  const mode = session.state.mode;
  const training = mode.kind === 'training';
  const cricket = mode.id === 'cricket';
  const supportsTotal = !!mode.isPossibleTotal;      // Summen-Eingabe nur bei X01
  let selected = null;       // { turnIndex, dartIndex } zum Korrigieren
  let mult = 1;              // Eingabe-Multiplikator
  let inputMode = getSettings().inputMode || 'dart'; // 'dart' | 'board' | 'total'
  if (inputMode === 'total' && !supportsTotal) inputMode = 'dart';
  let showBoard = inputMode === 'board';             // Board-Eingabe statt Zahlen
  let typed = '';                                    // Summen-Eingabe
  let padOpen = !useCamera;  // Mit Kamera ist das Zahlenfeld eingeklappt
  let cam = null;            // Kamera-Steuerung (Stufe 3)
  let disposed = false;
  let statsCache = {};

  keepAwake(true);

  // ---------- Aufbau ----------
  const infoEl = h('div', { class: 'info num' });
  const panels = session.match.players.map(() => {
    const name = h('div', { class: 'pname' });
    const score = h('div', { class: 'score num' });
    const sets = h('span');
    const legs = h('span');
    const avg = h('div', { class: 'avg num' });
    const el = h('div', { class: training ? 'pp solo' : 'pp' }, name, score, h('div', { class: 'sl num' }, sets, legs), avg);
    return { el, name, score, sets, legs, avg };
  });
  // Cricket: Tabelle der Marks (Spieler 1 | Zahl | Spieler 2)
  const cricketRows = cricket ? CRICKET_NUMBERS.map((n) => {
    const cells = [h('div', { class: 'cm' }), h('div', { class: 'cn num' }, n === 25 ? 'Bull' : n), h('div', { class: 'cm' })];
    return { n, el: h('div', { class: 'crow' }, cells[0], cells[1], cells[2]), cells };
  }) : [];
  const cricketEl = cricket ? h('div', { class: 'cricket' }, cricketRows.map((r) => r.el)) : null;
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
    h('div', { class: training ? 'players solo' : 'players' }, panels.map((p) => p.el)),
    cricketEl,
    h('div', { class: 'turnrow' }, slots, sumSlot),
    hintEl,
  );
  const right = h('div', { class: 'right' }, alertEl, statusEl, camPanel, padEl);
  const placeActions = () => (landscape.matches ? left : right).appendChild(actions);
  placeActions();
  landscape.addEventListener?.('change', placeActions);
  const screen = h('div', { class: `game${cricket ? ' is-cricket' : ''}${training ? ' is-training' : ''}` },
    h('div', { class: 'bar' },
      h('button', { class: 'iconbtn', onclick: openMenu, 'aria-label': 'Menü' }, '☰'),
      infoEl,
      h('button', { class: 'iconbtn', onclick: () => { inputMode = inputMode === 'dart' ? 'board' : inputMode === 'board' && supportsTotal ? 'total' : 'dart'; showBoard = inputMode === 'board'; padOpen = true; drawPad(); }, 'aria-label': 'Eingabeart' }, '◎'),
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
    // Umschalter Eingabeart
    const modeBtn = (key, label) => h('button', {
      class: `key ${inputMode === key ? 'on' : ''}`,
      onclick: () => { inputMode = key; showBoard = key === 'board'; typed = ''; if (key === 'total') selected = null; updateSettings({ inputMode: key }); drawPad(); draw(); },
    }, label);
    padEl.appendChild(h('div', { class: supportsTotal ? 'mults' : 'mults two' }, modeBtn('dart', 'Pro Dart'), modeBtn('board', 'Scheibe'), supportsTotal ? modeBtn('total', 'Summe') : null));
    if (inputMode === 'total' && !selected) { drawTotalPad(); return; }
    if (showBoard) {
      const wrap = h('div', { html: boardSvg() });
      const svg = wrap.firstChild;
      svg.addEventListener('click', (e) => enter(hitFromSvgEvent(svg, e).hit));
      padEl.appendChild(wrap);
      padEl.appendChild(h('div', { class: 'mults' },
        h('button', { class: 'key', onclick: () => enter({ segment: 0, multiplier: 0 }) }, '0 / Daneben'),
        h('button', { class: 'key', onclick: () => { showBoard = false; inputMode = 'dart'; drawPad(); } }, 'Zahlenfeld')));
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
      h('button', { class: 'key', onclick: () => { showBoard = true; inputMode = 'board'; drawPad(); } }, 'Scheibe'),
    ));
  }

  // ---------- Summen-Eingabe ----------
  const QUICK = [26, 41, 45, 60, 81, 85, 100, 140, 180];
  function drawTotalPad() {
    const st = session.state;
    const rest = st.turnEval.startRemaining;
    const val = typed === '' ? null : parseInt(typed, 10);
    let info = 'Summe der Aufnahme eintippen';
    if (val != null) {
      const after = rest - val;
      if (!st.mode.isPossibleTotal(val)) info = `${val} ist mit 3 Darts nicht möglich`;
      else if (after === 0) info = 'Checkout!';
      else if (after < 0 || after === 1) info = 'Überworfen';
      else info = `Rest danach: ${after}`;
    }
    const display = h('div', { class: 'totaldisplay num' }, h('div', { class: 'tv' }, typed || '–'), h('div', { class: 'ti' }, info));
    const digit = (d) => h('button', { class: 'key num', onclick: () => { if (typed.length < 3) typed = (typed + d).replace(/^0+(?=\d)/, ''); drawPad(); } }, d);
    const keys = h('div', { class: 'tkeys' },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit),
      h('button', { class: 'key', onclick: () => { typed = typed.slice(0, -1); drawPad(); } }, '⌫'),
      digit(0),
      h('button', { class: 'key on', onclick: () => submitTotal(val) }, 'OK'),
    );
    const quick = h('div', { class: 'tquick' },
      ...QUICK.map((q) => h('button', { class: 'key num', onclick: () => submitTotal(q) }, q)),
      rest <= 170 && rest > 1 ? h('button', { class: 'key on', onclick: () => submitTotal(rest) }, `Rest ${rest}`) : null,
    );
    padEl.appendChild(display);
    padEl.appendChild(h('div', { class: 'totalpad' }, keys, quick));
  }

  async function submitTotal(points) {
    unlock();
    if (points == null || Number.isNaN(points)) { toast('Bitte eine Zahl eintippen.'); return; }
    const st = session.state;
    if (st.finished) return;
    if (!st.mode.isPossibleTotal(points)) { toast(`${points} ist mit 3 Darts nicht möglich.`); return; }
    const rest = st.turnEval.startRemaining;
    let darts = 3;
    if (points === rest) {
      // Checkout: Mit wie vielen Darts? (nur mögliche Anzahl anbieten)
      const options = [1, 2, 3].filter((n) => checkoutPath(rest, n));
      if (!options.length) { toast(`${rest} ist mit Double-Out nicht auszuchecken.`); return; }
      darts = options.length === 1 ? options[0] : await askDarts(options);
      if (!darts) return;
    }
    const before = session.state;
    const name = session.match.playerNames;
    typed = '';
    selected = null;
    const ev = await session.enterTotal(points, darts);
    if (!ev) return;
    const now = session.state;
    if (!now.finished && now.legOverall === before.legOverall) banner(`${ev.bust ? 'Überworfen' : points}\n${name[now.current]} ist dran`, 1500);
    if (cam) cam.turnClosed();
    drawPad();
  }

  function askDarts(options) {
    return new Promise((resolve) => {
      let s;
      const pick = (n) => { resolve(n); s.close(); };
      s = sheet(h('div', { class: 'stack' },
        h('h2', {}, 'Checkout! Mit wie vielen Darts?'),
        h('div', { class: 'mults' }, ...[1, 2, 3].map((n) => h('button', { class: 'key', disabled: !options.includes(n), style: { minHeight: '64px', fontSize: '26px' }, onclick: () => pick(n) }, n))),
        h('button', { class: 'btn ghost', onclick: () => pick(null) }, 'Abbrechen'),
      ), { onClose: () => resolve(null) });
    });
  }

  // ---------- Anzeige ----------
  function draw() {
    const st = session.state;
    const m = session.match;
    const setTxt = m.format.setsBestOf > 1 ? `Set ${st.setNo} · ` : '';
    infoEl.textContent = training ? st.mode.describe(m.options) : `${setTxt}Leg ${st.legInSet} · ${st.mode.describe(m.options)}`;
    const ev = st.turnEval;
    if (training) drawTraining(st, m);
    else if (cricket) drawCricket(st, m);
    else panels.forEach((p, i) => {
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
    slots.forEach((el, i) => {
      const d = darts[i];
      const hit = ev.hits && ev.hits[i];
      el.className = 'slot num' + (d && d.source === 'camera' ? ' cam' : '') + (selected && selected.dartIndex === i ? ' sel' : '') + (hit ? ' hit' : '');
      el.replaceChildren(d ? hitLabel(d) : '–', d ? h('small', {}, d.source === 'camera' ? 'Kamera' : d.source === 'corrected' ? 'korrigiert' : '') : '');
    });
    sumSlot.className = 'slot sum num' + (ev.bust ? ' bust' : '');
    sumSlot.textContent = turnText(ev);
    if (!training) hintEl.textContent = st.hint ? st.hint.join('  ') : '';
    nextBtn.textContent = ev.closed ? `${darts.slice(0, ev.usedDarts).map(hitLabel).join(', ')} = ${turnText(ev, true)}  ▶` : 'WEITER';
    nextBtn.style.fontSize = ev.closed ? '20px' : '';
  }

  /** Kurzer Text einer Aufnahme (Punkte, Marks, Treffer …). */
  function turnText(ev, long = false) {
    if (mode.turnLabel) return mode.turnLabel(ev);
    if (ev.bust) return long ? 'Bust' : 'BUST';
    return ev.finished ? 'CHECK' : String(ev.points);
  }

  // Training: ein großes Feld mit Stand, Ziel und Fortschritt
  function drawTraining(st, m) {
    const p = panels[0];
    const s = st.mode.status(m.options, st.leg, st.turnEval);
    p.el.classList.toggle('active', !st.finished);
    p.name.textContent = m.playerNames[0];
    p.score.textContent = s.big;
    p.sets.textContent = s.label;
    p.legs.textContent = '';
    p.avg.replaceChildren(...s.lines.filter(Boolean).map((l) => h('div', {}, l)));
    hintEl.textContent = st.finished ? 'Fertig!' : s.target ? `Ziel: ${s.target}` : st.hint ? st.hint.join('  ') : '';
  }

  // Cricket: Punkte groß, darunter die Marks-Tabelle (live während der Aufnahme)
  const MARK = ['', '╱', '✕', 'Ⓧ'];
  function drawCricket(st, m) {
    const live = st.finished ? st.leg : st.turnEval.after;
    panels.forEach((p, i) => {
      p.el.classList.toggle('active', !st.finished && st.current === i);
      p.name.textContent = m.playerNames[i];
      p.score.textContent = live.points[i];
      p.sets.innerHTML = m.format.setsBestOf > 1 ? `Sets <b>${st.setsWon[i]}</b>` : '';
      p.legs.innerHTML = `Legs <b>${st.legsWon[i]}</b>`;
      const s = statsCache[m.players[i]];
      p.avg.textContent = s != null ? `MPR ${s.toFixed(2)}` : '';
    });
    for (const r of cricketRows) {
      const a = live.marks[0][r.n];
      const b = live.marks[1][r.n];
      r.cells[0].textContent = MARK[Math.min(3, a)];
      r.cells[2].textContent = MARK[Math.min(3, b)];
      r.el.className = 'crow' + (a >= 3 && b >= 3 ? ' dead' : '');
      r.cells[0].className = 'cm' + (a >= 3 ? ' closed' : '') + (st.current === 0 && !st.finished ? ' cur' : '');
      r.cells[2].className = 'cm' + (b >= 3 ? ' closed' : '') + (st.current === 1 && !st.finished ? ' cur' : '');
    }
  }

  /** Bewertung der zuletzt abgeschlossenen Aufnahme (nach „Weiter“). */
  function lastClosedEval(st) {
    for (let i = st.legs.length - 1; i >= 0; i--) {
      const ts = st.legs[i].turns;
      if (ts.length) return ts[ts.length - 1].ev;
    }
    return null;
  }

  // Durchschnitt pro Spieler im aktuellen Match
  function updateAverages() {
    // throwRows berücksichtigt nur abgeschlossene Aufnahmen
    if (training) return;
    const all = throwRows(session.match);
    session.match.players.forEach((pid) => {
      const rows = all.filter((r) => r.playerId === pid);
      if (cricket) { const c = cricketStats(rows); statsCache[pid] = c.turns ? c.mpr : null; return; }
      const s = playerStats(rows);
      statsCache[pid] = s.darts ? s.average : null;
    });
  }

  // ---------- Ablauf ----------
  async function doNext(reason) {
    if (session.state.finished) { showMatchEnd(); return; }
    const before = session.state;
    const ev = before.turnEval;
    const labels = [...before.turnDarts.slice(0, ev.usedDarts).map(hitLabel)];
    while (!ev.closed && labels.length < 3) labels.push('0');
    selected = null;
    await session.next(reason);
    const st = session.state;
    // Text der abgeschlossenen Aufnahme (fehlende Darts zählen als 0, z. B. bei Bob's 27 dann Minus)
    const summary = `${labels.join(', ')} = ${turnText(lastClosedEval(st) || ev, true)}`;
    if (training) {
      if (!st.finished) {
        const s = st.mode.status(session.match.options, st.leg, st.turnEval);
        const next = s.banner || (s.target ? `Ziel ${s.target}` : '');
        banner(next ? `${summary}\n${next}` : summary, 1400);
      }
    } else if (!st.finished && st.legOverall === before.legOverall) {
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
    if (document.querySelector('.endsheet')) return; // schon offen (z. B. doppelt „Weiter“)
    keepAwake(false);
    if (training) { showTrainingEnd(st, m); return; }
    const name = m.playerNames[st.winner];
    const s = sheet(h('div', { class: 'stack endsheet' },
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

  // Ende eines Trainings: Ergebnis, Vergleich mit dem bisherigen Rekord, nochmal
  function showTrainingEnd(st, m) {
    const res = st.mode.result(m.options, st.leg);
    const recordEl = h('p', { class: 'dim', style: { textAlign: 'center', margin: 0 } }, '…');
    const s = sheet(h('div', { class: 'stack endsheet' },
      h('h2', {}, `${st.mode.label} – fertig`),
      h('div', { class: 'confirmturn num' }, res.text),
      recordEl,
      h('button', {
        class: 'btn primary',
        onclick: () => {
          s.close();
          const setup = { mode: m.mode, options: m.options, players: m.players, playerNames: m.playerNames, setsBestOf: 1, legsBestOf: 1 };
          nav.go('game', { setup, camera: useCamera });
        },
      }, 'Nochmal'),
      h('button', { class: 'btn', onclick: () => { s.close(); nav.go('training', { player: m.players[0] }); } }, 'Anderes Training'),
      h('button', { class: 'btn ghost', onclick: () => { s.close(); nav.go('home'); } }, 'Startseite'),
      h('button', { class: 'btn ghost', onclick: () => { s.close(); session.undoDart(); keepAwake(true); } }, 'Letzten Dart zurücknehmen'),
    ), { dismissable: false });
    // Rekord aus den gespeicherten Trainings (das aktuelle ist schon gespeichert)
    dbGetAll('matches').then((all) => {
      const key = trainingKey(st.mode, m.options);
      const others = all.filter((x) => x.id !== m.id);
      const rec = trainingRecords(others, m.players[0], getMode)[key];
      if (!rec || !rec.best) { recordEl.textContent = 'Erstes Ergebnis in dieser Variante.'; return; }
      const better = res.better === 'low' ? res.value < rec.best.value : res.value > rec.best.value;
      const same = res.value === rec.best.value;
      recordEl.textContent = better ? `🎉 Neuer Rekord! Bisher: ${rec.best.text}` : same ? `Rekord eingestellt: ${rec.best.text}` : `Rekord: ${rec.best.text} · ${rec.count} Mal gespielt`;
      if (better) recordEl.className = 'accent';
    }).catch(() => { recordEl.textContent = ''; });
  }

  function openMenu() {
    const st = getSettings();
    const s = sheet(h('div', { class: 'stack' },
      h('h2', {}, 'Menü'),
      h('button', { class: 'btn', onclick: () => { updateSettings({ announceDart: !st.announceDart }); s.close(); } }, `Dart-Ansage: ${st.announceDart ? 'an' : 'aus'}`),
      h('button', { class: 'btn', onclick: () => { updateSettings({ announceTurn: !st.announceTurn }); s.close(); } }, `Summen-Ansage: ${st.announceTurn ? 'an' : 'aus'}`),
      h('button', {
        class: 'btn',
        onclick: (e) => {
          // Nächster Dialekt derselben Gruppe (Deutsch / mit Akzent / Englisch)
          const curKey = getSettings().speechLang;
          const cur = SPEECH_LANGS.find(([k]) => k === curKey) || SPEECH_LANGS[0];
          const same = SPEECH_LANGS.filter(([, , g]) => g === cur[2]);
          const [k, label] = same[(same.findIndex(([kk]) => kk === cur[0]) + 1) % same.length];
          // Stimme nur behalten, wenn die Stimmen-Sprache gleich bleibt
          updateSettings({ speechLang: k, ...(voiceLangOf(k) === voiceLangOf(cur[0]) ? {} : { voiceURI: null }) });
          e.target.textContent = `Ansage: ${label} ›`;
          window.speechSynthesis && window.speechSynthesis.cancel();
          say(speechText().test);
        },
      }, `Ansage: ${(SPEECH_LANGS.find(([k]) => k === st.speechLang) || [0, 'Deutsch'])[1]} ›`),
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

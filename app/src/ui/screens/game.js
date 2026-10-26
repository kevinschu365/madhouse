// Spielbildschirm: großer Spielstand, aktuelle Aufnahme, Eingabe/Korrektur, Kamera.
import { h, banner, toast, sheet, confirmDialog } from '../dom.js';
import { createMatch, throwRows } from '../../game/match.js';
import { GameSession } from '../../game/session.js';
import { hitLabel, allHits, dartScore } from '../../core/board.js';
import { checkoutPath, checkoutPaths, turnPlan } from '../../rules/checkout.js';
import { boardSvg, hitFromSvgEvent } from '../boardSvg.js';
import { keepAwake } from '../../core/wakelock.js';
import { getSettings, updateSettings } from '../../core/settings.js';
import { say, unlock, announceUpNext, t as speechText, SPEECH_LANGS, voiceLangOf } from '../../audio/speech.js';
import { lsGet, dbGetAll } from '../../core/storage.js';
import { playerStats, cricketStats, trainingRecords, trainingKey } from '../../stats/stats.js';
import { CRICKET_NUMBERS } from '../../rules/cricket.js';
import { getMode } from '../../rules/index.js';
import { isBotId, botLevel, botThrow } from '../../game/bot.js';

// Summen, die mit 1 bzw. 2 Darts möglich sind (für den Zwischenstand bei der Summen-Eingabe)
const ONE_DART = new Set(allHits().map(dartScore));
const TWO_DARTS = new Set([...ONE_DART].flatMap((a) => [...ONE_DART].map((b) => a + b)));

export function render(root, params, nav) {
  const match = params.match || createMatch(params.setup);
  const session = new GameSession(match);
  let useCamera = params.camera ?? (match.camera || false);
  session.match.camera = useCamera;
  const mode = session.state.mode;
  const training = mode.kind === 'training';
  const cricket = mode.id === 'cricket';
  const party = !!mode.panel;                        // Halve-It, Killer: eigene Anzeige je Spieler
  const playerCount = session.match.players.length;
  const isBot = (i) => isBotId(session.match.players[i]);
  const botTurn = () => !session.state.finished && isBot(session.state.current);
  let botTimer = null;
  const supportsTotal = !!mode.isPossibleTotal;      // Summen-Eingabe nur bei X01
  let selected = null;       // { turnIndex, dartIndex } zum Korrigieren
  let mult = 1;              // Eingabe-Multiplikator
  // Eingabeart wird beim Spielstart festgelegt und ist im Spiel fest.
  // Einzige Ausnahme: Kamera fällt aus -> Wechsel auf Handeingabe (siehe switchToManual).
  let inputMode = params.inputMode || match.inputMode || getSettings().inputMode || 'total'; // 'dart' | 'board' | 'total'
  if (inputMode === 'total' && !supportsTotal) inputMode = 'dart';
  session.match.inputMode = inputMode;
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
    const meta = h('div', { class: 'meta num' }); // Runden und Darts im aktuellen Leg
    const el = h('div', { class: training ? 'pp solo' : 'pp' }, name, score, h('div', { class: 'sl num' }, sets, legs), meta, avg);
    return { el, name, score, sets, legs, avg, meta };
  });
  // Cricket: Tabelle der Marks. Zu zweit: Spieler 1 | Zahl | Spieler 2.
  // Ab 3 Spielern: Zahl | Spieler 1 | Spieler 2 | … (mit Namenskopf, Reihenfolge wie die Spielerfelder).
  const wideCricket = cricket && playerCount > 2;
  const cricketCols = wideCricket ? { gridTemplateColumns: `1.2fr repeat(${playerCount}, 1fr)` } : null;
  const cricketRows = cricket ? CRICKET_NUMBERS.map((n) => {
    const marks = session.match.players.map(() => h('div', { class: 'cm' }));
    const num = h('button', { class: 'cn num', onclick: () => tapCricket(n) }, n === 25 ? 'Bull' : n);
    const cells = wideCricket ? [num, ...marks] : [marks[0], num, marks[1]];
    return { n, el: h('div', { class: 'crow', style: cricketCols }, cells), marks };
  }) : [];
  const cricketHead = wideCricket ? h('div', { class: 'crow chead', style: cricketCols }, h('div', {}), session.match.playerNames.map((nm) => h('div', {}, nm))) : null;
  const cricketEl = cricket ? h('div', { class: wideCricket ? 'cricket wide' : 'cricket' }, cricketHead, cricketRows.map((r) => r.el)) : null;
  const slots = [0, 1, 2].map((i) => h('button', { class: 'slot num', onclick: () => selectSlot(i) }));
  const sumSlot = h('div', { class: 'slot sum num' });
  const hintEl = h('div', { class: 'hint num' });
  const statusEl = h('div', { class: 'status' });
  const alertEl = h('div', { class: 'alert hidden' });
  const camPanel = h('div', { class: 'campanel' });
  const padEl = h('div', { class: 'pad' });
  const nextBtn = h('button', { class: 'btn primary next', onclick: () => doNext('manual') }, 'WEITER');

  const actions = h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => undo('dart') }, '↶ Dart'),
    h('button', { class: 'btn', onclick: () => undo('turn') }, '↶ Aufn.'),
    nextBtn,
  );
  // Hochformat: Kamera oben, Eingabe darunter, Knöpfe unten. Querformat: Knöpfe links unter dem Spielstand.
  const landscape = window.matchMedia('(orientation: landscape) and (min-width: 640px)');
  const left = h('div', { class: 'left' },
    h('div', { class: training ? 'players solo' : playerCount > 2 ? `players many n${playerCount}` : 'players' }, panels.map((p) => p.el)),
    cricketEl,
    h('div', { class: 'turnrow' }, slots, sumSlot),
    hintEl,
  );
  const right = h('div', { class: 'right' }, alertEl, statusEl, camPanel, padEl);
  const placeActions = () => (landscape.matches ? left : right).appendChild(actions);
  placeActions();
  landscape.addEventListener?.('change', placeActions);
  const screen = h('div', { class: `game${cricket ? ' is-cricket' : ''}${training ? ' is-training' : ''}${party ? ' is-party' : ''}` },
    h('div', { class: 'bar' },
      h('button', { class: 'iconbtn', onclick: openMenu, 'aria-label': 'Menü' }, '☰'),
      infoEl,
      h('div', { class: 'iconbtn spacer-btn', 'aria-hidden': 'true' }),
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
    if (botTurn()) { toast('Der Computer ist dran.'); return; }
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
    if (cricketEl) cricketEl.dataset.mult = mult; // Tabelle zeigt Double/Triple an
    if (!padOpen) {
      padEl.appendChild(h('button', { class: 'btn ghost', onclick: () => { padOpen = true; drawPad(); } }, '⌨ Korrektur / Eingabe'));
      return;
    }
    if (useCamera) padEl.appendChild(h('button', { class: 'btn ghost', style: { minHeight: '40px', fontSize: '15px' }, onclick: () => { padOpen = false; selected = null; drawPad(); draw(); } }, 'Eingabe einklappen'));
    // Mit Kamera wird pro Dart korrigiert, sonst gilt die beim Start gewählte Eingabeart.
    const kind = useCamera ? 'dart' : inputMode;
    if (kind === 'total' && !selected) drawTotalPad();
    else if (kind === 'board') drawBoardPad();
    else drawDartPad();
  }

  const MISS_KEY = () => h('button', { class: 'key miss', onclick: () => enter({ segment: 0, multiplier: 0 }) }, '0 / Daneben');

  // Cricket: Tipp auf eine Zahl der Tabelle. Bull: einfach = 25, mit Double/Triple = Bullseye.
  function tapCricket(n) {
    if (n === 25) enter({ segment: 25, multiplier: mult > 1 ? 2 : 1 });
    else enter({ segment: n, multiplier: mult });
  }

  function drawBoardPad() {
    const wrap = h('div', { class: 'boardwrap', html: boardSvg() });
    const svg = wrap.firstChild;
    svg.addEventListener('click', (e) => enter(hitFromSvgEvent(svg, e).hit));
    padEl.append(wrap, MISS_KEY());
  }

  // Pro Dart: Double/Triple umschalten, dann Zahl. Cricket braucht nur 15–20 und Bull.
  function drawDartPad() {
    const mk = (m, label) => h('button', { class: `key mult${mult === m ? ' on' : ''}`, onclick: () => { mult = mult === m ? 1 : m; drawPad(); } }, label);
    const num = (n) => h('button', { class: 'key num', onclick: () => enter({ segment: n, multiplier: mult }) }, n);
    const bull = (m, label) => h('button', { class: 'key num', onclick: () => enter({ segment: 25, multiplier: m }) }, label);
    if (cricket) {
      // Zahlen werden direkt in der Marks-Tabelle angetippt; hier nur Double/Triple und Daneben
      padEl.append(h('div', { class: 'mults' }, mk(2, 'Double'), mk(3, 'Triple'), MISS_KEY()));
      return;
    }
    padEl.append(
      h('div', { class: 'mults two' }, mk(2, 'Double'), mk(3, 'Triple')),
      h('div', { class: 'keys' }, Array.from({ length: 20 }, (_, i) => num(i + 1))),
      h('div', { class: 'mults' }, MISS_KEY(), bull(1, '25'), bull(2, 'BULL')),
    );
  }

  // ---------- Summen-Eingabe ----------
  // Ziffernfeld in der Mitte, häufige Aufnahmen links und rechts daneben.
  // Übernommen wird mit dem großen Knopf unten (NO SCORE / WEITER 45 / CHECK 100).
  const QUICK_LEFT = [26, 41, 45, 60];
  const QUICK_RIGHT = [85, 100, 140, 180];
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
      else {
        const part = typedPartial(rest);
        info = part && part.dartsLeft < 3 ? `Rest danach: ${after} · noch ${part.dartsLeft} Dart${part.dartsLeft > 1 ? 's' : ''}` : part ? `Rest danach: ${after} · nächste Aufnahme` : `Rest danach: ${after}`;
      }
    }
    const display = h('div', { class: 'totaldisplay num' }, h('div', { class: 'tv' }, typed || '–'), h('div', { class: 'ti' }, info));
    const digit = (d) => h('button', { class: 'key num', onclick: () => { if (typed.length < 3) typed = (typed + d).replace(/^0+(?=\d)/, ''); drawPad(); draw(); } }, d);
    const quick = (q) => h('button', { class: 'key num quick', onclick: () => submitTotal(q) }, q);
    const digitRows = [
      [digit(1), digit(2), digit(3)],
      [digit(4), digit(5), digit(6)],
      [digit(7), digit(8), digit(9)],
      [h('button', { class: 'key', onclick: () => { typed = typed.slice(0, -1); drawPad(); draw(); } }, '⌫'), digit(0), checkKey(rest)],
    ];
    const grid = h('div', { class: 'totalgrid' },
      digitRows.map((row, i) => [quick(QUICK_LEFT[i]), row, quick(QUICK_RIGHT[i])]),
    );
    padEl.append(display, grid);
  }

  // „Check“ checkt den Rest mit einem Tipp aus (bei mehreren möglichen Dart-Anzahlen kommt die Rückfrage)
  function checkKey(rest) {
    const canCheck = !!checkoutPath(rest, 3);
    return h('button', {
      class: `key checkkey${canCheck ? '' : ' off'}`,
      disabled: !canCheck,
      onclick: () => submitTotal(rest),
    }, 'Check');
  }

  async function submitTotal(points) {
    unlock();
    if (points == null || Number.isNaN(points)) { toast('Bitte eine Zahl eintippen.'); return; }
    const st = session.state;
    if (st.finished) return;
    if (botTurn()) { toast('Der Computer ist dran.'); return; }
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
    else if (party) drawParty(st, m);
    else panels.forEach((p, i) => {
      p.el.classList.toggle('active', !st.finished && st.current === i);
      p.name.textContent = m.playerNames[i];
      const showScore = i === st.current && !st.finished ? st.turnEval.remaining : st.scores[i];
      p.score.textContent = showScore;
      p.sets.innerHTML = m.format.setsBestOf > 1 ? `Sets <b>${st.setsWon[i]}</b>` : '';
      p.legs.innerHTML = `Legs <b>${st.legsWon[i]}</b>`;
      p.avg.replaceChildren(avgParts(m.players[i], 'Ø', 1));
      p.meta.replaceChildren(legCountParts(st, i));
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
    if (party) setHint(st.finished ? '' : st.mode.targetText(m.options, ev.after || st.leg, st.current));
    else if (!training) drawCheckout(st, m);
    // X01: Solange in der Aufnahme nichts eingegeben ist, heißt „Weiter“ NO SCORE (rot) und trägt 0 ein
    const bot = botTurn();
    const noScore = st.mode.id === 'x01' && !st.finished && !darts.length && !typed && !bot;
    nextBtn.classList.toggle('noscore', noScore);
    nextBtn.disabled = bot;
    let label = 'WEITER';
    if (bot) label = 'Computer wirft …';
    else if (ev.closed) label = `${darts.slice(0, ev.usedDarts).map(hitLabel).join(', ')} = ${turnText(ev, true)}  ▶`;
    else if (noScore) label = 'NO SCORE';
    else if (typed) label = parseInt(typed, 10) === ev.startRemaining ? `CHECK ${typed} ✓` : `WEITER ${typed}`; // Summen-Eingabe
    nextBtn.textContent = label;
    nextBtn.style.fontSize = ev.closed ? '20px' : '';
  }

  /** Hinweiszeile: Hauptweg groß, Alternativen klein daneben. */
  function setHint(main, alts = []) {
    hintEl.replaceChildren();
    if (!main) return;
    hintEl.append(h('div', { class: 'main' }, main), alts.length ? h('div', { class: 'alts' }, alts.map((a) => h('div', {}, a))) : null);
  }

  // X01: Finish-Weg für den aktuellen Rest und die übrigen Darts, plus bis zu 2 Alternativen
  function drawCheckout(st, m) {
    const ev = st.turnEval;
    let rest = ev.remaining;
    let dartsLeft = st.dartsLeft;
    // Summen-Eingabe: Zwischenstand eintippen (z. B. 54 nach T18 bei 141) -> Weg für den neuen Rest
    const part = typedPartial(ev.startRemaining);
    if (part) ({ rest, dartsLeft } = part);
    const x01 = !st.finished && !ev.bust && m.options.doubleOut && dartsLeft > 0 && st.mode.id === 'x01';
    const paths = x01 ? checkoutPaths(rest, dartsLeft, 3) : [];
    // Kein Finish möglich, aber in Reichweite: Stellwurf-Plan, der keinen Bogey (169, 159 …) übrig lässt
    const plan = x01 && !paths.length && rest <= 350 ? turnPlan(rest, dartsLeft) : null;
    if (paths.length) setHint(paths[0].join('  '), paths.slice(1).map((p) => p.join(' ')));
    else if (plan) setHint(plan.darts.join('  '), [`stellen · bleibt ${plan.leave}`]);
    else if (part) setHint(rest <= 170 ? `Kein Finish mit ${dartsLeft} Dart${dartsLeft > 1 ? 's' : ''}` : '');
    else setHint(st.hint ? st.hint.join('  ') : '');
  }

  /**
   * Eingetippte Summe als Zwischenstand: Rest danach und übrige Darts.
   * Geht die Zahl mit 1 Dart, bleiben 2; mit 2 Darts bleibt 1; sonst ist die Aufnahme voll
   * und es gilt der Weg für die nächste Aufnahme (3 Darts). null = nichts Sinnvolles eingetippt.
   */
  function typedPartial(startRemaining) {
    if (useCamera || inputMode !== 'total' || !typed) return null;
    const val = parseInt(typed, 10);
    const rest = startRemaining - val;
    if (!val || rest < 2) return null;
    const dartsLeft = ONE_DART.has(val) ? 2 : TWO_DARTS.has(val) ? 1 : 3;
    return { rest, dartsLeft };
  }

  /** „Runde 5 · 13 Darts“ im aktuellen Leg; die laufende Aufnahme zählt schon mit. */
  function legCountParts(st, i) {
    const leg = st.finished ? null : st.legs[st.legs.length - 1];
    const turns = leg ? leg.turns.filter((t) => t.player === i) : [];
    let darts = turns.reduce((n, t) => n + t.ev.usedDarts, 0);
    let rounds = turns.length;
    if (!st.finished && st.current === i) {
      rounds++; // Runde, die gerade geworfen wird
      darts += st.turnEval.usedDarts || 0;
    }
    if (!rounds) return [];
    return [h('span', {}, 'Runde ', h('b', {}, rounds)), h('span', {}, h('b', {}, darts), ' Darts')];
  }

  /** „Ø Leg 52.3  Spiel 48.1“ (X01) bzw. „MPR Leg 2.40  Spiel 2.10“ (Cricket), bricht bei Platzmangel um. */
  function avgParts(pid, label, digits) {
    const s = statsCache[pid];
    if (!s || s.game == null) return [];
    const f = (v) => (v == null ? '–' : v.toFixed(digits));
    return [h('span', {}, `${label} Leg `, h('b', {}, f(s.leg))), h('span', {}, 'Spiel ', h('b', {}, f(s.game)))];
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
    setHint(st.finished ? 'Fertig!' : s.target ? `Ziel: ${s.target}` : st.hint ? st.hint.join('  ') : '');
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
      p.avg.replaceChildren(avgParts(m.players[i], 'MPR', 2));
      p.meta.replaceChildren(legCountParts(st, i));
    });
    for (const r of cricketRows) {
      const counts = live.marks.map((mk) => mk[r.n]);
      r.marks.forEach((cell, i) => {
        cell.textContent = MARK[Math.min(3, counts[i])];
        cell.className = 'cm' + (counts[i] >= 3 ? ' closed' : '') + (st.current === i && !st.finished ? ' cur' : '');
      });
      // Zahl ist „tot“, wenn alle sie geschlossen haben
      r.el.className = 'crow' + (counts.every((c) => c >= 3) ? ' dead' : '');
    }
    if (cricketHead) [...cricketHead.children].slice(1).forEach((c, i) => c.classList.toggle('cur', st.current === i && !st.finished));
  }

  // Halve-It, Killer: Anzeige je Spieler kommt aus dem Spielmodus (live während der Aufnahme)
  function drawParty(st, m) {
    const live = st.finished ? st.leg : (st.turnEval.after || st.leg);
    panels.forEach((p, i) => {
      const v = st.mode.panel(m.options, live, i);
      p.el.classList.toggle('active', !st.finished && st.current === i);
      p.name.textContent = m.playerNames[i];
      p.score.textContent = v.big;
      p.sets.innerHTML = m.format.setsBestOf > 1 ? `Sets <b>${st.setsWon[i]}</b>` : '';
      p.legs.innerHTML = `Legs <b>${st.legsWon[i]}</b>`;
      p.meta.replaceChildren(h('span', {}, v.sub));
      p.avg.replaceChildren();
    });
  }

  /** Bewertung der zuletzt abgeschlossenen Aufnahme (nach „Weiter“). */
  function lastClosedEval(st) {
    for (let i = st.legs.length - 1; i >= 0; i--) {
      const ts = st.legs[i].turns;
      if (ts.length) return ts[ts.length - 1].ev;
    }
    return null;
  }

  // Durchschnitt pro Spieler im aktuellen Leg und im ganzen Match
  function updateAverages() {
    // throwRows berücksichtigt nur abgeschlossene Aufnahmen
    if (training) return;
    const all = throwRows(session.match);
    const legNo = session.state.legOverall;
    const value = (rows) => {
      if (cricket) { const c = cricketStats(rows); return c.turns ? c.mpr : null; }
      const s = playerStats(rows);
      return s.darts ? s.average : null;
    };
    session.match.players.forEach((pid) => {
      const rows = all.filter((r) => r.playerId === pid);
      statsCache[pid] = { game: value(rows), leg: value(rows.filter((r) => r.legOverall === legNo)) };
    });
  }

  // Vor dem Wurf den Rest ansagen, wenn er auscheckbar ist (X01, z. B. „Kevin, Rest 80“)
  function announceRequire() {
    const st = session.state;
    if (st.finished || st.mode.id !== 'x01' || !session.match.options.doubleOut || !getSettings().announceRequire) return;
    const rest = st.scores[st.current];
    if (!checkoutPath(rest, 3)) return;
    announceUpNext(`${session.match.playerNames[st.current]}, ${speechText().youRequire(rest)}`);
  }

  // ---------- Ablauf ----------
  async function doNext(reason) {
    if (session.state.finished) { showMatchEnd(); return; }
    if (botTurn() && reason !== 'bot') return; // Der Computer schließt seine Aufnahme selbst ab
    // Summen-Eingabe: eine eingetippte Zahl mit „Weiter“ übernehmen statt 0 einzutragen
    if (!useCamera && inputMode === 'total' && typed) { submitTotal(parseInt(typed, 10)); return; }
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
    if (type === 'next') announceRequire();
    // Summen-Eingabe: Feld neu aufbauen (Rest-Taste hängt vom Rest des Spielers ab, der dran ist)
    if ((type === 'next' || type === 'undo') && !useCamera && inputMode === 'total') { typed = ''; drawPad(); }
    if (type === 'legWon') {
      const name = session.match.playerNames[data.winner];
      banner(data.setWon ? `Set für ${name}!` : `Leg für ${name}!`, 2200);
    }
    if (type === 'matchWon') showMatchEnd();
    if (type === 'error') toast(data.message);
    draw();
    if (cam) cam.sessionChanged(type, data);
    scheduleBot();
  });

  // ---------- Computer-Gegner ----------
  // Wirft Dart für Dart mit kurzer Pause, damit man mitlesen und die Ansage hören kann.
  function scheduleBot() {
    clearTimeout(botTimer);
    if (disposed || !botTurn()) return;
    const st = session.state;
    const delay = st.turnEval.closed ? 1100 : st.turnDarts.length ? 900 : 1500;
    botTimer = setTimeout(botStep, delay);
  }

  function botStep() {
    if (disposed || !botTurn() || document.querySelector('.endsheet')) return;
    const st = session.state;
    if (st.turnEval.closed) { doNext('bot'); return; }
    const m = session.match;
    const live = st.turnEval.after || st.leg;
    const target = st.mode.botTarget
      ? st.mode.botTarget(m.options, live, st.current, st.turnEval, st.dartsLeft)
      : { segment: 20, multiplier: 3 };
    session.addDart(botThrow(target, botLevel(m.players[st.current])), 'bot');
  }

  /**
   * Rückgängig. Aufnahmen des Computers werden dabei übersprungen, sonst würde er sofort
   * neu werfen und man käme nie an die eigene Aufnahme heran.
   */
  function undo(kind) {
    clearTimeout(botTimer);
    selected = null;
    const step = () => (kind === 'dart' ? session.undoDart() : session.undoTurn());
    step();
    while (botTurn() && session.match.turns.length) step();
  }

  function showMatchEnd() {
    const st = session.state;
    const m = session.match;
    if (!st.finished) return;
    if (document.querySelector('.endsheet')) return; // schon offen (z. B. doppelt „Weiter“)
    keepAwake(false);
    if (training) { showTrainingEnd(st, m); return; }
    const name = m.playerNames[st.winner];
    const sets = m.format.setsBestOf > 1;
    const result = (sets ? st.setsWon : st.legsWon).join(' : ') + (sets ? ' Sets' : ' Legs');
    const recordsEl = h('div', { class: 'records' });
    const s = sheet(h('div', { class: 'stack endsheet' },
      h('h2', {}, `🏆 ${name} gewinnt!`),
      h('div', { class: 'confirmturn num' }, result),
      m.players.length > 2 ? h('p', { class: 'dim', style: { margin: '-8px 0 0', textAlign: 'center' } }, m.playerNames.join(' · ')) : null,
      recordsEl,
      h('button', {
        class: 'btn primary',
        onclick: () => {
          s.close();
          // Anwurf rückt einen Platz weiter; Killer bekommt neue Zahlen (prepareOptions)
          const setup = { mode: m.mode, options: m.options, players: m.players, playerNames: m.playerNames, setsBestOf: m.format.setsBestOf, legsBestOf: m.format.legsBestOf, firstStarter: (m.firstStarter + 1) % m.players.length, starterMethod: 'tap' };
          nav.go('game', { setup, camera: useCamera, inputMode });
        },
      }, 'Revanche'),
      h('button', { class: 'btn', onclick: () => { s.close(); nav.go('stats', m.players.some(isBotId) ? { player: m.players[0], tab: 'training' } : {}); } }, 'Statistik'),
      h('button', { class: 'btn ghost', onclick: () => { s.close(); nav.go('home'); } }, 'Startseite'),
      h('button', { class: 'btn ghost', onclick: () => { s.close(); undo('dart'); keepAwake(true); } }, 'Letzten Dart zurücknehmen'),
    ), { dismissable: false });
    showRecords(m, recordsEl);
  }

  /**
   * Neue persönliche Bestwerte in diesem Match (nur menschliche Spieler, nur X01 und Cricket).
   * Verglichen wird mit allen früher beendeten Matches desselben Modus.
   */
  async function showRecords(m, el) {
    if (m.mode !== 'x01' && m.mode !== 'cricket') return;
    if (m.players.some(isBotId)) return; // gegen den Computer: Training, keine Rekorde
    try {
      const [rows, matches] = await Promise.all([dbGetAll('throws'), dbGetAll('matches')]);
      const earlier = new Set(matches.filter((x) => x.id !== m.id && x.status === 'finished' && x.mode === m.mode && !x.players.some(isBotId)).map((x) => x.id));
      const now = throwRows(m);
      const lines = [];
      m.players.forEach((pid, i) => {
        if (isBotId(pid)) return;
        const prev = rows.filter((r) => r.playerId === pid && earlier.has(r.matchId));
        if (!prev.length) return; // erstes Match: noch nichts zu vergleichen
        const mine = now.filter((r) => r.playerId === pid);
        const who = m.players.length > 1 ? `${m.playerNames[i]}: ` : '';
        const byMatch = new Map();
        for (const r of prev) (byMatch.get(r.matchId) || byMatch.set(r.matchId, []).get(r.matchId)).push(r);
        if (m.mode === 'cricket') {
          const c = cricketStats(mine);
          const best = Math.max(...[...byMatch.values()].map((rs) => cricketStats(rs).mpr));
          if (c.turns && c.mpr > best) lines.push(`${who}Beste MPR ${c.mpr.toFixed(2)} (bisher ${best.toFixed(2)})`);
          return;
        }
        const s = playerStats(mine);
        const p = playerStats(prev);
        const bestAvg = Math.max(...[...byMatch.values()].map((rs) => playerStats(rs).average));
        if (s.darts && s.average > bestAvg) lines.push(`${who}Bester Average ${s.average.toFixed(1)} (bisher ${bestAvg.toFixed(1)})`);
        if (s.bestLeg && (!p.bestLeg || s.bestLeg < p.bestLeg)) lines.push(`${who}Bestes Leg: ${s.bestLeg} Darts${p.bestLeg ? ` (bisher ${p.bestLeg})` : ''}`);
        if (s.highestCheckout > p.highestCheckout) lines.push(`${who}Höchstes Finish ${s.highestCheckout} (bisher ${p.highestCheckout || '–'})`);
        if (s.highest > p.highest) lines.push(`${who}Höchste Aufnahme ${s.highest} (bisher ${p.highest})`);
      });
      if (lines.length) el.replaceChildren(h('div', { class: 'recordhead' }, '🎉 Neuer Rekord!'), lines.map((l) => h('div', {}, l)));
    } catch (e) { console.warn('Rekorde nicht ermittelbar', e); }
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
      useCamera ? h('button', { class: 'btn', onclick: () => { s.close(); askManualInput(); } }, 'Kamera aus – Handeingabe') : null,
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
    if (!calibration) { switchToManual(inputMode); toast('Keine Kalibrierung – nur Handeingabe.'); return; }
    try {
      const { CameraGame } = await import('../../vision/cameraGame.js');
      if (disposed) return;
      cam = new CameraGame({
        container: camPanel,
        statusEl,
        alertEl,
        calibration,
        session,
        onHit: (hit, info) => { if (botTurn()) return; unlock(); session.addDart(hit, 'camera', info); }, // Darts des Computers gibt es nicht am Board
        onTapHit: (hit) => enter(hit, 'manual'),
        onBoardEmpty: () => { if (!botTurn() && getSettings().autoAdvance && session.state.openTurnIndex >= 0) doNext('auto'); },
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
      if (disposed) return;
      switchToManual(inputMode);
      toast('Kamera konnte nicht gestartet werden – weiter mit Handeingabe.', 4000);
    }
  }

  // Kamera funktioniert nicht: einmalig auf Handeingabe wechseln (einzige Ausnahme von der festen Eingabeart)
  function askManualInput() {
    const opts = [['dart', 'Pro Dart'], ['board', 'Scheibe'], ...(supportsTotal ? [['total', 'Summe']] : [])];
    const s = sheet(h('div', { class: 'stack' },
      h('h2', {}, 'Weiter mit Handeingabe'),
      h('p', { class: 'dim', style: { margin: 0 } }, 'Die Kamera wird für dieses Spiel ausgeschaltet.'),
      opts.map(([k, label]) => h('button', { class: k === inputMode ? 'btn primary' : 'btn', onclick: () => { s.close(); switchToManual(k); } }, label)),
      h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Abbrechen'),
    ));
  }

  function switchToManual(kind) {
    if (cam) { cam.stop(); cam = null; }
    import('../../vision/camera.js').then(({ camera }) => camera.stop()).catch(() => {}); // Kamera freigeben (Akku)
    useCamera = false;
    inputMode = kind === 'total' && !supportsTotal ? 'dart' : kind;
    session.match.camera = false;
    session.match.inputMode = inputMode;
    camPanel.replaceChildren();
    alertEl.classList.add('hidden');
    statusEl.classList.add('hidden'); // Statuszeile nur für die Kamera
    padOpen = true;
    selected = null;
    typed = '';
    session.set(session.match, 'input', {});
    drawPad();
  }

  drawPad();
  draw();
  updateAverages();
  if (useCamera) startCamera();
  else statusEl.classList.add('hidden'); // Statuszeile nur für die Kamera

  // Match sofort lokal sichern
  session.set(session.match, 'init', {});

  return () => {
    disposed = true;
    clearTimeout(botTimer);
    landscape.removeEventListener?.('change', placeActions);
    keepAwake(false);
    if (cam) cam.stop();
  };
}

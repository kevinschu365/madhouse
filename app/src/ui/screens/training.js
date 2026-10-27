// Trainingsbereich: Übungen für einen Spieler, mit Rekord und letztem Ergebnis je Variante.
import { h, toast, promptDialog } from '../dom.js';
import { getPlayers, addPlayer, getSettings, updateSettings, displayName, ownerId } from '../../core/settings.js';
import { lsGet, dbGetAll } from '../../core/storage.js';
import { unlock } from '../../audio/speech.js';
import { getMode } from '../../rules/index.js';
import { trainingRecords, trainingKey, playerStats, cricketStats, doubleStats } from '../../stats/stats.js';
import { throwRows } from '../../game/match.js';
import { BOT_LEVELS, BOT_LEVEL_NAMES, botName, isBotId } from '../../game/bot.js';
import { JDC_GRADES } from '../../rules/training.js';

const yesNo = [[true, 'Ja'], [false, 'Nein']];
const DOUBLE_TARGETS = [[20, 'D20'], [16, 'D16'], [8, 'D8'], [18, 'D18'], [10, 'D10'], [12, 'D12'], [4, 'D4'], [25, 'Bullseye'], [0, 'Reihum D1–D20 + Bull'],
  ...[1, 2, 3, 5, 6, 7, 9, 11, 13, 14, 15, 17, 19].map((n) => [n, `D${n}`])];

// Auswahl je Übung: [Option, Beschriftung, [[Wert, Text], …]]
export const DRILLS = [
  {
    cat: 'Treffsicherheit', id: 'atc',
    text: '1 bis 20 und Bull der Reihe nach. Erst wenn das Feld getroffen ist, geht es weiter. Gewertet: Darts bis zum Ende (weniger ist besser).',
    opts: [['variant', 'Felder', [['any', 'Alle'], ['double', 'Nur Doubles'], ['triple', 'Nur Triples']]], ['bull', 'Bull am Ende', yesNo]],
  },
  {
    cat: 'Treffsicherheit', id: 'shanghai',
    text: 'Runde 1 auf die 1, Runde 2 auf die 2 … Punkte zählen nur auf der Rundenzahl. Single, Double und Triple in einer Aufnahme = Shanghai, sofort gewonnen.',
    opts: [['to', 'Zahlen', [[7, '1–7'], [20, '1–20']]]],
  },
  {
    cat: 'Doubles', id: 'bobs27',
    text: 'Start mit 27 Punkten, je 3 Darts auf D1 bis D20, dann Bullseye. Jeder Treffer bringt den Wert des Doubles. Keiner getroffen: Wert wird abgezogen. Bei 0 oder weniger ist Schluss.',
    opts: [],
  },
  {
    cat: 'Doubles', id: 'doubles',
    text: 'Feste Zahl Darts auf ein Double, oder reihum D1–D20 und Bull mit je 3 Darts. Gewertet: Trefferquote.',
    opts: [['target', 'Double', DOUBLE_TARGETS], ['darts', 'Darts', [[15, '15'], [30, '30'], [60, '60'], [99, '99']]]],
  },
  {
    cat: 'Scoring', id: 'score',
    text: 'Eine feste Zahl Aufnahmen, alles zählt. Gewertet: Average (3 Darts), dazu 100+, 140+ und 180.',
    opts: [['rounds', 'Aufnahmen', [[10, '10'], [20, '20'], [33, '33 (≈ 100 Darts)']]]],
  },
  {
    cat: 'Checkout', id: 'c121',
    text: 'Ab 121 mit Double-Out finishen. Geschafft: eine Zahl höher. Nicht geschafft: eine Zahl tiefer (nie unter den Start). Gewertet: höchstes geschafftes Finish.',
    opts: [['start', 'Start', [[61, '61'], [81, '81'], [101, '101'], [121, '121']]], ['limit', 'Darts je Zahl', [[6, '6'], [9, '9'], [12, '12'], [15, '15']]], ['attempts', 'Versuche', [[10, '10'], [20, '20']]]],
  },
  {
    cat: 'Checkout', id: 'catch40',
    text: '61 bis 100 auschecken, je höchstens 6 Darts. 2 Darts = 3 Punkte, 3 Darts = 2 Punkte, 4–6 Darts = 1 Punkt (bei 99 zählen 3 Darts wie 2). Maximal 120 Punkte.',
    opts: [],
  },
  {
    cat: 'Checkout', id: 'randomco',
    text: 'Zufällige Restwerte, die mit 3 Darts machbar sind. Gewertet: wie viele du schaffst.',
    opts: [['limit', 'Darts je Zahl', [[3, '3'], [6, '6'], [9, '9']]], ['max', 'Bis', [[60, '60'], [100, '100'], [170, '170']]], ['attempts', 'Versuche', [[10, '10'], [20, '20']]]],
  },
  {
    cat: 'Checkout', id: 'costreak',
    text: 'Zufällige machbare Restwerte, so viele wie möglich hintereinander. Der erste nicht geschaffte beendet die Serie. Gewertet: längste Serie.',
    opts: [['limit', 'Darts je Zahl', [[3, '3'], [6, '6']]], ['max', 'Bis', [[60, '60'], [100, '100'], [170, '170']]]],
  },
  {
    cat: 'Komplett-Test', id: 'jdc',
    text: `Teil 1 Shanghai 10–15, Teil 2 je 1 Dart auf D1–D20 und Bull (50 je Treffer, Bullseye 100), Teil 3 Shanghai 15–20. Shanghai +100. Stufen: ${JDC_GRADES.slice().reverse().map(([min, n]) => `${n} ${min}+`).join(', ')}.`,
    opts: [],
  },
];

export function render(root, params, nav) {
  const s = getSettings();
  const players = () => getPlayers();
  let player = params.player || s.trainingPlayer || ownerId() || null;
  if (!players().some((p) => p.id === player)) player = players()[0]?.id || null;
  let camera = s.cameraEnabled;
  // Handeingabe im Training: pro Dart, Scheibe oder Summe (Summe nur X01 gegen den Computer, sonst pro Dart)
  let input = ['board', 'total'].includes(s.trainingInput) ? s.trainingInput : 'dart';
  const chosen = { ...(s.trainingOptions || {}) };
  let records = {};
  let allMatches = [];
  let allThrows = [];

  const body = h('div', { class: 'stack', style: { maxWidth: '640px', margin: '0 auto' } });
  root.appendChild(body);

  const optionsOf = (id) => ({ ...getMode(id).defaultOptions, ...(chosen[id] || {}) });
  const dropdown = (label, values, current, onPick) => h('label', { class: 'field' }, h('span', {}, label),
    h('select', { onchange: (e) => onPick(JSON.parse(e.target.value)) },
      values.map(([v, text]) => h('option', { value: JSON.stringify(v), selected: v === current }, text))));

  const NEW = '__neu';
  const pickPlayer = async (value) => {
    if (value === NEW) {
      const n = await promptDialog('Neuer Spieler', '', { ok: 'Anlegen', placeholder: 'Name' });
      if (n == null) { draw(); return; }
      try { value = addPlayer(n).id; } catch (e) { toast(e.message); draw(); return; }
    }
    player = value || null;
    updateSettings({ trainingPlayer: player });
    computeRecords();
    draw();
  };

  const computeRecords = () => { records = player ? trainingRecords(allMatches, player, getMode) : {}; };

  const start = (id) => {
    unlock(); // iOS: Sprachausgabe durch diesen Tipp freischalten
    const p = players().find((x) => x.id === player);
    if (!p) { toast('Bitte zuerst einen Spieler wählen.'); return; }
    updateSettings({ cameraEnabled: camera, trainingOptions: chosen, trainingPlayer: player });
    const gameParams = {
      setup: { mode: id, options: optionsOf(id), players: [p.id], playerNames: [p.name], setsBestOf: 1, legsBestOf: 1, firstStarter: 0, starterMethod: 'tap' },
      camera,
      inputMode: input,
    };
    if (camera) nav.go('calibrate', { mode: 'quickcheck', then: 'game', thenParams: gameParams });
    else nav.go('game', gameParams);
  };

  // ---------- Übungs-Vorschlag: schwächstes Doppel aus der Doppel-Quote (echte X01-Matches) ----------
  const MIN_ATTEMPTS = 8; // darunter ist die Quote zu zufällig
  const weakestDouble = () => {
    if (!player) return null;
    const real = new Set(allMatches.filter((m) => m.status === 'finished' && !m.players.some(isBotId)).map((m) => m.id));
    const list = doubleStats(allThrows.filter((r) => r.playerId === player && real.has(r.matchId)))
      .filter((d) => d.attempts >= MIN_ATTEMPTS);
    if (list.length < 2) return null; // ein Vergleich braucht mindestens zwei Doppel
    return list.reduce((a, b) => (b.rate < a.rate ? b : a));
  };

  const tipCard = () => {
    const d = weakestDouble();
    if (!d) return null;
    const segment = d.target === 'BULL' ? 25 : parseInt(d.target.slice(1), 10);
    return h('div', { class: 'card tip-card' },
      h('div', { class: 'drillhead' },
        h('h3', {}, '💡 Übungs-Vorschlag'),
        h('button', {
          class: 'btn primary small',
          onclick: () => {
            chosen.doubles = { ...(chosen.doubles || {}), target: segment };
            updateSettings({ trainingOptions: chosen });
            start('doubles');
          },
        }, 'Üben')),
      h('p', { style: { margin: 0, fontSize: '15px' } },
        'Dein schwächstes Doppel ist ', h('b', {}, d.target === 'BULL' ? 'Bullseye' : d.target),
        `: ${Math.round(d.rate * 100)} % (${d.hits} von ${d.attempts} Versuchen).`),
      h('p', { class: 'dim', style: { margin: '4px 0 0', fontSize: '13px' } }, `„Üben“ startet das Doubles-Training auf ${d.target === 'BULL' ? 'Bullseye' : d.target}.`),
    );
  };

  // ---------- Gegen den Computer: X01 oder Cricket, zählt nicht in die Statistik gegen echte Spieler ----------
  const vs = { mode: 'x01', startScore: 501, cutThroat: false, level: 60, legs: 3, starter: 0, ...(s.botSetup || {}) };
  const saveVs = () => updateSettings({ botSetup: { ...vs } });

  const startVs = () => {
    unlock(); // iOS: Sprachausgabe durch diesen Tipp freischalten
    const p = players().find((x) => x.id === player);
    if (!p) { toast('Bitte zuerst einen Spieler wählen.'); return; }
    saveVs();
    updateSettings({ cameraEnabled: camera, trainingPlayer: player });
    const gameParams = {
      setup: {
        mode: vs.mode,
        options: vs.mode === 'x01' ? { startScore: vs.startScore, doubleOut: true } : { cutThroat: vs.cutThroat },
        players: [p.id, `bot:${vs.level}`],
        playerNames: [p.name, botName(vs.level)],
        setsBestOf: 1, legsBestOf: vs.legs, firstStarter: vs.starter, starterMethod: 'tap',
      },
      camera,
      inputMode: input,
    };
    if (camera) nav.go('calibrate', { mode: 'quickcheck', then: 'game', thenParams: gameParams });
    else nav.go('game', gameParams);
  };

  /** Bilanz gegen den Computer in dieser Stärke und diesem Spiel: Siege und dein Average bzw. MPR. */
  const vsLine = () => {
    const list = allMatches.filter((m) => m.status === 'finished' && m.mode === vs.mode && m.players.length === 2
      && m.players[0] === player && m.players[1] === `bot:${vs.level}`);
    if (!list.length) return h('div', { class: 'rec dim' }, 'Noch nicht gegen diese Stärke gespielt');
    const won = list.filter((m) => m.winner === 0).length;
    const rows = list.flatMap((m) => throwRows(m)).filter((r) => r.playerId === player);
    const value = vs.mode === 'x01' ? `Dein Ø ${playerStats(rows).average.toFixed(1)}` : `Deine MPR ${cricketStats(rows).mpr.toFixed(2)}`;
    return h('div', { class: 'rec' }, h('span', {}, '🏆 ', h('b', {}, `${won} / ${list.length}`), ' gewonnen'), h('span', { class: 'dim' }, value));
  };

  const vsCard = () => h('div', { class: 'card drill' },
    h('div', { class: 'drillhead' }, h('h3', {}, '🤖 Computer'), h('button', { class: 'btn primary small', onclick: startVs }, 'Start')),
    h('p', { class: 'dim', style: { margin: '0 0 6px', fontSize: '14px' } }, 'Ein Match gegen den Computer. Er wirft von selbst und spielt echte Finish-Wege. Zählt nicht in deine X01- und Cricket-Statistik gegen echte Spieler.'),
    h('div', { class: 'chips', style: { margin: '0 0 2px' } },
      [['x01', 'X01'], ['cricket', 'Cricket']].map(([k, label]) => h('button', { class: `chip ${vs.mode === k ? 'on' : ''}`, onclick: () => { vs.mode = k; saveVs(); draw(); } }, label))),
    h('div', { class: 'grid2' },
      vs.mode === 'x01'
        ? dropdown('Startwert', [301, 501, 701].map((v) => [v, String(v)]), vs.startScore, (v) => { vs.startScore = v; saveVs(); })
        : dropdown('Variante', [[false, 'Standard'], [true, 'Cut Throat']], vs.cutThroat, (v) => { vs.cutThroat = v; saveVs(); }),
      dropdown('Stärke', BOT_LEVELS.map((l) => [l, `Ø${l} · ${BOT_LEVEL_NAMES[l]}`]), vs.level, (v) => { vs.level = v; saveVs(); draw(); }),
      dropdown('Legs', [1, 3, 5, 7].map((v) => [v, v === 1 ? '1 Leg' : `Best of ${v}`]), vs.legs, (v) => { vs.legs = v; saveVs(); }),
      dropdown('Wer beginnt?', [[0, 'Du'], [1, 'Computer']], vs.starter, (v) => { vs.starter = v; saveVs(); }),
    ),
    vsLine(),
  );

  const drillCard = (d) => {
    const mode = getMode(d.id);
    const o = optionsOf(d.id);
    const rec = records[trainingKey(mode, o)];
    const recLine = rec
      ? h('div', { class: 'rec' }, h('span', {}, '🏆 ', h('b', {}, rec.best.text)), h('span', { class: 'dim' }, `Zuletzt ${rec.last.text} · ${rec.count}×`))
      : h('div', { class: 'rec dim' }, 'Noch nicht gespielt');
    const optEls = d.opts.filter(([key]) => !(d.id === 'doubles' && key === 'darts' && o.target === 0)).map(([key, label, values]) => dropdown(label, values, o[key], (v) => {
      chosen[d.id] = { ...(chosen[d.id] || {}), [key]: v };
      updateSettings({ trainingOptions: chosen });
      draw();
    }));
    return h('div', { class: 'card drill' },
      h('div', { class: 'drillhead' }, h('h3', {}, mode.label), h('button', { class: 'btn primary small', onclick: () => start(d.id) }, 'Start')),
      h('p', { class: 'dim', style: { margin: '0 0 6px', fontSize: '14px' } }, d.text),
      optEls.length ? h('div', { class: optEls.length >= 3 ? 'grid3' : 'grid2' }, optEls) : null,
      recLine,
    );
  };

  const draw = () => {
    const ps = players();
    const hasCal = !!lsGet('calibration', null);
    const playerOptions = [['', '– wählen –'], ...ps.map((p) => [p.id, displayName(p, ps)]), [NEW, '+ Neuer Spieler …']];
    const cats = [...new Set(DRILLS.map((d) => d.cat))];
    body.replaceChildren(
      h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Training'),
        h('button', { class: 'iconbtn', onclick: () => nav.go('stats', { player, tab: 'training' }), 'aria-label': 'Verlauf' }, '📈')),
      h('div', { class: 'card' },
        h('div', { class: 'grid2' },
          dropdown('Spieler', playerOptions, player || '', pickPlayer),
          dropdown('Eingabe', [['camera', 'Kamera'], ['dart', 'Pro Dart'], ['board', 'Scheibe'], ['total', 'Summe (nur X01)']], camera ? 'camera' : input, (v) => {
            camera = v === 'camera';
            if (!camera) input = v;
            updateSettings({ cameraEnabled: camera, ...(camera ? {} : { trainingInput: input }) });
            draw();
          }),
        ),
        camera && !hasCal ? h('p', { class: 'dim', style: { margin: '4px 0 0', fontSize: '14px' } }, 'Noch keine Kalibrierung – sie kommt vor dem Training.') : null,
      ),
      tipCard(),
      h('h3', { class: 'cat' }, 'Gegen den Computer'),
      vsCard(),
      cats.map((c) => [h('h3', { class: 'cat' }, c), DRILLS.filter((d) => d.cat === c).map(drillCard)]),
    );
  };

  draw();
  Promise.all([dbGetAll('matches'), dbGetAll('throws')]).then(([all, throws]) => {
    allMatches = all;
    allThrows = throws;
    computeRecords();
    draw();
  }).catch((e) => console.warn(e));
}

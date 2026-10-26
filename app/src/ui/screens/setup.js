import { h, toast, promptDialog } from '../dom.js';
import { getPlayers, addPlayer, getSettings, updateSettings } from '../../core/settings.js';
import { lsGet } from '../../core/storage.js';
import { unlock } from '../../audio/speech.js';

export function render(root, params, nav) {
  const s = getSettings();
  const cfg = {
    mode: s.lastSetup.mode === 'cricket' ? 'cricket' : 'x01',
    cutThroat: !!s.lastSetup.cutThroat,
    startScore: s.lastSetup.startScore || 501,
    setsBestOf: s.lastSetup.setsBestOf || 1,
    legsBestOf: s.lastSetup.legsBestOf || 3,
    selected: (s.lastSetup.players || []).filter((id) => getPlayers().some((p) => p.id === id)).slice(0, 2),
    starter: 'p0', // 'p0' | 'p1' | 'bull'
    camera: s.cameraEnabled,
    input: s.inputMode || 'dart', // Handeingabe: 'dart' | 'board' | 'total' (Summe nur X01)
  };
  const body = h('div', { class: 'stack', style: { maxWidth: '560px', margin: '0 auto' } });

  // Auswahlfeld mit Beschriftung; values = [[Wert, Text], …]
  const dropdown = (label, values, current, onPick) => h('label', { class: 'field' }, h('span', {}, label),
    h('select', { onchange: (e) => onPick(e.target.value) },
      values.map(([v, text]) => h('option', { value: String(v), selected: String(v) === String(current) }, text))));

  const NEW = '__neu';
  const pickPlayer = async (slot, value) => {
    if (value === NEW) {
      const n = await promptDialog('Neuer Spieler', '', { ok: 'Anlegen', placeholder: 'Name' });
      if (n != null) {
        try { value = addPlayer(n).id; } catch (e) { toast(e.message); value = null; }
      } else value = null;
    }
    const other = 1 - slot;
    // Gleicher Spieler auf beiden Plätzen -> Plätze tauschen
    if (value && cfg.selected[other] === value) cfg.selected[other] = cfg.selected[slot] || null;
    cfg.selected[slot] = value || null;
    draw();
  };

  const draw = () => {
    body.replaceChildren();
    const players = getPlayers();
    const hasCal = !!lsGet('calibration', null);
    const nameOf = (i) => players.find((p) => p.id === cfg.selected[i])?.name || `Spieler ${i + 1}`;
    const playerOptions = [['', '– wählen –'], ...players.map((p) => [p.id, p.name]), [NEW, '+ Neuer Spieler …']];
    const ready = !!(cfg.selected[0] && cfg.selected[1] && cfg.selected[0] !== cfg.selected[1]);
    if (cfg.starter === 'bull' && !cfg.camera) cfg.starter = 'p0';
    if (cfg.input === 'total' && cfg.mode !== 'x01') cfg.input = 'dart';
    const inputValue = cfg.camera ? 'camera' : cfg.input;
    const inputOptions = [['camera', 'Kamera'], ['dart', 'Pro Dart'], ['board', 'Scheibe'], ...(cfg.mode === 'x01' ? [['total', 'Summe']] : [])];
    body.append(
      h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Neues Spiel')),
      h('div', { class: 'card' },
        h('div', { class: 'grid2' },
          dropdown('Spieler 1', playerOptions, cfg.selected[0] || '', (v) => pickPlayer(0, v)),
          dropdown('Spieler 2', playerOptions, cfg.selected[1] || '', (v) => pickPlayer(1, v)),
        ),
        h('div', { class: 'chips', style: { margin: '8px 0 2px' } },
          [['x01', 'X01'], ['cricket', 'Cricket']].map(([k, label]) =>
            h('button', { class: `chip ${cfg.mode === k ? 'on' : ''}`, onclick: () => { cfg.mode = k; draw(); } }, label))),
        h('div', { class: 'grid3' },
          cfg.mode === 'x01'
            ? dropdown('Startwert', [301, 501, 701].map((v) => [v, String(v)]), cfg.startScore, (v) => { cfg.startScore = +v; })
            : dropdown('Variante', [['0', 'Standard'], ['1', 'Cut Throat']], cfg.cutThroat ? '1' : '0', (v) => { cfg.cutThroat = v === '1'; draw(); }),
          dropdown('Sets', [1, 3, 5, 7].map((v) => [v, v === 1 ? 'Keine' : `Best of ${v}`]), cfg.setsBestOf, (v) => { cfg.setsBestOf = +v; draw(); }),
          dropdown(cfg.setsBestOf > 1 ? 'Legs pro Set' : 'Legs', [1, 3, 5, 7, 9, 11].map((v) => [v, v === 1 ? '1 Leg' : `Best of ${v}`]), cfg.legsBestOf, (v) => { cfg.legsBestOf = +v; }),
        ),
        h('div', { class: 'grid2' },
          dropdown('Wer beginnt?', [['p0', nameOf(0)], ['p1', nameOf(1)], ...(cfg.camera ? [['bull', 'Ausbullen (Kamera)']] : [])], cfg.starter, (v) => { cfg.starter = v; }),
          dropdown('Eingabe', inputOptions, inputValue, (v) => { cfg.camera = v === 'camera'; if (!cfg.camera) cfg.input = v; draw(); }),
        ),
        h('p', { class: 'dim', style: { margin: '4px 0 0', fontSize: '14px' } },
          cfg.mode === 'x01' ? 'Double-Out.'
            : cfg.cutThroat ? 'Cricket 15–20 und Bull. Cut Throat: Deine Punkte bekommt der Gegner, wenig Punkte gewinnen.'
              : 'Cricket 15–20 und Bull. Wer alles geschlossen hat und vorne liegt (oder gleich), gewinnt.',
          ' Wer das Leg beginnt, wechselt nach jedem Leg.',
          cfg.camera ? ' Korrekturen per Zahlenfeld; fällt die Kamera aus, kannst du im Menü auf Handeingabe wechseln.' : ' Die Eingabeart bleibt während des Spiels fest.',
          cfg.camera && !hasCal ? ' Noch keine Kalibrierung – sie kommt vor dem Spiel.' : ''),
      ),
      h('button', {
        class: 'btn primary', style: { minHeight: '64px', fontSize: '22px' },
        disabled: !ready,
        onclick: () => {
          unlock(); // iOS: Sprachausgabe durch diesen Tipp freischalten
          updateSettings({ lastSetup: { mode: cfg.mode, cutThroat: cfg.cutThroat, startScore: cfg.startScore, setsBestOf: cfg.setsBestOf, legsBestOf: cfg.legsBestOf, players: cfg.selected.slice() }, cameraEnabled: cfg.camera, inputMode: cfg.input });
          const ps = getPlayers();
          const gameParams = {
            setup: {
              mode: cfg.mode,
              options: cfg.mode === 'x01' ? { startScore: cfg.startScore, doubleOut: true } : { cutThroat: cfg.cutThroat },
              players: cfg.selected.slice(),
              playerNames: cfg.selected.map((id) => ps.find((p) => p.id === id).name),
              setsBestOf: cfg.setsBestOf,
              legsBestOf: cfg.legsBestOf,
              firstStarter: cfg.starter === 'p1' ? 1 : 0,
              starterMethod: cfg.starter === 'bull' ? 'bull' : 'tap',
            },
            camera: cfg.camera,
            inputMode: cfg.input,
          };
          if (cfg.camera) nav.go('calibrate', { mode: 'quickcheck', then: 'game', thenParams: gameParams });
          else nav.go('game', gameParams);
        },
      }, ready ? 'Spiel starten' : 'Zwei Spieler wählen'),
    );
  };
  draw();
  root.appendChild(body);
}

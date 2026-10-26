import { h, toast, promptDialog } from '../dom.js';
import { getPlayers, addPlayer, getSettings, updateSettings } from '../../core/settings.js';
import { lsGet } from '../../core/storage.js';
import { unlock } from '../../audio/speech.js';
import { getMode } from '../../rules/index.js';
import { BOT_LEVELS, isBotId, botLevel, botName } from '../../game/bot.js';

const MODES = [['x01', 'X01'], ['cricket', 'Cricket'], ['halveit', 'Halve-It'], ['killer', 'Killer']];

const MODE_TEXT = {
  x01: 'Double-Out.',
  cricket: 'Cricket 15–20 und Bull. Wer alles geschlossen hat und vorne liegt (oder gleich), gewinnt.',
  cricketCut: 'Cricket 15–20 und Bull. Cut Throat: Deine Punkte bekommt der Gegner, wenig Punkte gewinnen.',
  halveit: 'Halve-It: 9 Runden mit festem Ziel (15, 16, Double, 17, 18, Triple, 19, 20, Bull), Start mit 40 Punkten. Treffer aufs Ziel zählen; kein Treffer in der Runde halbiert deinen Stand. Höchste Punktzahl gewinnt.',
  killer: 'Killer: Jeder bekommt eine Zahl. Triff dein Double, dann bist du Killer. Als Killer kostet jeder Treffer auf das Double eines Gegners ihm ein Leben (dein eigenes kostet dich eins). Der Letzte gewinnt.',
};

export function render(root, params, nav) {
  const s = getSettings();
  const known = () => getPlayers();
  const validId = (id) => isBotId(id) || known().some((p) => p.id === id);
  const cfg = {
    mode: MODES.some(([k]) => k === s.lastSetup.mode) ? s.lastSetup.mode : 'x01',
    cutThroat: !!s.lastSetup.cutThroat,
    startScore: s.lastSetup.startScore || 501,
    lives: s.lastSetup.lives || 3,
    setsBestOf: s.lastSetup.setsBestOf || 1,
    legsBestOf: s.lastSetup.legsBestOf || 3,
    selected: (s.lastSetup.players || []).filter(validId).slice(0, 6),
    starter: 'p0', // 'p0' … 'p5' | 'bull'
    camera: s.cameraEnabled,
    input: s.inputMode || 'total', // Handeingabe: 'dart' | 'board' | 'total' (Summe nur X01)
  };
  while (cfg.selected.length < 2) cfg.selected.push(null);
  const body = h('div', { class: 'stack', style: { maxWidth: '560px', margin: '0 auto' } });

  // Auswahlfeld mit Beschriftung; values = [[Wert, Text], …]
  const dropdown = (label, values, current, onPick) => h('label', { class: 'field' }, h('span', {}, label),
    h('select', { onchange: (e) => onPick(e.target.value) },
      values.map(([v, text]) => h('option', { value: String(v), selected: String(v) === String(current) }, text))));

  const maxPlayers = () => getMode(cfg.mode).maxPlayers || 2;
  const nameOf = (id, i) => (isBotId(id) ? botName(botLevel(id)) : known().find((p) => p.id === id)?.name) || `Spieler ${i + 1}`;

  const NEW = '__neu';
  const pickPlayer = async (slot, value) => {
    if (value === NEW) {
      const n = await promptDialog('Neuer Spieler', '', { ok: 'Anlegen', placeholder: 'Name' });
      if (n != null) {
        try { value = addPlayer(n).id; } catch (e) { toast(e.message); value = null; }
      } else value = null;
    }
    // Gleicher Spieler auf zwei Plätzen -> Plätze tauschen
    const other = cfg.selected.findIndex((id, i) => i !== slot && id && id === value);
    if (other >= 0) cfg.selected[other] = cfg.selected[slot] || null;
    cfg.selected[slot] = value || null;
    draw();
  };

  const draw = () => {
    body.replaceChildren();
    const players = known();
    const hasCal = !!lsGet('calibration', null);
    const max = maxPlayers();
    if (cfg.selected.length > max) cfg.selected = cfg.selected.slice(0, max);
    const sel = cfg.selected;
    const playerOptions = [['', '– wählen –'], ...players.map((p) => [p.id, p.name]),
      ...BOT_LEVELS.map((l) => [`bot:${l}`, `🤖 ${botName(l)}`]), [NEW, '+ Neuer Spieler …']];
    const ready = sel.length >= 2 && sel.every(Boolean) && new Set(sel).size === sel.length && sel.some((id) => !isBotId(id));
    const twoPlayers = sel.length === 2;
    if (cfg.starter === 'bull' && !(cfg.camera && twoPlayers)) cfg.starter = 'p0';
    if (parseInt(cfg.starter.slice(1), 10) >= sel.length) cfg.starter = 'p0';
    // Summe gibt es nur bei X01; die gespeicherte Vorliebe bleibt für das nächste X01-Spiel erhalten
    const input = cfg.input === 'total' && cfg.mode !== 'x01' ? 'dart' : cfg.input;
    const inputOptions = [['camera', 'Kamera'], ['dart', 'Pro Dart'], ['board', 'Scheibe'], ...(cfg.mode === 'x01' ? [['total', 'Summe']] : [])];

    const playerRows = sel.map((id, i) => h('div', { class: 'playerrow' },
      dropdown(`Spieler ${i + 1}`, playerOptions, id || '', (v) => pickPlayer(i, v)),
      sel.length > 2 ? h('button', { class: 'iconbtn', 'aria-label': 'Entfernen', onclick: () => { sel.splice(i, 1); draw(); } }, '✕') : null,
    ));
    const modeOption = {
      x01: () => dropdown('Startwert', [301, 501, 701].map((v) => [v, String(v)]), cfg.startScore, (v) => { cfg.startScore = +v; }),
      cricket: () => dropdown('Variante', [['0', 'Standard'], ['1', 'Cut Throat']], cfg.cutThroat ? '1' : '0', (v) => { cfg.cutThroat = v === '1'; draw(); }),
      halveit: () => null,
      killer: () => dropdown('Leben', [3, 5].map((v) => [v, String(v)]), cfg.lives, (v) => { cfg.lives = +v; }),
    }[cfg.mode]();

    body.append(
      h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Neues Spiel')),
      h('div', { class: 'card' },
        h('div', { class: 'chips', style: { margin: '0 0 4px' } },
          MODES.map(([k, label]) => h('button', { class: `chip ${cfg.mode === k ? 'on' : ''}`, onclick: () => { cfg.mode = k; draw(); } }, label))),
        h('div', { class: 'grid2 players-setup' }, playerRows),
        sel.length < max ? h('button', { class: 'btn ghost', style: { minHeight: '44px', fontSize: '16px', margin: '4px 0' }, onclick: () => { sel.push(null); draw(); } }, '+ Spieler') : null,
        h('div', { class: 'grid3' },
          modeOption,
          dropdown('Sets', [1, 3, 5, 7].map((v) => [v, v === 1 ? 'Keine' : `Best of ${v}`]), cfg.setsBestOf, (v) => { cfg.setsBestOf = +v; draw(); }),
          dropdown(cfg.setsBestOf > 1 ? 'Legs pro Set' : 'Legs', [1, 3, 5, 7, 9, 11].map((v) => [v, v === 1 ? '1 Leg' : `Best of ${v}`]), cfg.legsBestOf, (v) => { cfg.legsBestOf = +v; }),
        ),
        h('div', { class: 'grid2' },
          dropdown('Wer beginnt?', [...sel.map((id, i) => [`p${i}`, nameOf(id, i)]), ...(cfg.camera && twoPlayers ? [['bull', 'Ausbullen (Kamera)']] : [])], cfg.starter, (v) => { cfg.starter = v; }),
          dropdown('Eingabe', inputOptions, cfg.camera ? 'camera' : input, (v) => { cfg.camera = v === 'camera'; if (!cfg.camera) cfg.input = v; draw(); }),
        ),
        h('p', { class: 'dim', style: { margin: '4px 0 0', fontSize: '14px' } },
          cfg.mode === 'cricket' && cfg.cutThroat ? MODE_TEXT.cricketCut : MODE_TEXT[cfg.mode],
          ' Wer das Leg beginnt, wechselt nach jedem Leg.',
          sel.some(isBotId) ? ' Der Computer wirft von selbst; seine Darts werden angesagt.' : '',
          cfg.camera ? ' Korrekturen per Zahlenfeld; fällt die Kamera aus, kannst du im Menü auf Handeingabe wechseln.' : ' Die Eingabeart bleibt während des Spiels fest.',
          cfg.camera && !hasCal ? ' Noch keine Kalibrierung – sie kommt vor dem Spiel.' : ''),
      ),
      h('button', {
        class: 'btn primary', style: { minHeight: '64px', fontSize: '22px' },
        disabled: !ready,
        onclick: () => {
          unlock(); // iOS: Sprachausgabe durch diesen Tipp freischalten
          updateSettings({
            lastSetup: { mode: cfg.mode, cutThroat: cfg.cutThroat, startScore: cfg.startScore, lives: cfg.lives, setsBestOf: cfg.setsBestOf, legsBestOf: cfg.legsBestOf, players: sel.slice() },
            cameraEnabled: cfg.camera, inputMode: cfg.input,
          });
          const options = {
            x01: { startScore: cfg.startScore, doubleOut: true },
            cricket: { cutThroat: cfg.cutThroat },
            halveit: {},
            killer: { lives: cfg.lives },
          }[cfg.mode];
          const gameParams = {
            setup: {
              mode: cfg.mode,
              options,
              players: sel.slice(),
              playerNames: sel.map((id, i) => nameOf(id, i)),
              setsBestOf: cfg.setsBestOf,
              legsBestOf: cfg.legsBestOf,
              firstStarter: cfg.starter === 'bull' ? 0 : parseInt(cfg.starter.slice(1), 10),
              starterMethod: cfg.starter === 'bull' ? 'bull' : 'tap',
            },
            camera: cfg.camera,
            inputMode: input,
          };
          if (cfg.camera) nav.go('calibrate', { mode: 'quickcheck', then: 'game', thenParams: gameParams });
          else nav.go('game', gameParams);
        },
      }, ready ? 'Spiel starten' : 'Spieler wählen (mind. 1 Mensch)'),
    );
  };
  draw();
  root.appendChild(body);
}

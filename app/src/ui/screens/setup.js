import { h, toast, promptDialog } from '../dom.js';
import { getPlayers, addPlayer, getSettings, updateSettings } from '../../core/settings.js';
import { lsGet } from '../../core/storage.js';
import { unlock } from '../../audio/speech.js';

export function render(root, params, nav) {
  const s = getSettings();
  const cfg = {
    startScore: s.lastSetup.startScore || 501,
    setsBestOf: s.lastSetup.setsBestOf || 1,
    legsBestOf: s.lastSetup.legsBestOf || 3,
    selected: (s.lastSetup.players || []).filter((id) => getPlayers().some((p) => p.id === id)).slice(0, 2),
    starter: 'p0', // 'p0' | 'p1' | 'bull'
    camera: s.cameraEnabled,
  };
  const body = h('div', { class: 'stack', style: { maxWidth: '560px', margin: '0 auto' } });

  const chipGroup = (values, current, label, onPick) =>
    h('div', { class: 'chips' }, values.map((v) => h('button', { class: `chip ${v === current ? 'on' : ''}`, onclick: () => onPick(v) }, label(v))));

  const draw = () => {
    body.replaceChildren();
    const players = getPlayers();
    const hasCal = !!lsGet('calibration', null);
    body.append(
      h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Neues Spiel')),
      h('div', { class: 'card' },
        h('h3', {}, 'Zwei Spieler wählen'),
        players.length ? null : h('p', { class: 'dim' }, 'Lege zuerst Spieler an.'),
        h('div', { class: 'chips' },
          players.map((p) => {
            const idx = cfg.selected.indexOf(p.id);
            return h('button', {
              class: `chip ${idx >= 0 ? 'on' : ''}`,
              onclick: () => {
                if (idx >= 0) cfg.selected.splice(idx, 1);
                else { if (cfg.selected.length >= 2) cfg.selected.shift(); cfg.selected.push(p.id); }
                draw();
              },
            }, idx >= 0 ? h('span', { class: 'badge' }, idx + 1) : null, p.name);
          }),
          h('button', {
            class: 'chip',
            onclick: async () => {
              const n = await promptDialog('Neuer Spieler', '', { ok: 'Anlegen', placeholder: 'Name' });
              if (n == null) return;
              try { const p = addPlayer(n); if (cfg.selected.length < 2) cfg.selected.push(p.id); draw(); } catch (e) { toast(e.message); }
            },
          }, '+ Neu'),
        ),
      ),
      h('div', { class: 'card' },
        h('h3', {}, 'Startwert'),
        chipGroup([301, 501, 701], cfg.startScore, (v) => String(v), (v) => { cfg.startScore = v; draw(); }),
        h('h3', { style: { marginTop: '14px' } }, 'Sets'),
        chipGroup([1, 3, 5, 7], cfg.setsBestOf, (v) => (v === 1 ? 'Keine' : `Best of ${v}`), (v) => { cfg.setsBestOf = v; draw(); }),
        h('h3', { style: { marginTop: '14px' } }, cfg.setsBestOf > 1 ? 'Legs pro Set' : 'Legs'),
        chipGroup([1, 3, 5, 7, 9, 11], cfg.legsBestOf, (v) => (v === 1 ? '1 Leg' : `Best of ${v}`), (v) => { cfg.legsBestOf = v; draw(); }),
        h('p', { class: 'dim', style: { margin: '10px 0 0' } }, 'Double-Out. Wer das Leg beginnt, wechselt nach jedem Leg.'),
      ),
      h('div', { class: 'card' },
        h('h3', {}, 'Kamera'),
        chipGroup([true, false], cfg.camera, (v) => (v ? 'Kamera-Erkennung' : 'Nur Handeingabe'), (v) => { cfg.camera = v; if (!v && cfg.starter === 'bull') cfg.starter = 'p0'; draw(); }),
        cfg.camera && !hasCal ? h('p', { class: 'dim', style: { margin: '10px 0 0' } }, 'Noch keine Kalibrierung gespeichert – sie wird vor dem Spiel durchgeführt.') : null,
      ),
      h('div', { class: 'card' },
        h('h3', {}, 'Wer beginnt?'),
        h('div', { class: 'chips' },
          ['p0', 'p1'].map((k, i) => {
            const id = cfg.selected[i];
            const name = id ? players.find((p) => p.id === id)?.name : `Spieler ${i + 1}`;
            return h('button', { class: `chip ${cfg.starter === k ? 'on' : ''}`, onclick: () => { cfg.starter = k; draw(); } }, name);
          }),
          cfg.camera ? h('button', { class: `chip ${cfg.starter === 'bull' ? 'on' : ''}`, onclick: () => { cfg.starter = 'bull'; draw(); } }, 'Ausbullen (Kamera)') : null,
        ),
      ),
      h('button', {
        class: 'btn primary', style: { minHeight: '64px', fontSize: '22px' },
        disabled: cfg.selected.length !== 2,
        onclick: () => {
          unlock(); // iOS: Sprachausgabe durch diesen Tipp freischalten
          updateSettings({ lastSetup: { startScore: cfg.startScore, setsBestOf: cfg.setsBestOf, legsBestOf: cfg.legsBestOf, players: cfg.selected.slice() }, cameraEnabled: cfg.camera });
          const ps = getPlayers();
          const gameParams = {
            setup: {
              options: { startScore: cfg.startScore, doubleOut: true },
              players: cfg.selected.slice(),
              playerNames: cfg.selected.map((id) => ps.find((p) => p.id === id).name),
              setsBestOf: cfg.setsBestOf,
              legsBestOf: cfg.legsBestOf,
              firstStarter: cfg.starter === 'p1' ? 1 : 0,
              starterMethod: cfg.starter === 'bull' ? 'bull' : 'tap',
            },
            camera: cfg.camera,
          };
          if (cfg.camera) nav.go('calibrate', { mode: 'quickcheck', then: 'game', thenParams: gameParams });
          else nav.go('game', gameParams);
        },
      }, cfg.selected.length === 2 ? 'Spiel starten' : 'Zwei Spieler wählen'),
    );
  };
  draw();
  root.appendChild(body);
}

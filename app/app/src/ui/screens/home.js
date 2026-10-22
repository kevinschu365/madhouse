import { h, confirmDialog } from '../dom.js';
import { BRAND, APP_VERSION } from '../../config.js';
import { lsGet, lsSet } from '../../core/storage.js';
import { derive } from '../../game/match.js';
import { GameSession } from '../../game/session.js';

export function render(root, params, nav) {
  const active = lsGet('activeMatch', null);
  let resume = null;
  if (active && active.status === 'running') {
    let info = '';
    try {
      const st = derive(active);
      info = `${active.playerNames[0]} ${st.scores[0]} : ${st.scores[1]} ${active.playerNames[1]}`;
    } catch { info = 'Spiel unterbrochen'; }
    resume = h('div', { class: 'card resume stack' },
      h('div', { class: 'dim' }, 'Laufendes Spiel'),
      h('div', { style: { fontSize: '20px', fontWeight: 700 } }, info),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => nav.go('game', { match: active }) }, 'Weiterspielen'),
        h('button', {
          class: 'btn ghost',
          onclick: async () => {
            if (await confirmDialog('Spiel abbrechen?', 'Das Spiel wird als abgebrochen gespeichert und taucht nicht in der Match-Statistik auf.', { ok: 'Abbrechen', cancel: 'Zurück', danger: true })) {
              await new GameSession(active).abort();
              lsSet('activeMatch', null);
              nav.go('home');
            }
          },
        }, 'Beenden'),
      ),
    );
  }
  root.appendChild(h('div', { class: 'home' },
    h('div', { class: 'hero' }, h('span', { class: 'logo', html: BRAND.logoSvg }), h('h1', {}, BRAND.name)),
    resume,
    h('button', { class: 'btn primary', style: { minHeight: '64px', fontSize: '22px' }, onclick: () => nav.go('setup') }, 'Neues Spiel'),
    h('button', { class: 'btn', onclick: () => nav.go('players') }, 'Spieler'),
    h('button', { class: 'btn', onclick: () => nav.go('stats') }, 'Statistik'),
    h('button', { class: 'btn', onclick: () => nav.go('calibrate', { back: 'home' }) }, 'Kamera kalibrieren'),
    h('button', { class: 'btn', onclick: () => nav.go('settings') }, 'Einstellungen'),
    h('p', { class: 'dim', style: { textAlign: 'center', fontSize: '13px', marginTop: '20px' } }, `${BRAND.name} ${APP_VERSION} · Daten bleiben auf diesem Gerät`),
  ));
}

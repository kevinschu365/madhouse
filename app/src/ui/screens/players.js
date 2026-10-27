import { h, toast, promptDialog, confirmDialog } from '../dom.js';
import { getPlayers, addPlayer, renamePlayer, removePlayer } from '../../core/settings.js';

export function render(root, params, nav) {
  const list = h('div');
  const draw = () => {
    list.replaceChildren();
    const players = getPlayers();
    if (!players.length) list.appendChild(h('p', { class: 'dim' }, 'Noch keine Spieler angelegt.'));
    for (const p of players) {
      list.appendChild(h('div', { class: 'list-item' },
        h('span', { class: 'name' }, p.name, h('span', { class: 'dim', style: { fontSize: '13px', marginLeft: '8px' } }, `#${p.code}`)),
        h('button', {
          class: 'iconbtn', 'aria-label': 'Umbenennen',
          onclick: async () => {
            const n = await promptDialog('Spieler umbenennen', p.name);
            if (n == null) return;
            try { renamePlayer(p.id, n); draw(); } catch (e) { toast(e.message); }
          },
        }, '✎'),
        h('button', {
          class: 'iconbtn', 'aria-label': 'Löschen',
          onclick: async () => {
            if (await confirmDialog(`${p.name} entfernen?`, 'Die Statistik bleibt erhalten.', { ok: 'Entfernen', danger: true })) { removePlayer(p.id); draw(); }
          },
        }, '🗑'),
      ));
    }
  };
  const add = async () => {
    const n = await promptDialog('Neuer Spieler', '', { ok: 'Anlegen', placeholder: 'Name' });
    if (n == null) return;
    try { addPlayer(n); draw(); } catch (e) { toast(e.message); }
  };
  root.appendChild(h('div', { style: { maxWidth: '560px', margin: '0 auto' } },
    h('div', { class: 'topbar' },
      h('button', { class: 'iconbtn', onclick: () => nav.go(params.back || 'home', params.backParams || {}) }, '‹'),
      h('h1', {}, 'Spieler')),
    list,
    h('div', { style: { height: '14px' } }),
    h('button', { class: 'btn primary', onclick: add }, '+ Spieler anlegen'),
  ));
  draw();
}

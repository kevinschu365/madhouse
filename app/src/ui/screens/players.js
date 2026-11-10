import { h, toast, promptDialog, confirmDialog } from '../dom.js';
import { getPlayers, addPlayer, renamePlayer, removePlayer, setPlayerNick } from '../../core/settings.js';
import { loadStatsData } from '../statsData.js';
import { milestones } from '../../stats/stats.js';
import { standFrom, whenText } from '../../audio/quipPacks.js';
import { NICK_WHEN, nickUnlocked, cleanNick } from '../../audio/intro.js';

/**
 * Kampfname eingeben (für den Einlauf beim Spielstart). Leer speichern = entfernen.
 * Rückgabe: true, wenn etwas geändert wurde. Auch von der Meilenstein-Seite benutzt.
 */
export async function editNick(player) {
  const n = await promptDialog(`Kampfname für ${player.name}`, player.nick || '', { placeholder: 'z. B. The Hammer (leer = keiner)' });
  if (n == null) return false;
  const clean = setPlayerNick(player.id, n);
  toast(clean ? `🥊 ${player.name}, „${clean}“` : 'Kampfname entfernt');
  return true;
}

export function render(root, params, nav) {
  const list = h('div');
  // Rang je Spieler (für den Kampfnamen): wird nachgeladen, bis dahin steht dort „…“
  let stands = null;
  const draw = () => {
    list.replaceChildren();
    const players = getPlayers();
    if (!players.length) list.appendChild(h('p', { class: 'dim' }, 'Noch keine Spieler angelegt.'));
    for (const p of players) {
      const open = stands ? nickUnlocked(stands[p.id]) : null;
      const nick = cleanNick(p.nick);
      list.appendChild(h('div', { class: 'list-item' },
        h('span', { class: 'name' }, p.name, h('span', { class: 'dim', style: { fontSize: '13px', marginLeft: '8px' } }, `#${p.code}`),
          // Kampfname: erst ab einem bestimmten Rang – davor ein Schloss mit der Bedingung
          open == null ? h('div', { class: 'dim', style: { fontSize: '13px' } }, '…')
            : open ? h('button', {
              class: 'chip', style: { display: 'block', marginTop: '4px' },
              onclick: async () => { if (await editNick(p)) draw(); },
            }, nick ? `🥊 „${nick}“ ✎` : '🥊 Kampfname wählen')
              : h('div', { class: 'dim', style: { fontSize: '13px' } }, `🔒 Kampfname ${whenText(NICK_WHEN)}`)),
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
    h('p', { class: 'dim small' }, '🥊 Der Kampfname wird nur im Einlauf beim Spielstart angesagt (Einstellungen › Ansagen & Töne › Einlauf: Voll).'),
    h('div', { style: { height: '14px' } }),
    h('button', { class: 'btn primary', onclick: add }, '+ Spieler anlegen'),
  ));
  draw();
  loadStatsData().then(({ usable, realMatches }) => {
    const all = {};
    for (const p of getPlayers()) all[p.id] = standFrom(milestones(usable, realMatches, p.id));
    stands = all; // später angelegte Spieler fehlen hier: noch kein Rang, also gesperrt
    draw();
  }).catch(() => { stands = {}; draw(); });
}

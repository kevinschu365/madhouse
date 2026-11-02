// Bedienung für den Abgleich zwischen Handys (siehe core/sync.js).
// Beim Senden und beim Einlesen lässt sich auswählen, wessen Spiele mitkommen
// (z. B. aus der Turnier-Datei nur die eigenen und die von Nils, nicht Peter gegen Hans).
import { h, toast, confirmDialog, sheet } from './dom.js';
import { offerFile } from '../core/storage.js';
import { ownerId } from '../core/settings.js';
import { exportSync, importSync, syncFileName, filterSyncData, syncPlayers } from '../core/sync.js';

/**
 * Auswahl der Spieler. list: [{ id, name, count }], preselected: Kennungen.
 * Ergebnis: gewählte Kennungen oder null (abgebrochen).
 */
export function pickPlayers(title, note, list, preselected, data, okLabel) {
  return new Promise((resolve) => {
    const chosen = new Set(preselected.filter((id) => list.some((p) => p.id === id)));
    let s;
    const done = (v) => { resolve(v); s.close(); };
    const box = h('div', { class: 'stack' });
    const draw = () => {
      const n = filterSyncData(data, [...chosen]).matches.length;
      box.replaceChildren(
        h('h2', {}, title),
        h('p', { class: 'dim', style: { margin: '-6px 0 0', fontSize: '14px' } }, note),
        h('div', { class: 'chips pickchips' }, list.map((p) => h('button', {
          class: `chip ${chosen.has(p.id) ? 'on' : ''}`,
          onclick: () => { if (chosen.has(p.id)) chosen.delete(p.id); else chosen.add(p.id); draw(); },
        }, p.name, h('span', { class: 'dim small' }, ` ${p.count}`)))),
        h('div', { class: 'grid2' },
          h('button', { class: 'btn ghost', onclick: () => { list.forEach((p) => chosen.add(p.id)); draw(); } }, 'Alle'),
          h('button', { class: 'btn ghost', onclick: () => { chosen.clear(); draw(); } }, 'Keinen')),
        h('button', { class: 'btn primary', disabled: !n, onclick: () => done([...chosen]) }, `${okLabel} (${n} Spiele)`),
        h('button', { class: 'btn ghost', onclick: () => done(null) }, 'Abbrechen'),
      );
    };
    draw();
    s = sheet(box, { onClose: () => resolve(null) });
  });
}

/** Abgleich-Datei erstellen (Spieler wählbar) und über das Teilen-Menü schicken (AirDrop, WhatsApp …). */
export async function offerSync(source = null) {
  try {
    const data = source || await exportSync();
    const list = syncPlayers(data);
    if (!list.length) { toast('Noch keine Spiele zum Senden.'); return; }
    const me = ownerId();
    const ids = list.length === 1 ? [list[0].id] : await pickPlayers('Wessen Spiele senden?',
      'Mit kommen alle Spiele, an denen mindestens einer der gewählten Spieler beteiligt war.',
      list, me && list.some((p) => p.id === me) ? [me] : list.map((p) => p.id), data, 'Datei erstellen');
    if (!ids) return;
    const part = filterSyncData(data, ids);
    const r = await offerFile(syncFileName(), JSON.stringify(part));
    if (r !== 'aborted') toast(`${part.matches.length} Spiele bereit zum Senden`);
  } catch (e) { toast(`Abgleich fehlgeschlagen: ${e.message}`); }
}

/** Abgleich-Daten übernehmen: Spieler wählen (bei mehreren), dann zusammenführen. Auch für Online-Turniere. */
export async function importSyncData(data, onDone = null) {
  const list = syncPlayers(data);
  if (!list.length) { toast('Keine Spiele von echten Spielern zum Übernehmen (Gäste bekommen keine Statistik).'); return; }
  if (list.length > 1) {
    const ids = await pickPlayers('Wessen Spiele übernehmen?',
      'Nur Spiele, an denen mindestens einer der gewählten Spieler beteiligt war. Der Rest wird nicht übernommen.',
      list, list.map((p) => p.id), data, 'Übernehmen');
    if (!ids) return;
    data = filterSyncData(data, ids);
  } else if (!(await confirmDialog('Spiele zusammenführen?', 'Die Spiele kommen zu deinen dazu. Deine eigenen Spiele bleiben erhalten. Spieler werden über ihre Nummer zugeordnet (beim ersten Mal über den Namen).', { ok: 'Zusammenführen' }))) return;
  const r = await importSync(data);
  toast(`${r.added} neu, ${r.updated} aktualisiert${r.newPlayers.length ? ` · neue Spieler: ${r.newPlayers.join(', ')}` : ''}`);
  if (onDone) onDone(r);
}

/** Unsichtbares Dateifeld + Knopf zum Einlesen einer Abgleich-Datei (Spieler wählbar). onDone() nach Erfolg. */
export function syncImportButton(label = '📥 Abgleich-Datei einlesen', onDone = null) {
  const input = h('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        await importSyncData(JSON.parse(await file.text()), onDone);
      } catch (err) { toast(`Einlesen fehlgeschlagen: ${err.message}`); }
    },
  });
  return h('div', { class: 'stack' }, input, h('button', { class: 'btn', onclick: () => input.click() }, label));
}

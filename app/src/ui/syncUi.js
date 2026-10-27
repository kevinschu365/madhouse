// Bedienung für den Abgleich zwischen zwei Handys (siehe core/sync.js).
import { h, toast, confirmDialog } from './dom.js';
import { offerFile } from '../core/storage.js';
import { exportSync, importSync, syncFileName } from '../core/sync.js';

/** Abgleich-Datei erstellen und über das Teilen-Menü schicken (AirDrop, WhatsApp …). */
export async function offerSync() {
  try {
    const data = await exportSync();
    const r = await offerFile(syncFileName(), JSON.stringify(data));
    if (r !== 'aborted') toast(`${data.matches.length} Spiele bereit zum Senden`);
  } catch (e) { toast(`Abgleich fehlgeschlagen: ${e.message}`); }
}

/** Unsichtbares Dateifeld + Knopf zum Einlesen einer Abgleich-Datei. onDone() nach Erfolg. */
export function syncImportButton(label = '📥 Abgleich-Datei einlesen', onDone = null) {
  const input = h('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!(await confirmDialog('Spiele zusammenführen?', 'Spiele vom anderen Handy kommen dazu. Deine eigenen Spiele bleiben erhalten. Spieler werden über ihre Nummer zugeordnet (beim ersten Mal über den Namen).', { ok: 'Zusammenführen' }))) return;
        const r = await importSync(data);
        toast(`${r.added} neu, ${r.updated} aktualisiert${r.newPlayers.length ? ` · neue Spieler: ${r.newPlayers.join(', ')}` : ''}`);
        if (onDone) onDone(r);
      } catch (err) { toast(`Einlesen fehlgeschlagen: ${err.message}`); }
    },
  });
  return h('div', { class: 'stack' }, input, h('button', { class: 'btn', onclick: () => input.click() }, label));
}

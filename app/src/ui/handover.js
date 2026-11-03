// Turnierleitung an einen anderen PC übergeben (Online-Turnier): Die komplette Adresse samt Code steckt im QR-Code
// („…/app/?leitung=CODE“). Hat der PC keinen QR-Leser, steht die Adresse groß darüber zum Abtippen – dort dann
// „🖥️ Turnierleitung übernehmen“ und den Code eingeben. Das neue Gerät führt danach; dieses zeigt nur noch an.
import { h, sheet, toast } from './dom.js';
import { qrSvg } from './qr.js';
import { showCode } from '../core/cloud.js';

/** Adresse dieser App ohne „https://“ und ohne Zusätze, z. B. „name.github.io/madhouse/app/“. */
export const appAddress = () => `${location.host}${location.pathname}`;

/** Vollständige Übernahme-Adresse für den QR-Code. */
export const takeoverUrl = (code) => `${location.origin}${location.pathname}?leitung=${code}`;

export function handoverSheet(code) {
  const url = takeoverUrl(code);
  const s = sheet(h('div', { class: 'stack handover' },
    h('h2', {}, '🖥️ Turnierleitung an PC übergeben'),
    h('div', { class: 'small dim' }, 'Am PC im Browser diese Adresse öffnen:'),
    h('div', { class: 'hoaddr num' }, appAddress()),
    h('div', { class: 'small dim' }, 'Dort „🖥️ Turnierleitung übernehmen“ tippen und diesen Code eingeben:'),
    h('div', { class: 'hocode num' }, showCode(code)),
    h('div', { class: 'small dim' }, 'Oder schneller: Hat der PC einen QR-Leser (z. B. Kamera-App), diesen Code scannen – er enthält Adresse und Code und öffnet direkt die Turnierleitung.'),
    h('div', { class: 'qrimg hoqr', html: qrSvg(url, 240) }),
    h('div', { class: 'small dim' }, 'Danach führt der PC das Turnier (Aufrufe, Ansagen, Fernseher). Dieses Gerät zeigt nur noch an – mit „Leitung zurückholen“ geht es jederzeit zurück.'),
    h('button', {
      class: 'btn',
      onclick: async () => {
        try { await navigator.clipboard.writeText(url); toast('Adresse kopiert'); } catch { toast(url, 6000); }
      },
    }, '📋 Adresse kopieren (z. B. für Nachricht an den PC)'),
    h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Schließen')));
  return s;
}

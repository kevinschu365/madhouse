import { h, toast, confirmDialog } from '../dom.js';
import { getSettings, updateSettings, reloadSettings } from '../../core/settings.js';
import { availableVoices, unlock, speechSupported, announceTurn, say, t, voiceLangOf, SPEECH_LANGS } from '../../audio/speech.js';
import { exportAll, importAll, wipeAll, offerFile, dbGetAll } from '../../core/storage.js';
import { wakeLockSupported } from '../../core/wakelock.js';
import { BRAND } from '../../config.js';
import { listCameras } from '../../vision/camera.js';

export function render(root, params, nav) {
  const body = h('div', { class: 'stack', style: { maxWidth: '560px', margin: '0 auto' } });
  root.appendChild(body);

  const toggle = (key, label, note) => {
    const s = getSettings();
    return h('div', { class: 'list-item' },
      h('span', { class: 'name' }, label, note ? h('div', { class: 'dim', style: { fontSize: '13px' } }, note) : null),
      h('button', { class: `chip ${s[key] ? 'on' : ''}`, onclick: () => { updateSettings({ [key]: !s[key] }); draw(); } }, s[key] ? 'An' : 'Aus'));
  };

  const draw = async () => {
    const s = getSettings();
    const voices = availableVoices(voiceLangOf(s.speechLang));
    const imgCount = (await dbGetAll('images').catch(() => [])).length;
    body.replaceChildren(
      h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: () => nav.go('home') }, '‹'), h('h1', {}, 'Einstellungen')),

      h('div', { class: 'card' },
        h('h3', {}, 'Ansage'),
        h('label', { class: 'field' }, h('span', {}, 'Sprache / Dialekt der Ansage'),
          h('select', {
            onchange: (e) => {
              const l = e.target.value;
              // Gewählte Stimme nur zurücksetzen, wenn die Stimmen-Sprache wechselt (Deutsch <-> Englisch)
              const keepVoice = voiceLangOf(l) === voiceLangOf(s.speechLang);
              updateSettings({ speechLang: l, ...(keepVoice ? {} : { voiceURI: null }) });
              unlock();
              window.speechSynthesis && window.speechSynthesis.cancel();
              say(t().test);
              draw();
            },
          }, SPEECH_LANGS.map(([k, label]) => h('option', { value: k, selected: k === s.speechLang }, label)))),
        toggle('quips', 'Witzige Sprüche', 'z. B. bei 180, Überwerfen, 0 Punkten und Game shot'),
        toggle('announceDart', 'Jeden Dart ansagen', '„Triple 20“'),
        toggle('announceTurn', 'Summe der Aufnahme ansagen', '„180“'),
        toggle('announceRest', 'Rest ansagen', '„Rest 141“'),
        h('label', { class: 'field' }, h('span', {}, `Stimme (${voices.length} auf diesem Gerät gefunden)`),
          (() => {
            const sel = h('select', { onchange: (e) => updateSettings({ voiceURI: e.target.value || null }) },
              h('option', { value: '' }, 'Automatisch'),
              voices.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === s.voiceURI }, `${v.name} (${v.lang})`)));
            return sel;
          })()),
        h('label', { class: 'field' }, h('span', {}, `Sprechtempo: ${s.speechRate.toFixed(1)}`),
          h('input', { type: 'range', min: '0.6', max: '1.5', step: '0.1', value: String(s.speechRate), onchange: (e) => { updateSettings({ speechRate: parseFloat(e.target.value) }); draw(); } })),
        h('label', { class: 'field' }, h('span', {}, `Pause zwischen Summe und Rest: ${(s.restPause ?? 1).toFixed(1)} s`),
          h('input', { type: 'range', min: '0', max: '2.5', step: '0.1', value: String(s.restPause ?? 1), onchange: (e) => { updateSettings({ restPause: parseFloat(e.target.value) }); draw(); } })),
        h('button', {
          class: 'btn',
          onclick: () => {
            unlock();
            window.speechSynthesis && window.speechSynthesis.cancel();
            announceTurn({ points: 180, bust: false, finished: false, remaining: 321 });
          },
        }, 'Ansage testen („180“ … „Rest 321“)'),
        !speechSupported() ? h('p', { class: 'dim' }, 'Dieser Browser bietet keine Sprachausgabe an.') :
          voices.length === 0 ? h('p', { class: 'dim' }, 'Keine passende Stimme gefunden. Auf dem iPhone: Einstellungen › Bedienungshilfen › Gesprochene Inhalte › Stimmen – dort eine Stimme laden (z. B. „Anna (Erweitert)“).') : null,
        toggle('beeps', 'Warntöne', 'z. B. wenn die Kamera das Board verliert'),
      ),

      h('div', { class: 'card' },
        h('h3', {}, 'Kamera'),
        toggle('autoAdvance', 'Automatisch weiter, wenn Board leer'),
        toggle('cameraDebug', 'Kamera-Diagnose anzeigen', 'Zeile unter dem Kamerabild: Bilder/s, Analysen/s, Bewegung – hilft bei der Fehlersuche'),
        toggle('saveCorrectionImages', 'Bild bei Korrektur speichern', `Für späteres Testmaterial. Gespeichert: ${imgCount}`),
        h('div', { class: 'list-item' }, h('span', { class: 'name' }, 'Leistung', h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Automatisch passt die Bildrate an das Gerät an')),
          h('div', { class: 'chips' }, [['auto', 'Auto'], ['low', 'Sparsam'], ['high', 'Hoch']].map(([k, l]) =>
            h('button', { class: `chip ${s.performance === k ? 'on' : ''}`, onclick: () => { updateSettings({ performance: k }); draw(); } }, l)))),
        h('label', { class: 'field' }, h('span', {}, 'Kamera (nach Wechsel neu kalibrieren)'),
          (() => {
            const sel = h('select', {
              onchange: (e) => { updateSettings({ cameraDeviceId: e.target.value || null }); toast('Kamera geändert – bitte neu kalibrieren.'); },
            }, h('option', { value: '' }, 'Standard-Rückkamera'));
            listCameras().then((cams) => {
              for (const c of cams) sel.appendChild(h('option', { value: c.id, selected: c.id === s.cameraDeviceId }, c.label));
              if (!cams.some((c) => c.label && !/^Kamera \d/.test(c.label))) sel.appendChild(h('option', { disabled: true }, '(Namen erscheinen nach der ersten Kamera-Erlaubnis)'));
            }).catch(() => {});
            return sel;
          })()),
        h('button', { class: 'btn', onclick: () => nav.go('calibrate', { mode: 'full', back: 'settings' }) }, 'Neu kalibrieren'),
      ),

      h('div', { class: 'card stack' },
        h('h3', {}, 'Daten (nur auf diesem Gerät)'),
        h('button', { class: 'btn', onclick: () => doExport(false) }, 'Sicherung exportieren'),
        imgCount ? h('button', { class: 'btn', onclick: () => doExport(true) }, `Sicherung inkl. ${imgCount} Korrekturbilder`) : null,
        h('label', { class: 'btn', style: { position: 'relative' } }, 'Sicherung importieren',
          h('input', { type: 'file', accept: '.json,application/json', style: { position: 'absolute', inset: 0, opacity: 0 }, onchange: doImport })),
        h('button', {
          class: 'btn danger',
          onclick: async () => {
            if (await confirmDialog('Alle Daten löschen?', 'Spieler, Matches, Statistik, Kalibrierung und Einstellungen werden gelöscht. Vorher eine Sicherung exportieren!', { ok: 'Alles löschen', danger: true })) {
              await wipeAll(); reloadSettings(); toast('Alle Daten gelöscht'); draw();
            }
          },
        }, 'Alle Daten löschen'),
      ),

      h('div', { class: 'card' },
        h('h3', {}, 'Geräte-Check'),
        ...deviceChecks().map(([k, v]) => h('div', { class: 'list-item' }, h('span', { class: 'name', style: { fontSize: '15px' } }, k), h('span', { class: 'dim', style: { fontSize: '14px', textAlign: 'right' } }, v))),
      ),
    );
  };

  async function doExport(includeImages) {
    try {
      const data = await exportAll({ includeImages });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const r = await offerFile(`${BRAND.name.toLowerCase()}-sicherung-${stamp}.json`, JSON.stringify(data));
      if (r !== 'aborted') toast('Sicherung erstellt');
    } catch (e) { toast(`Export fehlgeschlagen: ${e.message}`); }
  }

  async function doImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!(await confirmDialog('Sicherung importieren?', 'Vorhandene Matches und Statistiken werden durch die Sicherung ersetzt.', { ok: 'Importieren' }))) return;
      await importAll(data, { replace: true });
      reloadSettings();
      toast('Sicherung importiert');
      draw();
    } catch (err) { toast(`Import fehlgeschlagen: ${err.message}`); }
  }

  draw();
  if (speechSupported()) setTimeout(draw, 800); // Stimmen werden auf iOS verzögert geladen
}

function deviceChecks() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return [
    ['Als Home-Bildschirm-App gestartet', standalone ? 'ja' : 'nein (im Browser)'],
    ['Sichere Verbindung (HTTPS)', window.isSecureContext ? 'ja' : 'NEIN – Kamera geht nicht'],
    ['Kamera-Schnittstelle', navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? 'vorhanden' : 'fehlt'],
    ['Sprachausgabe', speechSupported() ? `vorhanden (${availableVoices('de').length} dt. / ${availableVoices('en').length} engl. Stimmen)` : 'fehlt'],
    ['Bildschirm anlassen (Wake Lock)', wakeLockSupported() ? 'vorhanden' : 'fehlt – Auto-Sperre in iOS-Einstellungen auf „Nie“ stellen'],
    ['Prozessorkerne (Schätzung)', String(navigator.hardwareConcurrency || '?')],
  ];
}

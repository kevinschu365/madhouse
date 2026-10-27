// „Was ist neu?“ – kurze Checkliste je Version, neueste zuerst.
// Bei jedem Update hier einen Eintrag ergänzen (gleiche Nummer wie APP_VERSION in config.js).
// Nach einem Update zeigt die Startseite die neuen Punkte einmal an; danach unter Einstellungen › Was ist neu?

import { h, sheet } from './ui/dom.js';
import { APP_VERSION } from './config.js';
import { lsGet, lsSet } from './core/storage.js';

export const CHANGELOG = [
  {
    version: '1.7.2',
    date: '27.10.2026',
    items: [
      'Statistik: Spieler per Auswahlliste statt Knopfreihe',
      'Eigene Bestwerte: unter dem Wert steht jetzt „vs. Gegner“, damit klar ist, wessen Treppchen es ist',
      'Schnelltasten-Meilensteine je Zahl unterteilt: Zahl antippen, dann nur deren Stufen sehen',
      'Checkliste „Was ist neu?“ lässt sich sicher schließen (✕ oben, Knopf oben und unten, Tipp daneben)',
    ],
  },
  {
    version: '1.7.1',
    date: '27.10.2026',
    items: [
      'Schnelltasten-Meilensteine (26, 41, 45, 60, 85, 100, 140, 180) gehen jetzt bis 10.000 Mal',
      '20 statt 10 Ränge auf dem Zeitstrahl – vom Darts-Neuling bis zum Darts-Master',
      'Bestenliste über alle Spieler: Treppchen mit Gold, Silber, Bronze für jeden Bestwert',
      'Spielende: „🥇 Bester Average aller Spieler“, wenn jemand die Bestenliste knackt',
      'Diese Checkliste „Was ist neu?“ nach jedem Update (auch unter Einstellungen)',
    ],
  },
  {
    version: '1.7.0',
    date: '27.10.2026',
    items: [
      'NO SCORE fragt jetzt „Wie viele Darts aufs Doppel?“, wenn ein Finish möglich war',
      'Rest-Ansage vor dem Wurf: Name ist abschaltbar („Rest 80“ statt „Kevin, Rest 80“)',
      'Sticheleien bei Formtief: ab 3 Aufnahmen in Folge unter 40 ein frecher Spruch (abschaltbar)',
      'Bei 26: „Twenty fucking six!“ (abschaltbar)',
      'Persönliches Treppchen: Gold, Silber, Bronze für jeden Bestwert',
      'Spielende: „🥈 Zweitbester Average ever“, neue Meilensteine, neuer Rang',
      'Meilensteine stark erweitert, in 8 Kategorien zum Aufklappen',
      'Ränge mit Abzeichen und Zeitstrahl',
    ],
  },
];

/** Liste der Änderungen als Checkliste (alle Versionen oder nur die übergebenen). */
export function changelogView(entries = CHANGELOG) {
  return h('div', { class: 'stack changelog' }, entries.map((e) => h('div', {},
    h('h3', { style: { margin: '6px 0 6px' } }, `Version ${e.version}`, h('span', { class: 'dim', style: { fontSize: '13px', fontWeight: 400 } }, ` · ${e.date}`)),
    h('ul', {}, e.items.map((t) => h('li', {}, t))),
  )));
}

/** Nach einem Update einmal anzeigen, was seit der zuletzt gesehenen Version dazugekommen ist. */
export function showWhatsNewOnce() {
  const seen = lsGet('seenVersion', null);
  if (seen === APP_VERSION) return;
  lsSet('seenVersion', APP_VERSION);
  // Erste Installation (noch keine Spieler): keine Liste. Update von einer Version vor 1.7.0
  // (damals gab es seenVersion noch nicht): alle Einträge zeigen.
  if (!seen && !lsGet('players', []).length) return;
  const idx = seen ? CHANGELOG.findIndex((e) => e.version === seen) : CHANGELOG.length;
  const fresh = idx < 0 ? CHANGELOG.slice(0, 1) : CHANGELOG.slice(0, idx);
  if (!fresh.length) return;
  openList('🎉 Neu in dieser Version', fresh, 'Alles klar');
}

/** Alle Versionen anzeigen (Einstellungen › Was ist neu?). */
export function showChangelog() {
  openList('Was ist neu?', CHANGELOG, 'Schließen');
}

/**
 * Checkliste als Fenster. Schließen geht immer: ✕ oben (bleibt beim Scrollen stehen),
 * Knopf oben und unten, Tipp neben das Fenster.
 */
function openList(title, entries, okLabel) {
  let s;
  const close = () => s.close();
  s = sheet(h('div', { class: 'stack' },
    h('div', { class: 'sheethead' }, h('h2', {}, title), h('button', { class: 'iconbtn', 'aria-label': 'Schließen', onclick: close }, '✕')),
    h('button', { class: 'btn primary', onclick: close }, okLabel),
    changelogView(entries),
    h('button', { class: 'btn', onclick: close }, okLabel),
  ));
}

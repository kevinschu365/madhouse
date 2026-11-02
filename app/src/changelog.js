// „Was ist neu?“ – kurze Checkliste je Version, neueste zuerst.
// Bei jedem Update hier einen Eintrag ergänzen (gleiche Nummer wie APP_VERSION in config.js).
// Nach einem Update zeigt die Startseite die neuen Punkte einmal an; danach unter Einstellungen › Was ist neu?

import { h, sheet } from './ui/dom.js';
import { APP_VERSION } from './config.js';
import { lsGet, lsSet } from './core/storage.js';

export const CHANGELOG = [
  {
    version: '1.15.0',
    date: '02.11.2026',
    items: [
      'Behoben: Laptop zeigte „kein Handy“, obwohl ein Handy verbunden war (die Uhren von PC und Handy liefen auseinander) – jetzt zählt nur die Uhr des Laptops',
      'Board-Handy lässt den Bildschirm an, auch beim Warten aufs nächste Spiel (sonst meldet sich ein gesperrtes iPhone nicht mehr)',
      'Beitreten per QR-Code direkt in der App: Turnier › „📷 Beitreten: QR scannen“ – der QR-Leser ist selbst gebaut, ohne Fremdbibliothek',
      'Ein Beitreten-QR-Code für alle in der Live-Ansicht: das erste Handy wird Board 1, das nächste Board 2 …',
      'Beim Anlegen heißt das Feld jetzt „Boards (= Handys)“',
    ],
  },
  {
    version: '1.14.0',
    date: '02.11.2026',
    items: [
      'Live-Turnier: jedes Board zeigt, ob ein Handy verbunden ist (📱 Name oder ⚠️ kein Handy) – die Handys melden sich alle 5 Sekunden',
      'Spiele werden nur an Boards mit verbundenem Handy aufgerufen (abschaltbar)',
      'Boards während des Turniers hinzufügen oder entfernen (− / ＋ in der Live-Ansicht)',
      'Ergebnis am PC eintragen, wenn ein Handy ausfällt (Board antippen)',
      'Schreiber ansagen: „Board 2: Kevin gegen Tom. Schreiber: Nils“ – der Verlierer des letzten Spiels an diesem Board',
      'Highlights auf dem Fernseher: 180 und Finishes ab 100 groß eingeblendet, wahlweise mit Ansage',
      'Zeitplan: geschätztes Turnierende; Warnung, wenn ein aufgerufenes Spiel nach 5 Minuten nicht begonnen hat',
      'Neue Einstellungen › Turnier & Live: alles einzeln an- und abschaltbar',
    ],
  },
  {
    version: '1.13.0',
    date: '02.11.2026',
    items: [
      'Online-Turnier (optional, mit Firebase): iPhones treten aus der normalen App per Code bei – Turnier › „Turnier beitreten“',
      'Das WLAN-Turnier mit QR-Code geht weiter ohne Internet; Online ist eine zweite Möglichkeit',
      'Board-Handy: „Turnier-Spiele in meine Statistik übernehmen“ (Spieler wählbar) und „Turnier verlassen“',
      'Board-Handys schreiben beim Live-Turnier nicht mehr direkt in die eigene Statistik – erst beim Übernehmen, sauber zugeordnet',
      'Training zählt nicht mehr für Rang, Meilensteine und Rekorde der Spiele. Umschalter „Spiele | Training“ bei Meilensteine und Rekorde',
    ],
  },
  {
    version: '1.12.0',
    date: '02.11.2026',
    items: [
      'Live-Turnier: QR-Code je Board in der Live-Ansicht – mit der iPhone-Kamera scannen, dann öffnet sich direkt das Board-Handy für dieses Board',
      'Abgleich: beim Senden und beim Einlesen wählbar, wessen Spiele mitkommen (z. B. aus der Turnier-Datei nur deine und die von Nils)',
      'Turnier-Server: hört jetzt auch auf IPv6 (Firefox), hängt nicht mehr an leeren Verbindungen und schreibt im Fenster mit, was ankommt',
      'Live schalten: zweiter Versuch bei Netzfehlern und eine verständliche Meldung, wenn das Server-Fenster geschlossen ist',
    ],
  },
  {
    version: '1.11.0',
    date: '02.11.2026',
    items: [
      'Rekorde und Meilensteine haben eigene große Knöpfe auf der Startseite (nicht mehr in der Statistik)',
      'Meilensteine: Suche, Filter (erreicht/offen, Punkte, nur Elite) und Sortierung (Kategorie, Punkte, neueste)',
      'Tipp auf einen Meilenstein zeigt Details: Fortschritt, alle Stufen der Reihe, Vitrine – beim Doppel-Sammler alle 21 Doppel, getroffene grün',
      'Rekorde: oben umschalten zwischen „Meine Rekorde“ und „Bestenliste“, dazu Abend-Krone, Duelle und Monatsrückblick',
      'Gäste: „+ Gast“ bei Neues Spiel und „＋ Gäste“ im Turnier (Zahl eingeben, z. B. 5) – spielen mit, bekommen aber keine Statistik und keine Meilensteine',
      'Neues Spiel: das Spiel wird jetzt per Auswahlfeld gewählt, im selben Stil wie die Felder darunter',
      'Startseite aufgeräumt: Spieler, Kamera kalibrieren und Anleitung liegen jetzt als Menü in den Einstellungen',
      'Einstellungen in Unterseiten aufgeteilt: Dieses Handy & Startseite, Ansagen & Töne, Kamera & Geräte-Check, Abgleich & Sicherung',
    ],
  },
  {
    version: '1.10.1',
    date: '02.11.2026',
    items: [
      'Behoben (vermutlich): schwarzer Bildschirm nach dem Update – eine neue Version wird jetzt immer komplett geladen, nie mehr alte und neue Dateien gemischt',
      'Start-Hilfe: Startet die App nicht, erscheint nach 6 Sekunden „Reparieren“ (leert nur den Zwischenspeicher, Spiele und Statistik bleiben)',
      'Nach einem Update lädt die App einmal neu (mitten im Spiel erst beim Zurück zur Startseite)',
    ],
  },
  {
    version: '1.10.0',
    date: '02.11.2026',
    items: [
      'Große Turniere: K.-o. bis 32 Spieler, neues Format Gruppen + K.-o. (8–32 Spieler, Platz 1 und 2 jeder Gruppe kommen weiter)',
      'Neue Spieler im Turnier schnell anlegen: mehrere Namen auf einmal, mit Komma getrennt',
      'Live-Turnier im WLAN: Der PC ist die Turnierleitung (werkzeuge › „Turnier-Server starten“), die iPhones zählen an den Boards (Handeingabe)',
      'Freies Board = sofort das nächste Spiel: Der PC ruft es auf und sagt es an („Board 2: Kevin gegen Tom“), das Board-Handy zeigt es mit Start-Knopf',
      'Pause vor K.-o.-Runden einstellbar (5, 10 oder 15 Minuten) – wird angesagt und als Uhrzeit angezeigt',
      'Live-Ansicht für PC und Fernseher: alle Boards mit Spielstand, Gruppen-Tabellen, K.-o.-Baum, Sieger mit Konfetti',
      'Nach dem Turnier: „Abgleich-Datei für alle“ – in der eigenen App einlesen, dann zählen die Spiele für Statistik und Meilensteine',
    ],
  },
  {
    version: '1.9.0',
    date: '02.11.2026',
    items: [
      'Neu: Turnier-Modus (Startseite › Turnier) – K.-o. mit 4–8 Spielern (Freilose werden ausgelost) oder Jeder gegen Jeden mit 3–8, mit Turnierbaum bzw. Tabelle',
      'Neue Meilenstein-Kategorie „Turniere“: Turniere gespielt, Turnier-Matches gewonnen, Finals, Turniersiege, Sieg mit 8 Spielern',
      'Turniere kommen über den Abgleich auf das zweite Handy; Spiele dort zählen fürs selbe Turnier',
      'Neue Spiele: Count-Up, Baseball, Gotcha und Scram (unter Neues Spiel)',
      'Training: „Vorschlag für heute“ aus deinen Daten (schwächstes Doppel, Checkout-Quote, Start, Cricket-Marks) – mit einem Tipp direkt starten',
      'Statistik X01, Cricket und Training im neuen Stil: große Kennzahlen oben, Abschnitte, Erklärungen zum Aufklappen',
      'Beendete Spiele lassen sich in der Statistik nicht mehr löschen (abgebrochene zählen weiterhin nicht)',
      'Sicherung enthält jetzt auch Turniere und die Abzeichen-Vitrine',
    ],
  },
  {
    version: '1.8.6',
    date: '02.11.2026',
    items: [
      'Rekorde-Seite aufgeräumt: Rang, Punkte, Meilensteine, Serien und Vitrine oben in einer Karte',
      'Neu: „Als Nächstes“ zeigt die 3 Meilensteine, denen am wenigsten fehlt, mit Fortschrittsbalken',
      'Neu: „Zuletzt erreicht“ als Leiste zum Wischen',
      'Meilensteine filtern: Alle, Erreicht oder Offen; offene zeigen ihren Fortschritt als Balken',
      'Rang- und Saison-Zeitstrahl zum Aufklappen, Saison als kleinere Karte',
      'Im Spiel: unter jedem Spieler steht, was er zuletzt geworfen hat (z. B. „Zuletzt: T20 T20 5 = 125“)',
      'Neu: Tagesaufgaben – jeden Spieltag ab 5 Uhr drei leichtere Aufgaben (für alle gleich), auf der Startseite und unter Rekorde',
      'Neue Meilenstein-Kategorie „Aufgaben“: für erledigte Tages- und Wochenaufgaben, perfekte Tage, Wochen-Medaillen und Serien am Stück',
      'Leg-Average zählt erst, wenn das Leg fertig ist; Match-Average, First 9, Checkout-Quote und Cricket-MPR erst nach dem Match – keine falschen „Leg-Average“-Meldungen mehr mitten im Spiel',
    ],
  },
  {
    version: '1.8.5',
    date: '27.10.2026',
    items: [
      'Abgleich: „Sicherung importieren“ erkennt jetzt auch eine Abgleich-Datei und führt die Spiele zusammen, statt einen Fehler zu zeigen',
    ],
  },
  {
    version: '1.8.4',
    date: '27.10.2026',
    items: [
      'Wochenaufgaben: bei jeder Aufgabe steht dein Stand („1 / 2“), erledigte haben einen grünen Haken und „geschafft“',
    ],
  },
  {
    version: '1.8.3',
    date: '27.10.2026',
    items: [
      '„Ich bin“: jedes Handy weiß, wem es gehört (Einstellungen › Dieses Handy)',
      'Startseite zeigt dann nur deinen Fortschritt – „Alle Spieler zeigen“ bei Bedarf',
      'Karten auf der Startseite einklappbar: Tipp auf den Titel, eingeklappt bleibt nur eine Zeile',
      'Wochenaufgaben und Fortschritt lassen sich in den Einstellungen ganz ausblenden',
      'Statistik und Training starten direkt mit deinem Spieler',
    ],
  },
  {
    version: '1.8.2',
    date: '27.10.2026',
    items: [
      'Startseite aufgeräumt: Wochenaufgaben und Fortschritt als zwei ruhige Karten',
      'Wochenaufgaben nummeriert, darunter je Spieler drei Punkte für den Stand',
      'Fortschritt je Spieler: Rang-Abzeichen, Balken zum nächsten Rang, nächstes Ziel und Serie',
      'Deutlich weniger Emojis, Hinweis nur, wenn die Serie heute zu reißen droht',
    ],
  },
  {
    version: '1.8.1',
    date: '27.10.2026',
    items: [
      'Ränge nach oben deutlich schwerer: steilere Punkte-Grenzen (Master ab 3.700 Punkten)',
      'Ab Tour-Card-Anwärter braucht es zusätzlich ★ Elite-Meilensteine (40+ Punkte, z. B. 9-Darter, Big Fish) – Master braucht 12',
      'Elite-Meilensteine sind in der Liste mit ★ markiert',
      '📆 Tages-Serie: Tage in Folge gespielt – Trainings und Spiele gegen den Computer zählen mit (dazu Meilensteine bis 100 Tage)',
      'Jeder Spieler hat eine feste Nummer (#12345, siehe Spieler) – gleiche Namen sind jetzt erlaubt',
      'Abgleich erkennt Spieler über ihre Nummer, so wird nichts verwechselt oder doppelt angelegt',
    ],
  },
  {
    version: '1.8.0',
    date: '27.10.2026',
    items: [
      'Feier-Moment: neue Meilensteine werden schon während des Spiels eingeblendet und angesagt (mit Konfetti)',
      'Neuer Rang: Vollbild mit Abzeichen und Konfetti',
      'Startseite: Wochenaufgaben, Fortschritt je Spieler und „Fast geschafft“-Ziele',
      'Wochenaufgaben: jeden Montag 3 neue, alle geschafft = 🏅 Wochen-Medaille',
      'Punkte statt Anzahl: schwere Meilensteine zählen mehr, die Ränge richten sich nach Punkten',
      'Zwei Ränge: All-Time und Saison (jedes Quartal neu, mit Abzeichen für vergangene Saisons)',
      '10 geheime Meilensteine 🕵️ – erst sichtbar, wenn sie passieren',
      'Abzeichen-Vitrine: 3 Lieblings-Meilensteine erscheinen neben dem Namen',
      'Wochen-Serie 🔥: Wochen in Folge gespielt',
      '⚔️ Duell-Bilanz gegen jeden Gegner, auch am Spielende',
      '👑 Abend-Krone für den besten Average des Spieltags',
      'Bestwerte nach Zeitraum: für immer, diese Saison, dieser Monat',
      '„😱 … nimmt … den Rekord ab“ am Spielende',
      'Neuer Bestwert: bester Leg-Average (dazu Meilensteine Leg-Average 60 bis 120+)',
      '🌙 Abendbericht (Heute-Karte antippen) und 📅 Monatsrückblick – auch als Bild zum Teilen',
      '📲 Handys abgleichen: Spiele per AirDrop/WhatsApp ans andere Handy schicken und zusammenführen',
    ],
  },
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

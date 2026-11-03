// „Was ist neu?“ – kurze Checkliste je Version, neueste zuerst.
// Bei jedem Update hier einen Eintrag ergänzen (gleiche Nummer wie APP_VERSION in config.js).
// Nach einem Update zeigt die Startseite die neuen Punkte einmal an; danach unter Einstellungen › Was ist neu?

import { h, sheet } from './ui/dom.js';
import { APP_VERSION } from './config.js';
import { lsGet, lsSet } from './core/storage.js';

export const CHANGELOG = [
  {
    version: '1.34.0',
    date: '03.11.2026',
    items: [
      'Turnierleitung: neue Kachel „⏱ Zeitplan“ mit Ampel 🟢 im Plan / 🟡 knapp / 🔴 zu spät – nur hier, nicht auf Fernseher oder Fokus',
      'Geplantes Ende: kommt aus „Zeit bis Turnierende“ beim Anlegen oder wird in der Kachel eingetragen',
      'Hinter dem Plan: Vorschläge mit geschätzter Ersparnis zum direkten Anwenden – ein Board mehr, K.-o. bzw. restliche Gruppenspiele kürzer, Pause vor dem K.-o. streichen',
      'Gruppentabellen: Wer gerade spielt (🎯 B1, grün), aufgerufen ist (📣 B2, orange) oder schreibt (✍️), ist farbig markiert',
      'Handy während eines Spiels weg (z. B. gesperrt): nach 1½ Min. wird die Board-Kachel rot mit Hinweis und einmaliger Ansage. Kommt das Handy zurück, geht das Spiel dort einfach weiter – es wird nichts neu vergeben',
      '📄 Drucken: neuer Aushang für die Wand – je Gruppe Spieler und alle Spiele mit Feldern zum Eintragen, dazu der K.-o.-Baum (A4)',
      '🏆 Siegerehrung starten (nach dem Finale): Platz 3, 2 und 1 nacheinander groß auf allen Bildschirmen und mit Ansage, zum Schluss Konfetti und das Podest',
    ],
  },
  {
    version: '1.33.0',
    date: '03.11.2026',
    items: [
      'Turnierleitung: Kacheln nebeneinander – 📱 Handys, 🚀 Gleich geht\'s los (vor dem ersten Spiel), ☕ Pause, 📣 Aufruf; antippen klappt den Inhalt darunter auf',
      '📣 Aufruf: Spieler aus der Liste rufen (an sein Board bzw. zur Turnierleitung), ein Spiel ausrufen (am Board nochmal oder „bitte bereithalten“) oder eigene Durchsage',
      'Aufrufe erscheinen im Fokus und auf dem Fernseher groß: „📣 Aufruf · Board 2 – Gast 26 – Gast 24 · Schreiber …“ (9 Sekunden), Durchsagen ebenfalls',
      '🚀 Gleich geht\'s los: Startzeit festlegen (in 5–30 Min. oder um Uhrzeit), verschieben oder „Jetzt starten“ – bis dahin wird nichts aufgerufen',
      'Fokus und Fernseher zeigen vor dem ersten Spiel eine Startseite: Turniername, „Gleich geht\'s los!“, großer Countdown, die ersten Spiele und der QR-Code zum Mitverfolgen',
      'In Pausen und wenn kein Spiel läuft: Zuschauer-QR unten rechts in der Ecke (🖥️ › Weitere Möglichkeiten, abschaltbar)',
      'Die Pause-Karte steht nicht mehr neben dem Turnierbaum, sondern als Kachel neben den Handys',
    ],
  },
  {
    version: '1.32.7',
    date: '03.11.2026',
    items: [
      'Fokus und Fernseher: mehr Rand außen und mehr Abstand zwischen den Karten – die Boards sind etwas niedriger, überall mehr Luft',
      '🖥️ Fernseher: „➕ Weitere Möglichkeiten“ ist jetzt ein deutlicher Aufklapp-Knopf mit Rahmen und Pfeil',
    ],
  },
  {
    version: '1.32.6',
    date: '03.11.2026',
    items: [
      'Turnierleitung: feste Karte „☕ Pause“ auf der Seite (über dem Turnierbaum bzw. unter den Boards) – Grund eintippen, 5′–60′ antippen oder „bis Uhrzeit“',
      'Läuft eine Pause, zeigt die Karte „bis … Uhr, noch … Min.“ mit ＋5/10/15 Min. und „▶ Pause beenden“',
      '🖥️ Fernseher: oben „Fernseher-Fenster öffnen“ – ist es schon offen, „nach vorn holen“ oder „schließen“; direkt darunter steuern (Seite, Wechsel, Größe)',
      'Anderes Gerät, Übergabe und Zuschauer-Link stehen aufklappbar unter „Weitere Möglichkeiten“',
    ],
  },
  {
    version: '1.32.5',
    date: '03.11.2026',
    items: [
      'Fernseher-Fenster: oben keine Knöpfe mehr – nur Titel, Phase, Zeiten und Uhr (Vollbild: Doppelklick, F11 oder das blasse ⛶)',
      'Turnierleitung › 🖥️ › „📺 Fernseher steuern“: Seite (automatisch, Boards, Gruppen, K.-o., Ergebnisse), Größe und Wechsel in Pausen – wirkt sofort auf dem Fernseher, auch auf einem anderen Gerät',
      'Turnierleitung: Leiste oben deutlich schmaler – nur noch Boards −/＋, 🎯 Fokus, 🛠️ Steuern, 📜 Protokoll, 🖥️ Fernseher und ⚙️',
      '⚙️ › „🔍 Ansicht“: Größe (nur noch eine Einstellung), QR-Codes (Auto/An/Aus) und im Fokus die Seite; Ton ebenfalls unter ⚙️',
      '☕ Pause jetzt im Dashboard: rechts neben „Als Nächstes“ (und Tipp aufs Pausen-Banner, weiter auch unter 🛠️)',
      'Fernseher-/Vollbild-Ansicht 📺 in der Turnierleitung entfernt (Vollbild bei Bedarf mit F11); fürs Fernsehbild gibt es das Fernseher-Fenster',
      'Fokus am Laptop: oben nur ⚙️ und 🎯 – mehr Platz für Zeiten und Uhr',
      'Behoben: Das Fernseher-Fenster zeigte unter den Boards noch „Letzte Ergebnisse“ (gibt es dort als eigene Seite)',
    ],
  },
  {
    version: '1.32.4',
    date: '03.11.2026',
    items: [
      '„🔥 Bestwerte & Highlights“ nur noch als große Karten – nichts mehr doppelt (kein Laufband, „Beste Aufnahme“ nur, wenn sie unter 180 liegt)',
      'Neue Karten: „⚡ Kürzestes Leg“ (bzw. 💎 9-Darter) und „🏁 Finishes ab 100“',
      'Mehr als 4 Karten: Sie laufen seitenweise durch (alle 8 Sekunden, Punkte darunter zeigen die Seite)',
      'Kopfzeile der Turnierleitung: Knöpfe, Kacheln und Uhr werden auf kleineren Laptops kompakter',
      'Fokus mit Pausen-Banner: Die Boards werden etwas kleiner, damit alles auf eine Seite passt',
      'Behoben: Während einer Pause zeigte „Als Nächstes“ Uhrzeiten vor dem Pausenende – jetzt beginnt laut Prognose nichts vor dem Ende der Pause',
      'Pausen-Banner: „Nächste Spiele um …“ und „gerade läuft kein Spiel“, sobald kein Spiel mehr läuft',
    ],
  },
  {
    version: '1.32.3',
    date: '03.11.2026',
    items: [
      'Turnierleitung: Neuer Knopf ☕ oben in der Leiste (auch im Fokus) – Pause für 5–60 Min. oder bis zu einer Uhrzeit, mit Grund (z. B. „Essenspause“)',
      'Laufende Pause: verlängern (＋5/10/15 Min.), neu setzen oder „▶ Pause beenden“',
      'Großes Pausen-Banner über den Boards – im Fokus und auf dem Fernseher: Grund, „Weiter um …“ und Countdown; auch vor einer K.-o.-Runde',
      'Ansage beim Start der Pause (mit Grund) und eine Minute vor dem Ende: „Bitte zurück an die Boards“',
      'Zuschauer-Seite zeigt die Pause ebenfalls an',
    ],
  },
  {
    version: '1.32.2',
    date: '03.11.2026',
    items: [
      'Turnierleitung: Karte unter „Als Nächstes“ antippen – „… fehlt → Sieg …“ (kampflos für den anderen), Spieler „nicht da“ markieren oder das Spiel später spielen',
      'Spielerprofil: „🏳 nächstes Spiel kampflos an …“ und „🚫 aus dem Turnier nehmen“ (alle offenen Spiele kampflos)',
      'Spielerprofil zeigt bei „nicht da“, was passiert: Er wird nicht aufgerufen, seine Spiele warten, die anderen spielen weiter',
      '⚙️ „Nicht da → kampflos“ (10, 15 oder 30 Min., Standard aus): Wer so lange nicht da ist, verliert sein nächstes Spiel automatisch kampflos – mit Ansage, danach beginnt die Zeit neu',
      'Kampflos gewertete Spiele stehen im 📜 Protokoll und lassen sich dort zurücknehmen; sie zählen nicht für die Statistik',
    ],
  },
  {
    version: '1.32.1',
    date: '03.11.2026',
    items: [
      'Turnierleitung: „Turnier-Bestwerte“ und „Highlight-Ticker“ sind jetzt ein Bereich „🔥 Bestwerte & Highlights“ – Karten oben, die einzelnen Highlights darunter',
      'Fokus/Fernseher: Neuer Reiter „🏁 Ergebnisse“ oben – alle Ergebnisse mit Uhrzeit, daneben alle Highlights; wechselt in Pausen automatisch mit',
      'Im Fokus stehen die letzten Ergebnisse nicht mehr unter den Boards (in der normalen Ansicht weiter ein- und ausblendbar)',
      'Kopfzeile neu: Turniername mit Phase als Schild, daneben Kacheln „⏱ Läuft“, „👥 Gruppen fertig“, „🏆 Finale“, „🏁 Ende“ – jede Angabe nur noch einmal, dann die Uhr',
      'Fokus/Fernseher nutzt die ganze Bildschirmbreite; die Boards nehmen den Platz, den Bestwerte und „Als Nächstes“ übrig lassen',
      'Fokus: Bestwerte und „Als Nächstes“ je in einer Reihe, Schrift und Abstände wachsen mit der Bildschirmhöhe – passt auf Laptop (1366 × 768) und Fernseher (Full HD) ohne Scrollen',
      'Behoben: Im Fokus konnte ein freies Board mit QR-Code die Ansicht breiter als den Bildschirm machen (rechts abgeschnitten)',
    ],
  },
  {
    version: '1.32.0',
    date: '03.11.2026',
    items: [
      'Turnierleitung: Spiel läuft ungewöhnlich lange → Kachel orange („⚠️ läuft seit … Min.“), Grenze unter ⚙️ (Auto, 30, 45, 60 Min., Aus)',
      'Board antippen: Ergebnis eintragen, „🏳 … gibt auf“ (nur dieses Spiel), „🤝 Unentschieden“ (Gruppenphase), „🔄 Neu starten“, „⏭ Später spielen“, auf anderes Board verschieben – auch bei laufenden Spielen',
      'Unentschieden zählt als halber Sieg (1 Punkt); die Tabelle zeigt dann eine Spalte U',
      'Board-Handys merken Neustart, Zurückstellen und Board-Wechsel von selbst und beenden dort das Spiel',
      '🛠️ Anwesenheit / Check-in: Spieler als „nicht da“ markieren – sie werden nicht aufgerufen; „⏸ … fehlt“ direkt im Board-Menü',
      '🛠️ Durchsage: am PC ansagen und auf allen Bildschirmen (auch Fernseher) groß einblenden; Klick auf einen Namen ruft den Spieler',
      '⚙️ Ruhezeit (Standard 5 Min.): Wer gerade gespielt hat, kommt möglichst erst danach wieder dran; Aufrufe auf Wunsch zweimal ansagen',
      'Prognose oben: Gruppen fertig ca. …, Finale ca. …; bei „Als Nächstes“ die geschätzte Uhrzeit',
      'Gruppen: ✓ sicher weiter, ✗ raus (rechnerisch), Erklärung der Reihenfolge per ⓘ / Tooltip',
      'Neuer Bereich „📰 Highlight-Ticker“: 180er, Finishes ab 100, Short Legs (z. B. 501 in 15 Darts) und 9-Darter als Laufband',
      'Spielerprofil: Klick auf einen Namen zeigt Stand, nächstes Spiel mit Uhrzeit, Average, F9, Finish, 180er, Checkout-Quote und alle Spiele',
      '👀 Zuschauer-Link (🖥️): Jeder sieht am eigenen Handy sein nächstes Spiel, die Boards und Tabellen – optional mit Hinweis, wenn er bald dran ist; QR im Fokus/Fernseher nur auf Wunsch',
      '📄 Ergebnisse & Urkunden: CSV für Excel, Ergebnisliste drucken/als PDF, Urkunden für Platz 1–3 oder alle',
      '📜 Protokoll: alle Ergebnisse und Eingriffe mit Uhrzeit – mit ↩ Rückgängig (Ergebnis löschen, Aufgabe, Abwesenheit, Pause, Verschieben …)',
    ],
  },
  {
    version: '1.31.0',
    date: '03.11.2026',
    items: [
      'Online-Turnier: „🖥️ Turnierleitung an PC übergeben“ – z. B. unterwegs nur mit dem iPhone, Turnierleitung auf einem fremden PC',
      'Der QR-Code enthält Adresse und Code und öffnet am PC direkt die Turnierleitung; darüber steht die Adresse groß zum Abtippen',
      'Am PC in der Turnierliste: „🖥️ Turnierleitung übernehmen“ mit dem Code vom iPhone',
      'Es gibt immer nur eine Turnierleitung – das andere Gerät zeigt nur noch an und kann die „Leitung zurückholen“',
      'Turnierleitung: Klick auf „⚠️ kein Handy“ in einer Kachel zeigt den QR-Code dieses Boards – auch bei einem laufenden Spiel',
      'Handy ausgefallen mitten im Spiel: altes Handy abmelden (geht jetzt auch während des Spiels), neues verbinden und „Weiterspielen“ – der Stand bleibt',
      'Ein abgemeldetes Handy beendet sein Spiel von selbst, damit es den Stand des neuen Handys nicht überschreibt',
    ],
  },
  {
    version: '1.30.0',
    date: '03.11.2026',
    items: [
      'Turnier anlegen: „⚙️ Legs je Runde“ – z. B. Gruppenphase 1 Leg, K.-o. Best of 3, Halbfinale Best of 5, Finale Best of 7',
      'Finale auch in Sätzen möglich (Best of 3 oder 5 Sätze, je Satz die Legs vom Finale)',
      'Board-Handys starten automatisch das richtige Format; Turnierleitung und Turnier-Seite zeigen es an',
      '„Zeit bis Turnierende“: Die Empfehlung ist die Aufteilung mit den meisten Spielen, die noch in die Zeit passt',
      'Grobe Dauer jetzt auch für K.-o. und Jeder gegen Jeden; sie rechnet mit den Legs je Runde',
    ],
  },
  {
    version: '1.29.0',
    date: '03.11.2026',
    items: [
      'Turnier anlegen (Gruppen + K.-o.): Vorschläge für die Aufteilung passend zur Spielerzahl – 2, 4 oder 8 Gruppen als Karten',
      'Je Vorschlag: Gruppengröße, Spiele pro Spieler, Gruppen- und K.-o.-Spiele, Gesamtzahl und grob geschätzte Dauer; der empfohlene ist markiert',
      'Die Einstellung „Gruppengröße etwa 4/5/6“ entfällt – einfach den passenden Vorschlag antippen',
    ],
  },
  {
    version: '1.28.0',
    date: '02.11.2026',
    items: [
      'Turnier anlegen: „Spiel um Platz 3“ wählbar (ja/nein) – die beiden Halbfinal-Verlierer spielen um Platz 3',
      'Das Spiel um Platz 3 wird vor dem Finale aufgerufen und steht im Turnierbaum unter dem Finale',
      'Siegerehrung: Mit Spiel um Platz 3 steht dessen Sieger allein auf Platz 3',
      'Gruppen + K.-o.: Immer 2, 4 oder 8 Gruppen – so sind genau 4, 8 oder 16 Spieler im K.-o., ohne Freilose (z. B. 30 Spieler: 8 Gruppen, Achtelfinale)',
      'Turnierbaum: kürzere Platzhalter – „Sieger Viertelfinale 2“ statt „Sieger Sieger …“, Freilos-Spieler stehen direkt in der nächsten Runde',
    ],
  },
  {
    version: '1.27.0',
    date: '02.11.2026',
    items: [
      'Spiel: Vor dem ersten Dart heißt der große Knopf „⇄ ANWURF WECHSELN“ (z. B. nach dem Ausbullen) – einmal gedrückt, wird er zu NO SCORE; mit No Score beginnen: 0 eintippen. Auch am Board-Handy im Turnier',
      'Turnierleitung 🛠️: „Spieler gibt auf“ – offene Spiele gehen kampflos (w.o.) an die Gegner; zurücknehmbar',
      'Turnierleitung 🛠️: Turnier anhalten (10–60 Min.) – laufende Spiele enden normal, danach wird bis zur Zeit nichts aufgerufen',
      'Board antippen: „Aufruf nochmal ansagen“ und „Auf anderes Board verschieben“ (mit Ansage)',
      'Karte „📱 Handys“: zeigt, wenn ein Handy Spielstände noch nicht senden konnte',
      'Fokus/Fernseher: Seite „🏆 Siegerehrung“ mit Podest und Bestwerten – erscheint am Turnierende von selbst',
    ],
  },
  {
    version: '1.26.0',
    date: '02.11.2026',
    items: [
      'Fernseher-Fenster zeigt keine QR-Codes und keinen Code mehr – verbunden wird nur über die Turnierleitung am Laptop',
      'Turnierleitung: Handys abmelden („📴 Abmelden“) – z. B. wenn jemand vergessen hat, sein Board freizugeben',
      'Neue Karte „📱 Handys“: je Board das Handy, letzte Meldung, was dort läuft, mit Abmelde-Knopf',
      'Jedes Board-Handy hat jetzt eine eigene Kennung, damit genau das richtige abgemeldet wird',
    ],
  },
  {
    version: '1.25.0',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Neuer Knopf 🖥️ Fernseher – Fernseher-Fenster für den zweiten Bildschirm, Adresse/QR für ein anderes Gerät oder Fokus nur auf dem Laptop',
      'Das Fernseher-Fenster zeigt nur die Fokus-Ansicht, ruft nichts auf und sagt nichts an – gesteuert wird am Laptop',
      'In Pausen bzw. wenn kein Spiel läuft, wechselt der Fokus automatisch Boards → Gruppen → K.-o. (🔄, Dauer unter ⚙️), bei einem Aufruf sofort zurück',
      'Fokus mit nur einer Reihe Boards (z. B. 2): Boards nicht mehr lang gezogen, Bestwerte und „Als Nächstes“ darunter größer mit mehr Abstand',
      'Aufgerufene, noch nicht begonnene Spiele: Namen groß in der Mitte der Kachel',
    ],
  },
  {
    version: '1.24.0',
    date: '02.11.2026',
    items: [
      'Fokus: oben drei Seiten zum Durchklicken – 🎯 Boards, 👥 Gruppen und 🌳 K.-o. jeweils bildschirmfüllend',
      'Turnierbaum: aktuelle Runde umrahmt („läuft“), Weiterkommer grün mit ▶, Ausgeschiedene grau durchgestrichen',
      'Gruppen: Plätze 1 und 2 (kommen weiter) mit grünem Balken; bei fertiger Gruppe mit ✓',
      'Board-Kachel: Bei einem neuen Leg steht „Neues Leg“ statt der alten Aufnahme aus dem vorigen Leg',
      'Fokus mit 2 Boards: Die Kachel stellt sich auf Hochformat um – Zahl groß und mittig, Werte zentriert darunter',
      'Fokus-Seiten Gruppen und K.-o. füllen den ganzen Bildschirm (Gruppen 2 × 2 bzw. 3 nebeneinander)',
    ],
  },
  {
    version: '1.23.1',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Der Rest ist jetzt so groß wie möglich – Legs rechts oben, Zuletzt und Averages rechts unten in der Ecke',
      'Die kleinen Infos (Darts, Max, F9, 180er) und der Checkout-Weg stehen am unteren Rand der Karte',
    ],
  },
  {
    version: '1.23.0',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Board-Kacheln neu aufgeteilt – der Rest ganz groß, Legs und Averages daneben, „wirft jetzt“ oben rechts in der Ecke',
      'Die Schrift richtet sich nach jeder Spieler-Hälfte – die Karten sind gefüllt, nichts wird abgeschnitten oder überlappt',
      'Fußzeile mit Schreiber und Spieldauer bleibt immer sichtbar (auch bei 4 Boards im Fokus)',
      '„Zuletzt“ steht immer – am Leg-Anfang die letzte Aufnahme aus dem vorigen Leg; Checkout-Weg in derselben Zeile',
      'Schmale Kacheln (Turnierbaum daneben): Werte rücken unter die Zahl, die Zahl wird dafür größer',
    ],
  },
  {
    version: '1.22.4',
    date: '02.11.2026',
    items: [
      'Fokus: Die Boards behalten immer mindestens gut die halbe Bildschirmhöhe – auch wenn Tabellen und Turnierbaum eingeblendet sind',
      'Fokus: Ist unten mehr eingeblendet, als auf den Bildschirm passt, kann man jetzt scrollen',
    ],
  },
  {
    version: '1.22.3',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Unter der Uhr steht die Turnierlaufzeit („Turnier läuft 1:24 Std.“), mit Zeitplan auch das geschätzte Ende',
    ],
  },
  {
    version: '1.22.2',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Beide Averages je Spieler – „Ø Spiel“ und „Ø Leg“ (laufendes Leg)',
      'Board-Kacheln ohne Emojis: „wirft jetzt“, „Checkout: …“, „6 Darts“, „Max 140“',
    ],
  },
  {
    version: '1.22.1',
    date: '02.11.2026',
    items: [
      'Turnierleitung: „✅ Checkout: T20 T20 D20“ steht bei jedem Spieler, dessen Rest auscheckbar ist – nicht nur beim Werfer',
    ],
  },
  {
    version: '1.22.0',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Rest und Namen in den Board-Kacheln deutlich größer – die Zahlen füllen die Karte',
      'Legs als Punkte: ●○ = 1 von 2 nötigen Legs gewonnen',
      'Zusatzinfos je Spieler: Darts im Leg, höchste Aufnahme, First 9 und 180er',
      'Fokus mit 4 Boards: Zahlen etwa ein Viertel größer, ohne dass unten etwas abgeschnitten wird',
      'Freie Boards zeigen ihren Inhalt mittig; Bestwerte und „Als Nächstes“ stehen in einer mittigen Reihe statt umzubrechen',
    ],
  },
  {
    version: '1.21.1',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Beim Werfer steht rot „🎯 wirft jetzt“ (bzw. seine Darts) und darunter trotzdem „Zuletzt: …“',
      'Fokus: Auch bei nur 1–2 Boards füllen die Kacheln die ganze Höhe, die Zahlen werden entsprechend größer',
    ],
  },
  {
    version: '1.21.0',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Höchstens 2 Boards nebeneinander (ab 5 Boards 3) – die Kacheln werden groß, die Schrift wächst mit',
      'Im Fokus füllen die Boards den ganzen Bildschirm, unten nur noch Bestwerte und die nächsten 4 Spiele',
      'Bestwerte als schmale Leiste in der Mitte (Zahl und Name in einer Zeile), standardmäßig über „Als Nächstes“',
      '⚙️ › Anzeige: Boards nebeneinander wählbar (Auto, 1, 2, 3)',
    ],
  },
  {
    version: '1.20.1',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Boards mit laufendem Spiel stechen heraus – heller Hintergrund, grünes Leuchten, leichter Schatten',
      'Aufgerufene Spiele leuchten orange, freie Boards treten dunkel mit gestricheltem Rand zurück',
    ],
  },
  {
    version: '1.20.0',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Beitreten steht jetzt in einer schmalen Zeile (ein QR-Code, Code, Zahl der Handys) – die vielen QR-Codes oben sind weg',
      'Den QR-Code für ein bestimmtes Board zeigt die Kachel des freien Boards',
      'Board-Handy nach dem Spiel: „🎯 Nächstes Spiel auch an Board 3“ oder „📴 Board freigeben“',
      'Board freigeben meldet das Handy sofort ab – am PC erscheint gleich wieder der QR-Code, ein anderes Handy kann übernehmen',
      'War dort schon das nächste Spiel aufgerufen, nimmt der PC den Aufruf zurück – das Spiel geht an ein Board mit Handy',
    ],
  },
  {
    version: '1.19.0',
    date: '02.11.2026',
    items: [
      'Turnierleitung: Neuer Knopf 👁 oben – Als Nächstes, Bestwerte, Letzte Ergebnisse und Turnierbaum ein- und ausblenden',
      'Reihenfolge dieser Bereiche frei wählbar (↑ / ↓ unter 👁 oder ⚙️ › Anordnung)',
      'Neuer Knopf 🎯 Fokus: nur Uhr, Boards, Als Nächstes und Bestwerte – was der Fokus zeigt, ist einstellbar',
      'Unter jedem Spieler steht jetzt „Legs 1 von 2“: so viele Legs braucht man zum Sieg',
      'Die Leiste „📋 Turnier“ mitten auf der Seite ist weg – ihre Größen-Knöpfe − 📋 ＋ sitzen jetzt oben in der Leiste',
      'Behoben: „Bald geschafft“ auf der Meilenstein-Seite wurde seit 1.18.0 als Raster statt als Liste angezeigt',
    ],
  },
  {
    version: '1.18.0',
    date: '02.11.2026',
    items: [
      'Turnierleitung: A− / A+ oben macht alles kleiner oder größer, − / ＋ im Bereich „Turnier“ nur diesen Bereich (wird gespeichert)',
      'Neu: große Uhr oben und ein Fortschrittsbalken fürs Turnier',
      'Neu: „🔥 Turnier-Bestwerte“ (180er, höchstes Finish, bester Average, beste Aufnahme) und „🏁 Letzte Ergebnisse“',
      '„Als Nächstes“ als große, nummerierte Karten, Turnierbaum größer',
      'Freies Board ohne Handy zeigt seinen QR-Code direkt in der Kachel, sonst das Spiel, das gleich dort startet',
    ],
  },
  {
    version: '1.17.0',
    date: '02.11.2026',
    items: [
      'Turnier anlegen: Starke Spieler mit ⭐ setzen (den besten zuerst) – sie treffen sich erst spät, ⭐1 und ⭐2 frühestens im Finale',
      'Freilose gehen an die Gesetzten; bei Gruppen kommt jeder Gesetzte in eine andere Gruppe',
      'Neu: „✏️ Auslosung ändern“ vor dem ersten Spiel – zwei Spieler antippen, sie tauschen die Plätze (auch mit Freilosen)',
      '„🎲 Neu auslosen“: Die Gesetzten bleiben gesetzt, alle anderen werden neu zugelost',
    ],
  },
  {
    version: '1.16.0',
    date: '02.11.2026',
    items: [
      'Turnierleitung neu: Jedes Board zeigt links und rechts den Rest groß, dazu Legs und Average',
      'Wer wirft, ist grün markiert (▶) – mit den Darts der laufenden Aufnahme und ab Rest 170 dem Checkout-Weg',
      'Beim anderen Spieler steht „Zuletzt: …“, unten Schreiber und seit wann das Spiel läuft; oben Runde und Best of',
      'Neue Leiste oben: Boards − / ＋, 🔊 Ansagen an/aus, QR-Codes ein/aus, ⚙️ Einstellungen, 📺 Fernseher',
      '⚙️ in der Turnierleitung: Ton, Highlights, Schreiber, Turnierbaum daneben/darunter/aus, große Schrift',
      'QR-Codes klappen von selbst zu, sobald alle Handys verbunden sind; auf breiten Bildschirmen steht der Turnierbaum rechts',
      'Turnier-Seite: Läuft das Turnier live, gibt es oben „🖥️ Zur Turnierleitung“ statt der Spielen-Knöpfe; ‹ in der Turnierleitung führt zur Turnier-Seite',
    ],
  },
  {
    version: '1.15.2',
    date: '02.11.2026',
    items: [
      'Behoben: Der Turnier-Server auf dem PC hielt ein altes Turnier fest – jetzt gibt es „⏹️ Live-Turnier beenden“ auch im WLAN',
      'Turnierplan entfernen leert den Turnier-Server mit, wenn genau dieses Turnier dort live ist',
      'Live-Karten auf Startseite und im Turnier-Bereich erscheinen nur noch, wenn wirklich ein Turnier live ist',
    ],
  },
  {
    version: '1.15.1',
    date: '02.11.2026',
    items: [
      'Behoben: Nach dem Beenden eines Online-Turniers am PC blieb das Handy mit dem alten Code verbunden und kam nicht mehr heraus – jetzt verlässt es das Turnier von selbst',
      '„🌐 Turnier verlassen“ jetzt auch auf der Startseite und im Turnier-Bereich',
    ],
  },
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

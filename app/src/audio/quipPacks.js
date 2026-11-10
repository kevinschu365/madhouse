// Freischaltbare Sprüche (Sprüche-Sammlung je Spieler) und die allgemeine Freischalt-Logik.
//
// SPRÜCHE ÄNDERN ODER STREICHEN: einfach die Zeile in der Liste unten ändern oder löschen.
// Jede Zeile: [Bedingung, Anlass, Spruch deutsch, Spruch englisch (darf fehlen)]
//
// Bedingung:
//   'rang:5'           ab Rang 5 (Zählung ab 0 wie RANKS in stats/stats.js: 0 = Darts-Neuling … 19 = Darts-Master)
//   'ms:madhouse-10'   für einen Meilenstein (Kennung aus MILESTONES in stats/stats.js)
//   'medaillen:3'      ab 3 Wochen-Medaillen
// Anlass: s180 (180) · ton (100 und mehr) · low (1 bis 20) · zero (0 Punkte) · bust (überworfen) · game (Checkout)
//
// Die Texte sind Hochdeutsch, damit sie in jedem deutschen Dialekt passen. Bei englischer Ansage kommen
// nur die Sprüche mit englischem Text. Sprüche mit mehr als 8 Wörtern gelten als „lang“ und kommen seltener.
//
// Die Logik unten (unlockedFor, whenText, standFrom) ist allgemein gehalten: Auch andere Listen
// (z. B. Disses oder Einlauf-Ansagen) können Einträge mit einem Feld „when“ damit freischalten.

import { RANKS, MILESTONES, playerRank } from '../stats/stats.js';

const ROWS = [
  // ---------- Rang 1: Frischling ----------
  ['rang:1', 'ton', 'Na also, geht doch!', 'There we go!'],
  ['rang:1', 'low', 'Das üben wir noch.', 'We will work on that.'],
  ['rang:1', 'game', 'Zack, zu ist das Ding!', 'Bang, done and dusted!'],
  ['rang:1', 'zero', 'Immerhin steht die Wand noch.', 'At least the wall is still standing.'],
  // ---------- Rang 2: Anfänger ----------
  ['rang:2', 'bust', 'Rechnen ist auch ein Sport.', 'Maths is a sport too.'],
  ['rang:2', 's180', 'Hundertachtzig! Wer hätte das gedacht!', 'One hundred and eighty! Who would have thought!'],
  ['rang:2', 'ton', 'Das war kein Zufall. Oder doch?', 'That was no accident. Or was it?'],
  ['rang:2', 'low', 'Die dicken Felder sind weiter oben.', 'The big numbers are further up.'],
  // ---------- Rang 3: Gelegenheitswerfer ----------
  ['rang:3', 'game', 'Sauber zugemacht.', 'Nicely finished.'],
  ['rang:3', 'zero', 'Drei Darts, null Ertrag.', 'Three darts, nothing to show for it.'],
  ['rang:3', 'low', 'Das war die Aufwärmrunde, oder?', 'That was the warm-up, right?'],
  // ---------- Rang 4: Kneipenwerfer ----------
  ['rang:4', 'ton', 'Der Wirt nickt anerkennend.', 'The landlord nods in approval.'],
  ['rang:4', 'bust', 'Zu gierig. Passiert den Besten.', 'Too greedy. Happens to the best.'],
  ['rang:4', 'game', 'Die nächste Runde zahlt der Verlierer.', 'Next round is on the loser.'],
  ['rang:4', 'low', 'Mehr Zielwasser, bitte.', 'More Dutch courage, please.'],
  // ---------- Rang 5: Stammtisch-Ass ----------
  ['rang:5', 's180', 'Hundertachtzig! Der Stammtisch steht auf!', 'One hundred and eighty! The whole pub is on its feet!'],
  ['rang:5', 'ton', 'Am Stammtisch wird schon getuschelt.'],
  ['rang:5', 'zero', 'Das erzählen wir keinem.', 'We will keep that between us.'],
  ['rang:5', 'game', 'Deckel drauf!', 'Put a lid on it!'],
  // ---------- Rang 6: Hobbyspieler ----------
  ['rang:6', 'low', 'Hobby heißt ja nicht, dass man es können muss.'],
  ['rang:6', 'bust', 'Knapp daneben ist auch überworfen.'],
  ['rang:6', 'ton', 'Mit Ansage!', 'Called it!'],
  // ---------- Rang 7: Feierabend-Profi ----------
  ['rang:7', 'game', 'Feierabend!', 'That is a wrap!'],
  ['rang:7', 'ton', 'So macht Feierabend Spaß.'],
  ['rang:7', 'zero', 'Auch ein Profi hat mal Feierabend.'],
  ['rang:7', 'low', 'War wohl ein langer Arbeitstag.', 'Long day at work, was it?'],
  // ---------- Rang 8: Vereinsspieler ----------
  ['rang:8', 's180', 'Hundertachtzig! Das gibt eine Vereinsrunde!'],
  ['rang:8', 'bust', 'Fünf Euro in die Mannschaftskasse.', 'That is a fiver in the team kitty.'],
  ['rang:8', 'game', 'Ab in die Vereinschronik damit.'],
  // ---------- Rang 9: Mannschaftsführer ----------
  ['rang:9', 'ton', 'Der Kapitän geht voran.', 'Captain leads the way.'],
  ['rang:9', 'low', 'Auch der Kapitän darf mal schwächeln.'],
  ['rang:9', 'zero', 'Das bleibt in der Kabine.', 'That stays in the dressing room.'],
  // ---------- Rang 10: Ligaspieler ----------
  ['rang:10', 'game', 'Zwei Punkte für die Tabelle!', 'Two points for the table!'],
  ['rang:10', 'ton', 'Das ist Liga-Niveau.', 'League standard, that.'],
  ['rang:10', 'bust', 'In der Liga kostet das das Leg.'],
  // ---------- Rang 11: Bezirksmeister ----------
  ['rang:11', 's180', 'Hundertachtzig! Der Bezirk bebt!'],
  ['rang:11', 'low', 'So wird man aber nicht Landesmeister.'],
  ['rang:11', 'game', 'Meisterlich zugemacht.', "A champion's finish."],
  // ---------- Rang 12: Landesmeister ----------
  ['rang:12', 'ton', 'Das Land ist stolz auf dich.'],
  ['rang:12', 'zero', 'Auch Meister fangen mal bei null an.'],
  ['rang:12', 'bust', 'Ein Meister überwirft mit Stil.'],
  // ---------- Rang 13: Turnierspieler ----------
  ['rang:13', 'game', 'Nächste Runde, bitte!', 'Next round, please!'],
  ['rang:13', 'ton', 'Turnierform!', 'Tournament form!'],
  ['rang:13', 'low', 'Das war keine Turnierform.'],
  // ---------- Rang 14: Tour-Card-Anwärter ----------
  ['rang:14', 's180', 'Hundertachtzig! Die Tour Card rückt näher!'],
  ['rang:14', 'zero', 'Dafür gibt es keine Tour Card.', 'No tour card for that.'],
  ['rang:14', 'game', 'So holt man sich die Tour Card.'],
  // ---------- Rang 15: Profi ----------
  ['rang:15', 'ton', 'Dafür gibt es Preisgeld.', 'That is prize money.'],
  ['rang:15', 'bust', 'Auch Profis verrechnen sich.', 'Even the pros miscount.'],
  ['rang:15', 'low', 'Das Preisgeld ist in Gefahr.'],
  ['rang:15', 'game', 'Ganz abgezockt.', 'Ice cold.'],
  // ---------- Rang 16: Weltranglisten-Spieler ----------
  ['rang:16', 'ton', 'Das gibt Punkte für die Weltrangliste.'],
  ['rang:16', 'game', 'Die Weltrangliste lässt grüßen.'],
  ['rang:16', 'zero', 'Die Weltrangliste schaut gerade weg.'],
  // ---------- Rang 17: Weltklasse ----------
  ['rang:17', 's180', 'Hundertachtzig! Reine Weltklasse!', 'One hundred and eighty! Pure world class!'],
  ['rang:17', 'ton', 'Weltklasse, was sonst.'],
  ['rang:17', 'low', 'Weltklasse war das gerade nicht.'],
  ['rang:17', 'bust', 'Weltklasse überworfen.'],
  // ---------- Rang 18: Weltmeister ----------
  ['rang:18', 'game', 'So spielt ein Weltmeister.', 'That is how a world champion plays.'],
  ['rang:18', 's180', 'Hundertachtzig! Der Weltmeister liefert!'],
  ['rang:18', 'zero', 'Auch Weltmeister haben schlechte Tage.'],
  // ---------- Rang 19: Darts-Master ----------
  ['rang:19', 'game', 'Der Master hat gesprochen.', 'The master has spoken.'],
  ['rang:19', 'ton', 'Lehrstunde vom Master.'],
  ['rang:19', 's180', 'Hundertachtzig! Verneigt euch vor dem Master!'],
  ['rang:19', 'low', 'Der Master gönnt sich eine Pause.'],
  ['rang:19', 'bust', 'Selbst der Master ist nur ein Mensch.'],

  // ---------- Für Meilensteine: 180er und hohe Aufnahmen ----------
  ['ms:180-1', 's180', 'Hundertachtzig! Und es war nicht die erste!', 'One hundred and eighty! And not the first one!'],
  ['ms:180-10', 's180', 'Hundertachtzig! Das wird langsam zur Gewohnheit.'],
  ['ms:180-25', 's180', 'Hundertachtzig! Wie am Fließband.'],
  ['ms:sec-coaster', 's180', 'Hundertachtzig! Achterbahn fahren kannst du.'],
  ['ms:s100-10', 'ton', 'Schon wieder dreistellig.', 'Three figures again.'],
  ['ms:ton-100', 'ton', 'Dreistellig, wie bestellt.'],
  ['ms:s140-1', 'ton', 'Da geht noch mehr, das wissen wir.'],
  ['ms:tonrow-3', 'ton', 'Jetzt bloß nicht aufhören!', 'Do not stop now!'],
  ['ms:avg-60', 'ton', 'Der Schnitt bedankt sich.'],
  // ---------- Für Meilensteine: Checkouts, Legs und Siege ----------
  ['ms:co-n-10', 'game', 'Routine am Doppel.'],
  ['ms:co-n-100', 'game', 'Der Doppel-Automat hat geliefert.'],
  ['ms:co-100', 'game', 'Check! Und wie!'],
  ['ms:co-170', 'game', 'Der große Fisch lässt grüßen!', 'Regards from the big fish!'],
  ['ms:bull', 'game', 'Eiskalt abgeräumt.'],
  ['ms:madhouse', 'game', 'Willkommen im Madhouse!', 'Welcome to the madhouse!'],
  ['ms:madhouse-10', 'game', 'Madhouse-Stammgast checkt aus.'],
  ['ms:tops-25', 'game', 'Tops! Oder so ähnlich.'],
  ['ms:dbl-all', 'game', 'Jedes Doppel kennt deinen Namen.'],
  ['ms:sec-drama', 'game', 'Diesmal ganz ohne Drama.'],
  ['ms:leg-15', 'game', 'Kurz und schmerzlos.', 'Short and sweet.'],
  ['ms:leg-12', 'game', 'Das ging ja schnell.'],
  ['ms:win-10', 'game', 'Gewinnen wird zur Gewohnheit.', 'Winning is becoming a habit.'],
  ['ms:win-50', 'game', 'Siegertyp. Ganz klar.'],
  ['ms:streak-5', 'game', 'Wer soll dich eigentlich stoppen?', 'Who is going to stop you?'],
  ['ms:ww', 'game', 'Gnadenlos.', 'Merciless.'],
  // ---------- Für Meilensteine: Pleiten, Pech und Pannen ----------
  ['ms:madhouse-10', 'bust', 'Das Madhouse wartet schon auf dich.'],
  ['ms:bust-1', 'bust', 'Das kennst du ja schon.', 'You know the feeling.'],
  ['ms:bust-50', 'bust', 'Überwerfen kannst du wie kein Zweiter.'],
  ['ms:zero-1', 'zero', 'Null. Kommt in den besten Familien vor.'],
  ['ms:zero-25', 'zero', 'Null Punkte. Deine Spezialität.', 'No score. Your speciality.'],
  ['ms:darts-10k', 'zero', 'Zehntausend Darts geübt, und dann das.'],
  ['ms:s26-10', 'low', 'Immerhin keine sechsundzwanzig.', 'At least it was not twenty six.'],
  ['ms:s26-100', 'low', 'Frühstück gab es heute wohl schon.'],
  ['ms:night', 'low', 'Um die Uhrzeit trifft keiner mehr.', 'Nobody hits anything at this hour.'],
  ['ms:played-50', 'low', 'Nach so vielen Spielen kennst du das ja.'],

  // ---------- Ab N Wochen-Medaillen ----------
  ['medaillen:1', 'ton', 'Medaillen-Form!', 'Medal form!'],
  ['medaillen:3', 'game', 'Das riecht nach der nächsten Medaille.'],
  ['medaillen:5', 'low', 'Dafür gibt es keine Medaille.', 'No medal for that one.'],
  ['medaillen:10', 's180', 'Hundertachtzig! Gold wert!', 'One hundred and eighty! Worth its weight in gold!'],
  ['medaillen:25', 'game', 'Medaillensammler bei der Arbeit.'],
];

/** Alle freischaltbaren Sprüche: { when (Bedingung), kind (Anlass), de, en (oder null) }. */
export const QUIP_PACK = ROWS.map(([when, kind, de, en = null]) => ({ when, kind, de, en }));

/** Anlässe in der Reihenfolge der Anzeige. */
export const QUIP_KINDS = [
  ['s180', '🚀', '180'], ['ton', '💯', '100 und mehr'], ['game', '🏁', 'Checkout'],
  ['low', '🐌', 'Wenig Punkte (1–20)'], ['zero', '🥚', '0 Punkte'], ['bust', '💣', 'Überworfen'],
];

/** Text eines Spruchs in der Sprache der Stimme ('de' oder 'en'); null, wenn es ihn dort nicht gibt. */
export const quipText = (q, voiceLang = 'de') => (voiceLang === 'en' ? q.en : q.de) || null;

/** Lang = mehr als 8 Wörter (kommt seltener, nie beim Leg-Checkout mitten im Match). */
export const isLongQuip = (text) => String(text || '').trim().split(/\s+/).length > 8;

// ---------- Allgemeine Freischalt-Logik ----------
// Spieler-Stand: { rank (Index in RANKS), reached (Set mit Meilenstein-Kennungen), medals (Wochen-Medaillen) }

/** Bedingung zerlegen: 'rang:5' -> { type: 'rank', value: 5 }, 'ms:co-170' -> { type: 'ms', value: 'co-170' }. */
export function parseWhen(when) {
  const [type, ...rest] = String(when || '').split(':');
  const value = rest.join(':');
  if (type === 'rang') return { type: 'rank', value: parseInt(value, 10) || 0 };
  if (type === 'medaillen') return { type: 'medals', value: parseInt(value, 10) || 0 };
  if (type === 'ms') return { type: 'ms', value };
  return { type: 'free', value: null }; // ohne Bedingung: für alle frei
}

/** Ist die Bedingung mit diesem Stand erfüllt? Ohne Stand (Gast, Computer-Spiel) ist nichts freigeschaltet. */
export function isUnlocked(when, stand) {
  const c = parseWhen(when);
  if (c.type === 'free') return true;
  if (!stand) return false;
  if (c.type === 'rank') return (stand.rank || 0) >= c.value;
  if (c.type === 'medals') return (stand.medals || 0) >= c.value;
  return !!(stand.reached && stand.reached.has(c.value));
}

/** Alle Einträge einer Liste (Standard: die Sprüche), die mit diesem Stand freigeschaltet sind. */
export function unlockedFor(stand, items = QUIP_PACK) {
  return items.filter((x) => isUnlocked(x.when, stand));
}

/** Bedingung als kurzer Text: „ab 🍻 Stammtisch-Ass“, „für 10× Madhouse“, „ab 3 Wochen-Medaillen“. */
export function whenText(when) {
  const c = parseWhen(when);
  if (c.type === 'rank') { const r = RANKS[c.value]; return r ? `ab ${r.icon} ${r.title}` : `ab Rang ${c.value + 1}`; }
  if (c.type === 'medals') return c.value === 1 ? 'für die erste Wochen-Medaille' : `ab ${c.value} Wochen-Medaillen`;
  if (c.type === 'ms') {
    const m = MILESTONES.find((x) => x.id === c.value);
    return !m ? 'für einen Meilenstein' : m.secret ? 'für einen geheimen Meilenstein' : `für ${m.title}`;
  }
  return 'frei';
}

/** Sortier-Schlüssel: erst Ränge (aufsteigend), dann Medaillen, dann Meilensteine. */
export function whenOrder(when) {
  const c = parseWhen(when);
  return c.type === 'rank' ? c.value : c.type === 'medals' ? 100 + c.value : c.type === 'ms' ? 1000 : -1;
}

/** Stand eines Spielers aus dem Ergebnis von milestones() (stats/stats.js). */
export function standFrom(ms) {
  const medal = ms.find((m) => m.id === 'mis-wm-52'); // Zähler der Wochen-Medaillen (bis 52)
  return {
    rank: playerRank(ms).index,
    reached: new Set(ms.filter((m) => m.at).map((m) => m.id)),
    medals: medal && medal.progress ? medal.progress[0] : 0,
  };
}

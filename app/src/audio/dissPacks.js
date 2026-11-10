// Sticheleien („Disses“) bei Formtief, die Rang und Rivalen kennen – plus die Stufe „brutal“.
//
// STICHELEI ÄNDERN ODER STREICHEN: einfach die Zeile in der Liste unten ändern oder löschen.
// Jede Zeile: [Bedingung, Stufe, Art, Text deutsch, Text englisch (darf fehlen)]
//
// Bedingung (wie bei den Sprüchen, siehe quipPacks.js): 'rang:8' ab Rang 8 (Zählung ab 0) · 'ms:…' für einen
//   Meilenstein · 'medaillen:3' ab 3 Wochen-Medaillen · '' = für alle frei.
//   Gemeint ist immer der Spieler, der die Stichelei ABBEKOMMT („wer oben steht, muss mehr aushalten“).
// Stufe: mild (3 Aufnahmen in Folge unter 40) · hard (ab 5) · brutal (ab 7, nur wenn in den Einstellungen gewählt)
// Art:   allg   = allgemein
//        rang   = greift den Rang auf (Platzhalter {rang})
//        heute  = Stand von heute Abend, nur bei Rückstand ({heute} = „vier zu eins“, Gegner zuerst)
//        bilanz = Gesamtbilanz, nur wenn sie negativ ist und es mindestens 5 Duelle gab
//                 ({bilanz} = „drei zu sieben“, {nte} = „achte“ (die nächste Niederlage), {mal} = „siebenmal“)
//        serie  = Niederlagen in Folge, ab 3 ({serie} = „fünfmal“, {zahl} = „fünf“, {nten} = „sechsten“)
// Platzhalter überall: {name} = Spieler, {gegner} = Gegner (nur bei heute / bilanz / serie).
// Zahlen stehen als Wörter im Satz, damit die Sprachausgabe sie sauber spricht.
// Sätze mit mehr als 10 Wörtern gelten als „lang“ und kommen seltener.
// Die bisherigen allgemeinen Sticheleien (mild / hart, für alle frei) stehen weiter in speech.js.

import { RANKS } from '../stats/stats.js';

const ROWS = [
  // ---------- Rang: mild ----------
  ['rang:4', 'mild', 'rang', 'Für einen {rang} ist das dünn, {name}.'],
  ['rang:4', 'mild', 'rang', '{name}, den Titel {rang} gibt es auch wieder weg.'],
  ['rang:5', 'mild', 'rang', '{rang}, ja? Sieht man gerade nicht, {name}.'],
  ['rang:6', 'mild', 'rang', '{name}, so wirft kein {rang}.'],
  ['rang:8', 'mild', 'rang', 'Rang und Leistung passen gerade nicht zusammen, {name}.', 'Your rank and your darts do not match right now, {name}.'],
  // ---------- Rang: hart ----------
  ['rang:4', 'hard', 'rang', '{name}, bist du sicher, dass du {rang} bist?'],
  ['rang:5', 'hard', 'rang', 'Als {rang} müsste dir das peinlich sein, {name}.'],
  ['rang:7', 'hard', 'rang', '{name}, den Rang {rang} hast du wohl im Lotto gewonnen.'],
  ['rang:9', 'hard', 'rang', 'Wer hat dich eigentlich zum {rang} gemacht, {name}?'],
  ['rang:10', 'hard', 'rang', '{name}, wir prüfen gerade, ob man Ränge aberkennen kann.', '{name}, we are checking whether ranks can be taken away.'],
  ['rang:12', 'hard', 'rang', '{rang}? Heute eher Darts-Neuling, {name}.'],
  // ---------- Rang: brutal ----------
  ['rang:8', 'brutal', 'rang', '{name}, für diese Aufnahmen müsste man dir den Rang pfänden.'],
  ['rang:10', 'brutal', 'rang', '{rang} steht drauf, Darts-Neuling ist drin, {name}.'],
  ['rang:13', 'brutal', 'rang', '{name}, dein Rang schämt sich gerade in Grund und Boden.', '{name}, your rank is hiding in shame right now.'],

  // ---------- Rivalen: Stand von heute Abend (nur bei Rückstand) ----------
  ['', 'mild', 'heute', '{gegner} führt heute {heute}, nur so.', '{gegner} leads {heute} tonight, just saying.'],
  ['', 'mild', 'heute', 'Heute steht es {heute} für {gegner}, {name}.', 'It is {heute} to {gegner} tonight, {name}.'],
  ['rang:3', 'hard', 'heute', '{name}, {gegner} zählt heute schon mit: {heute}.'],
  ['rang:6', 'hard', 'heute', '{heute} für {gegner}. Der Abend läuft nicht für dich, {name}.', '{heute} to {gegner}. Not your night, {name}.'],
  ['rang:8', 'brutal', 'heute', '{gegner} führt {heute} und muss sich nicht mal anstrengen, {name}.', '{gegner} leads {heute} without even trying, {name}.'],
  // ---------- Rivalen: Gesamtbilanz (nur wenn negativ, ab 5 Duellen) ----------
  ['', 'mild', 'bilanz', 'Das wäre dann die {nte} Niederlage gegen {gegner}.', 'That would be your {nte} defeat against {gegner}.'],
  ['', 'mild', 'bilanz', 'Gesamtbilanz gegen {gegner}: {bilanz}, {name}.', 'Overall against {gegner}: {bilanz}, {name}.'],
  ['rang:4', 'hard', 'bilanz', '{name}, {gegner} hat dich schon {mal} geschlagen. Gleich einmal mehr.', '{name}, {gegner} has beaten you {mal}. One more coming up.'],
  ['rang:7', 'hard', 'bilanz', '{bilanz} gegen {gegner}. Besser wird es heute nicht, {name}.'],
  ['rang:10', 'brutal', 'bilanz', '{name}, {gegner} führt dich in der Statistik als Lieblingsgegner.', '{name}, {gegner} lists you as favourite opponent.'],
  ['rang:12', 'brutal', 'bilanz', 'Die {nte} Niederlage gegen {gegner} ist schon bestellt, {name}.'],
  // ---------- Rivalen: Niederlagen in Folge (ab 3) ----------
  ['', 'mild', 'serie', '{serie} in Folge gegen {gegner} verloren, {name}.', 'Lost {serie} in a row to {gegner}, {name}.'],
  ['rang:3', 'mild', 'serie', '{name}, gegen {gegner} wartest du seit {zahl} Spielen auf einen Sieg.', 'No win against {gegner} in {zahl} games, {name}.'],
  ['rang:5', 'hard', 'serie', '{gegner} gewinnt gleich zum {nten} Mal in Folge.'],
  ['rang:9', 'brutal', 'serie', '{serie} in Folge verloren. {gegner} hält dich für Aufbautraining, {name}.'],
  ['rang:11', 'brutal', 'serie', '{name}, {gegner} sagt schon vor dem Spiel danke.', '{name}, {gegner} says thank you before the game even starts.'],

  // ---------- Allgemein: mild und hart zum Freischalten ----------
  ['rang:2', 'mild', 'allg', '{name}, das Bier ist nicht schuld. Oder doch?', '{name}, do not blame the beer. Or should we?'],
  ['rang:3', 'mild', 'allg', 'Kopf hoch, {name}. Tiefer geht es kaum noch.', 'Chin up, {name}. It can hardly get worse.'],
  ['rang:5', 'mild', 'allg', '{name}, sollen wir kurz die Regeln erklären?', '{name}, shall we go over the rules again?'],
  ['ms:s26-10', 'mild', 'allg', '{name}, da wäre sogar die Sechsundzwanzig ein Fortschritt.', '{name}, even twenty six would be progress.'],
  ['rang:4', 'hard', 'allg', '{name}, die Scheibe gähnt schon.', '{name}, the board is yawning.'],
  ['rang:6', 'hard', 'allg', 'Das ist Arbeitsverweigerung, {name}.', 'That is refusal to work, {name}.'],
  ['rang:8', 'hard', 'allg', '{name}, wirf ruhig weiter. Irgendwann trifft jeder mal.', 'Keep throwing, {name}. Everyone hits something eventually.'],
  ['ms:played-50', 'hard', 'allg', 'So viele Spiele, {name}, und dann das.', 'All those games, {name}, and then this.'],
  ['medaillen:3', 'hard', 'allg', '{name}, deine Medaillen wollen zurück in die Schublade.'],
  // ---------- Allgemein: brutal (erst ab höherem Rang) ----------
  ['rang:8', 'brutal', 'allg', '{name}, das ist Körperverletzung an einer Dartscheibe.', '{name}, that is assault on a dartboard.'],
  ['rang:8', 'brutal', 'allg', 'Ich sag es ungern, {name}: Das ist richtig schlecht.', 'I hate to say it, {name}: that is really bad.'],
  ['rang:9', 'brutal', 'allg', '{name}, gib die Darts jemandem, der sie benutzt.', '{name}, hand the darts to someone who will use them.'],
  ['rang:10', 'brutal', 'allg', 'Wenn Scham Punkte gäbe, hättest du längst gecheckt, {name}.', 'If shame scored points, you would have checked out by now, {name}.'],
  ['rang:11', 'brutal', 'allg', '{name}, sogar die Wand hinter dem Board hat Angst.', '{name}, even the wall behind the board is scared.'],
  ['rang:12', 'brutal', 'allg', 'Bitte nicht filmen. {name} hat Familie.', 'No filming, please. {name} has a family.'],
  ['rang:13', 'brutal', 'allg', '{name}, der Wirt fragt, ob er dir ein Taxi rufen soll.', '{name}, the landlord is asking whether you need a taxi.'],
  ['rang:14', 'brutal', 'allg', 'Ich habe nachgerechnet, {name}: Schlechter geht es kaum.', 'I did the maths, {name}: it hardly gets worse.'],
  ['rang:15', 'brutal', 'allg', '{name}, ab jetzt zähle ich nur noch aus Mitleid mit.', '{name}, from now on I only keep score out of pity.'],
  ['rang:16', 'brutal', 'allg', 'Das war nichts, {name}. Und davor auch nicht.', 'That was nothing, {name}. Same as before.'],
];

/** Alle Sticheleien der Liste: { when (Bedingung), level (Stufe), kind (Art), de, en (oder null) }. */
export const DISS_PACK = ROWS.map(([when, level, kind, de, en = null]) => ({ when, level, kind, de, en }));

/** Stufen in der Reihenfolge der Anzeige. */
export const DISS_LEVELS = [['mild', '😏', 'Mild'], ['hard', '😈', 'Hart'], ['brutal', '💀', 'Brutal']];

/** Arten, die eine Duell-Bilanz brauchen (Rivalen-Sticheleien). */
export const RIVAL_KINDS = ['heute', 'bilanz', 'serie'];
export const isRivalKind = (kind) => RIVAL_KINDS.includes(kind);

/** Vorlage in der Sprache der Stimme ('de' oder 'en'); null, wenn es sie dort nicht gibt. */
export const dissText = (d, voiceLang = 'de') => (voiceLang === 'en' ? d.en : d.de) || null;

/** Lang = mehr als 10 Wörter (kommt seltener). */
export const isLongDiss = (text) => String(text || '').trim().split(/\s+/).length > 10;

// ---------- Zahlen als Wörter (damit die Sprachausgabe sie sauber spricht) ----------
const DE_ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf',
  'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const DE_TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

/** Zahl als Wort: 4 -> „vier“, 21 -> „einundzwanzig“ (ab 100 als Ziffern). */
export function numWord(n, lang = 'de') {
  n = Math.max(0, Math.round(n) || 0);
  if (n > 99) return String(n);
  const ones = lang === 'en' ? EN_ONES : DE_ONES, tens = lang === 'en' ? EN_TENS : DE_TENS;
  if (n < 20) return ones[n];
  const o = n % 10, t = tens[Math.floor(n / 10)];
  if (!o) return t;
  return lang === 'en' ? `${t} ${ones[o]}` : `${o === 1 ? 'ein' : ones[o]}und${t}`;
}

/** Ordnungszahl als Wort: 8 -> „achte“, 21 -> „einundzwanzigste“; englisch „eighth“. */
export function ordWord(n, lang = 'de') {
  n = Math.max(1, Math.round(n) || 1);
  if (n > 99) return lang === 'en' ? `number ${n}` : `${n}.`;
  const w = numWord(n, lang);
  if (lang === 'en') {
    const parts = w.split(' ');
    const last = parts.pop();
    const ord = EN_ORD[last] || (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
    return [...parts, ord].join(' ');
  }
  if (n === 1) return 'erste';
  if (n === 3) return 'dritte';
  if (n === 7) return 'siebte';
  if (n === 8) return 'achte';
  return n < 20 ? `${w}te` : `${w}ste`;
}

/** „fünfmal“ / „five times“. */
export function timesWord(n, lang = 'de') {
  if (lang === 'en') return n === 1 ? 'once' : n === 2 ? 'twice' : `${numWord(n, 'en')} times`;
  return n === 1 ? 'einmal' : `${numWord(n)}mal`;
}

// ---------- Duell-Angabe: passt die Vorlage zu den Zahlen? ----------
// rival (wird beim Spielstart einmal berechnet, siehe duelFacts in stats/progress.js):
// { opp (Name des Gegners), today: [eigene Siege, Siege des Gegners], wins, losses, lossStreak }

export const MIN_DUELS = 5;       // Gesamtbilanz erst ab so vielen Duellen
export const MIN_LOSS_STREAK = 3; // Serie erst ab so vielen Niederlagen in Folge

/** Geben die Zahlen diese Art von Stichelei her? Allgemeine und Rang-Sticheleien: immer. */
export function dissFits(kind, rival) {
  if (!isRivalKind(kind)) return true;
  if (!rival || !rival.opp) return false;
  const [mine, theirs] = rival.today || [0, 0];
  if (kind === 'heute') return theirs >= 2 && theirs > mine;
  if (kind === 'bilanz') return rival.losses > rival.wins && rival.wins + rival.losses >= MIN_DUELS;
  return rival.lossStreak >= MIN_LOSS_STREAK;
}

/** Rang-Titel für den Satz („Für einen Landesmeister …“); „Weltklasse“ wird zu „Weltklasse-Spieler“. */
export function rankWord(rank) {
  const r = RANKS[rank];
  return !r ? '' : r.title === 'Weltklasse' ? 'Weltklasse-Spieler' : r.title;
}

/** Vorlage ausfüllen: Name, Rang und die Zahlen des Duells (als Wörter). Erster Buchstabe groß. */
export function fillDiss(template, { name = '', rank = null, rival = null, lang = 'de' } = {}) {
  const r = rival || {};
  const [mine, theirs] = r.today || [0, 0];
  const zu = lang === 'en' ? 'to' : 'zu';
  const ord = ordWord((r.lossStreak || 0) + 1, lang);
  const values = {
    name, rang: rank == null ? '' : rankWord(rank), gegner: r.opp || '',
    heute: `${numWord(theirs, lang)} ${zu} ${numWord(mine, lang)}`,
    bilanz: `${numWord(r.wins || 0, lang)} ${zu} ${numWord(r.losses || 0, lang)}`,
    nte: ordWord((r.losses || 0) + 1, lang),
    mal: timesWord(r.losses || 0, lang),
    serie: timesWord(r.lossStreak || 0, lang),
    zahl: numWord(r.lossStreak || 0, lang),
    nten: lang === 'en' ? ord : `${ord}n`,
  };
  const text = String(template || '').replace(/\{(\w+)\}/g, (all, k) => (k in values ? values[k] : all)).replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

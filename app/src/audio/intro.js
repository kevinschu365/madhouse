// Einlauf-Ansage beim Spielstart („Am Oche: Stammtisch-Ass Kevin, The Hammer, gegen Ligaspieler Anna.“)
// und der freischaltbare Kampfname.
//
// VORLAGEN ÄNDERN ODER STREICHEN: einfach die Zeile in den Listen unten ändern oder löschen.
//   LEADS       Einleitungsworte (nur bei „Einlauf: voll“), je Ansage-Sprache; 'de' und 'en' sind die Grundlage
//   LEADS_DUEL  Einleitungen, die nur zu zweit passen
//   JOINS       Wort zwischen den beiden Spielern („gegen“, „trifft auf“)
//
// Regeln (damit es den Spielstart nicht aufhält):
//   - nur bei 2 bis 4 Spielern, nur einmal am Anfang eines neu gestarteten Spiels
//   - „kurz“: Rang + Name je Spieler in einem Satz. „voll“: mit Einleitung, Kampfname und Abend-Krone
//   - ab 3 Spielern nur die Namen (bei „voll“ wird der Träger der Abend-Krone genannt)
//   - zweites und weiteres Spiel am selben Spieltag mit denselben Spielern: „voll“ -> Kurzform, „kurz“ -> nichts
//   - wird der Satz zu lang (INTRO_MAX_CHARS), fällt der Reihe nach weg: die Einleitung, der Rang bei Spielern mit
//     Kampfname, alle Ränge, die Abend-Krone – zuletzt bleibt die Kurzform
//   - Gäste und Computer-Gegner: nur der Name, kein Rang

import { isUnlocked } from './quipPacks.js';
import { rankWord } from './dissPacks.js';

/** Einstellung „Einlauf“: aus / kurz / voll. */
export const INTRO_MODES = ['off', 'short', 'full'];
/** Ab wann man sich einen Kampfnamen geben darf (Rang 5 = Stammtisch-Ass, Zählung wie RANKS). */
export const NICK_WHEN = 'rang:5';
export const NICK_MAX = 24;
export const INTRO_MAX_PLAYERS = 4;
/** Längster Einlauf in Zeichen – gemessen etwa 10 Zeichen je Sekunde, das sind also 5 bis 6 Sekunden Sprechzeit. */
export const INTRO_MAX_CHARS = 60;

const LEADS = {
  de: ['Am Oche:', 'Game on!', 'Es treten an:', 'Bühne frei:', 'Meine Damen und Herren:'],
  en: ['At the oche:', 'Game on!', 'Ladies and gentlemen:', 'Tonight:'],
  // Dialekte: eigene Einleitungen, dazu kommen „Am Oche:“ und „Game on!“
  bay: ['Pack mas:', 'Jetzt gilts:'],
  saechs: ['Nu gehts los:'],
  koelsch: ['Loss jonn:', 'Et jeiht loss:'],
  berlin: ['Jetzt jeht et los:'],
  schwaeb: ['Jetzt gohts los:'],
  pott: ['Hömma, jetzt gilt et:'],
  wien: ['Gemma, gemma:', 'Jetzt wirds ernst:'],
  schweiz: ['Jetzt gahts los:'],
  platt: ['Nu geiht dat los:'],
  reporter: ['Herzlich willkommen am Oche:', 'Meine Damen und Herren:'],
  caller: ["Let's play darts:"],
  pirate: ['Ahoy, me hearties:'],
};
const LEADS_DUEL = {
  de: ['Das Duell des Abends:'],
  en: ['The big one tonight:'],
};
const JOINS = {
  de: ['gegen', 'trifft auf'],
  en: ['against', 'takes on'],
};
const CROWN = { de: 'Träger der Abend-Krone', en: 'holder of the evening crown' };
const CROWN_SENTENCE = {
  de: (name) => `Die Abend-Krone trägt ${name}.`,
  en: (name) => `${name} holds the evening crown.`,
};
// Rang-Titel auf Englisch (gleiche Reihenfolge wie RANKS in stats/stats.js)
const RANKS_EN = ['Darts Rookie', 'Newcomer', 'Beginner', 'Casual Thrower', 'Pub Thrower', 'Pub Ace', 'Hobby Player', 'After-Work Pro',
  'Club Player', 'Team Captain', 'League Player', 'District Champion', 'State Champion', 'Tournament Player', 'Tour Card Contender',
  'Pro', 'World Ranked Player', 'World Class Player', 'World Champion', 'Darts Master'];

const pick = (list, rnd) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
const baseLang = (lang) => (lang === 'en' ? 'en' : 'de');

/** Einleitungsworte zur Ansage-Sprache (langKey = Einstellung „Stimme / Sprache“, z. B. 'bay'); duel: zu zweit. */
export function introLeads(lang = 'de', langKey = lang, duel = true) {
  const b = baseLang(lang);
  const own = langKey !== b && LEADS[langKey] ? LEADS[langKey] : null;
  return [...(own ? [...own, ...LEADS[b].slice(0, 2)] : LEADS[b]), ...(duel ? LEADS_DUEL[b] : [])];
}

/** Alle Vorlagen als Liste (für die Übersicht und die Tests). */
export function introTemplates() {
  return { leads: LEADS, leadsDuel: LEADS_DUEL, joins: JOINS, crown: CROWN };
}

/** Rang-Titel für die Ansage, deutsch oder englisch. */
export function introRank(rank, lang = 'de') {
  if (rank == null) return '';
  return baseLang(lang) === 'en' ? RANKS_EN[rank] || '' : rankWord(rank);
}

// ---------- Kampfname ----------

/** Eingabe säubern: Leerzeichen zusammenziehen, höchstens NICK_MAX Zeichen. Leer = kein Kampfname. */
export function cleanNick(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, NICK_MAX).trim();
}

/** Darf dieser Spieler (Stand aus standFrom) einen Kampfnamen führen? Gäste und Computer (kein Stand): nie. */
export const nickUnlocked = (stand) => !!stand && isUnlocked(NICK_WHEN, stand);

/** Kampfname, der angesagt wird: nur wenn gesetzt UND freigeschaltet – sonst ''. */
export function nickFor(player, stand) {
  return nickUnlocked(stand) ? cleanNick(player && player.nick) : '';
}

// ---------- Wann und in welcher Form? ----------

/**
 * Kommt bei diesem Spielstart überhaupt ein Einlauf in Frage? Nur bei einem neu gestarteten Spiel (nicht beim
 * Weiterspielen), nicht im Training, nur mit 2 bis 4 Spielern, nicht am Board-Handy im Live-Turnier und nur,
 * solange noch keine Aufnahme gespielt ist.
 */
export function introWanted({ resumed = false, training = false, players = 0, liveBoard = false, turns = 0 } = {}) {
  return !resumed && !training && players >= 2 && players <= INTRO_MAX_PLAYERS && !liveBoard && turns === 0;
}

/**
 * Form des Einlaufs: 'full' | 'short' | null (keiner).
 * mode: Einstellung ('off' | 'short' | 'full'), seen: heute schon ein Einlauf mit denselben Spielern, count: Zahl der Spieler.
 */
export function introLevel(mode, seen = false, count = 2) {
  if (mode === 'off' || count < 2 || count > INTRO_MAX_PLAYERS) return null;
  const m = mode === 'full' ? 'full' : 'short';
  if (seen) return m === 'full' ? 'short' : null;
  return m;
}

/** Kennung einer Paarung, unabhängig von der Reihenfolge. */
export const pairKey = (ids) => ids.slice().sort().join('|');

/** Gab es heute (day = Beginn des Spieltags) schon einen Einlauf für diese Paarung? mem: { day, keys } */
export const introSeen = (mem, key, day) => !!mem && mem.day === day && Array.isArray(mem.keys) && mem.keys.includes(key);

/** Paarung für heute merken (alte Spieltage fallen weg). Rückgabe: neues Gedächtnis. */
export function rememberIntro(mem, key, day) {
  const keys = mem && mem.day === day && Array.isArray(mem.keys) ? mem.keys.filter((k) => k !== key) : [];
  return { day, keys: [...keys, key] };
}

// ---------- Text ----------

/**
 * Ein Spieler im Satz. p: { name, rank (Index in RANKS, null = Gast/Computer), nick, crown }
 * short: „Stammtisch-Ass Kevin“ · full: „Stammtisch-Ass Kevin, The Hammer, Träger der Abend-Krone“
 */
export function introPart(p, level = 'short', lang = 'de', { ranks = 'all', crown = true } = {}) {
  const full = level === 'full';
  const nick = full && p.rank != null ? cleanNick(p.nick) : ''; // Gäste und Computer: nie ein Kampfname
  // ranks: 'all' = jeder mit Rang · 'noNick' = kein Rang bei Spielern mit Kampfname · 'none' = ohne Rang
  const rank = p.rank == null || ranks === 'none' || (nick && ranks === 'noNick') ? '' : introRank(p.rank, lang);
  const parts = [`${rank ? `${rank} ` : ''}${p.name}`];
  if (nick) parts.push(nick);
  if (full && crown && p.crown) parts.push(CROWN[baseLang(lang)]);
  return parts.join(', ');
}

/** Zufällige Einleitung davor – aber nur eine, mit der der Satz nicht zu lang wird (sonst null). */
function withLead(leads, text, rnd) {
  const fit = leads.filter((l) => l.length + 1 + text.length <= INTRO_MAX_CHARS);
  return fit.length ? `${pick(fit, rnd)} ${text}` : null;
}

const listNames = (names, lang) => (names.length < 2 ? names.join('')
  : `${names.slice(0, -1).join(', ')} ${baseLang(lang) === 'en' ? 'and' : 'und'} ${names[names.length - 1]}`);

/**
 * Text des Einlaufs (oder null). players: [{ name, rank, nick, crown }] in Spielreihenfolge,
 * level: 'short' | 'full', lang: Sprache der Stimme ('de' | 'en'), langKey: Ansage-Sprache (Dialekt), rnd: Zufall.
 */
export function introText(players, level, { lang = 'de', langKey = lang, rnd = Math.random } = {}) {
  if (!level || !players || players.length < 2 || players.length > INTRO_MAX_PLAYERS) return null;
  const b = baseLang(lang);
  const full = level === 'full';
  // Ab 3 Spielern: nur die Namen; bei „voll“ mit Einleitung und dem Träger der Abend-Krone
  if (players.length > 2) {
    const names = `${listNames(players.map((p) => p.name), lang)}.`;
    if (!full) return names;
    const king = players.find((p) => p.crown);
    const leads = introLeads(lang, langKey, false);
    const tries = [king ? `${names} ${CROWN_SENTENCE[b](king.name)}` : null, names].filter(Boolean).map((x) => withLead(leads, x, rnd));
    return tries.find((x) => x && x.length <= INTRO_MAX_CHARS) || names;
  }
  const join = pick(JOINS[b], rnd);
  const pair = (lv, opts) => {
    const a = introPart(players[0], lv, lang, opts);
    return `${a}${a.includes(', ') ? ',' : ''} ${join} ${introPart(players[1], lv, lang, opts)}.`;
  };
  const short = pair('short');
  if (!full) return short;
  // Zu lang? Dann der Reihe nach kürzen – wer einen Kampfnamen oder die Krone hat, behält sie möglichst
  const special = players.some((p) => (p.rank != null && cleanNick(p.nick)) || p.crown);
  const tries = [withLead(introLeads(lang, langKey, true), pair('full'), rnd), pair('full')];
  if (special) {
    tries.push(pair('full', { ranks: 'noNick' }), pair('full', { ranks: 'none' }),
      pair('full', { ranks: 'noNick', crown: false }), pair('full', { ranks: 'none', crown: false }));
  }
  return tries.find((x) => x && x.length <= INTRO_MAX_CHARS) || short;
}

/** Die eigene Ansage zum Anhören (Meilenstein-Seite): Einleitung + der eigene Teil in voller Form. */
export function introSolo(player, { lang = 'de', langKey = lang, rnd = Math.random } = {}) {
  const leads = introLeads(lang, langKey, false).filter((l) => !/treten an/.test(l)); // „Es treten an“ passt nicht zu einem allein
  return `${pick(leads, rnd)} ${introPart(player, 'full', lang)}.`;
}

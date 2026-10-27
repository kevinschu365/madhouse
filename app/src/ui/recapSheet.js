// Rückblick-Fenster: Abendbericht (Startseite) und Monatsrückblick (Statistik).
import { h, sheet, toast } from './dom.js';
import { dbGetAll } from '../core/storage.js';
import { isBotId } from '../game/bot.js';
import { recap, crownHolder, monthRange, playDayStart } from '../stats/progress.js';
import { shareCard } from './shareCard.js';
import { offerSync } from './syncUi.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const fmt1 = (v) => v.toFixed(1).replace('.', ',');

/** Gespeicherte Spiele gegen echte Spieler (und Trainings), nur beendete. */
async function realData() {
  const [rows, matches] = await Promise.all([dbGetAll('throws'), dbGetAll('matches')]);
  const real = matches.filter((m) => m.status === 'finished' && !m.players.some(isBotId));
  const ids = new Set(real.map((m) => m.id));
  return { rows: rows.filter((r) => ids.has(r.matchId)), matches: real };
}

/** Zeilen je Spieler für Anzeige und Bild. */
function playerLines(e) {
  const lines = [];
  lines.push(`${e.matches} ${e.matches === 1 ? 'Match' : 'Matches'}, ${e.wins} ${e.wins === 1 ? 'Sieg' : 'Siege'}${e.trainings ? ` · ${e.trainings} Training${e.trainings > 1 ? 's' : ''}` : ''}`);
  if (e.average != null) lines.push(`Ø ${fmt1(e.average)}${e.avgDelta != null ? ` (${e.avgDelta >= 0 ? '+' : ''}${fmt1(e.avgDelta)} zum Vormonat)` : ''}`);
  const extra = [e.bestCheckout ? `Bestes Finish ${e.bestCheckout}` : null, e.tons ? `${e.tons}× 100+` : null, e.c180 ? `${e.c180}× 180` : null, e.s26 ? `${e.s26}× 26 🛏️` : null].filter(Boolean);
  if (extra.length) lines.push(extra.join(' · '));
  lines.push(`${e.darts.toLocaleString('de-DE')} Darts${e.newMilestones.length ? ` · ${e.newMilestones.length} neue Meilensteine (+${e.points} P.)` : ''}`);
  return lines;
}

async function openRecap(title, subtitle, from, to, prev, { withSync = false } = {}) {
  const { rows, matches } = await realData();
  const list = recap(rows, matches, from, to, prev);
  const crown = crownHolder(rows, matches.filter((m) => m.createdAt < to));
  const cards = list.map((e) => h('div', { class: 'card recapcard' },
    h('h3', { style: { margin: '0 0 4px' } }, `${crown && crown.playerId === e.playerId && crown.day >= from ? '👑 ' : ''}${e.name}`),
    playerLines(e).map((l) => h('div', {}, l)),
    e.newMilestones.length ? h('div', { class: 'newms', style: { justifyContent: 'flex-start' } }, e.newMilestones.slice(0, 8).map((m) => h('span', {}, `${m.icon} ${m.title}`))) : null));
  let s;
  s = sheet(h('div', { class: 'stack' },
    h('div', { class: 'sheethead' }, h('h2', {}, title), h('button', { class: 'iconbtn', 'aria-label': 'Schließen', onclick: () => s.close() }, '✕')),
    h('div', { class: 'dim', style: { marginTop: '-8px' } }, subtitle),
    list.length ? cards : h('p', { class: 'dim' }, 'In diesem Zeitraum wurde nichts gespielt.'),
    list.length ? h('button', {
      class: 'btn primary',
      onclick: async () => {
        const r = await shareCard(title, subtitle, list.map((e) => ({ title: e.name, lines: playerLines(e) })));
        if (r === 'downloaded') toast('Bild gespeichert');
      },
    }, '📤 Als Bild teilen') : null,
    withSync ? h('button', { class: 'btn', onclick: () => offerSync() }, '📲 Spiele ans andere Handy schicken') : null,
    h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Schließen'),
  ));
}

/** Abendbericht: der laufende bzw. letzte Spieltag. */
export function showEveningRecap() {
  const from = playDayStart(Date.now());
  const date = new Date(from).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
  return openRecap('🌙 Abendbericht', date, from, from + 86400000, null, { withSync: true });
}

/** Monatsrückblick (Monat 0–11), mit Vergleich zum Vormonat. */
export function showMonthRecap(year, month) {
  const [from, to] = monthRange(year, month);
  const prev = monthRange(month === 0 ? year - 1 : year, (month + 11) % 12);
  return openRecap(`📅 Rückblick ${MONTHS[month]}`, String(year), from, to, prev);
}

export { MONTHS };

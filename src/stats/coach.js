// Trainings-Vorschläge aus den eigenen Daten: „Deine D16-Quote ist 12 % – heute 30 Darts auf D16“.
// Grundlage sind beendete Spiele gegen echte Spieler (wie die Statistik) und die eigenen Trainings.
// Jeder Vorschlag startet direkt die passende Übung (mode + options).

import { playerStats, cricketStats, doubleStats } from './stats.js';
import { isBotId } from '../game/bot.js';

const MIN_DOUBLE_ATTEMPTS = 8;   // darunter ist eine Doppel-Quote zu zufällig
const DAY = 86400000;
const pct = (v) => `${Math.round(v * 100)} %`;
const dec = (v, n = 1) => v.toFixed(n).replace('.', ',');

/**
 * Bis zu drei Vorschläge, wichtigster zuerst:
 * [{ id, icon, title, text, mode, options, minutes }]
 */
export function trainingTips(rows, matches, playerId) {
  const real = matches.filter((m) => m.status === 'finished' && m.players.length > 1 && m.players.includes(playerId) && !m.players.some(isBotId));
  const ids = new Set(real.map((m) => m.id));
  const mine = rows.filter((r) => r.playerId === playerId && ids.has(r.matchId));
  const x01 = playerStats(mine);
  const cricket = cricketStats(mine.filter((r) => r.mode === 'cricket'));
  const trainings = matches.filter((m) => m.status === 'finished' && m.players.length === 1 && m.players[0] === playerId);
  const tips = [];

  // 1) Schwächstes Doppel (nur Doppel, die oft genug versucht wurden)
  const dbl = doubleStats(mine).filter((d) => d.attempts >= MIN_DOUBLE_ATTEMPTS);
  if (dbl.length >= 2) {
    const d = dbl.reduce((a, b) => (b.rate < a.rate ? b : a));
    const name = d.target === 'BULL' ? 'Bullseye' : d.target;
    const segment = d.target === 'BULL' ? 25 : parseInt(d.target.slice(1), 10);
    tips.push({
      id: 'double', icon: '🎯', weight: 1 - d.rate, minutes: 10,
      title: `${name} üben`,
      text: `Deine ${name}-Quote ist ${pct(d.rate)} (${d.hits} von ${d.attempts}). Heute 30 Darts auf ${name}, etwa 10 Minuten.`,
      mode: 'doubles', options: { target: segment, darts: 30 },
    });
  }

  // 2) Checkout-Quote niedrig -> Finishes von 61 bis 100 üben
  if (x01.checkoutAttempts >= 20 && x01.checkoutRate < 0.3) {
    tips.push({
      id: 'checkout', icon: '🏁', weight: 0.9 - x01.checkoutRate, minutes: 15,
      title: 'Finishes üben',
      text: `Deine Checkout-Quote ist ${pct(x01.checkoutRate)}. Catch 40 übt Finishes von 61 bis 100, etwa 15 Minuten.`,
      mode: 'catch40', options: {},
    });
  }

  // 3) Start schwächer als der Schnitt -> Scoring
  if (x01.darts >= 90 && x01.first9 < x01.average - 3) {
    tips.push({
      id: 'first9', icon: '🚀', weight: 0.5 + (x01.average - x01.first9) / 50, minutes: 10,
      title: 'Besser starten',
      text: `Dein First 9 (${dec(x01.first9)}) liegt unter deinem Average (${dec(x01.average)}). Übe den Start: 10 Aufnahmen Score-Training, etwa 10 Minuten.`,
      mode: 'score', options: { rounds: 10 },
    });
  } else if (x01.darts >= 90) {
    const goal = Math.ceil(x01.average / 5) * 5 + 5;
    tips.push({
      id: 'scoring', icon: '💯', weight: 0.4, minutes: 15,
      title: 'Scoring steigern',
      text: `Dein Average ist ${dec(x01.average)}. 20 Aufnahmen Score-Training, Ziel: Ø ${goal}. Etwa 15 Minuten.`,
      mode: 'score', options: { rounds: 20 },
    });
  }

  // 4) Cricket: wenig Marks -> Triples treffen
  if (cricket.turns >= 30 && cricket.mpr < 2) {
    tips.push({
      id: 'triples', icon: '🎳', weight: 0.6 + (2 - cricket.mpr) / 4, minutes: 10,
      title: 'Triples treffen',
      text: `Deine Cricket-MPR ist ${dec(cricket.mpr, 2)}. Around the Clock nur auf Triples bringt mehr Marks, etwa 10 Minuten.`,
      mode: 'atc', options: { variant: 'triple', bull: false },
    });
  }

  // 5) Länger nicht trainiert oder noch zu wenig Daten -> Komplett-Test als Standortbestimmung
  const lastTraining = trainings.reduce((a, m) => Math.max(a, m.createdAt), 0);
  if (!tips.length || Date.now() - lastTraining > 14 * DAY) {
    tips.push({
      id: 'jdc', icon: '🧭', weight: tips.length ? 0.3 : 1, minutes: 15,
      title: lastTraining ? 'Wo stehst du gerade?' : 'Erste Standortbestimmung',
      text: `${lastTraining ? `Dein letztes Training ist ${Math.floor((Date.now() - lastTraining) / DAY)} Tage her. ` : ''}Der JDC-Test prüft Treffsicherheit und Doppel in etwa 15 Minuten.`,
      mode: 'jdc', options: {},
    });
  }

  return tips.sort((a, b) => b.weight - a.weight).slice(0, 3);
}

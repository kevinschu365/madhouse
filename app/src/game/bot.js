// Computer-Gegner: zielt auf ein Feld und streut zufällig darum (Normalverteilung in mm).
// Die Streuung wird je Stärke so bestimmt, dass Würfe auf T20 im Schnitt den gewünschten
// 3-Dart-Average ergeben. Spielerkennung: id 'bot:<Average>', z. B. 'bot:60'.

import { pointForHit, hitFromPoint, dartScore } from '../core/board.js';

export const BOT_LEVELS = [30, 40, 50, 60, 70, 80, 90, 100];
export const BOT_LEVEL_NAMES = { 30: 'Anfänger', 40: 'Einsteiger', 50: 'Hobby', 60: 'Fortgeschritten', 70: 'Vereinsspieler', 80: 'Stark', 90: 'Sehr stark', 100: 'Profi' };

export function isBotId(id) {
  return typeof id === 'string' && id.startsWith('bot:');
}
/** Stärke aus der id ('bot:60', bei mehreren Computern gleicher Stärke 'bot:60:2'). */
export function botLevel(id) {
  return parseInt(String(id).slice(4), 10) || 50;
}
export function botName(level) {
  return `Computer Ø${level}`;
}

/** Kleiner Zufallsgenerator mit festem Startwert (für die Kalibrierung reproduzierbar). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd) {
  const u = Math.max(rnd(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

function scatter(target, sigma, rnd) {
  const p = pointForHit(target);
  return hitFromPoint(p.x + gauss(rnd) * sigma, p.y + gauss(rnd) * sigma);
}

const T20 = { segment: 20, multiplier: 3 };
const sigmaCache = new Map();

/** Streuung (mm) für einen 3-Dart-Average beim Zielen auf T20 (Bisektion über eine Simulation). */
export function sigmaFor(average) {
  if (sigmaCache.has(average)) return sigmaCache.get(average);
  const avgAt = (sigma) => {
    const rnd = seeded(12345);
    let sum = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) sum += dartScore(scatter(T20, sigma, rnd));
    return (sum / n) * 3;
  };
  let lo = 1;
  let hi = 200;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (avgAt(mid) > average) lo = mid; else hi = mid;
  }
  const sigma = (lo + hi) / 2;
  sigmaCache.set(average, sigma);
  return sigma;
}

/** Ein Wurf des Computers auf ein Ziel. */
export function botThrow(target, average, rnd = Math.random) {
  return scatter(target, sigmaFor(average), rnd);
}

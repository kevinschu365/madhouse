// Sprachausgabe (Web Speech API) und Warntöne (Web Audio).
// iOS: Sprachausgabe startet erst, nachdem einmal per Tipp etwas gesprochen wurde
// -> unlock() bei einem Tipp aufrufen (z. B. „Spiel starten“).

import { getSettings } from '../core/settings.js';

const TEXT = {
  de: {
    triple: 'Triple', double: 'Doppel', bull: 'Bullseye', outerBull: 'fünfundzwanzig', miss: 'Daneben',
    bust: 'Überworfen', noScore: 'Kein Punkt', rest: 'Rest', game: 'Game shot', leg: 'und das Leg', set: 'und das Set', match: 'und das Match',
    youRequire: (n) => `Rest ${n}`, cameraLost: 'Achtung, Kamera hat das Board verloren', next: (name) => `${name} ist dran`,
    test: 'Triple zwanzig. Einhundertachtzig.',
  },
  en: {
    triple: 'Treble', double: 'Double', bull: 'Bullseye', outerBull: 'twenty five', miss: 'Miss',
    bust: 'Bust', noScore: 'No score', rest: 'You require', game: 'Game shot', leg: 'and the leg', set: 'and the set', match: 'and the match',
    youRequire: (n) => `${n} left`, cameraLost: 'Warning, camera lost the board', next: (name) => `${name} to throw`,
    test: 'Treble twenty. One hundred and eighty.',
  },
};

function lang() {
  return getSettings().speechLang === 'en' ? 'en' : 'de';
}
export function t() {
  return TEXT[lang()];
}

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

let voicesCache = [];
function loadVoices() {
  if (!speechSupported()) return [];
  voicesCache = window.speechSynthesis.getVoices() || [];
  return voicesCache;
}
if (speechSupported()) {
  loadVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function availableVoices(forLang = lang()) {
  const all = voicesCache.length ? voicesCache : loadVoices();
  return all.filter((v) => v.lang && v.lang.toLowerCase().startsWith(forLang));
}

function pickVoice() {
  const s = getSettings();
  const list = availableVoices();
  if (s.voiceURI) {
    const v = list.find((x) => x.voiceURI === s.voiceURI);
    if (v) return v;
  }
  // Bevorzugt Stimmen in „erweiterter/Premium“-Qualität, sonst die Standardstimme der Sprache
  const preferred = list.find((v) => /premium|enhanced|erweitert/i.test(v.name)) || list.find((v) => v.default) || list[0];
  return preferred || null;
}

let unlocked = false;
/** Muss aus einem Tipp-Ereignis heraus aufgerufen werden (iOS). */
export function unlock() {
  if (speechSupported() && !unlocked) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      unlocked = true;
    } catch { /* ignorieren */ }
  }
  unlockAudio();
}

export function say(text, { interrupt = false } = {}) {
  if (!speechSupported() || !text) return;
  const synth = window.speechSynthesis;
  if (interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : (lang() === 'de' ? 'de-DE' : 'en-GB');
  u.rate = getSettings().speechRate || 1;
  // iOS bleibt manchmal im Pausenzustand hängen
  if (synth.paused) synth.resume();
  synth.speak(u);
}

export function dartText(hit) {
  const T = t();
  if (!hit || hit.multiplier === 0 || hit.segment === 0) return T.miss;
  if (hit.segment === 25) return hit.multiplier === 2 ? T.bull : T.outerBull;
  if (hit.multiplier === 3) return `${T.triple} ${hit.segment}`;
  if (hit.multiplier === 2) return `${T.double} ${hit.segment}`;
  return String(hit.segment);
}

export function announceDart(hit) {
  if (getSettings().announceDart) say(dartText(hit));
}

/** Summe der Aufnahme (und ggf. Rest) ansagen. */
export function announceTurn({ points, bust, finished, remaining, legWon, setWon, matchWon }) {
  const s = getSettings();
  const T = t();
  const parts = [];
  if (finished) {
    parts.push(T.game);
    if (matchWon) parts.push(T.match);
    else if (setWon) parts.push(T.set);
    else if (legWon) parts.push(T.leg);
  } else if (s.announceTurn) {
    parts.push(bust ? T.bust : points === 0 ? T.noScore : String(points));
  }
  if (!finished && s.announceRest && remaining > 0) parts.push(T.youRequire(remaining));
  if (parts.length) say(parts.join('. '));
}

// ---------- Töne ----------
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* ignorieren */ }
}

export function beep(kind = 'warn') {
  if (!getSettings().beeps || !audioCtx) return;
  const now = audioCtx.currentTime;
  const seq = kind === 'warn' ? [[880, 0], [660, 0.18], [880, 0.36]] : [[1200, 0]];
  for (const [f, at] of seq) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = f;
    o.type = 'square';
    g.gain.setValueAtTime(0.0001, now + at);
    g.gain.exponentialRampToValueAtTime(0.25, now + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.15);
    o.connect(g).connect(audioCtx.destination);
    o.start(now + at);
    o.stop(now + at + 0.16);
  }
}

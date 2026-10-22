// Kamera im Spiel: Darts erkennen, Board-leer erkennen (automatisch weiter),
// Ausbullen, Warnung bei Bildverlust, Korrekturbilder speichern.
// Spiellogik und Anzeige kennt dieses Modul nur über die übergebenen Rückruf-Funktionen.

import { camera, imageDataToJpeg } from './camera.js';
import { restoreCalibration, hitAtImage } from './calibration.js';
import { detectNewDart, downscale, roiMask, changeAmount, stableChange, DEFAULT_PARAMS } from './detector.js';
import { CamView } from '../ui/camView.js';
import { h, sheet } from '../ui/dom.js';
import { beep, say, t as speechText } from '../audio/speech.js';
import { getSettings } from '../core/settings.js';
import { dbPut } from '../core/storage.js';
import { newId } from '../game/match.js';
import { hitLabel, STANDARD_DIMENSIONS } from '../core/board.js';

// Werte aus der Auswertung an den Testbildern (siehe werkzeuge/ und BERICHT.md)
export const DETECTION_PARAMS = { ...DEFAULT_PARAMS };

// Wackelt das Kamerabild (Bildstabilisierung/Autofokus, um Pixel zitternde Kanten), sucht die
// Erkennung verschiebungstolerant (shiftTol). Ohne das wurde beim Wackeln fast jeder Dart als
// „Verdeckung“ verworfen. Bei ruhigem Bild bleibt die pixelgenaue Suche (dort etwas besser).
const JITTER_RAW = 0.0005;      // pixelgenaue Veränderung zwischen zwei Bildern, ab der ein Bild „wackelt“
const JITTER_SHARE = 0.25;      // Kamera gilt als wackelig, wenn das in mind. 25 % der letzten Bilder so war

// Veränderungen werden verschiebungstolerant gemessen (stableChange): Zittern von Kanten durch
// Bildstabilisierung/Autofokus des iPhones zählt nicht. Vorher stand die App dadurch fast
// dauernd auf „Bewegung …“ und hat Darts als „lange Bewegung“ verworfen (Kevins Video, 21.10.2026).
const MOTION_MIN = 0.0008;      // Anteil veränderter Pixel zwischen zwei Bildern = Bewegung
const MOTION_NOISE_X = 3;       // Bewegung erst ab dem 3-fachen des gemessenen Grundrauschens
const STABLE_MS = 350;          // so lange muss das Bild ruhig sein
const NOCHANGE = 0.0005;        // weniger Veränderung zur Referenz = nichts passiert (vorher 0,0012: dünne Darts bei frontaler Kamera lagen darunter)
const HAND_PEAK = 0.02;         // Bewegung über 2 % der Board-Fläche = Hand/Arm; ein fliegender Dart ist viel kleiner
const NOTICE = 0.002;           // ab dieser Veränderung ohne erkannten Dart: Hinweis „bitte antippen“
const LOCAL_EMPTY = 14;         // mittlere Farbdifferenz an einer Dart-Stelle: darunter = Stelle wieder leer
const BOARD_LOST_FRAC = 0.35;   // Anteil veränderter Board-Fläche gegenüber dem Kalibrierbild
const LOST_MS = 4000;
const DARK_LUM = 14;
const LONG_MOTION_MS = 1500;    // längere UND großflächige Bewegung vor einer Veränderung = Hand, kein Dart

export class CameraGame {
  constructor(opts) {
    this.o = opts;
    this.params = { ...DETECTION_PARAMS };
    this.stopped = false;
    this.timer = null;
    this.phase = 'throwing';     // 'throwing' | 'bulloff'
    this.turnDarts = [];         // erkannte Darts der aktuellen Aufnahme {tip, hit, before, after, ts}
    this.sawOcclusion = false;
    this.lastMotionAt = 0;
    this.motionHist = [];        // letzte Bewegungswerte -> Grundrauschen der Kamera
    this.jitterHist = [];        // 1 = Bild hat gegenüber dem vorigen pixelgenau „gewackelt“
    this.jittery = true;
    this.noneCount = 0;
    this.lostSince = null;
    this.lostAlerted = 0;
    this.lostReason = '';
    this.procMs = 30;
    this.bull = null;
    this.cameraEvents = null;
    window.__madhouseCam = this; // zur Fehlersuche
  }

  async start({ bullOff = false } = {}) {
    this.setStatus('warn', 'Kamera startet …');
    await camera.start();
    const size = camera.size();
    const saved = this.o.calibration;
    if (Math.abs(saved.width / saved.height - size.width / size.height) > 0.02) {
      this.setStatus('bad', 'Bildformat anders als bei der Kalibrierung – bitte neu kalibrieren.');
      throw new Error('Kalibrierung passt nicht zum Bildformat');
    }
    this.cal = restoreCalibration(saved, size.width, size.height);
    this.size = size;
    this.view = new CamView({
      source: camera.video, frameSize: size, aspect: `${size.width} / ${size.height}`,
      onTap: (p) => this.onTap(p),
    });
    this.view.setCalibration(this.cal);
    this.showGrid = false;
    this.view.setCalibration(null);
    const btnStyle = (right) => ({ position: 'absolute', right, top: '6px', height: '36px', minWidth: '36px', fontSize: '15px', zIndex: 3 });
    const gridBtn = h('button', { class: 'iconbtn', style: btnStyle('6px'), onclick: (e) => { e.stopPropagation(); this.showGrid = !this.showGrid; this.view.setCalibration(this.showGrid ? this.cal : null); } }, '▦');
    // Kamerabild klein (Standard) oder groß
    this.big = false;
    const ratio = size.width / size.height;
    const applySize = () => {
      const maxH = this.big ? '70dvh' : '28dvh';
      Object.assign(this.view.el.style, { maxHeight: maxH, width: `min(100%, calc(${maxH} * ${ratio.toFixed(4)}))`, margin: '0 auto' });
    };
    const sizeBtn = h('button', { class: 'iconbtn', style: btnStyle('48px'), onclick: (e) => { e.stopPropagation(); this.big = !this.big; applySize(); } }, '⤢');
    applySize();
    this.view.el.append(gridBtn, sizeBtn);
    this.dbgEl = h('div', { class: 'dim num', style: { fontSize: '12px', textAlign: 'center', minHeight: '0' } });
    this.o.container.replaceChildren(this.view.el, this.dbgEl);
    this.view.start();

    this.cameraEvents = camera.on((type) => {
      if (type === 'lost') this.markLost('Kamera-Signal unterbrochen');
      if (type === 'restored') this.clearLost();
    });

    await this.prepareReferences();
    if (bullOff) this.startBullOff();
    else this.setStatus('ok', 'Kamera bereit – werfen!');
    this.loop();
  }

  async prepareReferences() {
    const cur = await this.waitFrame();
    const P = this.params;
    this.ref = cur;
    this.refSmall = downscale(cur, P.procWidth);
    this.cleanRef = cur;
    this.cleanSmall = this.refSmall;
    const dims = this.cal.dims || STANDARD_DIMENSIONS;
    this.mask = roiMask(this.cal, this.refSmall.w, this.refSmall.h, this.refSmall.f, dims.doubleOuter * P.roiRadius);
    this.boardMask = roiMask(this.cal, this.refSmall.w, this.refSmall.h, this.refSmall.f, dims.doubleOuter * 1.02);
    this.prevSmall = this.refSmall;
    this.snapSmall = await this.loadSnapshot();
  }

  async waitFrame() {
    for (let i = 0; i < 50; i++) {
      const f = camera.grab();
      if (f) return f;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Kein Kamerabild');
  }

  async loadSnapshot() {
    const url = this.o.calibration.snapshot;
    if (!url) return null;
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
    if (!img.width) return null;
    const c = document.createElement('canvas');
    c.width = this.size.width; c.height = this.size.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return downscale(ctx.getImageData(0, 0, c.width, c.height), this.params.procWidth);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.view) this.view.stop();
    if (this.cameraEvents) this.cameraEvents();
    if (this.alertTimer) clearInterval(this.alertTimer);
  }

  interval() {
    const mode = getSettings().performance;
    const min = mode === 'low' ? 250 : mode === 'high' ? 66 : 100;
    return Math.max(min, this.procMs * 2.2);
  }

  loop() {
    if (this.stopped) return;
    const t0 = performance.now();
    try { this.tick(); } catch (e) { console.warn('Erkennung', e); }
    const dt = performance.now() - t0;
    this.procMs = this.procMs * 0.8 + dt * 0.2;
    this.ticks = (this.ticks || 0) + 1;
    this.updateDiagnostics();
    this.timer = setTimeout(() => this.loop(), document.visibilityState === 'visible' ? this.interval() : 1000);
  }

  /** Diagnose-Zeile unter dem Kamerabild (Einstellungen › Kamera-Diagnose). */
  updateDiagnostics() {
    const now = performance.now();
    if (this.lastDiag && now - this.lastDiag < 1000) return;
    const dtS = this.lastDiag ? (now - this.lastDiag) / 1000 : 1;
    const tps = ((this.ticks || 0) - (this.lastTicks || 0)) / dtS;
    this.lastDiag = now; this.lastTicks = this.ticks || 0;
    // Hängt das Kamerabild? (keine neuen Videobilder seit 1,5 s)
    if (camera.lastFrameAt && now - camera.lastFrameAt > 1500) {
      camera.ensurePlaying();
      this.setStatus('warn', 'Kamerabild steht – wird neu gestartet …');
    }
    if (!getSettings().cameraDebug) { if (this.dbgEl.textContent) this.dbgEl.textContent = ''; return; }
    const fps = camera.fps();
    const d = this.dbg || {};
    this.dbgEl.textContent = `Kamera ${fps == null ? '?' : fps.toFixed(0)} B/s · Analyse ${tps.toFixed(1)}/s (${this.procMs.toFixed(0)} ms) · Bewegung ${((d.motion || 0) * 1000).toFixed(1)}‰ (Rauschen ${((d.floor || 0) * 1000).toFixed(1)}‰) · ${this.jittery ? 'wackelt' : 'ruhig'} · Änderung ${((d.vsRef || 0) * 1000).toFixed(1)}‰ · ${d.state || ''}${d.last ? ` · zuletzt: ${d.last}` : ''}`;
  }

  // ---------- Hauptschleife ----------
  tick() {
    camera.ensurePlaying();
    const cur = camera.grab();
    const now = performance.now();
    if (!cur) { this.markLost('Kein Kamerabild'); return; }
    const P = this.params;
    const small = downscale(cur, P.procWidth);
    if (small.w !== this.refSmall.w) return;

    // Helligkeit (Objektiv verdeckt / dunkel)
    if (meanLum(small, this.boardMask) < DARK_LUM) { this.markLost('Bild zu dunkel oder Kamera verdeckt'); return; }

    const motion = stableChange(this.prevSmall, small, this.mask, P.minThresh, 2);
    // Wackelt das Bild? (pixelgenauer Vergleich zum vorigen Bild)
    this.jitterHist.push(changeAmount(this.prevSmall, small, this.mask, P.minThresh) > JITTER_RAW ? 1 : 0);
    if (this.jitterHist.length > 40) this.jitterHist.shift();
    // Solange zu wenig Messwerte da sind (Spielstart), sicherheitshalber tolerant suchen
    this.jittery = this.jitterHist.length < 10 || this.jitterHist.reduce((s, v) => s + v, 0) / this.jitterHist.length >= JITTER_SHARE;
    this.prevSmall = small;
    // Grundrauschen = unteres Viertel der letzten ~40 Werte. Rauscht die Kamera, steigt die Schwelle mit.
    this.motionHist.push(motion);
    if (this.motionHist.length > 40) this.motionHist.shift();
    const floor = this.motionHist.length >= 10 ? [...this.motionHist].sort((x, y) => x - y)[Math.floor(this.motionHist.length / 4)] : 0;
    const motionLimit = Math.max(MOTION_MIN, floor * MOTION_NOISE_X);
    this.dbg = { motion, floor, vsRef: this.dbg ? this.dbg.vsRef : 0, state: '', last: this.dbg ? this.dbg.last : '' };
    if (motion > motionLimit) {
      if (this.motionStart == null) { this.motionStart = now; this.motionPeak = 0; }
      this.motionPeak = Math.max(this.motionPeak, motion);
      this.lastMotionAt = now;
    }

    // Board noch zu sehen? (Vergleich mit dem Kalibrierbild, ca. 1x pro Sekunde)
    if (this.snapSmall && (!this.lastVisCheck || now - this.lastVisCheck > 1000)) {
      this.lastVisCheck = now;
      const vis = changeAmount(this.snapSmall, small, this.boardMask, 40);
      if (vis > BOARD_LOST_FRAC) {
        if (!this.visBadSince) this.visBadSince = now;
        if (now - this.visBadSince > LOST_MS) this.markLost('Board nicht mehr im Bild – Kamera verschoben?');
      } else {
        this.visBadSince = null;
        if (this.lostReason && !this.lostReason.startsWith('Kamera-Signal')) this.clearLost();
      }
    }
    if (this.lostSince && this.lostReason === 'Bild zu dunkel oder Kamera verdeckt') this.clearLost();

    if (now - this.lastMotionAt < STABLE_MS) { this.dbg.state = 'Bewegung'; this.setStatus('warn', 'Bewegung …'); return; }
    // Dauer der letzten Bewegung: Ein Dart steckt nach einem kurzen Moment, eine Hand bewegt sich länger.
    if (this.motionStart != null) {
      this.lastMotionDur = this.lastMotionAt - this.motionStart;
      this.lastMotionPeak = this.motionPeak;
      this.motionStart = null;
    }

    const vsRef = stableChange(this.refSmall, small, this.mask, P.minThresh);
    this.dbg.vsRef = vsRef;
    this.dbg.state = vsRef < NOCHANGE ? 'ruhig' : 'prüfe';
    if (vsRef < NOCHANGE) {
      this.noneCount = 0;
      this.checkBoardEmpty(cur, small);
      this.idleStatus();
      return;
    }

    const res = detectNewDart(this.ref, cur, this.cal, { ...P, shiftTol: this.jittery }, { refSmall: this.refSmall, mask: this.mask });
    this.dbg.last = res.kind === 'dart' ? `Dart ${hitLabel(res.hit)} (Fläche ${res.area})` : res.kind === 'occlusion' ? 'Verdeckung' : 'kein Dart';
    if (res.kind !== 'none') this.noneCount = 0;
    if (res.kind === 'occlusion') {
      // Große Veränderung (Hand, Schatten, Licht). Zählt nie als Dart.
      this.sawOcclusion = true;
      this.setStatus('warn', 'Hand/Verdeckung erkannt – zählt nicht');
      // Vielleicht ist die Hand schon weg und das Board leer (Vergleich mit dem leeren Board)
      this.checkBoardEmpty(cur, small);
      // Bleibt das veränderte Bild ruhig, wird es zur neuen Referenz (z. B. Hand weg, Licht anders)
      if (!this.occlusionSince) this.occlusionSince = now;
      else if (now - this.occlusionSince > 1500) { this.acceptReference(cur, small); this.occlusionSince = null; }
      return;
    }
    this.occlusionSince = null;
    if (res.kind === 'dart') {
      if (this.isEmptyAt(cur, res.tip, res.axis)) {
        // Ein Dart wurde herausgezogen (Stelle sieht wieder aus wie das leere Board)
        this.sawOcclusion = true;
        this.acceptReference(cur, small);
        this.checkBoardEmpty(cur, small);
        return;
      }
      if (this.lastMotionDur > LONG_MOTION_MS && this.lastMotionPeak > HAND_PEAK) {
        // Lange und großflächige Bewegung vor dem ruhigen Bild = eher Hand/Person als ein geworfener Dart.
        // (Nur die Dauer reicht nicht: Bildrauschen oder ein vorbeigehender Schatten am Rand dauern auch lange.)
        this.sawOcclusion = true;
        this.acceptReference(cur, small);
        this.setStatus('warn', 'Lange Bewegung – nicht als Dart gezählt (bei Bedarf von Hand eintragen)');
        return;
      }
      if (this.phase === 'bulloff') { this.onBullDart(res, cur, small); return; }
      const st = this.o.session.state;
      const accepts = !st.finished && !(st.openTurnIndex >= 0 && st.turnEval.closed) && !this.sawOcclusion;
      if (accepts) {
        const before = this.ref;
        this.acceptReference(cur, small);
        const meta = { tip: res.tip, axis: res.axis, hit: res.hit, before, after: cur, ts: Date.now(), confidence: res.confidence };
        this.turnDarts.push(meta);
        this.noticeUntil = 0;
        this.updateMarks();
        this.o.onHit(res.hit, { confidence: Math.round(res.confidence * 100) / 100, tip: res.tip.map((v) => Math.round(v)) });
        // Zeitstempel des eingetragenen Darts merken (für Korrekturbilder)
        const d = this.o.session.state.turnDarts;
        meta.dartTs = d.length ? d[d.length - 1].ts : null;
        this.setStatus('ok', `Erkannt: ${hitLabel(res.hit)}${res.confidence < 0.6 ? ' (unsicher – bitte prüfen)' : ''}`);
      } else {
        this.acceptReference(cur, small);
      }
      return;
    }
    // Veränderung ohne Dart (Licht, Schatten): Referenz übernehmen, wenn sie auch im nächsten
    // ruhigen Bild noch so aussieht (ein einzelnes unscharfes Bild soll keinen Dart „verschlucken“).
    if (++this.noneCount < 2) return;
    this.noneCount = 0;
    if (vsRef > NOTICE && this.phase === 'throwing') {
      this.setStatus('warn', 'Veränderung, aber kein Dart erkannt – falls einer steckt: ins Bild tippen');
      this.noticeUntil = now + 4000;
    }
    this.acceptReference(cur, small);
    this.checkBoardEmpty(cur, small);
  }

  acceptReference(cur, small) {
    this.ref = cur;
    this.refSmall = small;
  }

  /** Ist die Stelle (Dart-Spitze) wieder wie auf dem leeren Board? */
  isEmptyAt(cur, tip, axis = [0, -1]) {
    // Entlang des Dart-Schafts (von der Spitze Richtung Flight) prüfen, ob dort noch etwas ist
    const a = this.cleanRef.data, b = cur.data, W = cur.width, H = cur.height;
    const [ux, uy] = axis, nx = -uy, ny = ux;
    // Je Schritt entlang der Achse das Maximum quer zur Achse (±6 px, der Schaft ist dünn
    // und die Achse nicht ganz genau). Leer, wenn kaum ein Schritt deutlich abweicht.
    let on = 0, n = 0;
    for (let t = 2; t <= 44; t += 2) {
      let m = 0;
      for (let s = -6; s <= 6; s += 1) {
        const x = Math.round(tip[0] + ux * t + nx * s), y = Math.round(tip[1] + uy * t + ny * s);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = (y * W + x) * 4;
        const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
        if (d > m) m = d;
      }
      n++;
      if (m > LOCAL_EMPTY + 6) on++;
    }
    return n > 0 && on / n < 0.25;
  }

  /** Nach dem Ziehen: sind alle erkannten Darts weg? -> automatisch weiter. */
  checkBoardEmpty(cur, small) {
    if (this.phase === 'bulloff') { this.checkBullOffCleared(cur); return; }
    if (!this.turnDarts.length || !this.sawOcclusion) return;
    const st = this.o.session.state;
    if (st.openTurnIndex < 0) return;
    const allGone = this.turnDarts.every((d) => this.isEmptyAt(cur, d.tip, d.axis));
    const global = changeAmount(this.cleanSmall, small, this.boardMask, this.params.minThresh);
    const now = performance.now();
    if (!allGone) this.allGoneSince = null;
    else if (!this.allGoneSince) this.allGoneSince = now;
    // Normalfall: Darts weg und Board sieht aus wie vorher. Bei Lichtänderung: Darts weg und 2,5 s Ruhe.
    if (allGone && (global < 0.01 || (global < 0.04 && now - this.allGoneSince > 2500))) {
      this.allGoneSince = null;
      if (this.advancing) return; // nur einmal weiterschalten (Spielerwechsel läuft asynchron)
      this.setStatus('ok', 'Board leer – nächster Spieler');
      if (getSettings().autoAdvance) this.advancing = true;
      this.o.onBoardEmpty();
    }
  }

  /** Wird nach jedem Spielerwechsel aufgerufen. Das „leere Board“ wird nur übernommen,
   *  wenn das Bild wirklich wie das bisher leere Board aussieht (sonst stecken noch Darts). */
  turnClosed() {
    const cur = camera.grab();
    // Alle erkannten Darts sind lokal weg -> Board gilt als leer, auch wenn sich das Licht verändert hat
    const dartsGone = !!cur && this.turnDarts.length > 0 && this.sawOcclusion && this.turnDarts.every((d) => this.isEmptyAt(cur, d.tip, d.axis));
    this.turnDarts = [];
    this.sawOcclusion = false;
    this.advancing = false;
    if (cur) {
      const small = downscale(cur, this.params.procWidth);
      this.acceptReference(cur, small);
      if (dartsGone || changeAmount(this.cleanSmall, small, this.boardMask, this.params.minThresh) < 0.003) {
        this.cleanRef = cur;
        this.cleanSmall = small;
      }
    }
    this.updateMarks();
  }

  sessionChanged(type) {
    if (type === 'undo') {
      // Erkannte Darts, die nicht mehr in der Aufnahme stehen, aus der Anzeige nehmen
      const n = this.o.session.state.turnDarts.length;
      if (this.turnDarts.length > n) this.turnDarts = this.turnDarts.slice(0, n);
      this.updateMarks();
    }
  }

  updateMarks() {
    if (!this.view) return;
    this.view.setMarks(this.turnDarts.map((d, i) => ({ x: d.tip[0], y: d.tip[1], label: `${i + 1}: ${hitLabel(d.hit)}`, color: '#ff3b30' })));
  }

  /** Tipp ins Kamerabild = Feld an dieser Stelle eintragen/korrigieren. */
  onTap(p) {
    const { hit, radius } = hitAtImage(this.cal, p[0], p[1]);
    if (radius > 260) return;
    this.o.onTapHit(hit);
  }

  recalibrate() { this.o.onRecalibrate(); }

  /** Vorher/Nachher-Bild eines korrigierten Darts lokal speichern. Gibt die Bild-ID zurück. */
  saveCorrectionImage(oldDart, newHit) {
    const meta = this.turnDarts.find((d) => d.dartTs === oldDart.ts) || this.turnDarts[this.turnDarts.length - 1];
    if (!meta) return null;
    const id = newId('img');
    const rec = {
      id, ts: Date.now(),
      detected: { segment: oldDart.segment, multiplier: oldDart.multiplier },
      corrected: { segment: newHit.segment, multiplier: newHit.multiplier },
      tip: meta.tip, size: this.size, H: this.cal.H,
      before: imageDataToJpeg(meta.before, 1280, 0.85),
      after: imageDataToJpeg(meta.after, 1280, 0.85),
    };
    dbPut('images', rec).catch((e) => console.warn('Bild nicht gespeichert', e));
    return id;
  }

  // ---------- Ausbullen ----------
  startBullOff() {
    this.phase = 'bulloff';
    this.bull = { results: [] };
    this.bullPrompt();
  }

  bullPrompt() {
    const names = this.o.session.match.playerNames;
    const i = this.bull.results.length;
    if (i < 2) {
      const txt = `Ausbullen: ${names[i]} wirft auf das Bull`;
      this.setStatus('ok', txt);
      say(txt);
    }
  }

  onBullDart(res, cur, small) {
    const before = this.ref;
    this.acceptReference(cur, small);
    const dist = Math.hypot(res.board[0], res.board[1]);
    this.bull.results.push({ tip: res.tip, axis: res.axis, dist, conf: res.confidence, before });
    this.turnDarts = this.bull.results.map((r) => ({ tip: r.tip, hit: { segment: 25, multiplier: 2 } }));
    this.view.setMarks(this.bull.results.map((r, k) => ({ x: r.tip[0], y: r.tip[1], label: `${this.o.session.match.playerNames[k]}: ${r.dist.toFixed(0)} mm`, color: k ? '#38bdf8' : '#ff3b30' })));
    if (this.bull.results.length < 2) { this.bullPrompt(); return; }
    this.bullDecision();
  }

  bullDecision() {
    const names = this.o.session.match.playerNames;
    const [a, b] = this.bull.results;
    const diff = a && b ? Math.abs(a.dist - b.dist) : 0;
    const sure = a && b && diff >= 4 && a.conf >= 0.6 && b.conf >= 0.6;
    const winner = a && b ? (a.dist <= b.dist ? 0 : 1) : null;
    const choose = (idx) => {
      s.close();
      this.o.onBullOff(idx);
      this.setStatus('ok', 'Darts ziehen – danach geht es los');
      this.bull.decided = true;
    };
    const s = sheet(h('div', { class: 'stack' },
      h('h2', {}, 'Ausbullen'),
      a && b ? h('p', {}, `${names[0]}: ${a.dist.toFixed(0)} mm · ${names[1]}: ${b.dist.toFixed(0)} mm vom Mittelpunkt`) : null,
      sure ? h('p', { style: { fontSize: '22px', fontWeight: 800 } }, `${names[winner]} ist näher dran.`) :
        h('p', { style: { fontSize: '20px', fontWeight: 700, color: 'var(--warn)' } }, 'Zu knapp oder unsicher – bitte selbst auswählen.'),
      h('button', { class: `btn ${sure && winner === 0 ? 'primary' : ''}`, onclick: () => choose(0) }, `${names[0]} beginnt`),
      h('button', { class: `btn ${sure && winner === 1 ? 'primary' : ''}`, onclick: () => choose(1) }, `${names[1]} beginnt`),
      h('button', { class: 'btn ghost', onclick: () => { s.close(); this.bull = { results: [] }; this.turnDarts = []; this.view.setMarks([]); this.bullPrompt(); } }, 'Nochmal ausbullen'),
    ), { dismissable: false });
  }

  checkBullOffCleared(cur) {
    if (!this.bull || !this.bull.decided) return;
    if (this.bull.results.every((r) => this.isEmptyAt(cur, r.tip, r.axis))) this.endBullOff();
  }

  endBullOff() {
    this.phase = 'throwing';
    this.bull = null;
    this.turnClosed();
    const st = this.o.session.state;
    const name = this.o.session.match.playerNames[st.current];
    say(speechText().next(name));
    this.setStatus('ok', `${name} beginnt – Game on!`);
  }

  // ---------- Status und Warnungen ----------
  idleStatus() {
    if (this.lostSince) return;
    if (this.phase === 'bulloff') return;
    if (this.noticeUntil && performance.now() < this.noticeUntil) return;
    const st = this.o.session.state;
    if (this.turnDarts.length && (this.sawOcclusion || (st.openTurnIndex >= 0 && st.turnEval.closed))) this.setStatus('ok', 'Darts ziehen – Board wird überwacht');
    else this.setStatus('ok', 'Bereit');
  }

  setStatus(kind, text) {
    if (this.lastStatus === kind + text) return;
    this.lastStatus = kind + text;
    this.o.statusEl.replaceChildren(h('span', { class: `dot ${kind}` }), text);
  }

  markLost(reason) {
    const now = performance.now();
    if (!this.lostSince) this.lostSince = now;
    this.lostReason = reason;
    this.o.alertEl.textContent = `⚠ ${reason}`;
    this.o.alertEl.classList.remove('hidden');
    this.setStatus('bad', reason);
    if (!this.lostAlerted || now - this.lostAlerted > 10000) {
      this.lostAlerted = now;
      beep('warn');
      say(speechText().cameraLost, { interrupt: false });
    }
  }

  clearLost() {
    if (!this.lostSince) return;
    this.lostSince = null;
    this.lostReason = '';
    this.lostAlerted = 0;
    this.o.alertEl.classList.add('hidden');
    beep('ok');
  }
}

function meanLum(small, mask) {
  let s = 0, n = 0;
  for (let i = 0; i < mask.length; i += 7) if (mask[i]) { s += 0.299 * small.r[i] + 0.587 * small.g[i] + 0.114 * small.b[i]; n++; }
  return n ? s / n : 0;
}

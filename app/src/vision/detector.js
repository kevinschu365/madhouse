// Dart-Erkennung per Bildvergleich (vorher/nachher). Läuft komplett lokal, ohne Modell.
//
// Ablauf:
//  1. Beide Bilder verkleinern, Helligkeit angleichen (Auto-Belichtung der Kamera).
//  2. Farbdifferenz je Pixel, glätten, Schwelle aus dem Bildrauschen ableiten.
//  3. Zusammenhängende Flächen suchen. Sehr viel Veränderung = Hand/Verdeckung, kein Dart.
//  4. Für die größte dartartige Fläche: Achse bestimmen, Spitze = Ende auf der Board-Seite
//     (Richtung aus der Kalibrierung: der Dart ragt zur Kamera hin aus der Scheibe).
//  5. Spitze in voller Auflösung nachschärfen, über die Kalibrierung auf das Board abbilden.
//
// Bilder: { width, height, data: Uint8ClampedArray (RGBA) } – z. B. ImageData.

import { applyH } from './homography.js';
import { hitFromPoint, STANDARD_DIMENSIONS } from '../core/board.js';

export const DEFAULT_PARAMS = {
  procWidth: 640,        // Arbeitsbreite für die Grobsuche
  minThresh: 22,         // minimale Farbdifferenz (0..255)
  noiseFactor: 4,        // Schwelle = max(minThresh, Rauschen * noiseFactor)
  minAreaFrac: 0.00012,  // minimale Fläche eines Darts (Anteil am Bild)
  occlusionFrac: 0.10,   // ab diesem Anteil veränderter Board-Fläche: Hand/Verdeckung
  roiRadius: 1.25,       // Suchbereich in Vielfachen des Doppelrings
  tipBand: 2.5,          // px (Arbeitsauflösung): Bandbreite am Ende der Achse
  refine: false,         // Spitze in voller Auflösung nachschärfen (an Testbildern schlechter -> aus)
  refineWindow: 28,      // Suchlänge über die Grobspitze hinaus (volle Auflösung, px)
  trace: true,           // Dart-Linie vom Flight zur Spitze verfolgen
  lowFactor: 0.7,        // niedrigere Schwelle entlang der Linie (Anteil der Hauptschwelle)
  minThreshLow: 12,
  corridor: 2,           // halbe Breite des Suchkorridors (Arbeitsauflösung, px)
  maxGap: 36,            // überbrückbare Lücke im Schaft (Arbeitsauflösung, px)
  maxLen: 220,           // maximale Dartlänge im Bild (Arbeitsauflösung, px)
  angleRange: 24,        // Winkelsuche ± Grad um die erwartete Richtung
  angleStep: 2,
  refineBack: 6,         // Nachschärfen startet so viele px (Arbeitsauflösung) vor der Grobspitze
  refineGap: 6,          // Lücke beim Nachschärfen (volle Auflösung, px)
  maxCandidates: 4,      // so viele größte Flächen werden geprüft
  refineFactor: 0.55,    // Schwelle beim Nachschärfen (Anteil der Hauptschwelle)
  refineCorridor: 3,     // halbe Korridorbreite beim Nachschärfen (volle Auflösung, px)
  refineAvg: 1,          // 1 = 3x3-Mittel beim Nachschärfen, 0 = Einzelpixel
  tipOffset: 5,          // feste Verschiebung der Spitze Richtung Flight (px bei 1280 Breite)
  selectBy: 0,           // 0 = größte Fläche, >0 = Fläche + Linienlänge (Gewicht)
  maxAreaRel: 0.04,      // größte Dart-Fläche relativ zum Suchbereich (0 = aus); größer = Hand
};

/** Bild auf Arbeitsbreite verkleinern (Box-Mittelung), liefert RGB-Float-Arrays. */
export function downscale(img, procWidth) {
  const f = Math.max(1, Math.round(img.width / procWidth));
  const w = Math.floor(img.width / f), hgt = Math.floor(img.height / f);
  const r = new Float32Array(w * hgt), g = new Float32Array(w * hgt), b = new Float32Array(w * hgt);
  const src = img.data, W = img.width, n = f * f;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let yy = 0; yy < f; yy++) {
        let o = ((y * f + yy) * W + x * f) * 4;
        for (let xx = 0; xx < f; xx++, o += 4) { sr += src[o]; sg += src[o + 1]; sb += src[o + 2]; }
      }
      const i = y * w + x;
      r[i] = sr / n; g[i] = sg / n; b[i] = sb / n;
    }
  }
  return { w, h: hgt, f, r, g, b };
}

/** Maske des Suchbereichs (Board + Rand) in Arbeitsauflösung. */
export function roiMask(cal, w, h, f, radiusMm) {
  const m = new Uint8Array(w * h);
  const Hi = cal.Hinv;
  const r2 = radiusMm * radiusMm;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [bx, by] = applyH(Hi, (x + 0.5) * f, (y + 0.5) * f);
      if (bx * bx + by * by <= r2) m[y * w + x] = 1;
    }
  }
  return m;
}

function gains(a, b, mask) {
  // Verhältnis der Mittelwerte je Kanal im Suchbereich (gegen Belichtungsänderungen)
  let ar = 0, ag = 0, ab = 0, br = 0, bg = 0, bb = 0, n = 0;
  for (let i = 0; i < mask.length; i += 3) {
    if (!mask[i]) continue;
    ar += a.r[i]; ag += a.g[i]; ab += a.b[i]; br += b.r[i]; bg += b.g[i]; bb += b.b[i]; n++;
  }
  if (!n) return [1, 1, 1];
  const clamp = (v) => Math.min(1.3, Math.max(0.77, v));
  return [clamp(br / (ar || 1)), clamp(bg / (ag || 1)), clamp(bb / (ab || 1))];
}

/** Differenzbild (max. Kanaldifferenz), 3x3 geglättet. */
export function diffImage(ref, cur, mask) {
  const [gr, gg, gb] = gains(ref, cur, mask);
  const n = ref.w * ref.h;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dr = Math.abs(cur.r[i] - ref.r[i] * gr);
    const dg = Math.abs(cur.g[i] - ref.g[i] * gg);
    const db = Math.abs(cur.b[i] - ref.b[i] * gb);
    d[i] = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
  }
  return boxBlur3(d, ref.w, ref.h);
}

function boxBlur3(src, w, h) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const a = src[o + (x > 0 ? x - 1 : x)], b = src[o + x], c = src[o + (x < w - 1 ? x + 1 : x)];
      tmp[o + x] = (a + b + c) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w, md = y * w, dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) out[md + x] = (tmp[up + x] + tmp[md + x] + tmp[dn + x]) / 3;
  }
  return out;
}

function threshold(d, mask, params) {
  // Rauschen = Median der Differenz im Suchbereich
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i++) if (mask[i]) { hist[Math.min(255, d[i] | 0)]++; n++; }
  let acc = 0, med = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { med = v; break; } }
  return Math.max(params.minThresh, med * params.noiseFactor);
}

function morphOpen(bin, w, h) {
  const er = new Uint8Array(bin.length), out = new Uint8Array(bin.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    er[i] = bin[i] & bin[i - 1] & bin[i + 1] & bin[i - w] & bin[i + w];
  }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    out[i] = er[i] | er[i - 1] | er[i + 1] | er[i - w] | er[i + w];
  }
  return out;
}

/** Zusammenhängende Flächen (8er-Nachbarschaft). */
function components(bin, w, h, minArea) {
  const label = new Int32Array(bin.length);
  const comps = [];
  const stack = [];
  let next = 1;
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || label[i]) continue;
    const pix = [];
    label[i] = next;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop();
      pix.push(p);
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (bin[q] && !label[q]) { label[q] = next; stack.push(q); }
        }
      }
    }
    if (pix.length >= minArea) comps.push({ id: next, pix });
    next++;
  }
  return comps;
}

/** Achse (Hauptkomponente) und Spitze einer Fläche bestimmen. */
function analyzeComponent(comp, w, f, cal, params) {
  let mx = 0, my = 0;
  const n = comp.pix.length;
  for (const p of comp.pix) { mx += p % w; my += (p / w) | 0; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of comp.pix) {
    const dx = (p % w) - mx, dy = ((p / w) | 0) - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l2 = tr - l1;
  let ax = sxy !== 0 ? l1 - syy : (sxx >= syy ? 1 : 0);
  let ay = sxy !== 0 ? sxy : (sxx >= syy ? 0 : 1);
  const al = Math.hypot(ax, ay) || 1;
  ax /= al; ay /= al;
  const elong = l2 > 0 ? Math.sqrt(l1 / l2) : 99;

  // Erwartete Richtung (Spitze -> Flight) aus der Kalibrierung, am Flächenschwerpunkt
  const [bx, by] = applyH(cal.Hinv, mx * f, my * f);
  const br = Math.hypot(bx, by);
  const lim = 170;
  const cbx = br > lim ? bx * lim / br : bx, cby = br > lim ? by * lim / br : by;
  const [ex, ey] = cal.dir.direction(cbx, cby);
  // Achse zur erwarteten Richtung ausrichten; bei schwacher Länglichkeit Modellrichtung nutzen
  let dx = ax, dy = ay;
  if (dx * ex + dy * ey < 0) { dx = -dx; dy = -dy; }
  if (elong < 2.2) { dx = ex; dy = ey; }

  // Spitze = Pixel mit kleinster Projektion auf die Achse, nahe an der Achse
  let tmin = Infinity;
  const proj = new Float32Array(n), perp = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const p = comp.pix[k];
    const px = (p % w) - mx, py = ((p / w) | 0) - my;
    proj[k] = px * dx + py * dy;
    perp[k] = -px * dy + py * dx;
    if (proj[k] < tmin) tmin = proj[k];
  }
  let sx = 0, sy = 0, c = 0;
  for (let k = 0; k < n; k++) {
    if (proj[k] <= tmin + params.tipBand) {
      const p = comp.pix[k];
      sx += p % w; sy += (p / w) | 0; c++;
    }
  }
  const tip = [(sx / c + 0.5) * f, (sy / c + 0.5) * f];
  return { tip, axis: [dx, dy], expected: [ex, ey], elong, area: n, centroid: [mx * f, my * f], axisAgree: ax * ex + ay * ey };
}

/**
 * Dart-Linie verfolgen: Vom Schwerpunkt der Fläche (meist das Flight) in Richtung Board
 * entlang der Dart-Achse laufen und die letzte veränderte Stelle als Spitze nehmen.
 * Der Schaft ist oft dünn und nur stückweise sichtbar – kleine Lücken werden überbrückt.
 */
function traceDart(d, w, h, f, start, dir, P, Tlow) {
  const [cx, cy] = [start[0] / f, start[1] / f];
  const sample = (x, y) => {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
    return d[yi * w + xi];
  };
  const rayScore = (ux, uy, len) => {
    const nx = -uy, ny = ux;
    let on = 0, lastOn = 0, t = 0;
    for (t = 0; t < len; t += 1) {
      let v = 0;
      for (let s = -P.corridor; s <= P.corridor; s++) {
        const val = sample(cx - ux * t + nx * s, cy - uy * t + ny * s);
        if (val > v) v = val;
      }
      if (v >= Tlow) { on++; lastOn = t; } else if (t - lastOn > P.maxGap) break;
    }
    return { on, lastOn };
  };
  // Richtung in einem Fächer um die erwartete Richtung suchen
  const base = Math.atan2(dir[1], dir[0]);
  let best = { on: -1 };
  const steps = P.angleRange / P.angleStep;
  for (let k = -steps; k <= steps; k++) {
    const a = base + (k * P.angleStep) * Math.PI / 180;
    const ux = Math.cos(a), uy = Math.sin(a);
    const r = rayScore(ux, uy, P.maxLen);
    if (r.on > best.on) best = { ...r, ux, uy };
  }
  const tip = [(cx - best.ux * best.lastOn + 0.5) * f, (cy - best.uy * best.lastOn + 0.5) * f];
  return { tip, axis: [best.ux, best.uy], support: best.on, length: best.lastOn * f };
}

/** Spitze in voller Auflösung nachschärfen: Linie ab kurz vor der Grobspitze weiter verfolgen. */
function refineTrace(refImg, curImg, tip, axis, Tlow, P, back) {
  const W = refImg.width, Hh = refImg.height, a = refImg.data, b = curImg.data;
  const R = P.refineAvg ? 1 : 0, nAvg = (2 * R + 1) ** 2;
  const px = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= Hh - 1) return 0;
    let s = 0;
    for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
      const o = ((yi + yy) * W + xi + xx) * 4;
      const dr = Math.abs(b[o] - a[o]), dg = Math.abs(b[o + 1] - a[o + 1]), db = Math.abs(b[o + 2] - a[o + 2]);
      s += dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
    }
    return s / nAvg;
  };
  const [ux, uy] = axis;
  const nx = -uy, ny = ux;
  const sx = tip[0] + ux * back, sy = tip[1] + uy * back;
  const corr = P.refineCorridor;
  let lastOn = -1;
  for (let t = 0; t < back + P.refineWindow; t++) {
    let v = 0;
    for (let s = -corr; s <= corr; s++) { const val = px(sx - ux * t + nx * s, sy - uy * t + ny * s); if (val > v) v = val; }
    if (v >= Tlow) lastOn = t;
    else if (lastOn >= 0 && t - lastOn > P.refineGap) break;
  }
  if (lastOn < 0) return tip;
  return [sx - ux * lastOn, sy - uy * lastOn];
}

/** Spitze in voller Auflösung nachschärfen (kleines Fenster um die Grobposition). */
function refineTip(refImg, curImg, tip, axis, T, params) {
  const W = refImg.width, Hh = refImg.height;
  const R = params.refineWindow;
  const x0 = Math.max(1, Math.round(tip[0] - R)), x1 = Math.min(W - 2, Math.round(tip[0] + R));
  const y0 = Math.max(1, Math.round(tip[1] - R)), y1 = Math.min(Hh - 2, Math.round(tip[1] + R));
  if (x1 <= x0 || y1 <= y0) return tip;
  const [dx, dy] = axis;
  let tmin = Infinity;
  const pts = [];
  const a = refImg.data, b = curImg.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // 3x3-Mittel der Kanaldifferenz
      let s = 0;
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
        const o = ((y + yy) * W + x + xx) * 4;
        const dr = Math.abs(b[o] - a[o]), dg = Math.abs(b[o + 1] - a[o + 1]), db = Math.abs(b[o + 2] - a[o + 2]);
        s += dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
      }
      if (s / 9 < T) continue;
      const px = x - tip[0], py = y - tip[1];
      const perp = Math.abs(-px * dy + py * dx);
      if (perp > 6) continue; // nur nahe der Dart-Achse
      const t = px * dx + py * dy;
      pts.push([x, y, t]);
      if (t < tmin) tmin = t;
    }
  }
  if (pts.length < 3) return tip;
  let sx = 0, sy = 0, c = 0;
  for (const [x, y, t] of pts) if (t <= tmin + 2) { sx += x; sy += y; c++; }
  return [sx / c + 0.5, sy / c + 0.5];
}

/**
 * Sucht den neu hinzugekommenen Dart.
 * ref/cur: volle Bilder (RGBA). cal: Kalibrierung (H, Hinv, dir) passend zur Bildgröße.
 * Optional: cache = { refSmall, mask } zur Wiederverwendung.
 */
export function detectNewDart(ref, cur, cal, params = DEFAULT_PARAMS, cache = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  const dims = cal.dims || STANDARD_DIMENSIONS;
  const a = cache.refSmall || downscale(ref, P.procWidth);
  const b = downscale(cur, P.procWidth);
  const mask = cache.mask || roiMask(cal, a.w, a.h, a.f, dims.doubleOuter * P.roiRadius);
  const d = diffImage(a, b, mask);
  const T = threshold(d, mask, P);
  let bin = new Uint8Array(d.length);
  let changed = 0, roiN = 0;
  for (let i = 0; i < d.length; i++) {
    if (d[i] >= T) bin[i] = 1;
    if (mask[i]) { roiN++; if (bin[i]) changed++; }
  }
  bin = morphOpen(bin, a.w, a.h);
  const changedFrac = roiN ? changed / roiN : 0;
  const result = { kind: 'none', changedFrac, threshold: T };
  if (changedFrac > P.occlusionFrac) return { ...result, kind: 'occlusion' };

  const minArea = Math.max(6, P.minAreaFrac * a.w * a.h);
  const comps = components(bin, a.w, a.h, minArea);
  const Tlow = Math.max(P.minThreshLow, T * P.lowFactor);
  const maxR = (dims.boardRadius || 225) * 1.05;
  comps.sort((x, y) => y.pix.length - x.pix.length);
  const cands = [];
  for (const c of comps.slice(0, P.maxCandidates)) {
    const an = analyzeComponent(c, a.w, a.f, cal, P);
    if (P.trace) {
      const dir = an.elong >= 2.5 && Math.abs(an.axisAgree) > 0.8 ? an.axis : an.expected;
      const tr = traceDart(d, a.w, a.h, a.f, an.centroid, dir, P, Tlow);
      if (tr.support > 0) { an.tip = tr.tip; an.axis = tr.axis; an.trace = tr; }
    }
    const [bx, by] = applyH(cal.Hinv, an.tip[0], an.tip[1]);
    const r = Math.hypot(bx, by);
    if (r > maxR) continue; // Spitze außerhalb der Scheibe: kein Dart
    cands.push({ ...an, board: [bx, by], r });
  }
  if (!cands.length) return result;
  // Auswahl: größte Fläche, oder (selectBy=1) größte Fläche plus Länge der verfolgten Dart-Linie
  const score = (c) => (P.selectBy ? c.area + P.selectBy * (c.trace ? c.trace.support : 0) * 4 : c.area);
  cands.sort((x, y) => score(y) - score(x));
  const best = cands[0];
  // Viel zu große Fläche für einen Dart (relativ zur Board-Größe im Bild) = Hand/Arm
  const areaRel = roiN ? best.area / roiN : 0;
  if (P.maxAreaRel && areaRel > P.maxAreaRel) return { ...result, kind: 'occlusion', areaRel, area: best.area };
  let tip = best.tip;
  const axis = best.axis;
  if (P.refine) tip = P.trace ? refineTrace(ref, cur, tip, axis, Math.max(Tlow, T * P.refineFactor), P, P.refineBack * a.f) : refineTip(ref, cur, tip, axis, T, P);
  // Feste Korrektur entlang der Achse (Pixel bei 1280 px Bildbreite, skaliert mit der Bildgröße)
  if (P.tipOffset) {
    const k = P.tipOffset * ref.width / 1280;
    tip = [tip[0] + axis[0] * k, tip[1] + axis[1] * k];
  }
  const [bx, by] = applyH(cal.Hinv, tip[0], tip[1]);
  const hit = hitFromPoint(bx, by, dims);
  return {
    ...result,
    kind: 'dart',
    tip,
    coarseTip: best.tip,
    board: [bx, by],
    hit,
    area: best.area,
    areaRel,
    elong: best.elong,
    axis,
    trace: best.trace || null,
    axisAgree: best.axisAgree,
    candidates: cands.length,
    confidence: confidenceOf(best, cands, changedFrac),
  };
}

function confidenceOf(best, cands, changedFrac) {
  // Grobe Einschätzung 0..1 (keine kalibrierte Wahrscheinlichkeit!)
  let c = 1;
  if (best.elong < 2.5) c *= 0.6;
  if (Math.abs(best.axisAgree) < 0.7) c *= 0.7;
  if (cands.length > 1 && cands[1].area > best.area * 0.5) c *= 0.6;
  if (changedFrac > 0.05) c *= 0.7;
  return c;
}

/** Wie stark unterscheidet sich das Bild vom Referenzbild (Anteil veränderter Pixel im Board-Bereich). */
export function changeAmount(refSmall, curSmall, mask, minThresh = 22) {
  const d = diffImage(refSmall, curSmall, mask);
  let n = 0, c = 0;
  for (let i = 0; i < d.length; i++) if (mask[i]) { n++; if (d[i] >= minThresh) c++; }
  return n ? c / n : 0;
}

// Automatische Kalibrierung aus zwei Tipps (Bullseye + irgendwo in die 20).
// 1. Rot/grüne Pixel suchen (Doppel- und Triple-Ring).
// 2. Vom Bull aus Strahlen schicken, der äußerste farbige Punkt je Strahl liegt auf dem Doppelring.
// 3. Ellipse robust einpassen.
// 4. Aus Ellipse + Bull-Position die perspektivische Abbildung berechnen, Drehung aus dem 20er-Tipp.
// 5. Mit dem Kanten-Feinabgleich (refine.js) nachschärfen.

import { multiplyH, invertH, applyH, solveHomography } from './homography.js';
import { refineImagePoints, edgeScoreH } from './refine.js';
import { STANDARD_DIMENSIONS } from '../core/board.js';

const WORK_W = 640;

function ringMask(img) {
  const f = Math.max(1, Math.round(img.width / WORK_W));
  const w = Math.floor(img.width / f), h = Math.floor(img.height / f);
  const m = new Uint8Array(w * h);
  const d = img.data, W = img.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = ((y * f) * W + x * f) * 4;
      const r = d[o], g = d[o + 1], b = d[o + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 45 || mx < 60) continue;
      const red = r > g + 40 && r > b + 30;
      const green = g > r + 25 && g > b + 10;
      if (red || green) m[y * w + x] = 1;
    }
  }
  return { m, w, h, f };
}

/**
 * Außenkante des Doppelrings je Strahl (in Arbeitsauflösung).
 * Entlang jedes Strahls werden die farbigen Abschnitte gesucht: Bull, Triple-Ring, Doppel-Ring,
 * evtl. Deko (grüner Zahlenring, Schilder …). Gewählt wird das erste Paar Triple/Doppel, dessen
 * Abstandsverhältnis zum echten Board passt (Doppel außen 170 mm : Triple außen 107 mm ≈ 1,59).
 */
function rayPoints(mask, bx, by, ratio = 170 / 107) {
  const { m, w, h } = mask;
  const pts = [];
  const maxR = Math.hypot(w, h);
  for (let k = 0; k < 360; k++) {
    const a = k * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    // farbige Abschnitte [Anfang, Ende]; kleine Lücken (Drähte) überbrücken
    const runs = [];
    let start = -1, lastOn = -10;
    for (let r = 1; r < maxR; r += 1) {
      const x = Math.round(bx + ca * r), y = Math.round(by + sa * r);
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (m[y * w + x]) {
        if (start < 0 || r - lastOn > 3) { if (start >= 0) runs.push([start, lastOn]); start = r; }
        lastOn = r;
      }
    }
    if (start >= 0) runs.push([start, lastOn]);
    // Bull-Abschnitt (beginnt direkt am Mittelpunkt) überspringen
    const rings = runs.filter(([s]) => s > 3);
    let found = null;
    for (let i = 0; i < rings.length && !found; i++) {
      for (let j = i + 1; j < rings.length; j++) {
        const q = rings[j][1] / rings[i][1];
        if (q < ratio * 0.85) continue;
        if (q > ratio * 1.2) break;
        // beide Ringe sind schmal (je ca. 8–10 mm bei 107/170 mm Radius)
        const wi = rings[i][1] - rings[i][0], wj = rings[j][1] - rings[j][0];
        if (wi > rings[i][1] * 0.3 || wj > rings[j][1] * 0.25) continue;
        found = rings[j][1];
        break;
      }
    }
    if (found) pts.push([bx + ca * found, by + sa * found]);
  }
  return pts;
}

/** Kegelschnitt a x² + b xy + c y² + d x + e y = 1 (Koordinaten relativ zu (ox, oy)). */
function fitConic(pts, ox, oy, s) {
  const N = Array.from({ length: 5 }, () => new Array(5).fill(0));
  const v = new Array(5).fill(0);
  for (const [px, py] of pts) {
    const x = (px - ox) / s, y = (py - oy) / s;
    const row = [x * x, x * y, y * y, x, y];
    for (let i = 0; i < 5; i++) { v[i] += row[i]; for (let j = 0; j < 5; j++) N[i][j] += row[i] * row[j]; }
  }
  return solve(N, v);
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Ellipse aus Kegelschnitt: Mittelpunkt c und Matrix A (Einheitskreis -> Ellipse), in Pixeln. */
function ellipseFrom(conic, ox, oy, s) {
  if (!conic) return null;
  const [a, b, c, d, e] = conic;
  const det = 4 * a * c - b * b;
  if (det <= 0) return null; // keine Ellipse
  const x0 = (b * e - 2 * c * d) / det, y0 = (b * d - 2 * a * e) / det;
  // Nach Verschiebung in den Mittelpunkt: a u² + b uv + c v² = K
  const K = 1 - (d * x0 + e * y0) / 2;
  if (K <= 0) return null;
  const m11 = a / K, m12 = b / 2 / K, m22 = c / K;
  // Eigenzerlegung 2x2
  const tr = m11 + m22, dt = m11 * m22 - m12 * m12;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - dt));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  if (l1 <= 0 || l2 <= 0) return null;
  let vx = m12, vy = l1 - m11;
  if (Math.abs(vx) + Math.abs(vy) < 1e-12) { vx = 1; vy = 0; }
  const vn = Math.hypot(vx, vy); vx /= vn; vy /= vn;
  // A = R diag(1/sqrt(l1), 1/sqrt(l2)), R = [v, v⊥]
  const s1 = s / Math.sqrt(l1), s2 = s / Math.sqrt(l2);
  const A = [vx * s1, -vy * s2, vy * s1, vx * s2];
  return { cx: ox + x0 * s, cy: oy + y0 * s, A };
}

function robustEllipse(pts, ox, oy) {
  const s = 100;
  let use = pts.slice();
  let el = null;
  for (let it = 0; it < 4; it++) {
    const conic = fitConic(use, ox, oy, s);
    el = ellipseFrom(conic, ox, oy, s);
    if (!el) return null;
    // Abstand jedes Punkts zur Ellipse (im Einheitskreis gemessen)
    const Ai = inv2(el.A);
    const res = pts.map(([x, y]) => {
      const u = Ai[0] * (x - el.cx) + Ai[1] * (y - el.cy), v = Ai[2] * (x - el.cx) + Ai[3] * (y - el.cy);
      return Math.abs(Math.hypot(u, v) - 1);
    });
    const sorted = res.slice().sort((p, q) => p - q);
    const lim = Math.max(0.02, sorted[Math.floor(sorted.length * 0.7)] * 1.5);
    use = pts.filter((_, i) => res[i] <= lim);
    if (use.length < 20) return null;
  }
  return el;
}

function inv2([a, b, c, d]) {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det];
}

/**
 * Homographie Board(mm) -> Bild(px) aus Ellipse des Doppelrings, Bull-Position und 20er-Richtung.
 * flip: Spiegelung des Boards (eine der beiden Varianten ist richtig).
 */
function homographyFromEllipse(el, bull, t20, dims, flip) {
  const Ai = inv2(el.A);
  const toN = ([x, y]) => [Ai[0] * (x - el.cx) + Ai[1] * (y - el.cy), Ai[2] * (x - el.cx) + Ai[3] * (y - el.cy)];
  const p = toN(bull);
  const rho = Math.hypot(p[0], p[1]);
  if (rho >= 0.95) return null;
  const th = Math.atan2(p[1], p[0]);
  const P1 = [Math.cos(-th), -Math.sin(-th), 0, Math.sin(-th), Math.cos(-th), 0, 0, 0, 1];
  // Lorentz-Boost: bildet (rho,0) auf den Mittelpunkt ab und den Einheitskreis auf sich selbst
  const B = [1, 0, -rho, 0, Math.sqrt(1 - rho * rho), 0, -rho, 0, 1];
  const BP = multiplyH(B, P1);
  const tN = toN(t20);
  const td = applyH(BP, tN[0], tN[1]);
  const alpha = Math.atan2(td[1], td[0]);
  const S = flip ? [1, 0, 0, 0, -1, 0, 0, 0, 1] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const beta = Math.atan2(flip ? -1 : 1, 0); // Richtung der 20 (Board (0,1)) nach Spiegelung
  const phi = beta - alpha;
  const R = [Math.cos(phi), -Math.sin(phi), 0, Math.sin(phi), Math.cos(phi), 0, 0, 0, 1];
  const scale = 1 / dims.doubleOuter;
  const Sc = [scale, 0, 0, 0, scale, 0, 0, 0, 1];
  // d = R · B · P1 · q   ->   q = (R B P1)^-1 d,   Bild = c + A q
  const Aff = [el.A[0], el.A[1], el.cx, el.A[2], el.A[3], el.cy, 0, 0, 1];
  let H = multiplyH(Aff, invertH(multiplyH(R, BP)));
  H = multiplyH(H, multiplyH(S, Sc));
  return H.map((v) => v / H[8]);
}

/**
 * Hauptfunktion. img: ImageData (leeres Board), bullTap/twentyTap: Bildpunkte in Pixeln.
 * calBoardPoints: Board-Punkte der Kalibrierung (Bull + 4 Punkte am Doppelring).
 * Liefert { imagePoints, H, score } oder null, wenn es nicht klappt.
 */
/**
 * Bull-Mitte genau bestimmen: In voller Auflösung vom Tipp aus Strahlen schicken, je Strahl das Ende
 * des farbigen Bull-Flecks (rotes Bull + grüner 25er-Ring) suchen und eine Ellipse hineinlegen.
 * Deren Mittelpunkt ist die Bull-Mitte (der Ring ist klein, Perspektive spielt kaum eine Rolle).
 */
function bullCenter(img, tap) {
  const { width: W, height: H, data } = img;
  const colored = (x, y) => {
    const o = (y * W + x) * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 45 || mx < 60) return false;
    return (r > g + 40 && r > b + 30) || (g > r + 25 && g > b + 10);
  };
  let c = tap.slice();
  for (let pass = 0; pass < 2; pass++) {
    const pts = [];
    for (let k = 0; k < 72; k++) {
      const a = k * 5 * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      let inRun = false, end = -1, started = false;
      for (let r = 0; r < 120; r += 0.5) {
        const x = Math.round(c[0] + ca * r), y = Math.round(c[1] + sa * r);
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        const on = colored(x, y);
        if (on) { inRun = true; started = true; end = r; }
        else if (inRun && r - end > 2) break; // Ende des Bull-Flecks (kleine Drahtlücken überbrücken)
        if (!started && r > 30) break;        // Tipp lag weit neben dem Bull
      }
      if (end > 2) pts.push([c[0] + ca * end, c[1] + sa * end]);
    }
    if (pts.length < 30) return tap;
    const el = robustEllipse(pts, c[0], c[1]);
    if (!el || Math.hypot(el.cx - tap[0], el.cy - tap[1]) > 40) return tap;
    c = [el.cx, el.cy];
  }
  return c;
}

export function autoCalibrate(img, bullTapRaw, twentyTap, calBoardPoints, dims = STANDARD_DIMENSIONS) {
  const mask = ringMask(img);
  const f = mask.f;
  const bullTap = bullCenter(img, bullTapRaw);
  const pts = rayPoints(mask, bullTap[0] / f, bullTap[1] / f).map(([x, y]) => [(x + 0.5) * f, (y + 0.5) * f]);
  if (pts.length < 60) return null;
  const el = robustEllipse(pts, bullTap[0], bullTap[1]);
  if (!el) return null;
  let best = null;
  // Das Drahtraster sieht gespiegelt gleich aus, die Kanten können die Spiegelung also nicht
  // unterscheiden. Die Rückkamera spiegelt nicht -> Bild-y nach unten, Board-y nach oben.
  const rot = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  for (const flip of [true]) {
    const H0 = homographyFromEllipse(el, bullTap, twentyTap, dims, flip);
    if (!H0) continue;
    // 1. Grobe Drehung aus dem 20er-Tipp: Tipp genau auf die Mitte der 20 (90°) drehen.
    //    Da der Tipp irgendwo im 20er-Feld liegt, ist die echte Drehung danach höchstens ±9° entfernt.
    const [tbx, tby] = applyH(invertH(H0), twentyTap[0], twentyTap[1]);
    const coarse = Math.atan2(tby, tbx) - Math.PI / 2;
    const H1 = multiplyH(H0, rot(coarse));
    // 2. Feine Drehung: ±9,5° so drehen, dass die Segmentdrähte auf Kanten liegen
    let bestDeg = 0, bestS = -1;
    for (let deg = -9.5; deg <= 9.5; deg += 0.1) {
      const s = edgeScoreH(img, multiplyH(H1, rot(deg * Math.PI / 180)), dims, 'radial', 1);
      if (s > bestS) { bestS = s; bestDeg = deg; }
    }
    // (Keine Farbprobe für die 20: Je nach Board-Modell hat die 20 rote ODER grüne Felder.)
    const H2 = multiplyH(H1, rot(bestDeg * Math.PI / 180));
    const init = calBoardPoints.map(([x, y]) => applyH(H2, x, y));
    // 3. Nur noch minimal nachschieben (die Ellipse sitzt schon; größere Sprünge würden sich
    //    von Deko-Kanten wie grünen Zahlenringen oder Schildern anziehen lassen)
    let r = refineImagePoints(img, calBoardPoints, init, dims, { maxShift: 10, step: 2, iters: 400, blur: 1 });
    r = refineImagePoints(img, calBoardPoints, r.imagePoints, dims, { maxShift: 3, step: 0.7, iters: 300 });
    const score = edgeScoreH(img, solveHomography(calBoardPoints, r.imagePoints), dims);
    if (!best || score > best.score) best = { imagePoints: r.imagePoints, score, flip, initPoints: init };
  }
  if (!best) return null;
  best.H = solveHomography(calBoardPoints, best.imagePoints);
  return best;
}

// Für Tests
export const _internals = { ringMask, rayPoints, robustEllipse, homographyFromEllipse };

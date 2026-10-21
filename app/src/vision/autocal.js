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

/** Äußerster Ring-Pixel je Strahl (in Arbeitsauflösung). */
function rayPoints(mask, bx, by) {
  const { m, w, h } = mask;
  const pts = [];
  const maxR = Math.hypot(w, h);
  for (let k = 0; k < 360; k++) {
    const a = k * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    // Äußerster farbiger Pixel; Ausreißer (rote Logos, Flights …) fängt die robuste Ellipse ab
    let last = -1;
    for (let r = 4; r < maxR; r += 1) {
      const x = Math.round(bx + ca * r), y = Math.round(by + sa * r);
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (m[y * w + x]) last = r;
    }
    if (last > 0) pts.push([bx + ca * last, by + sa * last]);
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
/** Bull-Mitte genauer bestimmen: Schwerpunkt der farbigen Pixel (rotes Bull + grüner 25er-Ring) nahe dem Tipp. */
function refineBull(mask, tap) {
  const { m, w, h, f } = mask;
  const tx = tap[0] / f, ty = tap[1] / f;
  let best = null;
  // Erst grob (großer Radius), dann im kleineren Radius um den neuen Schwerpunkt
  let cx = tx, cy = ty;
  for (const R of [14, 9, 7]) {
    let sx = 0, sy = 0, n = 0;
    for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++) {
      for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) {
        if (m[y * w + x] && (x - cx) ** 2 + (y - cy) ** 2 <= R * R) { sx += x; sy += y; n++; }
      }
    }
    if (n < 6) break;
    cx = sx / n; cy = sy / n;
    best = [(cx + 0.5) * f, (cy + 0.5) * f];
  }
  // Nur übernehmen, wenn es nahe am Tipp bleibt
  if (best && Math.hypot(best[0] - tap[0], best[1] - tap[1]) < 20 * f) return best;
  return tap;
}

export function autoCalibrate(img, bullTapRaw, twentyTap, calBoardPoints, dims = STANDARD_DIMENSIONS) {
  const mask = ringMask(img);
  const f = mask.f;
  const bullTap = refineBull(mask, bullTapRaw);
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
    // Drehung suchen (±12°): die Segmentdrähte müssen auf Kanten liegen. Mehrere gute Lagen als Startpunkte.
    const scores = [];
    for (let deg = -12; deg <= 12; deg += 0.25) scores.push([deg, edgeScoreH(img, multiplyH(H0, rot(deg * Math.PI / 180)), dims, 'radial', 2)]);
    const peaks = scores.filter(([, s], i) => (i === 0 || s >= scores[i - 1][1]) && (i === scores.length - 1 || s >= scores[i + 1][1]))
      .sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [deg] of peaks) {
      const H = multiplyH(H0, rot(deg * Math.PI / 180));
      const init = calBoardPoints.map(([x, y]) => applyH(H, x, y));
      // grob mit weichgezeichneten Kanten (breiter Einzugsbereich), dann fein
      let r = refineImagePoints(img, calBoardPoints, init, dims, { maxShift: 40, step: 6, iters: 500, force: true, blur: 4 });
      r = refineImagePoints(img, calBoardPoints, r.imagePoints, dims, { maxShift: 12, step: 2, iters: 400, force: true, blur: 1 });
      r = refineImagePoints(img, calBoardPoints, r.imagePoints, dims, { maxShift: 4, step: 0.7, iters: 300, force: true });
      const score = edgeScoreH(img, solveHomography(calBoardPoints, r.imagePoints), dims);
      if (!best || score > best.score) best = { imagePoints: r.imagePoints, score, flip, initPoints: init };
    }
  }
  if (!best) return null;
  let H = solveHomography(calBoardPoints, best.imagePoints);
  // Das Drahtraster sieht nach jeder Drehung um 18° gleich aus. Welche Lage stimmt, entscheidet
  // der 20er-Tipp: Er muss im Segment liegen, dessen Mitte bei 90° (oben) liegt.
  const [tbx, tby] = applyH(invertH(H), twentyTap[0], twentyTap[1]);
  const tapAngle = Math.atan2(tby, tbx) * 180 / Math.PI;
  const k = Math.round((tapAngle - 90) / 18);
  if (k !== 0) {
    const a = k * 18 * Math.PI / 180;
    const Rk = [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
    H = multiplyH(H, Rk);
    best.imagePoints = calBoardPoints.map(([x, y]) => applyH(H, x, y));
    H = solveHomography(calBoardPoints, best.imagePoints);
  }
  best.rotatedBy = k * 18;
  best.H = H;
  return best;
}

// Für Tests
export const _internals = { ringMask, rayPoints, robustEllipse, homographyFromEllipse };

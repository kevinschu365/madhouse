// Automatischer Feinabgleich der Kalibrierung:
// Die angetippten Punkte werden leicht verschoben, bis das projizierte Segmentraster
// möglichst genau auf den Kanten des Boards liegt (Ringe und Segmentgrenzen).
// Optimierung mit Nelder-Mead, Bewertung = mittlere Kantenstärke entlang des Rasters.

import { solveHomography, applyH } from './homography.js';
import { STANDARD_DIMENSIONS } from '../core/board.js';

function gradientImage(img) {
  const { width: w, height: h, data } = img;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  // leicht glätten
  const s = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    s[i] = (g[i] * 4 + g[i - 1] + g[i + 1] + g[i - w] + g[i + w]) / 8;
  }
  const m = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = s[i + 1] - s[i - 1], gy = s[i + w] - s[i - w];
    m[i] = Math.sqrt(gx * gx + gy * gy);
  }
  return { w, h, m };
}

function bilinear(G, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 1 || y0 < 1 || x0 >= G.w - 2 || y0 >= G.h - 2) return 0;
  const fx = x - x0, fy = y - y0, i = y0 * G.w + x0, m = G.m;
  return (m[i] * (1 - fx) + m[i + 1] * fx) * (1 - fy) + (m[i + G.w] * (1 - fx) + m[i + G.w + 1] * fx) * fy;
}

/** Abtastpunkte auf dem Raster (Board-mm). */
function samplePoints(dims) {
  const pts = [];
  for (const r of [dims.trebleInner, dims.trebleOuter, dims.doubleInner, dims.doubleOuter]) {
    for (let k = 0; k < 360; k++) {
      const a = (k + 0.5) * Math.PI / 180;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  for (let i = 0; i < 20; i++) {
    const a = (81 - i * 18) * Math.PI / 180;
    for (let r = dims.bullOuter + 8; r < dims.doubleOuter - 1; r += 3) {
      if (Math.abs(r - dims.trebleInner) < 3 || Math.abs(r - dims.trebleOuter) < 3 || Math.abs(r - dims.doubleInner) < 3) continue;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  return pts;
}

function nelderMead(f, x0, step, iters) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; simplex.push(x); }
  let vals = simplex.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]);
    vals = order.map((i) => vals[i]);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const xr = c.map((v, j) => v + (v - worst[j]));
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = c.map((v, j) => v + 2 * (v - worst[j]));
      const fe = f(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
    else {
      const xc = c.map((v, j) => v + 0.5 * (worst[j] - v));
      const fc = f(xc);
      if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); vals[i] = f(simplex[i]); }
      }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (vals[i] < vals[best]) best = i;
  return { x: simplex[best], fx: vals[best] };
}

/**
 * Verfeinert die Bildpunkte einer Kalibrierung.
 * img: ImageData (leeres Board), boardPoints/imagePoints wie bei buildCalibration.
 * Liefert { imagePoints, score0, score1, moved } – score = mittlere Kantenstärke (höher = besser).
 */
export function refineImagePoints(img, boardPoints, imagePoints, dims = STANDARD_DIMENSIONS, { maxShift = 10 } = {}) {
  const G = gradientImage(img);
  const S = samplePoints(dims);
  const x0 = imagePoints.flat();
  const score = (x) => {
    // zu weit verschobene Punkte bestrafen
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - x0[i]) > maxShift) return 1e9;
    let H;
    try { H = solveHomography(boardPoints, pairs(x)); } catch { return 1e9; }
    let s = 0;
    for (const [bx, by] of S) { const [u, v] = applyH(H, bx, by); s += bilinear(G, u, v); }
    return -s / S.length;
  };
  const s0 = -score(x0);
  let res = nelderMead(score, x0, 1.5, 400);
  res = nelderMead(score, res.x, 0.5, 300);
  const s1 = -res.fx;
  const out = pairs(res.x);
  const moved = Math.max(...out.map(([x, y], i) => Math.hypot(x - imagePoints[i][0], y - imagePoints[i][1])));
  // Nur übernehmen, wenn es wirklich besser ist
  if (!(s1 > s0 * 1.02)) return { imagePoints, score0: s0, score1: s0, moved: 0, improved: false };
  return { imagePoints: out, score0: s0, score1: s1, moved, improved: true };
}

function pairs(x) {
  const p = [];
  for (let i = 0; i < x.length; i += 2) p.push([x[i], x[i + 1]]);
  return p;
}

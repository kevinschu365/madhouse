// QR-Code lesen (Kamerabild -> Text), ohne Fremdbibliothek. Gedacht für QR-Codes von einem Bildschirm
// (Turnier beitreten): Byte-Modus, Fehlerkorrektur „M“, Version 1–6 – genau das, was ui/qr.js erzeugt.
// Ablauf: Graustufen -> Schwarz/Weiß mit örtlicher Schwelle -> drei Suchmuster (1:1:3:1:1) finden ->
// Größe schätzen -> Perspektive (Homographie, ab Version 2 mit Ausrichtungsmuster) -> Module abtasten ->
// Format lesen, Maske entfernen -> Reed-Solomon-Korrektur -> Text.

import { BLOCKS, ALIGN, EXP, LOG, mul, maskBit, fixedModules } from '../ui/qr.js';
import { solveHomography, applyH } from './homography.js';

// ---------- Bild vorbereiten ----------

/** ImageData -> Schwarz/Weiß-Raster (1 = dunkel) mit örtlicher Schwelle (gegen ungleichmäßiges Licht). */
function binarize({ data, width: w, height: h }) {
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  // Integralbild für schnelle Mittelwerte
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x];
      integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(7, Math.floor(Math.min(w, h) / 16));
  const bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r); const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r); const x1 = Math.min(w, x + r + 1);
      const sum = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      bin[y * w + x] = lum[y * w + x] < mean * 0.88 ? 1 : 0;
    }
  }
  return { bin, w, h };
}

// ---------- Suchmuster finden ----------

/** Passen fünf Lauflängen zu 1:1:3:1:1? */
function ratioOk(c) {
  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (total < 7) return false;
  const u = total / 7;
  const tol = u * 0.7;
  return Math.abs(c[0] - u) < tol && Math.abs(c[1] - u) < tol && Math.abs(c[2] - 3 * u) < tol * 2.2 && Math.abs(c[3] - u) < tol && Math.abs(c[4] - u) < tol;
}

/** Lauflängen entlang einer Linie um (cx, cy) in Richtung (dx, dy); Mitte muss dunkel sein. Ergebnis: { counts, center } oder null. */
function crossCheck(img, cx, cy, dx, dy, maxRun) {
  const at = (k) => {
    const x = Math.round(cx + dx * k); const y = Math.round(cy + dy * k);
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return -1;
    return img.bin[y * img.w + x];
  };
  if (at(0) !== 1) return null;
  // nach hinten: dunkel (Kern), hell, dunkel
  const back = [0, 0, 0];
  let k = 0;
  for (const [i, color] of [[2, 1], [1, 0], [0, 1]]) {
    while (at(-k) === color && back[i] <= maxRun) { back[i]++; k++; }
    if (!back[i]) return null;
  }
  const fwd = [0, 0, 0];
  k = 1;
  for (const [i, color] of [[0, 1], [1, 0], [2, 1]]) {
    while (at(k) === color && fwd[i] <= maxRun) { fwd[i]++; k++; }
    if (!fwd[i]) return null;
  }
  const counts = [back[0], back[1], back[2] + fwd[0], fwd[1], fwd[2]];
  if (!ratioOk(counts)) return null;
  // Mitte des Kerns
  const center = (fwd[0] - back[2] + 1) / 2;
  return { counts, center };
}

function findFinders(img) {
  const found = [];
  const step = Math.max(1, Math.floor(img.h / 400));
  for (let y = 0; y < img.h; y += step) {
    // Lauflängen der Zeile
    const runs = [];
    let color = img.bin[y * img.w];
    let start = 0;
    for (let x = 1; x <= img.w; x++) {
      const c = x < img.w ? img.bin[y * img.w + x] : -1;
      if (c !== color) { runs.push({ color, start, len: x - start }); color = c; start = x; }
    }
    for (let i = 0; i + 4 < runs.length; i++) {
      if (runs[i].color !== 1) continue;
      const counts = [runs[i].len, runs[i + 1].len, runs[i + 2].len, runs[i + 3].len, runs[i + 4].len];
      if (!ratioOk(counts)) continue;
      const total = counts.reduce((a, b) => a + b, 0);
      let cx = runs[i + 2].start + runs[i + 2].len / 2;
      const v = crossCheck(img, cx, y, 0, 1, total);
      if (!v) continue;
      const cy = y + v.center;
      const hz = crossCheck(img, cx, cy, 1, 0, total);
      if (!hz) continue;
      cx += hz.center;
      const ms = (total + v.counts.reduce((a, b) => a + b, 0) + hz.counts.reduce((a, b) => a + b, 0)) / 21;
      const near = found.find((f) => Math.hypot(f.x - cx, f.y - cy) < ms * 3 && Math.abs(f.ms - ms) < ms * 0.6);
      if (near) {
        near.x = (near.x * near.n + cx) / (near.n + 1);
        near.y = (near.y * near.n + cy) / (near.n + 1);
        near.ms = (near.ms * near.n + ms) / (near.n + 1);
        near.n++;
      } else found.push({ x: cx, y: cy, ms, n: 1 });
    }
  }
  return found.sort((a, b) => b.n - a.n).slice(0, 8);
}

/** Drei Suchmuster als oben links, oben rechts, unten links (Kandidaten nach Güte sortiert). */
function orderedTriples(found) {
  const out = [];
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      for (let k = j + 1; k < found.length; k++) {
        const pts = [found[i], found[j], found[k]];
        const ms = pts.map((p) => p.ms);
        if (Math.max(...ms) > Math.min(...ms) * 1.6) continue;
        // Ecke mit dem rechten Winkel = oben links (gegenüber der längsten Seite)
        const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const sides = [[d(pts[1], pts[2]), 0], [d(pts[0], pts[2]), 1], [d(pts[0], pts[1]), 2]].sort((a, b) => b[0] - a[0]);
        const tl = pts[sides[0][1]];
        let [a, b] = pts.filter((p) => p !== tl);
        // Seiten etwa gleich lang und Winkel etwa 90°
        const la = d(tl, a); const lb = d(tl, b);
        if (Math.max(la, lb) > Math.min(la, lb) * 1.4) continue;
        const cos = ((a.x - tl.x) * (b.x - tl.x) + (a.y - tl.y) * (b.y - tl.y)) / (la * lb);
        if (Math.abs(cos) > 0.35) continue;
        // im Bild (y nach unten): Kreuzprodukt > 0 heißt a = oben rechts, b = unten links
        if ((a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x) < 0) [a, b] = [b, a];
        out.push({ tl, tr: a, bl: b, score: Math.abs(cos) + Math.abs(la - lb) / Math.max(la, lb) - (tl.n + a.n + b.n) / 100 });
      }
    }
  }
  return out.sort((x, y) => x.score - y.score).slice(0, 3);
}

// ---------- Abtasten und Dekodieren ----------

const FORMATS = (() => {
  const list = [];
  for (const ec of [0, 1, 2, 3]) {
    for (let mask = 0; mask < 8; mask++) {
      const data = (ec << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      list.push({ ec, mask, bits: ((data << 10) | rem) ^ 0x5412 });
    }
  }
  return list;
})();

function readFormat(get, size) {
  const read = (cells) => cells.reduce((a, [r, c], i) => a | ((get(r, c) ? 1 : 0) << i), 0);
  const c1 = [];
  for (let i = 0; i <= 5; i++) c1.push([i, 8]);
  c1.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i < 15; i++) c1.push([8, 14 - i]);
  const c2 = [];
  for (let i = 0; i < 8; i++) c2.push([8, size - 1 - i]);
  for (let i = 8; i < 15; i++) c2.push([size - 15 + i, 8]);
  let best = null;
  for (const bits of [read(c1), read(c2)]) {
    for (const f of FORMATS) {
      let x = bits ^ f.bits; let dist = 0;
      while (x) { dist += x & 1; x >>>= 1; }
      if (!best || dist < best.dist) best = { ...f, dist };
    }
  }
  return best && best.dist <= 3 ? best : null;
}

// Reed-Solomon (Polynome mit niedrigstem Grad zuerst), Nullstellen α^0 … α^(n-1) wie beim Erzeugen
function evalLE(poly, x) {
  let y = 0;
  for (let i = poly.length - 1; i >= 0; i--) y = mul(y, x) ^ poly[i];
  return y;
}
const div = (a, b) => (a ? EXP[(LOG[a] - LOG[b] + 255) % 255] : 0);

/** Codewörter eines Blocks (Daten + Prüfwerte) korrigieren; true, wenn danach fehlerfrei. */
function rsCorrect(cw, n) {
  const len = cw.length;
  const syn = [];
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let p = 0; p < len; p++) acc = mul(acc, EXP[i]) ^ cw[p];
    syn.push(acc);
  }
  if (syn.every((s) => s === 0)) return true;
  // Berlekamp-Massey: Fehlerortungs-Polynom
  let C = [1]; let B = [1]; let L = 0; let m = 1; let b = 1;
  for (let k = 0; k < n; k++) {
    let d = syn[k];
    for (let i = 1; i <= L; i++) d ^= mul(C[i] || 0, syn[k - i]);
    if (d === 0) { m++; continue; }
    const coef = div(d, b);
    const T = C.slice();
    const need = B.length + m;
    while (C.length < need) C.push(0);
    for (let i = 0; i < B.length; i++) C[i + m] ^= mul(coef, B[i]);
    if (2 * L <= k) { L = k + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  if (L * 2 > n) return false;
  // Fehlerstellen suchen (Chien)
  const positions = [];
  for (let p = 0; p < len; p++) {
    const e = len - 1 - p;
    if (evalLE(C, EXP[(255 - e) % 255]) === 0) positions.push(p);
  }
  if (positions.length !== L) return false;
  // Fehlerwerte (Forney)
  const omega = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < C.length && j <= i; j++) omega[i] ^= mul(syn[i - j], C[j]);
  const deriv = C.map((c, i) => (i % 2 ? c : 0)).slice(1);
  for (const p of positions) {
    const e = len - 1 - p;
    const xinv = EXP[(255 - e) % 255];
    const den = evalLE(deriv, xinv);
    if (!den) return false;
    cw[p] ^= mul(EXP[e], div(evalLE(omega, xinv), den));
  }
  // nochmal prüfen
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let q = 0; q < len; q++) acc = mul(acc, EXP[i]) ^ cw[q];
    if (acc) return false;
  }
  return true;
}

/** Aus abgetasteten Modulen (get(r, c) -> dunkel?) den Text lesen; null, wenn es nicht passt. */
export function decodeModules(get, version) {
  const size = 17 + 4 * version;
  const fmt = readFormat(get, size);
  if (!fmt || fmt.ec !== 0) return null; // nur Stufe M (Bits 00)
  const fixed = fixedModules(version);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (fixed[r][c]) continue;
        bits.push((get(r, c) ? 1 : 0) ^ (maskBit(fmt.mask, r, c) ? 1 : 0));
      }
    }
  }
  const [ecn, blocks, per] = BLOCKS[version];
  const total = blocks * (per + ecn);
  const words = [];
  for (let i = 0; i < total; i++) words.push(bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  // Verschränkung auflösen
  const blk = Array.from({ length: blocks }, () => []);
  let k = 0;
  for (let i = 0; i < per; i++) for (let b = 0; b < blocks; b++) blk[b].push(words[k++]);
  for (let i = 0; i < ecn; i++) for (let b = 0; b < blocks; b++) blk[b].push(words[k++]);
  const data = [];
  for (const cw of blk) {
    if (!rsCorrect(cw, ecn)) return null;
    data.push(...cw.slice(0, per));
  }
  // Byte-Modus lesen
  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  const take = (pos, n) => stream.slice(pos, pos + n).reduce((a, b) => (a << 1) | b, 0);
  if (take(0, 4) !== 0b0100) return null;
  const count = take(4, 8);
  const bytes = [];
  for (let i = 0; i < count; i++) bytes.push(take(12 + i * 8, 8));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch { return null; }
}

/** Im Bild nach dem Ausrichtungsmuster suchen (Version 2+): beste Übereinstimmung mit dem 5×5-Muster nahe der Schätzung. */
function refineAlignment(img, H, ax, ay) {
  const [ex, ey] = applyH(H, ax, ay);
  const [ux, uy] = applyH(H, ax + 1, ay);
  const ms = Math.hypot(ux - ex, uy - ey);
  const px = (x, y) => {
    const ix = Math.round(x); const iy = Math.round(y);
    return ix >= 0 && iy >= 0 && ix < img.w && iy < img.h ? img.bin[iy * img.w + ix] : 0;
  };
  let best = null;
  const range = ms * 3;
  const stepPx = Math.max(1, ms / 3);
  for (let dy = -range; dy <= range; dy += stepPx) {
    for (let dx = -range; dx <= range; dx += stepPx) {
      let score = 0;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const want = Math.max(Math.abs(r), Math.abs(c)) !== 1 ? 1 : 0;
          const [sx, sy] = applyH(H, ax + c, ay + r);
          if (px(sx + dx, sy + dy) === want) score++;
        }
      }
      if (!best || score > best.score) best = { score, x: ex + dx, y: ey + dy };
    }
  }
  return best && best.score >= 21 ? best : null;
}

function sampleAndDecode(img, tri, version) {
  const size = 17 + 4 * version;
  const src = [[3.5, 3.5], [size - 3.5, 3.5], [3.5, size - 3.5]];
  const dst = [[tri.tl.x, tri.tl.y], [tri.tr.x, tri.tr.y], [tri.bl.x, tri.bl.y]];
  // vierter Punkt: zunächst als Parallelogramm geschätzt
  src.push([size - 3.5, size - 3.5]);
  dst.push([tri.tr.x + tri.bl.x - tri.tl.x, tri.tr.y + tri.bl.y - tri.tl.y]);
  let H = solveHomography(src, dst);
  if (version >= 2) {
    const a = ALIGN[version][1] + 0.5;
    const hit = refineAlignment(img, H, a, a);
    if (hit) H = solveHomography([...src.slice(0, 3), [a, a]], [...dst.slice(0, 3), [hit.x, hit.y]]);
  }
  const get = (r, c) => {
    const [x, y] = applyH(H, c + 0.5, r + 0.5);
    const ix = Math.round(x); const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= img.w || iy >= img.h) return false;
    return img.bin[iy * img.w + ix] === 1;
  };
  return decodeModules(get, version);
}

/** Text aus einem Kamerabild (ImageData) oder null. */
export function readQR(imageData) {
  const img = binarize(imageData);
  const found = findFinders(img);
  if (found.length < 3) return null;
  for (const tri of orderedTriples(found)) {
    const ms = (tri.tl.ms + tri.tr.ms + tri.bl.ms) / 3;
    const dim = (Math.hypot(tri.tr.x - tri.tl.x, tri.tr.y - tri.tl.y) + Math.hypot(tri.bl.x - tri.tl.x, tri.bl.y - tri.tl.y)) / 2 / ms + 7;
    const v0 = Math.round((dim - 17) / 4);
    for (const v of [v0, v0 - 1, v0 + 1]) {
      if (v < 1 || v > 6) continue;
      const text = sampleAndDecode(img, tri, v);
      if (text) return text;
    }
  }
  return null;
}

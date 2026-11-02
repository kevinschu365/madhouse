// Homographie (perspektivische Abbildung Ebene -> Bild) mit Normalisierung (DLT, kleinste Quadrate).
// H als Array mit 9 Einträgen, zeilenweise.

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function invertH(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((v) => v / det);
}

export function multiplyH(A, B) {
  const R = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) R[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return R;
}

function normalization(pts) {
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  let d = 0;
  for (const [x, y] of pts) d += Math.hypot(x - mx, y - my);
  d /= pts.length;
  const s = d > 0 ? Math.SQRT2 / d : 1;
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

/** Löst H mit src -> dst (mind. 4 Punktpaare), h33 = 1, Normalgleichungen. */
export function solveHomography(src, dst) {
  if (src.length < 4 || src.length !== dst.length) throw new Error('Mindestens 4 Punktpaare nötig');
  const Ts = normalization(src);
  const Td = normalization(dst);
  const s = src.map(([x, y]) => applyH(Ts, x, y));
  const d = dst.map(([x, y]) => applyH(Td, x, y));
  // 8 Unbekannte, Normalgleichungen A^T A h = A^T b
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const addRow = (row, b) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * b;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k < s.length; k++) {
    const [x, y] = s[k];
    const [u, v] = d[k];
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solveLinear(AtA, Atb);
  const Hn = [...h, 1];
  // H = Td^-1 * Hn * Ts
  const Hf = multiplyH(multiplyH(invertH(Td), Hn), Ts);
  return Hf.map((v) => v / Hf[8]);
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('Punkte liegen ungünstig (z. B. auf einer Linie)');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Schätzt aus H (Board-mm -> Bild-Pixel) die Bildrichtung, in die ein Dart aus der Scheibe ragt.
 * Annahme: Bildmitte = optische Achse, quadratische Pixel. Brennweite wird aus H geschätzt.
 * Liefert eine Funktion (bx, by) -> [dx, dy] (Einheitsvektor im Bild, vom Einstich zum Flight).
 */
export function dartDirectionModel(H, width, height, fallbackFocal) {
  const cx = width / 2, cy = height / 2;
  // H relativ zur Bildmitte
  const T = [1, 0, -cx, 0, 1, -cy, 0, 0, 1];
  const Hc = multiplyH(T, H);
  const h1 = [Hc[0], Hc[3], Hc[6]];
  const h2 = [Hc[1], Hc[4], Hc[7]];
  let f2 = [];
  const den1 = h1[2] * h2[2];
  if (Math.abs(den1) > 1e-12) f2.push(-(h1[0] * h2[0] + h1[1] * h2[1]) / den1);
  const den2 = h2[2] * h2[2] - h1[2] * h1[2];
  if (Math.abs(den2) > 1e-12) f2.push((h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2) / den2);
  f2 = f2.filter((v) => v > 0 && Number.isFinite(v));
  let f = f2.length ? Math.sqrt(f2.reduce((a, b) => a + b, 0) / f2.length) : 0;
  const fb = fallbackFocal || 0.8 * Math.max(width, height);
  if (!(f > 0.3 * fb && f < 3 * fb)) f = fb;
  const r1 = [h1[0] / f, h1[1] / f, h1[2]];
  const r2 = [h2[0] / f, h2[1] / f, h2[2]];
  const n1 = Math.hypot(...r1), n2 = Math.hypot(...r2);
  const lam = 2 / (n1 + n2);
  const R1 = r1.map((v) => v * lam), R2 = r2.map((v) => v * lam);
  let r3 = [R1[1] * R2[2] - R1[2] * R2[1], R1[2] * R2[0] - R1[0] * R2[2], R1[0] * R2[1] - R1[1] * R2[0]];
  const t = [Hc[2] / f * lam, Hc[5] / f * lam, Hc[8] * lam];
  // Board-Mitte muss vor der Kamera liegen
  const sgn = t[2] < 0 ? -1 : 1;
  const Rs1 = R1.map((v) => v * sgn), Rs2 = R2.map((v) => v * sgn), ts = t.map((v) => v * sgn);
  r3 = [Rs1[1] * Rs2[2] - Rs1[2] * Rs2[1], Rs1[2] * Rs2[0] - Rs1[0] * Rs2[2], Rs1[0] * Rs2[1] - Rs1[1] * Rs2[0]];
  // Normale zur Kamera hin: n · (0 - P) > 0 für P = Board-Mitte (t)
  if (r3[0] * -ts[0] + r3[1] * -ts[1] + r3[2] * -ts[2] < 0) r3 = r3.map((v) => -v);
  const project = (X) => [f * X[0] / X[2] + cx, f * X[1] / X[2] + cy];
  // Kamerastellung (Schätzung): Abstand Bull–Kamera in mm und Blickwinkel zur Board-Senkrechten
  const dist = Math.hypot(ts[0], ts[1], ts[2]);
  const cosA = Math.abs(r3[0] * -ts[0] + r3[1] * -ts[1] + r3[2] * -ts[2]) / (dist || 1) / (Math.hypot(...r3) || 1);
  return {
    focal: f,
    distanceMm: dist,
    viewAngleDeg: Math.acos(Math.min(1, cosA)) * 180 / Math.PI,
    direction(bx, by, len = 40) {
      const P = [Rs1[0] * bx + Rs2[0] * by + ts[0], Rs1[1] * bx + Rs2[1] * by + ts[1], Rs1[2] * bx + Rs2[2] * by + ts[2]];
      const Q = [P[0] + r3[0] * len, P[1] + r3[1] * len, P[2] + r3[2] * len];
      const a = project(P), b = project(Q);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const n = Math.hypot(dx, dy) || 1;
      return [dx / n, dy / n];
    },
  };
}

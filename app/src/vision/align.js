// Schätzt eine kleine Verschiebung zwischen dem Referenzbild der Kalibrierung und dem
// aktuellen Kamerabild (nur Verschiebung, keine Drehung/Zoom). Für „Automatisch nachführen“.

const WORK_W = 240;

function loadDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function toGradient(source, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const m = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    m[i] = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
  }
  return m;
}

/** snapshotUrl: JPEG-Data-URL; current: ImageData. Liefert { dx, dy } in Pixeln von current oder null. */
export async function estimateShift(snapshotUrl, current) {
  if (!snapshotUrl || !current) return null;
  const img = await loadDataUrl(snapshotUrl);
  const w = WORK_W, h = Math.round(WORK_W * current.height / current.width);
  const a = toGradient(img, w, h);
  const cc = document.createElement('canvas');
  cc.width = current.width; cc.height = current.height;
  cc.getContext('2d').putImageData(current, 0, 0);
  const b = toGradient(cc, w, h);
  const R = 24;
  let best = { score: Infinity, dx: 0, dy: 0 };
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let s = 0, n = 0;
      for (let y = R; y < h - R; y += 2) {
        for (let x = R; x < w - R; x += 2) {
          s += Math.abs(a[y * w + x] - b[(y + dy) * w + x + dx]);
          n++;
        }
      }
      s /= n;
      if (s < best.score) best = { score: s, dx, dy };
    }
  }
  if (Math.abs(best.dx) === R || Math.abs(best.dy) === R) return null; // am Rand: unzuverlässig
  const f = current.width / w;
  return { dx: best.dx * f, dy: best.dy * f, score: best.score };
}

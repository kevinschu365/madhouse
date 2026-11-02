// QR-Code als SVG, ohne Fremdbibliothek. Byte-Modus, Fehlerkorrektur „M“ (ca. 15 %), Version 1–6
// (bis 106 Zeichen) – reicht für Adressen wie http://192.168.178.69:8130/app/?board=2.
// Aufbau nach ISO/IEC 18004: Daten + Reed-Solomon-Prüfwerte, feste Muster, Maske mit der kleinsten Strafwertung.

// Je Version: [Prüfwerte je Block, Blöcke, Datenwerte je Block] für Stufe M
const BLOCKS = { 1: [10, 1, 16], 2: [16, 1, 28], 3: [26, 1, 44], 4: [18, 2, 32], 5: [24, 2, 43], 6: [16, 4, 27] };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

// ---------- Rechnen im Galois-Feld GF(256) ----------
const EXP = new Array(512);
const LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Generator-Polynom für n Prüfwerte, höchster Grad zuerst (führende 1). */
function generator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** Reed-Solomon-Prüfwerte zu einem Datenblock. */
function eccFor(data, n) {
  const g = generator(n);
  const rest = new Array(n).fill(0);
  for (const d of data) {
    const factor = d ^ rest.shift();
    rest.push(0);
    for (let i = 0; i < n; i++) rest[i] ^= mul(g[i + 1], factor);
  }
  return rest;
}

// ---------- Daten zu Codewörtern ----------
function codewords(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  while (version <= 6) {
    const [, blocks, per] = BLOCKS[version];
    if (4 + 8 + bytes.length * 8 <= blocks * per * 8) break;
    version++;
  }
  if (version > 6) throw new Error('Text zu lang für den QR-Code');
  const [ecn, blocks, per] = BLOCKS[version];
  const cap = blocks * per;
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);              // Byte-Modus
  put(bytes.length, 8);        // Länge (Version 1–9: 8 Bit)
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length)); // Abschluss
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);
  // In Blöcke teilen, Prüfwerte anhängen, dann verschränken
  const dataBlocks = [];
  const eccBlocks = [];
  for (let b = 0; b < blocks; b++) {
    const part = data.slice(b * per, (b + 1) * per);
    dataBlocks.push(part);
    eccBlocks.push(eccFor(part, ecn));
  }
  const out = [];
  for (let i = 0; i < per; i++) for (const blk of dataBlocks) out.push(blk[i]);
  for (let i = 0; i < ecn; i++) for (const blk of eccBlocks) out.push(blk[i]);
  return { version, words: out };
}

// ---------- Matrix aufbauen ----------
function buildMatrix(version, words, mask) {
  const size = 17 + 4 * version;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, dark) => { m[r][c] = dark; fixed[r][c] = true; };

  // Suchmuster mit Trennrand in drei Ecken
  const finder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr; const c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        set(r, c, ring !== 2 && ring !== 4);
      }
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  // Taktlinien
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Ausrichtungsmuster
  const pos = ALIGN[version];
  for (const r of pos) {
    for (const c of pos) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  // Format-Bereiche reservieren (werden unten beschrieben) und das feste dunkle Modul
  for (let i = 0; i < 9; i++) { fixed[8][i] = true; fixed[i][8] = true; }
  for (let i = 0; i < 8; i++) { fixed[8][size - 1 - i] = true; fixed[size - 1 - i][8] = true; }
  set(size - 8, 8, true);

  // Daten im Zickzack von unten rechts eintragen, Spalte 6 (Taktlinie) überspringen
  let bit = 0;
  const total = words.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (fixed[r][c]) continue;
        let dark = false;
        if (bit < total) dark = ((words[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
        if (maskBit(mask, r, c)) dark = !dark;
        m[r][c] = dark;
      }
    }
  }

  // Format-Information: Stufe M (00) + Maske, BCH-geschützt, zweimal eingetragen
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fmt = ((data << 10) | rem) ^ 0x5412;
  const fb = (i) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) m[i][8] = fb(i);
  m[7][8] = fb(6); m[8][8] = fb(7); m[8][7] = fb(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = fb(i);
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = fb(i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = fb(i);
  m[size - 8][8] = true;
  return m;
}

function maskBit(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

/** Strafwertung einer fertigen Matrix (kleiner = besser lesbar). */
function penalty(m) {
  const size = m.length;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) { lines.push(m[i]); lines.push(m.map((row) => row[i])); }
  for (const line of lines) {
    // Regel 1: fünf oder mehr gleiche in Folge
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    // Regel 3: Muster, die wie ein Suchmuster aussehen
    const s = line.map((x) => (x ? '1' : '0')).join('');
    for (const pat of ['10111010000', '00001011101']) {
      let k = s.indexOf(pat);
      while (k >= 0) { score += 40; k = s.indexOf(pat, k + 1); }
    }
  }
  // Regel 2: 2×2-Felder gleicher Farbe
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  // Regel 4: Verhältnis hell/dunkel
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  const k = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

/** QR-Code als Matrix (true = dunkel). */
export function qrMatrix(text) {
  const { version, words } = codewords(text);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = buildMatrix(version, words, mask);
    const p = penalty(m);
    if (!best || p < best.p) best = { m, p };
  }
  return best.m;
}

/** QR-Code als SVG-Text (mit Ruhezone), size = Kantenlänge in Pixeln. */
export function qrSvg(text, size = 160) {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let path = '';
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) path += `M${c + 4} ${r + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

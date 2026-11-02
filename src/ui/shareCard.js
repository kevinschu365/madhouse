// Rückblick als Bild zum Teilen (z. B. in die WhatsApp-Gruppe): einfache Karte per Canvas.
import { BRAND } from '../config.js';

/**
 * Karte zeichnen und teilen. sections: [{ title, lines: [String] }].
 * Auf dem iPhone öffnet sich das Teilen-Menü, sonst wird das Bild heruntergeladen.
 */
export async function shareCard(title, subtitle, sections, filename = 'madhouse-rueckblick.png') {
  const W = 1080;
  const lineH = 46;
  const height = 260 + sections.reduce((a, s) => a + 90 + s.lines.length * lineH, 0) + 80;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Math.max(1080, height);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#101a12');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, c.height);
  const font = (size, weight = 400) => `${weight} ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = '#22c55e';
  ctx.font = font(36, 800);
  ctx.fillText(BRAND.name.toUpperCase(), 70, 100);
  ctx.fillStyle = '#fff';
  ctx.font = font(64, 900);
  ctx.fillText(title, 70, 180);
  ctx.fillStyle = '#9ca3af';
  ctx.font = font(32);
  ctx.fillText(subtitle, 70, 228);
  let y = 320;
  for (const s of sections) {
    ctx.fillStyle = '#1a1a1a';
    roundRect(ctx, 50, y - 56, W - 100, 70 + s.lines.length * lineH, 28);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = font(40, 800);
    ctx.fillText(s.title, 80, y);
    ctx.font = font(32);
    ctx.fillStyle = '#e5e7eb';
    s.lines.forEach((l, i) => ctx.fillText(l, 80, y + 52 + i * lineH, W - 160));
    y += 90 + s.lines.length * lineH;
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], filename, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return 'shared'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'aborted'; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

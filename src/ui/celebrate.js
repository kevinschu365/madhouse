// Feier-Momente: Konfetti, Einblendung bei neuem Meilenstein, Vollbild bei neuem Rang.
import { h } from './dom.js';

const COLORS = ['#f5c542', '#22c55e', '#4f9de0', '#ff7ad9', '#ef4444', '#ffffff'];

/** Konfetti über den ganzen Bildschirm (ms Dauer). */
export function confetti(ms = 2200, count = 120) {
  const canvas = h('canvas', { class: 'confetti' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = (canvas.width = innerWidth * dpr);
  const H = (canvas.height = innerHeight * dpr);
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * W, y: -Math.random() * H * 0.4, vx: (Math.random() - 0.5) * 4 * dpr, vy: (2 + Math.random() * 4) * dpr,
    r: (4 + Math.random() * 5) * dpr, a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3, c: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  const t0 = performance.now();
  const step = (t) => {
    const k = (t - t0) / ms;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.7) / 0.3);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06 * dpr; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (k < 1) requestAnimationFrame(step); else canvas.remove();
  };
  requestAnimationFrame(step);
  setTimeout(() => canvas.remove(), ms + 500); // falls requestAnimationFrame pausiert
}

// Einblendungen nacheinander zeigen, nicht übereinander
const queue = [];
let showing = false;
function next() {
  if (showing || !queue.length) return;
  showing = true;
  const { el, ms } = queue.shift();
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('in'), 30);
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => { el.remove(); showing = false; next(); }, 300); }, ms);
}

/** Kleine Einblendung oben: „🎖️ Neuer Meilenstein – 🛏️ Erste 26 (+2 Punkte)“. */
export function milestoneToast(m, who = '') {
  const el = h('div', { class: 'mstoast' },
    h('div', { class: 'mstoasticon' }, m.icon),
    h('div', {},
      h('div', { class: 'mstoasthead' }, `🎖️ ${who ? `${who}: ` : ''}Neuer Meilenstein`),
      h('div', { class: 'mstoasttitle' }, m.title),
      m.pts ? h('div', { class: 'mstoastpts' }, `+${m.pts} Punkte`) : null));
  queue.push({ el, ms: 2600 });
  confetti(1400, 50);
  next();
}

/** Vollbild bei neuem Rang. Antippen schließt. */
export function rankUpScreen(rank, who = '', sub = '') {
  return new Promise((resolve) => {
    const close = () => { el.remove(); resolve(); };
    const el = h('div', { class: 'rankup-full', onclick: close },
      h('div', { class: 'rankup-inner' },
        h('div', { class: 'dim' }, who ? `${who} steigt auf!` : 'Neuer Rang!'),
        h('div', { class: 'badge big', style: `--rc: ${rank.color}` }, rank.icon),
        h('div', { class: 'rankup-title' }, rank.title),
        sub ? h('div', { class: 'dim', style: { marginTop: '6px' } }, sub) : null,
        h('div', { class: 'dim', style: { marginTop: '18px', fontSize: '13px' } }, 'Tippen zum Weiterspielen')));
    document.body.appendChild(el);
    confetti(3200, 180);
    setTimeout(close, 6000);
  });
}

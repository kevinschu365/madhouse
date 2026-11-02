// Kleines Liniendiagramm (SVG, ohne Fremdbibliothek) für den Verlauf in der Statistik.
// Eine Linie je Diagramm (eine Kennzahl, eine Achse). Ein Tipp auf einen Punkt zeigt Datum und Wert;
// ein zweiter Tipp auf denselben Punkt ruft onOpen auf (z. B. Match-Details).
import { h } from './dom.js';

const W = 340;
const H = 150;
const PAD = { l: 34, r: 12, t: 12, b: 22 };

/** „Schöne“ Achsenschritte (1, 2, 5 × 10^n). */
function niceStep(range, ticks) {
  const raw = range / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * points: [{ y, at, label?, data? }] in zeitlicher Reihenfolge.
 * opts: { title, format(y) -> Text, onOpen(point), min, max } (min/max: feste Achse, z. B. 0–100 %)
 */
export function lineChart(points, { title, format = (y) => y.toFixed(1), onOpen, min, max } = {}) {
  const wrap = h('div', { class: 'chart' }, h('div', { class: 'charttitle' }, title));
  if (points.length < 2) {
    wrap.appendChild(h('div', { class: 'dim', style: { fontSize: '13px', padding: '6px 0' } }, 'Ab 2 Spielen gibt es hier einen Verlauf.'));
    return wrap;
  }
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  if (min != null) lo = min;
  if (max != null) hi = max;
  const step = niceStep(hi - lo, 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const x = (i) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const n = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chartsvg', role: 'img', 'aria-label': title });
  // Raster und y-Achse (zurückhaltend)
  for (let v = lo; v <= hi + step / 2; v += step) {
    svg.appendChild(el('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: 'grid' }));
    svg.appendChild(el('text', { x: PAD.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, format(v).replace(/\.0+$/, '')));
  }
  // x-Achse: erstes und letztes Datum
  const d = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  svg.appendChild(el('text', { x: PAD.l, y: H - 4, class: 'axis' }, d(points[0].at)));
  svg.appendChild(el('text', { x: W - PAD.r, y: H - 4, class: 'axis', 'text-anchor': 'end' }, d(points[points.length - 1].at)));
  // Linie
  svg.appendChild(el('polyline', { points: points.map((p, i) => `${x(i)},${y(p.y)}`).join(' '), class: 'line' }));
  // Punkte mit großer Tippfläche
  const tip = h('div', { class: 'charttip hidden' });
  let active = -1;
  points.forEach((p, i) => {
    const g = el('g', { class: 'pt' });
    g.appendChild(el('circle', { cx: x(i), cy: y(p.y), r: 14, class: 'hit' }));
    g.appendChild(el('circle', { cx: x(i), cy: y(p.y), r: 4, class: 'dot' }));
    g.addEventListener('click', () => {
      if (active === i && onOpen) { onOpen(p); return; }
      active = i;
      svg.querySelectorAll('.dot.on').forEach((c) => c.classList.remove('on'));
      g.querySelector('.dot').classList.add('on');
      tip.replaceChildren(h('b', {}, format(p.y)), ` · ${new Date(p.at).toLocaleDateString('de-DE')}`, p.label ? h('div', {}, p.label) : null, onOpen ? h('div', { class: 'dim' }, 'Nochmal tippen: Details') : null);
      tip.classList.remove('hidden');
      tip.style.left = `${(x(i) / W) * 100}%`;
      tip.style.top = `${(y(p.y) / H) * 100}%`;
      tip.classList.toggle('right', x(i) > W * 0.6);
      tip.classList.toggle('left', x(i) < W * 0.3);
    });
    svg.appendChild(g);
  });
  // Letzter Wert direkt beschriftet
  const last = points[points.length - 1];
  svg.appendChild(el('text', { x: x(points.length - 1) - 6, y: y(last.y) - 8, class: 'lastlabel', 'text-anchor': 'end' }, format(last.y)));
  wrap.appendChild(h('div', { class: 'chartbox' }, svg, tip));
  return wrap;
}

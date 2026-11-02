// Dartscheibe als SVG zum Antippen (Eingabe/Korrektur) und als Raster-Overlay.
import { SEGMENT_ORDER, STANDARD_DIMENSIONS as D, hitFromPoint } from '../core/board.js';

const C = { black: '#161616', cream: '#e9dfc4', red: '#d0352b', green: '#16a34a' };

function arc(r1, r2, a0, a1) {
  // Winkel in Grad (mathematisch), SVG-y nach unten -> y negieren
  const p = (r, a) => [r * Math.cos(a * Math.PI / 180), -r * Math.sin(a * Math.PI / 180)];
  const [x1, y1] = p(r2, a0), [x2, y2] = p(r2, a1), [x3, y3] = p(r1, a1), [x4, y4] = p(r1, a0);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r2},${r2} 0 0 0 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${r1},${r1} 0 0 1 ${x4.toFixed(2)},${y4.toFixed(2)} Z`;
}

/** Vollständige Scheibe als SVG-String (viewBox in mm). */
export function boardSvg({ numbers = true, highlight = [] } = {}) {
  const parts = [];
  const R = 225;
  parts.push(`<circle r="${R}" fill="#000"/>`);
  parts.push(`<circle r="${D.doubleOuter + 2}" fill="#000" stroke="#444" stroke-width="1"/>`);
  SEGMENT_ORDER.forEach((seg, i) => {
    const center = 90 - i * 18;
    const a0 = center + 9, a1 = center - 9;
    const even = i % 2 === 0;
    const single = even ? C.black : C.cream;
    const ring = even ? C.red : C.green;
    parts.push(`<path d="${arc(D.bullOuter, D.trebleInner, a1, a0)}" fill="${single}"/>`);
    parts.push(`<path d="${arc(D.trebleInner, D.trebleOuter, a1, a0)}" fill="${ring}"/>`);
    parts.push(`<path d="${arc(D.trebleOuter, D.doubleInner, a1, a0)}" fill="${single}"/>`);
    parts.push(`<path d="${arc(D.doubleInner, D.doubleOuter, a1, a0)}" fill="${ring}"/>`);
    if (numbers) {
      const r = 197;
      const x = r * Math.cos(center * Math.PI / 180), y = -r * Math.sin(center * Math.PI / 180);
      parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="#fff" font-size="30" font-weight="800" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif">${seg}</text>`);
    }
  });
  parts.push(`<circle r="${D.bullOuter}" fill="${C.green}"/>`);
  parts.push(`<circle r="${D.bullInner}" fill="${C.red}"/>`);
  for (const pt of highlight) {
    parts.push(`<circle cx="${pt.x}" cy="${-pt.y}" r="${pt.r || 18}" fill="none" stroke="#ffcc00" stroke-width="7"/>`);
    parts.push(`<circle cx="${pt.x}" cy="${-pt.y}" r="6" fill="#ffcc00"/>`);
  }
  return `<svg class="boardpick" viewBox="-${R} -${R} ${2 * R} ${2 * R}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

/** Klick-Koordinate im SVG -> Treffer. Außerhalb der Doppel = 0. */
export function hitFromSvgEvent(svg, ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { hit: hitFromPoint(p.x, -p.y), x: p.x, y: -p.y };
}

/** Linien des Segmentrasters in Board-mm (für das Kamera-Overlay). */
export function gridPolylines(dims = D, steps = 90) {
  const lines = [];
  for (const r of [dims.bullInner, dims.bullOuter, dims.trebleInner, dims.trebleOuter, dims.doubleInner, dims.doubleOuter]) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    lines.push(pts);
  }
  for (let i = 0; i < 20; i++) {
    const a = (90 - 9 - i * 18) * Math.PI / 180;
    lines.push([[dims.bullOuter * Math.cos(a), dims.bullOuter * Math.sin(a)], [dims.doubleOuter * Math.cos(a), dims.doubleOuter * Math.sin(a)]]);
  }
  return lines;
}

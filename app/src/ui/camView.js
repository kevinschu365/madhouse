// Kamerabild mit eingeblendetem Segmentraster und Markierungen.
// Umrechnung zwischen Bildschirm-Tipp und Kamerabild-Pixeln (berücksichtigt Letterboxing).
import { h } from './dom.js';
import { gridPolylines } from './boardSvg.js';
import { applyH } from '../vision/homography.js';
import { STANDARD_DIMENSIONS } from '../core/board.js';

export class CamView {
  /**
   * source: HTMLVideoElement (live) oder HTMLCanvasElement (Standbild)
   * frameSize: { width, height } – Koordinatensystem der Kalibrierung (grab()-Größe)
   */
  constructor({ source, frameSize, aspect = '4 / 3', onTap }) {
    this.source = source;
    this.frameSize = frameSize;
    this.cal = null;
    this.marks = [];
    this.points = [];
    this.el = h('div', { class: 'camwrap', style: { aspectRatio: aspect } });
    this.view = h('canvas', { class: 'view' });
    this.overlay = h('canvas', { class: 'overlay' });
    this.tapLayer = h('div', { class: 'tap' });
    this.el.append(this.view, this.overlay, this.tapLayer);
    this.running = false;
    if (onTap) {
      this.tapLayer.addEventListener('click', (e) => {
        const p = this.clientToFrame(e.clientX, e.clientY);
        if (p) onTap(p, e);
      });
    }
  }

  setSource(source, frameSize) {
    this.source = source;
    if (frameSize) this.frameSize = frameSize;
  }

  setCalibration(cal) { this.cal = cal; }
  setMarks(marks) { this.marks = marks || []; }
  setPoints(points) { this.points = points || []; }

  /** Anzeigebereich des Bildes innerhalb des Elements (object-fit: contain). */
  layout() {
    const r = this.el.getBoundingClientRect();
    const { width: fw, height: fh } = this.frameSize;
    if (!fw || !r.width) return null;
    const s = Math.min(r.width / fw, r.height / fh);
    const w = fw * s, hh = fh * s;
    return { rect: r, s, ox: (r.width - w) / 2, oy: (r.height - hh) / 2, w, h: hh };
  }

  clientToFrame(cx, cy) {
    const L = this.layout();
    if (!L) return null;
    const x = (cx - L.rect.left - L.ox) / L.s, y = (cy - L.rect.top - L.oy) / L.s;
    if (x < 0 || y < 0 || x > this.frameSize.width || y > this.frameSize.height) return null;
    return [x, y];
  }

  frameToLocal(x, y) {
    const L = this.layout();
    return [L.ox + x * L.s, L.oy + y * L.s];
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  draw() {
    const L = this.layout();
    if (!L) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(L.rect.width * dpr), H = Math.round(L.rect.height * dpr);
    for (const c of [this.view, this.overlay]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const vc = this.view.getContext('2d');
    vc.fillStyle = '#000';
    vc.fillRect(0, 0, W, H);
    if (this.source && (this.source.videoWidth || this.source.width)) {
      vc.drawImage(this.source, L.ox * dpr, L.oy * dpr, L.w * dpr, L.h * dpr);
    }
    const oc = this.overlay.getContext('2d');
    oc.clearRect(0, 0, W, H);
    oc.save();
    oc.scale(dpr, dpr);
    const toLocal = (x, y) => [L.ox + x * L.s, L.oy + y * L.s];
    if (this.cal) {
      oc.strokeStyle = 'rgba(34,197,94,0.9)';
      oc.lineWidth = 1.2;
      for (const line of gridPolylines(this.cal.dims || STANDARD_DIMENSIONS, 72)) {
        oc.beginPath();
        line.forEach(([bx, by], i) => {
          const [x, y] = applyH(this.cal.H, bx, by);
          const [lx, ly] = toLocal(x, y);
          if (i === 0) oc.moveTo(lx, ly); else oc.lineTo(lx, ly);
        });
        oc.stroke();
      }
      // „20“ markieren, damit die Ausrichtung sichtbar ist
      const [tx, ty] = applyH(this.cal.H, 0, 190);
      const [lx, ly] = toLocal(tx, ty);
      oc.fillStyle = '#22c55e';
      oc.font = 'bold 14px system-ui';
      oc.textAlign = 'center';
      oc.fillText('20', lx, ly);
    }
    for (const m of this.marks) {
      const [lx, ly] = toLocal(m.x, m.y);
      oc.strokeStyle = m.color || '#ff3b30';
      oc.lineWidth = 2.5;
      oc.beginPath();
      oc.arc(lx, ly, m.r || 7, 0, Math.PI * 2);
      oc.stroke();
      if (m.label) {
        oc.fillStyle = m.color || '#ff3b30';
        oc.font = 'bold 13px system-ui';
        oc.textAlign = 'left';
        oc.fillText(m.label, lx + 9, ly - 6);
      }
    }
    for (const p of this.points) {
      const [lx, ly] = toLocal(p.x, p.y);
      oc.strokeStyle = p.active ? '#ffcc00' : '#22c55e';
      oc.lineWidth = 2;
      oc.beginPath();
      oc.moveTo(lx - 10, ly); oc.lineTo(lx + 10, ly); oc.moveTo(lx, ly - 10); oc.lineTo(lx, ly + 10);
      oc.stroke();
      if (p.label) {
        oc.fillStyle = oc.strokeStyle;
        oc.font = 'bold 12px system-ui';
        oc.textAlign = 'left';
        oc.fillText(p.label, lx + 8, ly + 14);
      }
    }
    oc.restore();
  }
}

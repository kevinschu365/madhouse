// Kalibrierung (5 Punkte antippen) und Schnell-Check vor dem Spiel.
import { h, toast } from '../dom.js';
import { camera, imageDataToJpeg } from '../../vision/camera.js';
import { CamView } from '../camView.js';
import { CAL_POINTS, boardPointFor, buildCalibration, restoreCalibration, serializeCalibration, shiftCalibration } from '../../vision/calibration.js';
import { lsGet, lsSet } from '../../core/storage.js';
import { STANDARD_DIMENSIONS } from '../../core/board.js';
import { estimateShift } from '../../vision/align.js';
import { refineImagePoints } from '../../vision/refine.js';
import { autoCalibrate } from '../../vision/autocal.js';
import { boardSvg } from '../boardSvg.js';

export function render(root, params, nav) {
  const mode = params.mode || 'full';
  let disposed = false;
  let view = null;
  const body = h('div', { class: 'stack', style: { maxWidth: '900px', margin: '0 auto' } });
  root.appendChild(body);

  const goBack = () => nav.go(params.back || 'home');
  const proceed = (withCamera = true) => {
    if (params.then) nav.go(params.then, { ...params.thenParams, camera: withCamera });
    else goBack();
  };
  const header = (title) => h('div', { class: 'topbar' }, h('button', { class: 'iconbtn', onclick: goBack }, '‹'), h('h1', {}, title));

  async function init() {
    body.replaceChildren(header(mode === 'quickcheck' ? 'Kamera-Check' : 'Kalibrierung'), h('p', { class: 'dim' }, 'Kamera wird gestartet …'));
    try {
      await camera.start();
    } catch (e) {
      body.replaceChildren(header('Kamera'), h('p', {}, e.message),
        params.then ? h('button', { class: 'btn primary', onclick: () => proceed(false) }, 'Ohne Kamera spielen') : null,
        h('button', { class: 'btn', onclick: () => init() }, 'Nochmal versuchen'));
      return;
    }
    if (disposed) return;
    const saved = lsGet('calibration', null);
    const size = camera.size();
    const aspectOk = saved && Math.abs(saved.width / saved.height - size.width / size.height) < 0.02;
    if (mode === 'quickcheck' && saved && aspectOk) quickCheck(restoreCalibration(saved, size.width, size.height));
    else {
      if (mode === 'quickcheck' && saved && !aspectOk) toast('Das Kamerabild hat ein anderes Format als bei der Kalibrierung (z. B. gedreht). Bitte neu kalibrieren.', 4000);
      fullCalibration();
    }
  }

  // ---------- Schnell-Check ----------
  function quickCheck(cal) {
    const size = camera.size();
    view = new CamView({ source: camera.video, frameSize: size, aspect: `${size.width} / ${size.height}` });
    view.setCalibration(cal);
    view.start();
    let current = cal;
    body.replaceChildren(
      header('Kamera-Check'),
      h('p', {}, 'Passt das grüne Raster auf die Drähte der Scheibe? Bitte vorher alle Darts aus dem Board ziehen.'),
      view.el,
      h('button', {
        class: 'btn primary', style: { minHeight: '60px' },
        onclick: () => {
          // Aktuelles Bild (leeres Board) als neues Referenzbild für die Bildverlust-Warnung
          const frame = camera.grab();
          const snapshot = frame ? imageDataToJpeg(frame, 480, 0.7) : lsGet('calibration', {}).snapshot;
          lsSet('calibration', { ...serializeCalibration(current), snapshot, checkedAt: Date.now() });
          proceed(true);
        },
      }, 'Passt – los geht’s'),
      h('button', {
        class: 'btn',
        onclick: async () => {
          const saved = lsGet('calibration', null);
          if (!saved || !saved.snapshot) { toast('Kein Referenzbild gespeichert – bitte neu kalibrieren.'); return; }
          const shift = await estimateShift(saved.snapshot, camera.grab());
          if (!shift) { toast('Automatisches Ausrichten nicht möglich – bitte neu kalibrieren.'); return; }
          if (Math.hypot(shift.dx, shift.dy) > 0.15 * size.width) { toast('Kamera stark verschoben – bitte neu kalibrieren.'); return; }
          current = shiftCalibration(current, shift.dx, shift.dy);
          view.setCalibration(current);
          toast(`Raster um ${Math.round(shift.dx)} / ${Math.round(shift.dy)} Pixel verschoben. Passt es jetzt?`, 3500);
        },
      }, 'Automatisch nachführen (kleine Verschiebung)'),
      h('button', { class: 'btn', onclick: () => { view.stop(); fullCalibration(); } }, 'Neu kalibrieren'),
      params.then ? h('button', { class: 'btn ghost', onclick: () => proceed(false) }, 'Ohne Kamera spielen') : null,
    );
  }

  // ---------- Vollständige Kalibrierung ----------
  function fullCalibration() {
    const size = camera.size();
    const aspect = `${size.width} / ${size.height}`;
    view = new CamView({ source: camera.video, frameSize: size, aspect });
    view.start();
    body.replaceChildren(
      header('Kalibrierung'),
      h('div', { class: 'card' },
        h('p', { style: { margin: 0 } }, '1. iPhone fest hinstellen, sodass die ganze Scheibe gut zu sehen ist (seitlich/schräg ist ok).'),
        h('p', { class: 'dim', style: { margin: '6px 0 0' } }, 'Tipp: Querformat sperren/halten wie beim Spiel. Keine Darts im Board.')),
      view.el,
      h('button', { class: 'btn primary', onclick: () => autoPoints(camera.grab()) }, 'Standbild aufnehmen'),
    );
  }

  // ---------- Schnelle Kalibrierung: 2 Tipps, Rest automatisch ----------
  function autoPoints(still) {
    if (!still) { toast('Kein Kamerabild.'); return; }
    view.stop();
    const stillCanvas = h('canvas', { width: still.width, height: still.height });
    stillCanvas.getContext('2d').putImageData(still, 0, 0);
    const size = { width: still.width, height: still.height };
    const taps = [];
    let cal = null;
    const instr = h('div', { class: 'card', style: { fontSize: '18px', fontWeight: 600 } });
    const actions = h('div', { class: 'stack' });
    const loupe = h('canvas', { width: 140, height: 140, style: { position: 'fixed', width: '140px', height: '140px', borderRadius: '70px', border: '3px solid #22c55e', pointerEvents: 'none', display: 'none', zIndex: 80, background: '#000' } });
    document.body.appendChild(loupe);
    cleanupFns.push(() => loupe.remove());
    view = new CamView({ source: stillCanvas, frameSize: size, aspect: `${size.width} / ${size.height}` });
    const boardPts = CAL_POINTS.map((c) => boardPointFor(c, STANDARD_DIMENSIONS));

    const run = () => {
      instr.replaceChildren('Suche das Board …');
      actions.replaceChildren();
      // kurz warten, damit die Anzeige aktualisiert wird
      setTimeout(() => {
        let res = null;
        try { res = autoCalibrate(still, taps[0], taps[1], boardPts, STANDARD_DIMENSIONS); } catch (e) { console.warn(e); }
        if (!res) {
          cal = null;
          toast('Board nicht automatisch gefunden – bitte nochmal tippen oder 5 Punkte setzen.', 4000);
          taps.length = 0;
          update();
          return;
        }
        cal = buildCalibration({ boardPoints: boardPts, imagePoints: res.imagePoints, width: size.width, height: size.height, dims: STANDARD_DIMENSIONS });
        update();
      }, 30);
    };

    attachLoupe(view, stillCanvas, loupe, (p) => {
      if (taps.length >= 2) return;
      taps.push(p);
      if (taps.length === 2) run(); else update();
    });

    const update = () => {
      view.setCalibration(cal);
      view.setPoints(taps.map(([x, y], i) => ({ x, y, label: i === 0 ? 'Bull' : '20' })));
      view.draw();
      if (taps.length === 0) instr.replaceChildren(miniBoard(0, 0), '1. Tippe genau auf das Bullseye',h('div', { class: 'dim', style: { fontSize: '14px', fontWeight: 400 } }, 'Mit der Lupe auf die Mitte schieben, loslassen. Keine Darts im Board.'));
      else if (taps.length === 1) instr.replaceChildren(miniBoard(0, 135, 30), '2. Tippe irgendwo in das Feld der 20',h('div', { class: 'dim', style: { fontSize: '14px', fontWeight: 400 } }, 'Am besten mitten ins große Single-Feld der 20.'));
      else if (cal) instr.replaceChildren('Liegt das grüne Raster auf den Drähten?', h('div', { class: 'dim', style: { fontSize: '14px', fontWeight: 400 } }, 'Die „20“ im Raster muss bei der echten 20 stehen.'));
      actions.replaceChildren(
        cal ? h('button', { class: 'btn primary', style: { minHeight: '60px' }, onclick: () => save(cal, still) }, 'Passt – speichern') : null,
        taps.length ? h('button', { class: 'btn', onclick: () => { taps.length = 0; cal = null; update(); } }, 'Nochmal tippen') : null,
        h('button', { class: 'btn ghost', onclick: () => { loupe.remove(); tapPoints(still); } }, 'Stattdessen 5 Punkte von Hand setzen'),
        h('button', { class: 'btn ghost', onclick: () => { loupe.remove(); fullCalibration(); } }, 'Neues Standbild'),
      );
    };
    body.replaceChildren(header('Kalibrierung'), instr, view.el, actions);
    update();
  }

  function save(cal, still) {
    const data = serializeCalibration(cal);
    data.createdAt = Date.now();
    data.snapshot = imageDataToJpeg(still, 480, 0.7);
    lsSet('calibration', data);
    document.querySelectorAll('canvas[style*="border-radius: 70px"]').forEach((c) => c.remove());
    toast('Kalibrierung gespeichert');
    proceed(true);
  }

  function tapPoints(still) {
    if (!still) { toast('Kein Kamerabild.'); return; }
    view.stop();
    const stillCanvas = h('canvas', { width: still.width, height: still.height });
    stillCanvas.getContext('2d').putImageData(still, 0, 0);
    const size = { width: still.width, height: still.height };
    const points = [];
    let editIndex = null;
    let cal = null;
    const instr = h('div', { class: 'card', style: { fontSize: '18px', fontWeight: 600 } });
    const loupe = h('canvas', { width: 140, height: 140, style: { position: 'fixed', width: '140px', height: '140px', borderRadius: '70px', border: '3px solid #22c55e', pointerEvents: 'none', display: 'none', zIndex: 80, background: '#000' } });
    document.body.appendChild(loupe);
    const actions = h('div', { class: 'stack' });

    const setPoint = (p) => {
      if (editIndex != null) { points[editIndex] = p; editIndex = null; }
      else if (points.length < CAL_POINTS.length) points.push(p);
      update();
    };
    view = new CamView({ source: stillCanvas, frameSize: size, aspect: `${size.width} / ${size.height}` });
    attachLoupe(view, stillCanvas, loupe, setPoint);

    let refined = null;      // automatisch verfeinerte Punkte
    let useRefined = true;
    let refinedFor = '';
    const boardPts = CAL_POINTS.map((c) => boardPointFor(c, STANDARD_DIMENSIONS));
    const update = () => {
      cal = null;
      if (points.length >= 5) {
        // Feinabgleich an den Kanten des Boards (nur neu rechnen, wenn sich Punkte geändert haben)
        const key = JSON.stringify(points);
        if (key !== refinedFor) {
          refinedFor = key;
          try { refined = refineImagePoints(still, boardPts, points, STANDARD_DIMENSIONS); } catch (e) { refined = null; }
        }
        const pts = useRefined && refined && refined.improved ? refined.imagePoints : points;
        try {
          cal = buildCalibration({ boardPoints: boardPts, imagePoints: pts, width: size.width, height: size.height, dims: STANDARD_DIMENSIONS });
        } catch (e) { toast(e.message); }
      }
      view.setCalibration(cal);
      view.setPoints(points.map(([x, y], i) => ({ x, y, label: String(i + 1), active: i === editIndex })));
      view.draw();
      const idx = editIndex != null ? editIndex : points.length;
      if (idx < CAL_POINTS.length) {
        instr.replaceChildren(miniBoard(...boardPointFor(CAL_POINTS[idx], STANDARD_DIMENSIONS)), `Punkt ${idx + 1}/5: ${CAL_POINTS[idx].label}`,h('div', { class: 'dim', style: { fontSize: '14px', fontWeight: 400 } }, 'Finger auflegen, mit der Lupe genau auf den Draht schieben, loslassen.'));
      } else {
        instr.replaceChildren('Liegt das grüne Raster auf den Drähten?', h('div', { class: 'dim', style: { fontSize: '14px', fontWeight: 400 } }, 'Sonst einen Punkt antippen zum Korrigieren.'));
      }
      actions.replaceChildren(
        points.length >= 5 && refined && refined.improved ? h('div', { class: 'list-item' },
          h('span', { class: 'name', style: { fontSize: '15px' } }, `Automatischer Feinabgleich (Punkte um bis zu ${refined.moved.toFixed(1)} px verschoben)`),
          h('button', { class: `chip ${useRefined ? 'on' : ''}`, onclick: () => { useRefined = !useRefined; update(); } }, useRefined ? 'An' : 'Aus')) : null,
        points.length >= 5 ? h('div', { class: 'chips' }, points.map((_, i) => h('button', { class: `chip ${i === editIndex ? 'on' : ''}`, onclick: () => { editIndex = editIndex === i ? null : i; update(); } }, `Punkt ${i + 1} ändern`))) : null,
        points.length >= 5 && cal ? h('button', { class: 'btn primary', style: { minHeight: '60px' }, onclick: save }, 'Kalibrierung speichern') : null,
        points.length && points.length < 5 ? h('button', { class: 'btn', onclick: () => { points.pop(); update(); } }, 'Letzten Punkt zurück') : null,
        h('button', { class: 'btn ghost', onclick: () => { loupe.remove(); fullCalibration(); } }, 'Neues Standbild'),
      );
    };

    const save = () => {
      const data = serializeCalibration(cal);
      data.createdAt = Date.now();
      data.snapshot = imageDataToJpeg(still, 480, 0.7);
      lsSet('calibration', data);
      loupe.remove();
      toast('Kalibrierung gespeichert');
      proceed(true);
    };

    body.replaceChildren(header('Kalibrierung'), instr, view.el, actions);
    update();
    cleanupFns.push(() => loupe.remove());
  }

  const cleanupFns = [];
  init();
  return () => {
    disposed = true;
    if (view) view.stop();
    cleanupFns.forEach((f) => f());
  };
}

/** Kleine Scheibe neben der Anweisung, die gelb zeigt, wohin getippt werden soll. */
function miniBoard(x, y, r) {
  return h('div', { html: boardSvg({ numbers: true, highlight: [{ x, y, r }] }), style: { float: 'right', width: '110px', marginLeft: '10px' } });
}

/** Lupe beim Antippen: zeigt die Umgebung vergrößert über dem Finger. */
function attachLoupe(view, still, loupe, onSet) {
  const ctx = loupe.getContext('2d');
  let active = false;
  const show = (cx, cy) => {
    const p = view.clientToFrame(cx, cy);
    if (!p) { loupe.style.display = 'none'; return null; }
    const zoom = 4, half = 140 / zoom / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 140, 140);
    ctx.drawImage(still, p[0] - half, p[1] - half, half * 2, half * 2, 0, 0, 140, 140);
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(70, 50); ctx.lineTo(70, 90); ctx.moveTo(50, 70); ctx.lineTo(90, 70); ctx.stroke();
    loupe.style.display = 'block';
    loupe.style.left = `${Math.max(4, Math.min(window.innerWidth - 144, cx - 70))}px`;
    loupe.style.top = `${Math.max(4, cy - 190)}px`;
    return p;
  };
  const layer = view.tapLayer;
  let last = null;
  layer.addEventListener('touchstart', (e) => { e.preventDefault(); active = true; const t = e.touches[0]; last = show(t.clientX, t.clientY); }, { passive: false });
  layer.addEventListener('touchmove', (e) => { e.preventDefault(); if (!active) return; const t = e.touches[0]; last = show(t.clientX, t.clientY) || last; }, { passive: false });
  layer.addEventListener('touchend', (e) => { e.preventDefault(); active = false; loupe.style.display = 'none'; if (last) onSet(last); last = null; }, { passive: false });
  // Maus (z. B. am PC zum Testen)
  layer.addEventListener('mousedown', (e) => { active = true; last = show(e.clientX, e.clientY); });
  layer.addEventListener('mousemove', (e) => { if (active) last = show(e.clientX, e.clientY) || last; });
  layer.addEventListener('mouseup', () => { active = false; loupe.style.display = 'none'; if (last) onSet(last); last = null; });
}

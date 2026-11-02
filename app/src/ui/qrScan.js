// QR-Code mit der Kamera scannen (in der App, z. B. „Turnier beitreten“). Liest mehrere Bilder pro Sekunde
// mit vision/qrRead.js, bis ein Code erkannt ist. Ergebnis: Text oder null (abgebrochen).
import { h } from './dom.js';
import { readQR } from '../vision/qrRead.js';

const MAX_W = 720; // Bild für die Erkennung verkleinern (schneller, reicht für Bildschirm-Codes)

export function scanQR(title = 'QR-Code scannen') {
  return new Promise((resolve) => {
    let stream = null;
    let done = false;
    let timer = null;
    const video = h('video', { playsinline: true, muted: true, autoplay: true, class: 'qrvideo' });
    const status = h('div', { class: 'small dim' }, 'Kamera wird gestartet …');
    const finish = (text) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      wrap.remove();
      resolve(text);
    };
    const wrap = h('div', { class: 'qrscan' },
      h('div', { class: 'qrscanbox' },
        h('h2', {}, title),
        h('div', { class: 'qrframe' }, video, h('div', { class: 'qraim' })),
        status,
        h('button', { class: 'btn ghost', onclick: () => finish(null) }, 'Abbrechen')));
    document.body.appendChild(wrap);
    video.muted = true;
    video.setAttribute('playsinline', '');

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const loop = () => {
      if (done) return;
      if (video.videoWidth) {
        const s = Math.min(1, MAX_W / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * s);
        canvas.height = Math.round(video.videoHeight * s);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        let text = null;
        try { text = readQR(ctx.getImageData(0, 0, canvas.width, canvas.height)); } catch { /* nächstes Bild */ }
        if (text) {
          if (navigator.vibrate) navigator.vibrate(80);
          finish(text);
          return;
        }
      }
      timer = setTimeout(loop, 120);
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.textContent = 'Kamera ist hier nicht verfügbar. Bitte den Code eintippen.';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (done) { s.getTracks().forEach((tr) => tr.stop()); return; }
        stream = s;
        video.srcObject = s;
        video.play().catch(() => {});
        status.textContent = 'QR-Code vom PC in den Rahmen halten …';
        loop();
      })
      .catch(() => { status.textContent = 'Kein Zugriff auf die Kamera. Bitte erlauben oder den Code eintippen.'; });
  });
}

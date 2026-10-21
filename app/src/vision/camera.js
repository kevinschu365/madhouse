// Kamera-Zugriff (eine dauerhafte Verbindung für die ganze App).
// iOS fragt in Home-Bildschirm-Apps die Erlaubnis teils erneut ab – deshalb wird der
// Stream zwischen Kalibrierung und Spiel NICHT beendet, sondern weiterverwendet.

import { getSettings } from '../core/settings.js';

const MAX_GRAB_WIDTH = 1280;

/** Liste der Kameras (Namen erst nach erteilter Erlaubnis sichtbar). */
export async function listCameras() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Kamera ${i + 1}` }));
}

class Camera {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.listeners = new Set();
    this.lastError = null;
    this.watchdog = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { this.listeners.forEach((fn) => fn(type, data)); }

  get active() {
    return !!(this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live'));
  }

  /** Kamera starten (Rückkamera, möglichst 1280x720). */
  async start() {
    if (this.active) { this.ensurePlaying(); return this.video; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(window.isSecureContext ? 'Dieser Browser bietet keinen Kamerazugriff.' : 'Kamera geht nur über HTTPS.');
    }
    const deviceId = getSettings().cameraDeviceId;
    const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    try {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: { ideal: 'environment' } },
        });
      } catch (e) {
        if (!deviceId || e.name === 'NotAllowedError') throw e;
        // Gewählte Kamera nicht mehr verfügbar -> Standard-Rückkamera
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, facingMode: { ideal: 'environment' } } });
      }
    } catch (e) {
      this.lastError = e;
      if (e.name === 'NotAllowedError') throw new Error('Kamerazugriff wurde abgelehnt. Erlauben unter iOS-Einstellungen › Safari › Kamera (bzw. beim nächsten Start „Erlauben“ tippen).');
      throw new Error(`Kamera konnte nicht gestartet werden (${e.name || e.message}).`);
    }
    if (!this.video) {
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('muted', '');
      this.video.muted = true;
      this.video.autoplay = true;
    }
    this.video.srcObject = this.stream;
    for (const t of this.stream.getVideoTracks()) {
      t.addEventListener('ended', () => this.emit('lost', { reason: 'ended' }));
      t.addEventListener('mute', () => this.emit('lost', { reason: 'mute' }));
      t.addEventListener('unmute', () => this.emit('restored', {}));
    }
    await this.video.play().catch(() => {});
    await new Promise((res) => {
      if (this.video.videoWidth) return res();
      this.video.addEventListener('loadedmetadata', () => res(), { once: true });
      setTimeout(res, 3000);
    });
    // Sprachausgabe kann auf iOS Videos anhalten (WebKit-Bug 218815) -> regelmäßig weiterlaufen lassen
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => this.ensurePlaying(), 700);
    this.emit('started', this.size());
    return this.video;
  }

  ensurePlaying() {
    if (this.video && this.stream && this.video.paused) this.video.play().catch(() => {});
  }

  stop() {
    clearInterval(this.watchdog);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  /** Größe der Bilder, die grab() liefert. */
  size() {
    const vw = this.video ? this.video.videoWidth : 0, vh = this.video ? this.video.videoHeight : 0;
    if (!vw || !vh) return { width: 0, height: 0 };
    const s = Math.min(1, MAX_GRAB_WIDTH / Math.max(vw, vh));
    return { width: Math.round(vw * s), height: Math.round(vh * s) };
  }

  /** Aktuelles Kamerabild als ImageData (max. 1280 px lange Seite). */
  grab() {
    const { width, height } = this.size();
    if (!width) return null;
    if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    this.ctx.drawImage(this.video, 0, 0, width, height);
    return this.ctx.getImageData(0, 0, width, height);
  }
}

export const camera = new Camera();

/** ImageData -> JPEG-Data-URL (verkleinert). */
export function imageDataToJpeg(img, maxWidth = 960, quality = 0.8) {
  const s = Math.min(1, maxWidth / img.width);
  const c1 = document.createElement('canvas');
  c1.width = img.width; c1.height = img.height;
  c1.getContext('2d').putImageData(img, 0, 0);
  const c2 = document.createElement('canvas');
  c2.width = Math.round(img.width * s); c2.height = Math.round(img.height * s);
  c2.getContext('2d').drawImage(c1, 0, 0, c2.width, c2.height);
  return c2.toDataURL('image/jpeg', quality);
}

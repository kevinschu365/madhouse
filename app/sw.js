// Service Worker: App läuft nach dem ersten Laden auch ohne Internet.
// Strategie: sofort aus dem Cache (schneller Start, auch bei schlechtem WLAN am Board),
// im Hintergrund aktualisieren. Neue Versionen sind damit beim übernächsten Öffnen aktiv.
// Bei jeder Veröffentlichung VERSION erhöhen und neue Dateien in FILES eintragen.
const VERSION = 'madhouse-v1.0.1';
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon.svg',
  './src/app.js', './src/config.js',
  './src/audio/speech.js',
  './src/core/board.js', './src/core/settings.js', './src/core/storage.js', './src/core/wakelock.js',
  './src/game/match.js', './src/game/session.js',
  './src/rules/checkout.js', './src/rules/index.js', './src/rules/x01.js',
  './src/stats/stats.js',
  './src/ui/boardSvg.js', './src/ui/camView.js', './src/ui/dom.js',
  './src/ui/screens/calibrate.js', './src/ui/screens/game.js', './src/ui/screens/home.js', './src/ui/screens/players.js',
  './src/ui/screens/settings.js', './src/ui/screens/setup.js', './src/ui/screens/stats.js',
  './src/vision/align.js', './src/vision/calibration.js', './src/vision/camera.js', './src/vision/cameraGame.js',
  './src/vision/detector.js', './src/vision/homography.js', './src/vision/refine.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));
      return cached || network;
    }),
  );
});

// Service Worker: App läuft nach dem ersten Laden auch ohne Internet.
// Strategie: Jede Version liegt komplett in ihrem eigenen Cache (VERSION) und wird nur aus diesem bedient –
// nie alte und neue Dateien gemischt (vermutete Ursache des schwarzen Bildschirms nach dem Update auf 1.10.0).
// Eine neue Version wird beim Installieren vollständig und frisch vom Server geholt (am Browser-Cache vorbei);
// sobald sie aktiv ist, lädt die App einmal neu (src/app.js).
// Bei jeder Veröffentlichung VERSION erhöhen und neue Dateien in FILES eintragen.
const VERSION = 'madhouse-v1.11.0';
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest', './anleitung.html', './anleitung.pdf',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon.svg',
  './src/app.js', './src/config.js', './src/changelog.js',
  './src/audio/speech.js',
  './src/core/board.js', './src/core/settings.js', './src/core/storage.js', './src/core/wakelock.js',
  './src/game/match.js', './src/game/session.js', './src/game/bot.js',
  './src/rules/checkout.js', './src/rules/index.js', './src/rules/x01.js',
  './src/rules/cricket.js', './src/rules/training.js', './src/rules/checkoutDrills.js', './src/rules/partyGames.js', './src/rules/moreGames.js',
  './src/stats/stats.js', './src/stats/progress.js', './src/stats/coach.js', './src/core/sync.js', './src/core/tournament.js', './src/core/live.js', './src/ui/tournamentView.js',
  './src/ui/celebrate.js', './src/ui/shareCard.js', './src/ui/recapSheet.js', './src/ui/syncUi.js',
  './src/ui/boardSvg.js', './src/ui/camView.js', './src/ui/dom.js', './src/ui/matchDetail.js', './src/ui/chart.js',
  './src/ui/screens/calibrate.js', './src/ui/screens/game.js', './src/ui/screens/home.js', './src/ui/screens/players.js',
  './src/ui/screens/settings.js', './src/ui/screens/setup.js', './src/ui/screens/stats.js', './src/ui/screens/training.js', './src/ui/screens/help.js', './src/ui/screens/tournament.js', './src/ui/screens/board.js', './src/ui/screens/live.js', './src/ui/screens/records.js', './src/ui/screens/milestones.js', './src/ui/statsData.js',
  './src/vision/align.js', './src/vision/calibration.js', './src/vision/camera.js', './src/vision/cameraGame.js',
  './src/vision/detector.js', './src/vision/homography.js', './src/vision/refine.js', './src/vision/autocal.js',
];


self.addEventListener('install', (event) => {
  // cache: 'reload' – alle Dateien frisch vom Server, nicht aus dem Browser-Cache (sonst evtl. alte Stände)
  event.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Nur aus dem Cache dieser Version; fehlt etwas, vom Server holen und dazulegen. Keine Hintergrund-Aktualisierung.
  event.respondWith(caches.open(VERSION).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)
    .then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    })
    .catch(() => c.match('./index.html')))));
});

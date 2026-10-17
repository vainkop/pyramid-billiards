// Offline support: the app shell is cached on install and served cache-first.
// Bump VERSION whenever any of these files change so clients pick up the update.
const VERSION = 'v10';
const CACHE = `pyramid-${VERSION}`;
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'src/app.js', 'src/ai.js', 'src/aim.js', 'src/canvas.js', 'src/content.js', 'src/cue-strip.js', 'src/dom.js', 'src/drills.js',
  'src/icons.js', 'src/physics.js', 'src/predict.js', 'src/pyramid.js', 'src/shot-controls.js', 'src/slider.js',
  'src/spin-pad.js', 'src/store.js', 'src/table.js', 'src/table-view.js', 'src/ui.js',
  'src/screens/game.js', 'src/screens/lessons.js', 'src/screens/practice.js', 'src/screens/quiz.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(e.request)));
});

// Lets the page open at the table when the phone has no signal.
//
// Network first: every file is asked to the site, and the copy kept on the
// phone is used only when the site does not answer. So a new version of the
// page is never hidden by an old copy. Calls to the Google script go to
// another address and are not touched here.

const CACHE = 'bil-v1';
const WAIT_MS = 4000;
const FILES = [
  './', 'index.html', 'style.css', 'link.html',
  'js/app.js', 'js/rules.js', 'js/suggest.js', 'js/games.js', 'js/setupcode.js',
  'js/store.js', 'js/api.js', 'js/sync.js', 'js/day.js', 'js/link.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function fromSite(request) {
  // A page load cannot be re-issued with other options; the files it pulls can.
  const asked = request.mode === 'navigate' ? fetch(request) : fetch(request.url, { cache: 'no-cache' });
  const tooLate = new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), WAIT_MS));
  return Promise.race([asked, tooLate]).then((response) => {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request.url.split('?')[0], copy)).catch(() => {});
    return response;
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fromSite(request).catch(() =>
      caches.match(request, { ignoreSearch: true }).then((kept) => kept || Response.error())),
  );
});

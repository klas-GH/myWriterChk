// App shell service worker.
//
// Cache-first: the shell is served from the cache so the app opens
// instantly and offline, and the network only fills gaps. Everything
// is same-origin static content, so there is nothing to stale-proof
// beyond a cache version bump.

const CACHE = 'writer-helper-v2';

const SHELL = [
    '.',
    'index.html',
    'style.css',
    'script.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-192.png',
    'icons/icon-maskable-512.png'
];

function sameOrigin(url) {
    return new URL(url).origin === self.location.origin;
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;

    // Only GET responses can be cached; anything else goes to the network.
    if (request.method !== 'GET') return;

    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then(cached => {
            if (cached) return cached;

            return fetch(request).then(response => {
                // Only cache our own successful responses; a CDN or API
                // may send something we must not store.
                if (response.ok && sameOrigin(request.url)) {
                    const copy = response.clone();
                    caches.open(CACHE)
                        .then(cache => cache.put(request, copy));
                }
                return response;
            }).catch(() => {
                // Offline: fall back to the app shell for navigations so
                // the app still opens rather than showing a browser error.
                if (request.mode === 'navigate') {
                    return caches.match('index.html');
                }
                return Response.error();
            });
        })
    );
});

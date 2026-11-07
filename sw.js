// =====================================================================
// CHARTOLJ! — Service Worker (Web Push fogadás + OFFLINE app-shell gyorsítótár)
// =====================================================================
// Ezt a fájlt a weboldal GYÖKERÉBE kell feltölteni (ugyanoda, ahova a
// chartolj_trading_terminal_mobile.html és a manifest.webmanifest kerül),
// pontosan "sw.js" néven, mert a kliens kód innen regisztrálja:
//   navigator.serviceWorker.register('sw.js')
//
// ÚJ FUNKCIÓ (OFFLINE MÓD): a push-üzenet-logika mellett (változatlan,
// lásd lejjebb) ez a fájl mostantól egy egyszerű, "network-first" app-shell
// gyorsítótárat is kezel, hogy az app megnyitható legyen internetkapcsolat
// nélkül is (legalább a legutóbb sikeresen betöltött verzióval).
//
// STRATÉGIA (fontos, miért network-first és NEM cache-first):
// - Minden SAJÁT (same-origin) GET kérésnél ELŐSZÖR a hálózatot próbáljuk.
//   Ha ez sikerül, a válasz a böngészőhöz megy ÉS egy másolata frissíti a
//   cache-t — így amíg van net, a felhasználó MINDIG a legfrissebb deployolt
//   verziót kapja, egy új commit sosem "ragad be" egy elavult cache-elt
//   változatra.
// - CSAK ha a hálózati kérés elbukik (nincs net / offline), akkor esünk
//   vissza a cache-elt másolatra.
// - Idegen (más eredetű, pl. Supabase, CDN) kéréseket NEM fogunk el —
//   azok a böngésző natív útját járják, a meglévő hálózati logika (és a
//   "guest mode" fallback, ha a Supabase nem érhető el) teljesen
//   érintetlen marad.
// - A cache verziószáma (CACHE_NAME) bővítésekor az activate esemény
//   törli a régi verziójú cache-eket, hogy ne halmozódjon a tárhely.
// =====================================================================

const CACHE_NAME = 'chartolj-shell-v1';
const SHELL_ASSETS = [
    './',
    './index.html',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => Promise.all(
                SHELL_ASSETS.map((url) => cache.add(url).catch(() => {
                    // Egy-egy hiányzó/el nem érhető asset (pl. eltérő fájlnév
                    // egy adott deploy-on) nem buktathatja el a teljes
                    // telepítést — a lényeg, hogy ami elérhető, bekerüljön.
                }))
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    // Csak a saját eredetű, GET kéréseket kezeljük — minden mást (idegen
    // eredet, POST/PUT a Supabase felé, stb.) változatlanul a böngészőre
    // bízunk, nem fogjuk el.
    if (req.method !== 'GET') return;
    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(req)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.ok) {
                    const copy = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
                }
                return networkResponse;
            })
            .catch(() => caches.match(req).then((cached) => {
                if (cached) return cached;
                // Navigációs (HTML) kérésnél, ha se net, se pontos cache-
                // egyezés nincs, próbáljuk az app-shell gyökér-oldalát —
                // így egy mélyebb/eltérő URL-re navigálva offline módban
                // is legalább az app megnyílik.
                if (req.mode === 'navigate') return caches.match('./index.html');
                return Response.error();
            }))
    );
});

self.addEventListener('push', (event) => {
    let payload = { title: 'Chartolj!', body: 'Új értesítésed érkezett.', url: '/' };
    try {
        if (event.data) payload = { ...payload, ...event.data.json() };
    } catch (e) {
        if (event.data) payload.body = event.data.text();
    }

    event.waitUntil(
        self.registration.showNotification(payload.title || 'Chartolj!', {
            body: payload.body || '',
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            data: { url: payload.url || '/' },
            vibrate: [100, 50, 100],
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
            const existing = clientsArr.find((c) => c.url.includes(self.registration.scope));
            if (existing) return existing.focus();
            return self.clients.openWindow(targetUrl);
        })
    );
});

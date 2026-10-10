// =====================================================================
// CHARTOLJ! — Service Worker (valódi Web Push fogadásához)
// =====================================================================
// Ezt a fájlt a weboldal GYÖKERÉBE kell feltölteni (ugyanoda, ahova a
// chartolj_trading_terminal_mobile.html és a manifest.webmanifest kerül),
// pontosan "sw.js" néven, mert a kliens kód innen regisztrálja:
//   navigator.serviceWorker.register('sw.js')
//
// Ez a fájl NEM gyorsítótárazást/offline-t csinál (ahhoz egy teljesebb
// "cache-first" service worker kellene) — kizárólag a push-üzenetek
// fogadásáért és natív értesítésként való megjelenítéséért felel, plusz
// azért, hogy a user az értesítésre kattintva visszajusson az appba.
// =====================================================================

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

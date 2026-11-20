/* Läxmotorns service worker.
 * - Gör appen installerbar och startbar utan nät (senast hämtade versionen).
 * - Rör bara filer från appens egen adress (GET). Allt annat, till exempel Supabase
 *   (inloggning, databas, serverfunktioner) och CDN:er, går direkt till nätet och cachas aldrig.
 * - Sidan hämtas alltid från nätet först, så en ny version syns direkt när den är publicerad.
 * Byt VERSION när filerna i SHELL ändras på ett sätt som kräver att gamla cachen rensas.
 */
const VERSION = 'laxmotorn-v1';
const SHELL = ['./', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('laxmotorn-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // Supabase, CDN:er m.m.: aldrig via cachen
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    // Nätet först, cachen bara som reserv när man är offline.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('./', copy)); }
          return res;
        })
        .catch(() => caches.match('./').then((r) => r || caches.match(req)))
    );
    return;
  }

  // Ikoner och manifest: cachen först, uppdateras i bakgrunden.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

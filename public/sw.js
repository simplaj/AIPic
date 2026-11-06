// Replaced on every production build, so browser update checks see a new worker.
const APP_BUILD_ID = '__AIPIC_BUILD_ID__'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('aipic-')).map((key) => caches.delete(key)))
    await self.clients.claim()
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) client.postMessage({ type: 'AIPIC_BUILD_UPDATED', buildId: APP_BUILD_ID })
  })())
})
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET') return
  const fresh = event.request.mode === 'navigate' || url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')
  event.respondWith(fetch(event.request, fresh ? { cache: 'no-store' } : undefined))
})

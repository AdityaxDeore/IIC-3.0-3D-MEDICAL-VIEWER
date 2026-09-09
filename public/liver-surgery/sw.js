/*!
 * LiverSurgerySimWeb - Copyright (c) 2026 Meidai Kasai (笠井明大)
 * All rights reserved. See LICENSE.
 * Unauthorized copying, modification, or redistribution is prohibited.
 * Contact: meidai1223@gmail.com
 */

// Service Worker for Liver Surgery Simulator PWA
// 軽量 fetch ハンドラ: 同一オリジン GET のみ cache-first
// Firebase 等の別オリジン通信は素通し → FPS 影響最小
const CACHE_NAME = 'liver-sim-v327';
const ASSETS = [
  './',
  './index.html',
  './softbody.js',
  './softbody.wasm',
  './softbody.data',
  './benchmark.js',
  './fflate.min.js',
  './data/cut_icon.png',
  './data/liver_icon.png',
  './data/portal_icon.png',
  './data/vein_icon.png',
  './data/tumor_icon.png',
  './data/gb_icon.png',
  './data/handleSphere_icon.png',
  './data/deform_icon.png',
  './data/segment_icon.png',
  './data/transform_icon.png',
  './data/reset_icon.png',
];

// install: プリキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching assets');
      return cache.addAll(ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// activate: 古いキャッシュ削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// fetch: 軽量ハンドラ
// - GET 以外 → 素通し
// - 別オリジン(Firebase, Google APIs等) → 素通し
// - 同一オリジン GET のみ cache-first
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone).catch(() => {});
          });
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 503 });
      });
    })
  );
});

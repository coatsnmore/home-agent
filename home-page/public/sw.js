// Service Worker for Home Agent PWA
const CACHE_NAME = 'home-agent-v1';
const CDN_CACHE_NAME = 'home-agent-cdn-v1';
const urlsToCache = [
  '/index.html',
  '/src/main.js',
  '/src/style.css',
  '/vite.svg'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        // Open CDN cache
        return caches.open(CDN_CACHE_NAME);
      })
      .then(() => {
        console.log('Service worker installed');
        // Force activation of new service worker
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== CDN_CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip caching for API requests and A2A server requests
  if (url.pathname.startsWith('/api/') || 
      (url.hostname === 'localhost' && (url.port === '9001' || url.port === '9002')) ||
      (url.hostname === '127.0.0.1' && (url.port === '9001' || url.port === '9002'))) {
    // Always fetch from network for API requests
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Cache CDN files (jsdelivr, huggingface, etc.) for offline use
  if (url.hostname === 'cdn.jsdelivr.net' || 
      url.hostname === 'huggingface.co' ||
      url.hostname.endsWith('.huggingface.co')) {
    event.respondWith(
      caches.open(CDN_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            // Return cached version
            return cachedResponse;
          }
          
          // Fetch from network and cache it
          return fetch(event.request).then((response) => {
            // Only cache successful responses
            if (response.status === 200) {
              // Clone the response because it can only be consumed once
              const responseToCache = response.clone();
              cache.put(event.request, responseToCache).catch((err) => {
                console.warn('Failed to cache CDN resource:', event.request.url, err);
              });
            }
            return response;
          }).catch((error) => {
            console.error('Failed to fetch CDN resource:', event.request.url, error);
            throw error;
          });
        });
      })
    );
    return;
  }
  
  // For other requests, try cache first, then network
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Fetch from network and optionally cache
        return fetch(event.request).then((response) => {
          // Cache successful responses for static assets
          if (response.status === 200 && 
              (url.pathname.endsWith('.js') || 
               url.pathname.endsWith('.css') || 
               url.pathname.endsWith('.html') ||
               url.pathname.endsWith('.svg'))) {
            const responseToCache = response.clone();
            cache.put(event.request, responseToCache).catch((err) => {
              console.warn('Failed to cache resource:', event.request.url, err);
            });
          }
          return response;
        });
      });
    })
  );
});


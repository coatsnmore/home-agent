// Service Worker for Home Agent PWA
const CACHE_NAME = 'home-agent-v1';
const urlsToCache = [
  '/',
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
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
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
  
  // For other requests, try cache first, then network
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
  );
});


"use strict";

/* Service worker: network-first with cache fallback.
   Online visits always get the latest deploy; offline visits get the
   last version seen. Everything the app needs (including the GIF
   worker) is precached so exports work offline too. */

const CACHE = "playbook-v2";

const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "export.js",
  "backup.js",
  "gif.js",
  "gif.worker.js",
  "qr.js",
  "manifest.webmanifest",
  "assets/logo.png",
  "assets/favicon.ico",
  "assets/favicon-32.png",
  "assets/apple-touch-icon.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => {
          if (hit) return hit;
          if (req.mode === "navigate") return caches.match("index.html");
          return Response.error();
        })
      )
  );
});

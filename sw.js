/* 오프라인에서도 열리도록 앱 파일을 저장해 두는 서비스 워커 */
const CACHE = "wheretogo-v2";
const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/data.js",
  "js/char-images.js",
  "js/storage.js",
  "js/characters.js",
  "js/backup.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putInCache(req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 앱 파일: 네트워크 먼저 (항상 최신), 안 되면 저장본
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => putInCache(req, res))
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
    );
    return;
  }

  // 구글 폰트: 저장본 먼저, 뒤에서 갱신
  if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => putInCache(req, res)).catch(() => hit);
        return hit || net;
      })
    );
  }
});

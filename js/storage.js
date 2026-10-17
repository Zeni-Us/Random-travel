/* 사진 저장소 — IndexedDB (localStorage보다 훨씬 많이 담을 수 있어요)
   여행 사진(p_…)과 내가 넣은 캐릭터 그림(char:…)을 함께 보관해요. */
(function () {
  var DB_NAME = "wheretogo", STORE = "photos";
  var dbPromise = null;
  var urlCache = {};

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var req = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(req && req.result); };
        t.onerror = t.onabort = function () { reject(t.error); };
      });
    });
  }

  function newId() {
    return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function forget(id) {
    if (urlCache[id]) { URL.revokeObjectURL(urlCache[id]); delete urlCache[id]; }
  }

  function putWithId(id, blob) {
    forget(id);
    return run("readwrite", function (s) { return s.put({ id: id, blob: blob, created: Date.now() }); })
      .then(function () { return id; });
  }

  function put(blob) { return putWithId(newId(), blob); }

  function getBlob(id) {
    return run("readonly", function (s) { return s.get(id); }).then(function (row) { return row ? row.blob : null; });
  }

  function url(id) {
    if (urlCache[id]) return Promise.resolve(urlCache[id]);
    return getBlob(id).then(function (blob) {
      if (!blob) return null;
      urlCache[id] = URL.createObjectURL(blob);
      return urlCache[id];
    });
  }

  function del(id) {
    forget(id);
    return run("readwrite", function (s) { return s.delete(id); }).catch(function () {});
  }

  function keys() {
    return run("readonly", function (s) { return s.getAllKeys(); });
  }

  function clearAll() {
    Object.keys(urlCache).forEach(forget);
    return run("readwrite", function (s) { return s.clear(); });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var src = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(src); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(src); reject(new Error("image load failed")); };
      img.src = src;
    });
  }

  function canvas(w, h) {
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    return cv;
  }

  function toBlob(cv, type, quality) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) { b ? resolve(b) : reject(new Error("toBlob failed")); }, type, quality);
    });
  }

  /* 고품질 축소: 한 번에 크게 줄이면 뭉개지니까 반씩 여러 번 나눠서 줄여요 */
  function shrink(src, sx, sy, sw, sh, tw, th) {
    var cur = canvas(sw, sh);
    cur.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    while (cur.width / 2 >= tw && cur.height / 2 >= th) {
      var half = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
      var hc = half.getContext("2d");
      hc.imageSmoothingQuality = "high";
      hc.drawImage(cur, 0, 0, half.width, half.height);
      cur = half;
    }
    var out = canvas(tw, th);
    var oc = out.getContext("2d");
    oc.imageSmoothingQuality = "high";
    oc.drawImage(cur, 0, 0, tw, th);
    return out;
  }

  /* 여행 사진: 긴 변 maxSide px로 줄여서 저장 */
  function compress(file, maxSide, type, quality) {
    return loadImage(file).then(function (img) {
      var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      var cv = scale < 1 ? shrink(img, 0, 0, img.naturalWidth, img.naturalHeight, w, h) : canvas(w, h);
      var ctx = cv.getContext("2d");
      if (scale === 1) ctx.drawImage(img, 0, 0);
      if (type === "image/jpeg") {
        var flat = canvas(w, h), fc = flat.getContext("2d");
        fc.fillStyle = "#fff"; fc.fillRect(0, 0, w, h); fc.drawImage(cv, 0, 0);
        cv = flat;
      }
      return toBlob(cv, type, quality);
    });
  }

  /* 캐릭터 그림: 크기가 제각각이어도 똑같이 보이게 맞춰요
     1) 투명한 여백을 잘라내고  2) 정사각형 가운데·아래쪽에 세운 뒤
     3) maxSide보다 클 때만 고품질로 줄여요 (작으면 원본 픽셀 그대로) */
  function prepareCharacter(file, maxSide) {
    maxSide = maxSide || 1024;
    return loadImage(file).then(function (img) {
      var W = img.naturalWidth, H = img.naturalHeight;
      // 아주 큰 그림은 여백 찾기 전에 먼저 4096px로 줄여서 폰 메모리를 아껴요
      var pre = Math.min(1, 4096 / Math.max(W, H));
      var src = pre < 1 ? shrink(img, 0, 0, W, H, Math.round(W * pre), Math.round(H * pre)) : canvas(W, H);
      if (pre === 1) src.getContext("2d").drawImage(img, 0, 0);
      W = src.width; H = src.height;

      var data = src.getContext("2d").getImageData(0, 0, W, H).data;
      var minX = W, minY = H, maxX = -1, maxY = -1;
      for (var y = 0; y < H; y++) {
        var row = y * W * 4;
        for (var x = 0; x < W; x++) {
          if (data[row + x * 4 + 3] > 10) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; }
      var bw = maxX - minX + 1, bh = maxY - minY + 1;

      var pad = Math.round(Math.max(bw, bh) * 0.03);
      var side = Math.max(bw, bh) + pad * 2;
      var S = Math.min(side, maxSide), k = S / side;
      var out = canvas(S, S), oc = out.getContext("2d");
      var dw = Math.round(bw * k), dh = Math.round(bh * k);
      var dx = Math.round((S - dw) / 2), dy = S - Math.round(pad * k) - dh;
      if (k === 1) oc.drawImage(src, minX, minY, bw, bh, dx, dy, bw, bh);
      else oc.drawImage(shrink(src, minX, minY, bw, bh, dw, dh), dx, dy);
      return toBlob(out, "image/png");
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(function (r) { return r.blob(); });
  }

  /* 브라우저에게 "이 앱 데이터는 함부로 지우지 마" 요청 */
  function askPersist() {
    if (!(navigator.storage && navigator.storage.persist)) return Promise.resolve(false);
    return navigator.storage.persisted()
      .then(function (yes) { return yes || navigator.storage.persist(); })
      .catch(function () { return false; });
  }

  window.Photos = {
    put: put, putWithId: putWithId, getBlob: getBlob, url: url, del: del, keys: keys, clearAll: clearAll,
    compress: compress, prepareCharacter: prepareCharacter,
    blobToDataUrl: blobToDataUrl, dataUrlToBlob: dataUrlToBlob, askPersist: askPersist
  };
})();

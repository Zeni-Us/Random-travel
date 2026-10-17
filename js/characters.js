/* 작고 귀여운 친구들 — 직접 그린 오마주 SVG
   그림을 넣으면 표정별로 그 그림을 쓰고, 없는 표정은 같은 캐릭터의 다른 그림 → SVG 순으로 채워요.
   그림 출처 우선순위: 설정에서 넣은 그림 > js/char-images.js에 등록한 그림 > SVG */
(function () {
  var OL = "#4a3a33";       // 손그림 느낌의 진한 갈색 외곽선
  var SW = 2.8;
  var WHITE = "#ffffff";
  var BLUE = "#7d9fd8";      // 하치와레 무늬
  var YELLOW = "#ffe38f";    // 우사기
  var BLUSH = "#ffb3c4";
  var MOUTH = "#e46a7c";
  var uid = 0;

  var SLOTS = [
    { key: "chiikawa-normal", name: "chiikawa", mood: "normal", label: "기본" },
    { key: "chiikawa-happy", name: "chiikawa", mood: "happy", label: "웃음" },
    { key: "chiikawa-wow", name: "chiikawa", mood: "wow", label: "놀람" },
    { key: "chiikawa-cry", name: "chiikawa", mood: "cry", label: "울음" },
    { key: "hachiware-normal", name: "hachiware", mood: "normal", label: "기본" },
    { key: "hachiware-happy", name: "hachiware", mood: "happy", label: "웃음" },
    { key: "usagi-happy", name: "usagi", mood: "happy", label: "웃음" },
    { key: "usagi-wow", name: "usagi", mood: "wow", label: "놀람" }
  ];
  var FALLBACK_ORDER = ["happy", "normal", "wow", "cry"];
  var LIST_KEY = "wheretogo.chars.v2";
  var bundled = window.CHAR_IMAGES || {};
  var custom = {}; // slot → object URL (IndexedDB에 있는 그림)
  try { localStorage.removeItem("wheretogo.chars.v1"); } catch (e) { /* 예전 형식 정리 */ }

  function savedSlots() {
    try { return JSON.parse(localStorage.getItem(LIST_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveSlots(keys) {
    try { localStorage.setItem(LIST_KEY, JSON.stringify(keys)); } catch (e) { /* 목록은 작아서 거의 안 남 */ }
  }

  function shape(tag, attrs, fill) {
    var s = "<" + tag;
    for (var k in attrs) s += " " + k + '="' + attrs[k] + '"';
    s += ' fill="' + (fill || WHITE) + '" stroke="' + OL + '" stroke-width="' + SW + '" stroke-linejoin="round"/>';
    return s;
  }

  function eyes(mood, lx, rx, y, small) {
    var r = small ? 3.6 : 4.4, ry = small ? 3.9 : 5.7;
    if (mood === "happy") {
      var w = small ? 4 : 5;
      return '<g class="eyes" fill="none" stroke="' + OL + '" stroke-width="' + SW + '" stroke-linecap="round">' +
        '<path d="M' + (lx - w) + " " + (y + 1.5) + " Q" + lx + " " + (y - 5.5) + " " + (lx + w) + " " + (y + 1.5) + '"/>' +
        '<path d="M' + (rx - w) + " " + (y + 1.5) + " Q" + rx + " " + (y - 5.5) + " " + (rx + w) + " " + (y + 1.5) + '"/></g>';
    }
    if (mood === "wow") { r += 0.9; ry += 1.1; }
    var g = '<g class="eyes">';
    [lx, rx].forEach(function (x) {
      g += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r + '" ry="' + ry + '" fill="' + OL + '"/>';
      g += '<circle cx="' + (x + r * 0.32) + '" cy="' + (y - ry * 0.34) + '" r="' + (small ? 1.2 : 1.7) + '" fill="#fff"/>';
      if (mood === "wow") g += '<circle cx="' + (x - r * 0.35) + '" cy="' + (y + ry * 0.4) + '" r="0.9" fill="#fff"/>';
    });
    g += "</g>";
    if (mood === "cry") {
      [lx, rx].forEach(function (x) {
        g += '<path class="tear" d="M' + x + " " + (y + ry + 1) + " q-3.2 5.5 0 8 q3.2 -2.5 0 -8z" + '" fill="#9fd8ff" stroke="#6fb6e6" stroke-width="1"/>';
      });
    }
    return g;
  }

  function blush(lx, rx, y) {
    var s = "";
    [lx, rx].forEach(function (x) {
      s += '<ellipse cx="' + x + '" cy="' + y + '" rx="7" ry="4" fill="' + BLUSH + '" opacity=".9"/>';
      s += '<path d="M' + (x - 3) + " " + (y - 1.8) + " l-1.6 3.6 M" + x + " " + (y - 1.8) + " l-1.6 3.6 M" + (x + 3) + " " + (y - 1.8) + ' l-1.6 3.6" stroke="#ff8aa6" stroke-width="1.2" stroke-linecap="round"/>';
    });
    return s;
  }

  function line(d) {
    return '<path d="' + d + '" fill="none" stroke="' + OL + '" stroke-width="' + (SW - 0.4) + '" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  function fillPath(d, fill) {
    return '<path d="' + d + '" fill="' + (fill || MOUTH) + '" stroke="' + OL + '" stroke-width="' + (SW - 0.6) + '" stroke-linejoin="round"/>';
  }

  function arms(mood, fill) {
    if (mood === "happy") {
      return shape("ellipse", { cx: 30, cy: 80, rx: 6.5, ry: 9, transform: "rotate(-30 30 80)" }, fill) +
             shape("ellipse", { cx: 90, cy: 80, rx: 6.5, ry: 9, transform: "rotate(30 90 80)" }, fill);
    }
    return shape("ellipse", { cx: 38, cy: 94, rx: 6.5, ry: 8.5, transform: "rotate(35 38 94)" }, fill) +
           shape("ellipse", { cx: 82, cy: 94, rx: 6.5, ry: 8.5, transform: "rotate(-35 82 94)" }, fill);
  }

  function shadow() { return '<ellipse cx="60" cy="116" rx="24" ry="3.5" fill="#000" opacity=".08"/>'; }

  function chiikawa(mood) {
    var mouth = {
      normal: line("M55 71 q2.5 3 5 0 q2.5 3 5 0"),
      happy: fillPath("M53.5 69.5 Q60 79 66.5 69.5 Q60 71.5 53.5 69.5 Z"),
      cry: line("M53 74 q3.5 -3.5 7 0 q3.5 3.5 7 0"),
      wow: '<ellipse cx="60" cy="72.5" rx="3.6" ry="4.6" fill="' + MOUTH + '" stroke="' + OL + '" stroke-width="2.2"/>'
    }[mood];
    return shadow() + '<g class="ch-bob">' +
      shape("ellipse", { cx: 60, cy: 99, rx: 25, ry: 15.5 }) +
      arms(mood, WHITE) +
      shape("circle", { cx: 34, cy: 33, r: 9.5 }) +
      shape("circle", { cx: 86, cy: 33, r: 9.5 }) +
      shape("ellipse", { cx: 60, cy: 61, rx: 38, ry: 31 }) +
      eyes(mood, 47, 73, 62) + blush(37, 83, 71) + mouth + "</g>";
  }

  function hachiware(mood) {
    var id = "hwclip" + (++uid);
    var mouth = {
      normal: line("M53 69 q3.5 4 7 0 q3.5 4 7 0"),
      happy: line("M53 68 q3.5 4 7 0 q3.5 4 7 0") + fillPath("M55.5 71 Q60 79 64.5 71 Q60 72.5 55.5 71 Z"),
      cry: line("M53 70 q3.5 4 7 0 q3.5 4 7 0") + line("M55 77 q5 -3 10 0"),
      wow: line("M53 68 q3.5 4 7 0 q3.5 4 7 0") + '<ellipse cx="60" cy="74.5" rx="3" ry="3.8" fill="' + MOUTH + '" stroke="' + OL + '" stroke-width="2"/>'
    }[mood];
    var head = { cx: 60, cy: 61, rx: 38, ry: 31 };
    return shadow() + '<g class="ch-bob">' +
      '<defs><clipPath id="' + id + '"><ellipse cx="60" cy="61" rx="38" ry="31"/></clipPath></defs>' +
      shape("ellipse", { cx: 60, cy: 99, rx: 25, ry: 15.5 }) +
      arms(mood, WHITE) +
      shape("path", { d: "M26 46 L29 13 L55 32 Z" }, BLUE) +
      shape("path", { d: "M94 46 L91 13 L65 32 Z" }, BLUE) +
      '<path d="M31 37 L32 21 L45 31 Z M89 37 L88 21 L75 31 Z" fill="#ffc6d3"/>' +
      '<ellipse cx="60" cy="61" rx="38" ry="31" fill="' + WHITE + '"/>' +
      '<path clip-path="url(#' + id + ')" d="M0 0 H120 V57 Q103 45 72 47 Q64 42 60 35 Q56 42 48 47 Q17 45 0 57 Z" fill="' + BLUE + '"/>' +
      '<ellipse cx="60" cy="61" rx="38" ry="31" fill="none" stroke="' + OL + '" stroke-width="' + SW + '"/>' +
      eyes(mood, 47, 73, 62) + blush(37, 83, 71) + mouth + "</g>";
  }

  function usagi(mood) {
    var mouth = {
      normal: fillPath("M52.5 72 Q60 84 67.5 72 Q60 75 52.5 72 Z"),
      happy: fillPath("M50 70.5 Q60 88 70 70.5 Q60 74.5 50 70.5 Z") + '<path d="M55 79 Q60 83.5 65 79 Q60 77 55 79Z" fill="#ff9aa9"/>',
      cry: fillPath("M53 77 Q60 70 67 77 Q60 79 53 77 Z"),
      wow: '<ellipse cx="60" cy="76" rx="5" ry="7" fill="' + MOUTH + '" stroke="' + OL + '" stroke-width="2.2"/>'
    }[mood];
    return shadow() + '<g class="ch-bob">' +
      shape("ellipse", { cx: 60, cy: 100, rx: 23, ry: 14.5 }, YELLOW) +
      arms(mood, YELLOW) +
      shape("ellipse", { cx: 45, cy: 27, rx: 8.5, ry: 23, transform: "rotate(-9 45 27)" }, YELLOW) +
      shape("ellipse", { cx: 75, cy: 27, rx: 8.5, ry: 23, transform: "rotate(9 75 27)" }, YELLOW) +
      '<path d="M45 13 q-2 12 0 26 M75 13 q2 12 0 26" fill="none" stroke="#f3c95c" stroke-width="2.2" stroke-linecap="round"/>' +
      shape("ellipse", { cx: 60, cy: 65, rx: 35, ry: 28 }, YELLOW) +
      eyes(mood, 49, 71, 63, true) + blush(39, 81, 72) + mouth + "</g>";
  }

  var DRAW = { chiikawa: chiikawa, hachiware: hachiware, usagi: usagi };
  var NAMES = { chiikawa: "치이카와", hachiware: "하치와레", usagi: "우사기" };

  // 표정에 딱 맞는 그림 → 같은 캐릭터의 다른 그림 → 없으면 null (SVG)
  function imageFor(name, mood) {
    var k = name + "-" + mood, i, c;
    if (custom[k]) return custom[k];
    if (bundled[k]) return bundled[k];
    for (i = 0; i < FALLBACK_ORDER.length; i++) { c = name + "-" + FALLBACK_ORDER[i]; if (custom[c]) return custom[c]; }
    for (i = 0; i < FALLBACK_ORDER.length; i++) { c = name + "-" + FALLBACK_ORDER[i]; if (bundled[c]) return bundled[c]; }
    return null;
  }

  function render(name, mood) {
    if (!DRAW[name]) return "";
    mood = /^(normal|happy|cry|wow)$/.test(mood) ? mood : "normal";
    var src = imageFor(name, mood);
    if (src) return '<img class="char-img" src="' + src + '" alt="' + NAMES[name] + '" decoding="async" draggable="false">';
    return '<svg class="char-svg" viewBox="0 0 120 120" role="img" aria-label="' + NAMES[name] + '">' + DRAW[name](mood) + "</svg>";
  }

  function hydrate(root) {
    (root || document).querySelectorAll("[data-char]").forEach(function (el) {
      el.innerHTML = render(el.getAttribute("data-char"), el.getAttribute("data-mood"));
    });
  }

  function tag(name, mood, cls) {
    return '<span class="char ' + (cls || "") + '" data-char="' + name + '" data-mood="' + (mood || "normal") + '">' + render(name, mood) + "</span>";
  }

  /* 설정에서 넣은 그림은 IndexedDB에 "char:슬롯이름"으로 저장돼요 */
  function init() {
    var keys = savedSlots();
    if (!keys.length) return Promise.resolve();
    var root = document.documentElement;
    root.classList.add("chars-loading");
    return Promise.all(keys.map(function (k) {
      return Photos.url("char:" + k).then(function (u) { if (u) custom[k] = u; });
    })).catch(function () {}).then(function () {
      root.classList.remove("chars-loading");
      hydrate(document);
    });
  }

  function setCustom(slot, blob) {
    if (!blob) {
      delete custom[slot];
      saveSlots(Object.keys(custom));
      return Photos.del("char:" + slot);
    }
    return Photos.putWithId("char:" + slot, blob)
      .then(function () { return Photos.url("char:" + slot); })
      .then(function (u) { custom[slot] = u; saveSlots(Object.keys(custom)); });
  }

  window.Chars = {
    render: render, hydrate: hydrate, tag: tag, init: init, setCustom: setCustom,
    hasCustom: function (slot) { return !!custom[slot]; },
    customSlots: function () { return Object.keys(custom); },
    replaceSlotList: saveSlots,
    SLOTS: SLOTS, NAMES: NAMES, LIST: ["chiikawa", "hachiware", "usagi"]
  };
})();

/* 여행 도구 — 지도 링크 · 지도에서 복사한 장소 읽기 · AI 일정 질문 만들기/답 읽기 (화면과 상관없는 계산만) */
(function () {
  "use strict";

  const MAP_APPS = { naver: "네이버지도", kakao: "카카오맵" };

  const SEARCH_KINDS = [
    { code: "food", label: "맛집", emoji: "🍜", q: { naver: "맛집", kakao: "맛집" } },
    { code: "cafe", label: "카페", emoji: "☕", q: { naver: "카페", kakao: "카페" } },
    { code: "sight", label: "관광지", emoji: "📸", q: { naver: "가볼만한곳", kakao: "관광명소" } },
    { code: "stay", label: "숙소", emoji: "🏨", q: { naver: "숙소", kakao: "숙박" } }
  ];

  /* ================= 지도 링크 ================= */
  function searchUrl(app, query) {
    const q = encodeURIComponent(query.trim());
    return app === "kakao" ? `https://map.kakao.com/link/search/${q}` : `https://map.naver.com/p/search/${q}`;
  }

  // 길찾기 (현재 위치 → 목적지, 자동차)
  // 카카오: 공개 웹 링크 / 네이버: 공개된 웹 길찾기 주소가 없어 공식 앱 주소(nmap://)를 쓰고, 앱이 없을 때는 검색으로
  function route(app, name, lat, lng) {
    const label = name.replace(/,/g, " ");
    if (app === "kakao") return { web: `https://map.kakao.com/link/to/${encodeURIComponent(label)},${lat},${lng}` };
    const appname = encodeURIComponent(location.origin + location.pathname);
    const query = `dlat=${lat}&dlng=${lng}&dname=${encodeURIComponent(label)}&appname=${appname}`;
    const fallback = searchUrl("naver", name);
    return {
      app: `nmap://route/car?${query}`,
      // 안드로이드: 앱이 없으면 브라우저가 알아서 fallback 주소로 이동
      intent: `intent://route/car?${query}#Intent;scheme=nmap;package=com.nhn.android.nmap;S.browser_fallback_url=${encodeURIComponent(fallback)};end`,
      fallback
    };
  }

  /* ================= 지도에서 복사한 장소 읽기 ================= */
  const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
  const APP_WORDS = "(네이버\\s*지도|네이버\\s*플레이스|naver\\s*map|카카오\\s*맵|카카오\\s*지도|kakao\\s*map|google\\s*maps?|구글\\s*지도)";
  const TAG_RE = new RegExp(`^[\\[【(]\\s*${APP_WORDS}\\s*[\\]】)]\\s*`, "i");
  const TAIL_RE = new RegExp(`\\s*[-:|·]\\s*${APP_WORDS}.*$`, "i");
  const APP_ONLY_RE = new RegExp(`^${APP_WORDS}$`, "i");
  const CHECK_RE = /(?:지도|맵|map)에서\s*(.+?)\s*(?:정보)?\s*(?:을|를)?\s*(?:확인|보세요|보기)/i; // "카카오맵에서 ○○을 확인해보세요"
  const BOILER_RE = /(확인해\s*보?세요|공유합니다|앱에서\s*(열기|보기)|자세히\s*보기|길찾기|지도\s*보기|^링크$|^지도$|^공유$)/;
  const ADDR_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)\S*\s+\S/;
  const ADDR_UNIT_RE = /\S(시|군|구|읍|면|동|로|길|리)(\s|\d|$)/;
  const ROAD_RE = /\S(로|길)\s?\d|\d+-\d+\s*$|\S(읍|면|동|리)\s+\d/;
  const PHONE_RE = /^(tel[.:\s]*|전화[:\s]*)?0\d{1,2}[-.\s)]*\d{3,4}[-.\s]*\d{4}$/i;
  // "부산 어묵"처럼 지역 이름으로 시작하는 가게 이름은 주소로 보지 않아요
  const isAddress = (line) => (ADDR_RE.test(line) && ADDR_UNIT_RE.test(line)) || (ROAD_RE.test(line) && /\d/.test(line) && line.length > 6);

  function sourceOf(url) {
    let h = "";
    try { h = new URL(url).hostname.toLowerCase(); } catch (e) { return "web"; }
    if (/(^|\.)naver\.(me|com)$/.test(h)) return "naver";
    if (/(^|\.)kko\.to$|(^|\.)kakao\.com$/.test(h)) return "kakao";
    if (/(^|\.)google\.|(^|\.)goo\.gl$/.test(h)) return "google";
    return "web";
  }
  const SOURCE_LABEL = { naver: "네이버지도", kakao: "카카오맵", google: "구글지도", web: "링크", text: "직접 적은 장소" };

  function tidyLine(line) {
    return line
      .replace(/^\s*(?:\d{1,2}[.)]|[-*•·▶▷✔✅📍🗺️]+)\s*/u, "")
      .replace(TAG_RE, "")
      .replace(TAIL_RE, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 글 덩어리 하나에서 장소 이름·주소 찾기
  function readChunk(text) {
    let name = "", address = "";
    for (const raw of text.split(/\n/)) {
      const check = raw.match(CHECK_RE);
      if (check && !name) { name = tidyLine(check[1]); continue; }
      const line = tidyLine(raw);
      if (!line || APP_ONLY_RE.test(line) || PHONE_RE.test(line)) continue;
      if (isAddress(line)) {
        if (!address) address = line;
        continue;
      }
      if (BOILER_RE.test(line)) continue;
      if (!name) name = line;
    }
    return { name: name.slice(0, 60), address: address.slice(0, 120) };
  }

  // 붙여넣은 글 → [{ name, address, url, source }]  (여러 곳을 한꺼번에 붙여도 하나씩 나눠요)
  function parseShared(input) {
    const text = String(input || "").replace(/\r\n?/g, "\n");
    const found = [];
    const urls = [];
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text))) {
      const url = m[0].replace(/[)\]}>.,;:!?'"’”]+$/, "");
      urls.push({ url, start: m.index, end: m.index + m[0].length });
    }

    if (!urls.length) {
      // 링크 없이 장소 이름만 줄줄이 적은 경우: 한 줄 = 한 곳
      for (const raw of text.split("\n")) {
        const { name } = readChunk(raw);
        if (name && !isAddress(name)) found.push({ name, address: "", url: "", source: "text" });
      }
      return found.slice(0, 30);
    }

    // 이름이 링크 앞에 오는 형식(대부분)인지, 링크 뒤에 오는 형식인지 판단
    const before = (i) => text.slice(i === 0 ? 0 : urls[i - 1].end, urls[i].start);
    const after = (i) => text.slice(urls[i].end, i + 1 < urls.length ? urls[i + 1].start : text.length);
    const nameFirst = !!readChunk(before(0)).name || !readChunk(after(0)).name;

    const seen = new Set();
    urls.forEach((u, i) => {
      if (seen.has(u.url)) return;
      seen.add(u.url);
      let info = readChunk(nameFirst ? before(i) : after(i));
      if (!info.name && nameFirst && i === urls.length - 1) info = readChunk(after(i));
      found.push({ name: info.name, address: info.address, url: u.url, source: sourceOf(u.url) });
    });
    return found.slice(0, 30);
  }

  /* ================= AI 일정 질문 만들기 ================= */
  const pad = (n) => String(n).padStart(2, "0");
  function dateText(s) {
    if (!s) return "";
    const [y, mo, d] = s.split("-").map(Number);
    const dt = new Date(y, mo - 1, d);
    return `${y}년 ${mo}월 ${d}일(${"일월화수목금토"[dt.getDay()]})`;
  }

  // o = { place, days, people, budget(1인 만원, 교통 제외), from, move, styles[], must[], request, start }
  function buildPrompt(o) {
    const p = o.place;
    const nights = Math.max(0, o.days - 1);
    const period = nights ? `${nights}박 ${o.days}일` : "당일치기";
    const lines = [
      `${p.name}(${p.region}) ${period} 국내 여행 일정을 짜 줘.`,
      "",
      "[여행 조건]",
      `- 여행지: ${p.name} (${p.desc})`,
      o.start ? `- 출발일: ${dateText(o.start)} — 계절과 요일을 고려해 줘` : null,
      `- 인원: ${o.people}명`,
      o.from ? `- 출발지: ${o.from} (가는 길과 돌아오는 길 이동 시간·교통비도 계산해 줘)` : "- 출발지: 정하지 않음 (현지 일정만)",
      `- 이동 수단: ${o.move === "public" ? "대중교통 (기차·버스·택시)" : "자동차"}`,
      o.styles.length ? `- 여행 스타일: ${o.styles.join(", ")}` : null,
      o.budget ? `- 예산: 1인 약 ${o.budget}만원 (오가는 교통비 제외)` : null,
      o.must.length ? `- 꼭 넣을 장소: ${o.must.join(", ")} — 모두 넣되 동선에 맞게 순서를 정리해 줘` : null,
      o.request ? `- 요청 사항: ${o.request}` : null,
      "",
      "[짜는 방법]",
      "- 실제로 있는 장소만 써 줘. 확실하지 않으면 지역 이름 + 종류(예: \"주문진 수산시장 횟집\")로 적어 줘.",
      "- 가까운 곳끼리 묶어서 왔다 갔다 하지 않게 동선을 짜 줘.",
      "- 식사(아침·점심·저녁)와 카페, 숙소 체크인도 일정에 넣어 줘.",
      "- 예상 비용은 2026년 물가 기준으로 현실적으로 잡아 줘.",
      "",
      "[답변 형식]",
      "1) 먼저 사람이 읽기 좋게 날짜별 일정과 예산을 보여 줘.",
      "2) 맨 마지막에 아래 형식의 JSON 코드 블록을 꼭 붙여 줘. 내 여행 앱에 그대로 붙여넣을 거야.",
      "   - time은 24시간 \"HH:MM\", place는 장소 이름만, memo는 한 줄 설명과 예상 비용",
      "   - budget은 전체 인원 합계 금액(원, 숫자만): transport 교통, stay 숙박, food 식비, activity 관광·체험, etc 쇼핑·기타",
      "   - JSON 안에는 주석을 넣지 마",
      "",
      "```json",
      JSON.stringify({
        app: "wheretogo",
        days: [{ stops: [{ time: "10:00", place: "장소 이름", memo: "한 줄 설명 · 1인 1만원" }] }],
        budget: { transport: 0, stay: 0, food: 0, activity: 0, etc: 0, people: o.people },
        tips: ["여행 팁 한 줄"]
      }, null, 2),
      "```"
    ];
    return lines.filter((l) => l !== null).join("\n");
  }

  /* ================= AI 답 읽기 ================= */
  const num = (v) => {
    if (typeof v === "number") return Math.max(0, Math.round(v));
    const n = Number(String(v || "").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  };
  function normTime(v) {
    const m = String(v || "").match(/(\d{1,2})\s*[:시]\s*(\d{2})?/);
    if (!m) return "";
    const h = Number(m[1]), mi = Number(m[2] || 0);
    return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : "";
  }

  function tryJson(s) {
    const variants = [
      s,
      s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"),
      s.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1")
    ];
    for (const v of variants) {
      try { return JSON.parse(v); } catch (e) { /* 다음 방법 */ }
    }
    return null;
  }

  // AI 답 전체(또는 코드 블록만) → { plan, cost, tips } / 못 읽으면 null
  function parseAiReply(text) {
    const src = String(text || "");
    const cands = [];
    const fence = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
    let m;
    while ((m = fence.exec(src))) cands.unshift(m[1]); // 마지막 코드 블록부터
    const a = src.indexOf("{"), b = src.lastIndexOf("}");
    if (a >= 0 && b > a) cands.push(src.slice(a, b + 1));

    for (const c of cands) {
      const obj = tryJson(c.trim());
      const days = obj && (Array.isArray(obj.days) ? obj.days : Array.isArray(obj.plan) ? obj.plan : null);
      if (!days || !days.length) continue;

      const plan = days.slice(0, 30).map((d) => {
        const stops = Array.isArray(d) ? d : (d && (d.stops || d.schedule || d.items)) || [];
        return {
          stops: stops.slice(0, 50).map((s) => ({
            t: normTime(s && (s.time || s.t)),
            p: String((s && (s.place || s.p || s.name)) || "").trim().slice(0, 60),
            m: String((s && (s.memo || s.m || s.note || s.desc)) || "").trim().slice(0, 120)
          })).filter((s) => s.p || s.m)
        };
      }).filter((d) => d.stops.length);
      if (!plan.length) continue;

      const bg = (obj.budget && typeof obj.budget === "object") ? obj.budget : {};
      const cost = {
        tr: num(bg.transport ?? bg.tr), st: num(bg.stay ?? bg.st), fd: num(bg.food ?? bg.fd),
        ac: num(bg.activity ?? bg.ac), et: num(bg.etc ?? bg.et), ppl: Math.min(50, Math.max(1, num(bg.people ?? bg.ppl) || 1))
      };
      const hasCost = cost.tr + cost.st + cost.fd + cost.ac + cost.et > 0;
      const tips = (Array.isArray(obj.tips) ? obj.tips : obj.tips ? [obj.tips] : [])
        .map((t) => String(t).trim().slice(0, 140)).filter(Boolean).slice(0, 5);
      return { plan, cost: hasCost ? cost : null, tips };
    }
    return null;
  }

  window.TripTools = { MAP_APPS, SEARCH_KINDS, SOURCE_LABEL, searchUrl, route, parseShared, isAddress, buildPrompt, parseAiReply };
})();

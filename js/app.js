(function () {
  "use strict";

  const PLACES = window.PLACES;
  const BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));
  const AREAS = window.AREAS, TIERS = window.BUDGET_TIERS, TYPES = window.TRAVEL_TYPES;
  const AREA = Object.fromEntries(AREAS.map((a) => [a.code, a]));
  const TIER = Object.fromEntries(TIERS.map((t) => [t.code, t]));
  const TYPE = Object.fromEntries(TYPES.map((t) => [t.code, t]));
  const COST_FIELDS = [["tr", "🚗 교통"], ["st", "🏨 숙박"], ["fd", "🍽️ 식비"], ["ac", "🎟️ 관광·체험"], ["et", "🛍️ 쇼핑·기타"]];
  const PAGE_SIZE = 10;
  const KEY = "wheretogo.v1";
  const TAU = Math.PI * 2;
  const FILTERS = ["all", "visited", "notyet", "planned"];
  const WHEEL_COLORS = ["#ffd3de", "#fff0a6", "#cdeee0", "#d3e5ff", "#e8dcff", "#ffe2c6"];
  const INK = "#4a3a33";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mod = (x, m) => ((x % m) + m) % m;
  const pad = (n) => String(n).padStart(2, "0");

  /* ================= 상태 ================= */
  // places[id] = { selected, visited, planned, visitedAt, date, memo, photos: [photoId],
  //               plan: [{ stops: [{ t: "10:00", p: "장소", m: "메모" }] }],   // 일정표 (하루씩)
  //               cost: { tr, st, fd, ac, et, ppl } }                         // 쓴 돈 / 예상 예산 (원)
  // facets = 리스트 필터 { areas: [권역], tiers: [예산 등급], types: [여행 유형] }
  function cleanFacets(f) {
    const pick = (arr, valid) => (Array.isArray(arr) ? arr.filter((x) => valid.includes(x)) : []);
    f = f || {};
    return {
      areas: pick(f.areas, AREAS.map((a) => a.code)),
      tiers: pick(f.tiers, TIERS.map((t) => t.code)),
      types: pick(f.types, TYPES.map((t) => t.code))
    };
  }
  function defaultState() {
    const places = {};
    PLACES.slice(0, 10).forEach((p) => { places[p.id] = { selected: true }; });
    return { places, includeVisited: false, filter: "all", facets: cleanFacets(), mapApp: "naver" };
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.places) {
        const st = Object.assign(defaultState(), s);
        if (!FILTERS.includes(st.filter)) st.filter = "all";
        st.facets = cleanFacets(st.facets);
        st.mapApp = st.mapApp === "kakao" ? "kakao" : "naver";
        return st;
      }
    } catch (e) { /* 처음 실행 */ }
    return defaultState();
  }
  const state = loadState();
  const ui = { page: 1, query: "", spinning: false, rotation: 0, wheelItems: [], wheelKey: "", wheelDirty: false, lastIdx: -1, resultId: null };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast("저장 공간이 부족해요 😢"); }
  }
  const get = (id) => state.places[id] || {};
  const rec = (id) => state.places[id] || (state.places[id] = {});

  function fmtDate(s) { return s ? s.replace(/-/g, ".") : ""; }
  // '부산 부산'처럼 겹치지 않게, 이름과 지역이 같으면 지역은 생략
  const regionOf = (p) => (p.region === p.name ? "" : p.region);
  const regionDesc = (p) => (regionOf(p) ? `${p.region} · ${p.desc}` : p.desc);
  function dday(s) {
    if (!s) return null;
    const [y, m, d] = s.split("-").map(Number);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((new Date(y, m - 1, d) - now) / 86400000);
  }
  function randInt(n) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  }

  function matchFilter(p) {
    const r = get(p.id);
    switch (state.filter) {
      case "visited": return !!r.visited;
      case "notyet": return !r.visited;
      case "planned": return !!r.planned;
      default: return true;
    }
  }
  // 같은 묶음 안에서는 "또는", 묶음끼리는 "그리고" (예: 강원 또는 경상 + 바다)
  function matchFacets(p) {
    const f = state.facets;
    return (!f.areas.length || f.areas.includes(p.area)) &&
      (!f.tiers.length || f.tiers.includes(p.tier)) &&
      (!f.types.length || p.types.some((t) => f.types.includes(t)));
  }
  const facetCount = () => state.facets.areas.length + state.facets.tiers.length + state.facets.types.length;
  function filteredList() {
    const q = ui.query.replace(/\s+/g, "");
    return PLACES.filter((p) => matchFilter(p) && matchFacets(p) &&
      (!q || (p.name + p.region + p.desc + p.types.map((t) => TYPE[t].label).join("")).replace(/\s+/g, "").includes(q)));
  }
  const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
  const manwon = (n) => {
    const v = Math.round(n / 1000) / 10;
    return `${v % 1 ? v.toFixed(1) : v}만원`;
  };
  const costSum = (c) => COST_FIELDS.reduce((s, [k]) => s + (Number(c && c[k]) || 0), 0);
  function candidates() {
    return PLACES.filter((p) => { const r = get(p.id); return r.selected && (state.includeVisited || !r.visited); });
  }

  /* ================= 갈거임 카드 ================= */
  function renderPlanned() {
    const list = PLACES.filter((p) => get(p.id).planned).sort((a, b) => {
      const da = get(a.id).date || "9999", db = get(b.id).date || "9999";
      return da === db ? a.rank - b.rank : da < db ? -1 : 1;
    });
    const box = $("#planned");
    if (!list.length) {
      box.innerHTML = `<div class="planned-empty">${Chars.tag("hachiware", "normal")}<p>아직 가기로 한 곳이 없어요.<br>룰렛을 돌리고 리스트에서 <b>🚩 갈거임</b>을 눌러줘!</p></div>`;
      return;
    }
    box.innerHTML = list.map((p) => {
      const r = get(p.id), dd = dday(r.date);
      let tag = "";
      if (dd !== null) {
        tag = dd > 0 ? `<span class="dday">D-${dd}</span>`
          : dd === 0 ? `<span class="dday today">D-DAY</span>`
          : `<span class="dday">${fmtDate(r.date).slice(5)}</span>`;
      }
      return `<button type="button" class="plan-chip" data-id="${p.id}"><span class="e">${p.emoji}</span>${p.name}${regionOf(p) ? `<small>${p.region}</small>` : ""}${tag}</button>`;
    }).join("");
  }

  /* ================= 룰렛 ================= */
  function renderWheel() {
    const items = candidates();
    const enough = items.length >= 2;
    const selVisited = PLACES.filter((p) => { const r = get(p.id); return r.selected && r.visited; }).length;

    $("#candCount").textContent = `${items.length}곳`;
    $("#candHint").textContent = !state.includeVisited && selVisited
      ? `체크한 곳 중 가봤음 ${selVisited}곳은 빠져 있어요`
      : enough ? `체크한 ${items.length}곳 중에서 하나를 골라줄게요` : "";
    $("#wheelEmpty").hidden = enough;

    if (ui.spinning) { ui.wheelDirty = true; return; }
    $("#spinBtn").disabled = !enough;

    const key = items.map((p) => p.id).join(",");
    if (key !== ui.wheelKey) {
      ui.wheelKey = key;
      ui.lastIdx = -1;
      $("#liveLabel").textContent = enough ? "두근두근… 어디가 나올까?" : "후보를 골라줘!";
    }
    ui.wheelItems = items;
    drawWheel();
  }

  function drawWheel() {
    const cv = $("#wheel");
    const size = cv.clientWidth || 300;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2, R = c - 2;
    const items = ui.wheelItems, n = items.length;

    if (n < 2) {
      for (let i = 0; i < 6; i++) slice(ctx, c, R, (i * TAU) / 6, ((i + 1) * TAU) / 6, WHEEL_COLORS[i], 2);
      rim(ctx, c, R);
      return;
    }
    const a = TAU / n;
    for (let i = 0; i < n; i++) {
      let color = WHEEL_COLORS[i % WHEEL_COLORS.length];
      if (i === n - 1 && n % WHEEL_COLORS.length === 1) color = WHEEL_COLORS[2];
      slice(ctx, c, R, i * a, (i + 1) * a, color, n > 40 ? 0.8 : 2);
    }
    const mode = n <= 12 ? "full" : n <= 24 ? "name" : n <= 48 ? "emoji" : "none";
    if (mode !== "none") {
      const fs = mode === "full" ? Math.round(Math.max(13, Math.min(17, size * 0.054))) : mode === "name" ? 12 : 13;
      ctx.font = `${fs}px Jua, "Gowun Dodum", sans-serif`;
      ctx.fillStyle = INK;
      ctx.textBaseline = "middle";
      items.forEach((p, i) => {
        const mid = (i + 0.5) * a;
        const flip = mid > Math.PI; // 왼쪽 절반은 글자가 거꾸로 보이지 않게 뒤집기
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(-Math.PI / 2 + mid + (flip ? Math.PI : 0));
        ctx.textAlign = flip ? "left" : "right";
        const text = mode === "full" ? (flip ? `${p.emoji} ${p.name}` : `${p.name} ${p.emoji}`) : mode === "name" ? p.name : p.emoji;
        ctx.fillText(text, flip ? -(R - 14) : R - 14, 1);
        ctx.restore();
      });
    }
    rim(ctx, c, R);
  }
  function slice(ctx, c, R, from, to, color, lw) {
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, R, -Math.PI / 2 + from, -Math.PI / 2 + to);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
  function rim(ctx, c, R) {
    ctx.beginPath();
    ctx.arc(c, c, R - 1, 0, TAU);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    for (let i = 0; i < 18; i++) {
      const t = (i * TAU) / 18;
      ctx.beginPath();
      ctx.arc(c + Math.cos(t) * (R - 7), c + Math.sin(t) * (R - 7), 2.2, 0, TAU);
      ctx.fillStyle = i % 2 ? "#ffffff" : "#ff9fb6";
      ctx.fill();
    }
  }

  function setHubMood(mood) {
    const el = $("#hubBtn .char");
    el.setAttribute("data-mood", mood);
    Chars.hydrate($("#hubBtn"));
  }

  function spin() {
    if (ui.spinning) return;
    const items = candidates();
    if (items.length < 2) {
      toast("리스트에서 2곳 이상 골라줘!");
      scrollToSection("sec-list");
      return;
    }
    ui.wheelItems = items;
    ui.wheelKey = items.map((p) => p.id).join(",");
    drawWheel();
    ui.spinning = true;
    ui.wheelDirty = false;
    $(".wheel-card").classList.add("spinning");
    $("#spinBtn").disabled = true;
    setHubMood("wow");

    const n = items.length, a = TAU / n;
    const win = randInt(n);
    // 포인터(맨 위)에 올 각도 — 조각 가운데에서 살짝 흔들어 자연스럽게
    const theta = win * a + a / 2 + (Math.random() - 0.5) * a * 0.7;
    const start = ui.rotation;
    let target = start - mod(start, TAU) + mod(TAU - theta, TAU);
    while (target - start < TAU * 5) target += TAU;
    target += TAU * randInt(2);
    const dur = 4600 + Math.random() * 900;
    const t0 = performance.now();
    const cv = $("#wheel");

    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 4);
      const rot = start + (target - start) * e;
      cv.style.transform = `rotate(${rot}rad)`;
      tickLabel(rot);
      if (t < 1) requestAnimationFrame(frame);
      else finish(target, items[win]);
    }
    requestAnimationFrame(frame);
  }

  function tickLabel(rot) {
    const items = ui.wheelItems, n = items.length;
    const idx = Math.floor(mod(-rot, TAU) / (TAU / n)) % n;
    if (idx === ui.lastIdx) return;
    ui.lastIdx = idx;
    $("#liveLabel").textContent = `${items[idx].emoji} ${items[idx].name}`;
    const ptr = $("#wheelPointer");
    ptr.classList.remove("tick");
    void ptr.getBoundingClientRect();
    ptr.classList.add("tick");
  }

  function finish(target, winner) {
    ui.spinning = false;
    ui.rotation = mod(target, TAU);
    $("#wheel").style.transform = `rotate(${ui.rotation}rad)`;
    $(".wheel-card").classList.remove("spinning");
    setHubMood("happy");
    if (ui.wheelDirty) renderWheel();
    else $("#spinBtn").disabled = false;
    $("#liveLabel").textContent = `🎉 ${winner.emoji} ${winner.name}!`;
    try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) { /* 진동 미지원 */ }
    setTimeout(() => showResult(winner), 380);
  }

  function showResult(p) {
    ui.resultId = p.id;
    $("#resultEmoji").textContent = p.emoji;
    $("#resultName").textContent = p.name;
    $("#resultDesc").textContent = regionDesc(p);
    $("#resultMaps").innerHTML = mapBoxHTML(p);
    openLayer($("#resultModal"));
    confetti();
  }

  /* ================= 지도 버튼 (맛집 · 카페 · 가볼만한곳 · 숙소 · 길찾기) ================= */
  function mapBoxHTML(p) {
    const app = state.mapApp;
    const apps = Object.entries(TripTools.MAP_APPS).map(([k, v]) =>
      `<button type="button" data-map-app="${k}" class="${k === app ? "on" : ""}" aria-pressed="${k === app}">${v}</button>`).join("");
    return `<div class="map-head"><span>🗺 ${p.name} 둘러보기</span><span class="map-switch" role="group" aria-label="열 지도 앱">${apps}</span></div>
      <div class="map-btns" data-id="${p.id}">
        ${TripTools.SEARCH_KINDS.map((k) => `<button type="button" data-map="${k.code}"><span>${k.emoji}</span>${k.label}</button>`).join("")}
        <button type="button" data-map="route"><span>🧭</span>길찾기</button>
      </div>`;
  }
  function renderMapBoxes() {
    if (!$("#resultModal").hidden && ui.resultId) $("#resultMaps").innerHTML = mapBoxHTML(BY_ID[ui.resultId]);
    if (draft) $("#sheetMaps").innerHTML = mapBoxHTML(BY_ID[draft.id]);
  }

  function openUrl(url) {
    const w = window.open(url, "_blank");
    if (w) w.opener = null;
    else location.href = url; // 팝업이 막히면 같은 창에서
  }

  function openSearch(query) {
    openUrl(TripTools.searchUrl(state.mapApp, query));
  }

  function openRoute(p) {
    const r = TripTools.route(state.mapApp, p.name, p.lat, p.lng);
    if (r.web) { openUrl(r.web); return; }
    if (/Android/i.test(navigator.userAgent)) { location.href = r.intent; return; } // 앱이 없으면 안드로이드가 검색 페이지로
    location.href = r.app;
    setTimeout(() => {
      if (document.hidden) return; // 앱으로 넘어갔어요
      toast("네이버지도 앱이 안 열렸나요?", { label: "웹에서 찾기", fn: () => openUrl(r.fallback) });
    }, 1600);
  }

  function openMapKind(code, p) {
    if (code === "route") { openRoute(p); return; }
    const kind = TripTools.SEARCH_KINDS.find((k) => k.code === code);
    if (kind) openSearch(`${p.name} ${kind.q[state.mapApp]}`);
  }

  // 일정표의 장소: 지도에서 가져온 링크가 있으면 그 링크, 없으면 여행지 이름을 붙여서 검색
  function openStopOnMap(p, s) {
    if (s.u) { openUrl(s.u); return; }
    const name = (s.p || "").trim();
    if (!name) { toast("장소 이름을 먼저 적어 주세요"); return; }
    openSearch(name.includes(p.name) ? name : `${p.name} ${name}`);
  }

  function locate(id) {
    closeLayer($("#resultModal"));
    state.filter = "all";
    ui.query = "";
    $("#search").value = "";
    ui.page = Math.floor(PLACES.findIndex((p) => p.id === id) / PAGE_SIZE) + 1;
    save();
    renderTabs();
    renderList();
    const el = $(`.place[data-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }
    toast("여기로 가기로 했다면 🚩 갈거임을 눌러줘!");
  }

  /* ================= 리스트 ================= */
  function renderTabs() {
    const counts = { all: 0, visited: 0, notyet: 0, planned: 0 };
    PLACES.filter(matchFacets).forEach((p) => {
      const r = get(p.id);
      counts.all++;
      r.visited ? counts.visited++ : counts.notyet++;
      if (r.planned) counts.planned++;
    });
    $$("#tabs .tab").forEach((t) => {
      const f = t.dataset.filter, on = f === state.filter;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on);
      t.querySelector("i").textContent = counts[f];
    });
  }

  function placeHTML(p) {
    const r = get(p.id);
    const nPhotos = (r.photos || []).length;
    const meta = [];
    if (r.date) meta.push(`📅 ${fmtDate(r.date).slice(2)}`);
    if (nPhotos) meta.push(`📷 ${nPhotos}`);
    if (r.plan && r.plan.length) meta.push(`🗓 ${r.plan.length}일`);
    if (costSum(r.cost)) meta.push(`💸 ${manwon(costSum(r.cost))}`);
    if (r.memo) meta.push("📝");
    return `<li class="place${r.visited ? " is-visited" : ""}${r.planned ? " is-planned" : ""}" data-id="${p.id}">
      <label class="pick" aria-label="${p.name} 룰렛에 넣기"><input type="checkbox" data-act="pick"${r.selected ? " checked" : ""}><span class="pick-box"></span></label>
      <div class="place-main">
        <div class="place-top"><span class="rank${p.rank <= 3 ? " top" : ""}">${p.rank}</span><span class="emoji">${p.emoji}</span><strong class="name">${p.name}</strong>${regionOf(p) ? `<span class="region">${p.region}</span>` : ""}</div>
        <p class="desc">${p.desc}</p>
        <div class="place-tags">
          <span class="budget-tag tier-${p.tier}" title="1박 2일 · 1인 예상 경비 (오가는 교통비 제외, 추정)">💸 약 ${p.budget}만원</span>
          ${p.types.map((t) => `<span class="type-tag">${TYPE[t].label}</span>`).join("")}
        </div>
        <div class="place-actions">
          <button type="button" class="pill pill-visited${r.visited ? " on" : ""}" data-act="visited" aria-pressed="${!!r.visited}">👣 가봤음</button>
          <button type="button" class="pill pill-planned${r.planned ? " on" : ""}" data-act="planned" aria-pressed="${!!r.planned}">🚩 갈거임</button>
          ${meta.length ? `<span class="rec-meta">${meta.join(" · ")}</span>` : ""}
        </div>
      </div>
      <button type="button" class="plus${meta.length ? " has" : ""}" data-act="record" aria-label="${p.name} 기록·일정표·예산 남기기">+</button>
      ${r.visited ? `<span class="stamp">가봤음!</span>` : ""}
    </li>`;
  }

  function renderList() {
    const list = filteredList();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    ui.page = Math.min(Math.max(1, ui.page), pages);
    const items = list.slice((ui.page - 1) * PAGE_SIZE, ui.page * PAGE_SIZE);
    const ul = $("#placeList");
    if (!items.length) {
      const allDone = state.filter === "notyet" && !ui.query && !facetCount();
      const msg = ui.query ? `'${esc(ui.query)}'에 맞는 여행지가 없어요`
        : facetCount() ? "고른 조건에 맞는 여행지가 없어요<br><small>필터를 조금 풀어 볼까요?</small>"
        : { visited: "아직 가봤음 표시한 곳이 없어요", planned: "아직 갈거임으로 정한 곳이 없어요", notyet: "와… 전부 가봤어요! 대단해!", all: "" }[state.filter];
      ul.innerHTML = `<li class="list-empty">${Chars.tag("chiikawa", allDone ? "happy" : "cry")}<p>${msg}</p></li>`;
    } else {
      ul.innerHTML = items.map(placeHTML).join("");
    }
    renderPager(pages);
    renderSelectBar(list);
  }

  function renderPager(pages) {
    const nav = $("#pager");
    if (pages <= 1) { nav.innerHTML = ""; return; }
    let start = Math.max(1, ui.page - 2);
    const end = Math.min(pages, start + 4);
    start = Math.max(1, end - 4);
    let h = `<button type="button" data-page="${ui.page - 1}"${ui.page === 1 ? " disabled" : ""} aria-label="이전 페이지">‹</button>`;
    for (let i = start; i <= end; i++) {
      h += `<button type="button" data-page="${i}"${i === ui.page ? ' class="on" aria-current="page"' : ""}>${i}</button>`;
    }
    h += `<button type="button" data-page="${ui.page + 1}"${ui.page === pages ? " disabled" : ""} aria-label="다음 페이지">›</button>`;
    nav.innerHTML = h;
  }

  function renderFacets() {
    const f = state.facets;
    const chip = (group, code, label) => {
      const on = f[group].includes(code);
      return `<button type="button" class="chip${on ? " on" : ""}" data-group="${group}" data-code="${code}" aria-pressed="${on}">${label}</button>`;
    };
    $('[data-facet="areas"]').innerHTML = AREAS.map((a) => chip("areas", a.code, a.label)).join("");
    $('[data-facet="tiers"]').innerHTML = TIERS.map((t) => chip("tiers", t.code, `${t.icon} ${t.label} <small>${t.hint}</small>`)).join("");
    $('[data-facet="types"]').innerHTML = TYPES.map((t) => chip("types", t.code, `${t.emoji} ${t.label}`)).join("");

    const n = facetCount();
    $("#filterCount").hidden = !n;
    $("#filterCount").textContent = n;
    $("#facetReset").disabled = !n;
    const open = !$("#facets").hidden;
    $("#filterBtn").setAttribute("aria-expanded", open);
    $("#filterBtn").classList.toggle("on", open || n > 0);
    // 필터 창을 닫아도 지금 어떤 조건이 걸려 있는지 보이게
    const labels = [...f.areas.map((c) => AREA[c].label), ...f.tiers.map((c) => TIER[c].label), ...f.types.map((c) => TYPE[c].label)];
    $("#activeFacets").innerHTML = n && !open
      ? `<span>🔎 ${labels.join(" · ")}</span><button type="button" class="link-btn" data-act="reset-facets">초기화</button>`
      : "";
  }

  function setFacets(next) {
    state.facets = next;
    ui.page = 1;
    save();
    renderFacets();
    renderTabs();
    renderList();
  }

  function renderSelectBar(list) {
    list = list || filteredList();
    const allSel = list.length > 0 && list.every((p) => get(p.id).selected);
    const btn = $("#selectAll");
    btn.textContent = allSel ? "전체해제" : "전체선택";
    btn.disabled = !list.length;
    const total = PLACES.filter((p) => get(p.id).selected).length;
    $("#selCount").innerHTML = `룰렛에 담은 곳 <b>${total}</b>곳`;
  }

  function toggleVisited(id) {
    const r = rec(id), p = BY_ID[id];
    r.visited = !r.visited;
    if (r.visited) {
      const wasPlanned = r.planned;
      r.visitedAt = Date.now();
      r.planned = false;
      toast(wasPlanned ? `👣 ${p.name} 다녀왔구나!` : `👣 ${p.name} 가봤음 도장 꾹!`, { label: "기록하기", fn: () => openRecord(id) });
    } else {
      toast(`${p.name} 가봤음 표시를 지웠어요`);
    }
    afterStatusChange(id, r.visited);
  }

  function togglePlanned(id) {
    const r = rec(id), p = BY_ID[id];
    r.planned = !r.planned;
    if (r.planned) toast(`🚩 ${p.name}, 우리 여기 가자!`, { label: "날짜 정하기", fn: () => openRecord(id) });
    else toast(`${p.name} 갈거임을 취소했어요`);
    afterStatusChange(id, false);
  }

  // 상태가 바뀐 줄이 현재 탭에서 빠지면 살짝 사라지는 모습을 보여준 뒤 다시 그림
  function afterStatusChange(id, popStamp) {
    save();
    Backup.touch();
    renderTabs();
    renderPlanned();
    renderWheel();
    renderAlbum();
    const redraw = () => {
      renderList();
      if (popStamp) {
        const s = $(`.place[data-id="${id}"] .stamp`);
        if (s) s.classList.add("pop");
      }
    };
    if (matchFilter(BY_ID[id])) { redraw(); return; }
    const li = $(`.place[data-id="${id}"]`);
    if (li) {
      li.style.transition = "opacity .3s, transform .3s";
      li.style.opacity = "0";
      li.style.transform = "scale(.96)";
    }
    setTimeout(redraw, 320);
  }

  /* ================= 가봤음 앨범 ================= */
  function renderAlbum() {
    const visited = PLACES.filter((p) => get(p.id).visited).sort((a, b) => {
      const ra = get(a.id), rb = get(b.id);
      const da = ra.date || "", db = rb.date || "";
      if (da !== db) return da < db ? 1 : -1;
      return (rb.visitedAt || 0) - (ra.visitedAt || 0);
    });
    const pct = Math.round((visited.length / PLACES.length) * 100);
    $("#conquer").innerHTML = `다녀온 곳 <b>${visited.length}</b>곳 · 국내여행 정복도 <b>${pct}%</b><div class="conquer-bar"><span style="width:${pct}%"></span></div>`;

    const grid = $("#album");
    if (!visited.length) {
      grid.innerHTML = `<div class="album-empty">${Chars.tag("usagi", "wow")}<p>아직 다녀온 곳이 없어요!<br>리스트에서 <b>👣 가봤음</b>을 눌러 도장을 찍어봐</p></div>`;
      return;
    }
    grid.innerHTML = visited.map((p) => {
      const r = get(p.id), ph = r.photos || [];
      const extra = [];
      if (r.plan && r.plan.length) extra.push(`🗓 ${r.plan.length}일`);
      if (costSum(r.cost)) extra.push(`💸 ${manwon(costSum(r.cost))}`);
      return `<button type="button" class="album-card" data-id="${p.id}">
        <div class="album-cover"${ph[0] ? ` data-photo="${ph[0]}"` : ""}>${p.emoji}</div>
        <div class="album-info">
          <strong>${p.emoji} ${p.name}</strong>
          <span class="date">${r.date ? fmtDate(r.date) : "날짜를 남겨줘"}</span>
          ${extra.length ? `<span class="album-extra">${extra.join(" · ")}</span>` : ""}
          ${r.memo ? `<p>${esc(r.memo)}</p>` : ""}
        </div>
        ${ph.length ? `<span class="album-count">📷 ${ph.length}</span>` : ""}
      </button>`;
    }).join("");
    $$("[data-photo]", grid).forEach((el) => {
      Photos.url(el.dataset.photo).then((u) => {
        if (!u) return;
        el.style.backgroundImage = `url("${u}")`;
        el.classList.add("has-photo");
      }).catch(() => {});
    });
  }

  function renderAll() {
    renderTabs();
    renderPlanned();
    renderWheel();
    renderList();
    renderAlbum();
  }

  /* ================= 기록 시트 (사진·메모·날짜) ================= */
  let draft = null;

  function openRecord(id, pane) {
    const p = BY_ID[id], r = get(id);
    draft = {
      id, visited: !!r.visited, planned: !!r.planned, photos: (r.photos || []).slice(), added: [], removed: [], busy: 0,
      plan: JSON.parse(JSON.stringify(r.plan || [])),
      cost: Object.assign({ ppl: 1 }, r.cost || {})
    };
    $("#sheetEmoji").textContent = p.emoji;
    $("#sheetTitle").textContent = p.name;
    $("#sheetSub").textContent = regionDesc(p);
    $("#recDate").value = r.date || "";
    $("#recMemo").value = r.memo || "";
    $("#sheetMaps").innerHTML = mapBoxHTML(p);
    closeToolPanels();
    renderDraft();
    renderPhotoGrid();
    renderPlan();
    renderCost();
    showPane(pane || "memo");
    openLayer($("#recordSheet"));
  }

  function renderDraft() {
    $("#draftVisited").classList.toggle("on", draft.visited);
    $("#draftVisited").setAttribute("aria-pressed", draft.visited);
    $("#draftPlanned").classList.toggle("on", draft.planned);
    $("#draftPlanned").setAttribute("aria-pressed", draft.planned);
    $("#dateLabel").textContent = draft.visited ? "📅 다녀온 날 (첫날)" : draft.planned ? "📅 가기로 한 날 (첫날)" : "📅 날짜";
    $('.sheet-tab[data-pane="cost"]').textContent = draft.visited ? "💸 쓴 돈" : "💸 예산";
    $("#planHint").textContent = draft.visited ? "다녀온 곳을 하루씩, 시간 순서대로 적어 봐요" : "가고 싶은 곳을 하루씩 계획해 봐요";
    $("#costHint").textContent = draft.visited ? "이번 여행에 쓴 돈을 적으면 합계와 1인당 금액을 계산해 줘요" : "예상 예산을 미리 짜 봐요";
    renderCostTotal();
  }

  function showPane(name) {
    $$("#recordSheet .sheet-pane").forEach((el) => { el.hidden = el.dataset.pane !== name; });
    $$("#sheetTabs .sheet-tab").forEach((t) => {
      const on = t.dataset.pane === name;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on);
    });
  }

  /* ---------- 일정표 ---------- */
  // 장소 하나 = { t: "HH:MM", p: 장소, m: 메모, u: 지도 링크(있을 때만) }
  const emptyStop = () => ({ t: "", p: "", m: "" });
  const isWebUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u) && u.length <= 500;

  function dayLabel(start, i) {
    if (!start) return "";
    const [y, m, d] = start.split("-").map(Number);
    const dt = new Date(y, m - 1, d + i);
    return `${dt.getMonth() + 1}/${dt.getDate()} (${"일월화수목금토"[dt.getDay()]})`;
  }

  function renderPlan() {
    const box = $("#planDays"), start = $("#recDate").value;
    if (!draft.plan.length) {
      box.innerHTML = `<div class="plan-empty">${Chars.tag("chiikawa", "normal")}<p>아직 일정이 없어요.<br>아래 <b>＋ 하루 추가</b>로 시작해 봐요!</p></div>`;
    } else {
      box.innerHTML = draft.plan.map((d, di) => `<div class="plan-day" data-day="${di}">
        <div class="plan-day-head">
          <strong>${di + 1}일차</strong><span>${dayLabel(start, di)}</span>
          <button type="button" class="icon-x" data-act="del-day" aria-label="${di + 1}일차 지우기">×</button>
        </div>
        <ol class="plan-stops">${d.stops.map((s, si) => `<li class="plan-stop" data-stop="${si}">
          <input type="time" class="stop-time" data-field="t" value="${esc(s.t)}" aria-label="시간">
          <div class="stop-body">
            <input type="text" class="stop-place" data-field="p" value="${esc(s.p)}" maxlength="60" placeholder="장소 (예: 안목 커피거리)" aria-label="장소">
            <input type="text" class="stop-memo" data-field="m" value="${esc(s.m)}" maxlength="120" placeholder="메모 (예: 라떼 맛집, 1.2만원)" aria-label="메모">
          </div>
          <div class="stop-btns">
            <button type="button" class="icon-x" data-act="del-stop" aria-label="이 장소 지우기">×</button>
            <button type="button" class="icon-map${s.u ? " linked" : ""}" data-act="map-stop" aria-label="${s.u ? "지도에서 가져온 링크 열기" : "지도에서 찾기"}" title="${s.u ? "지도 링크 열기" : "지도에서 찾기"}">🗺</button>
          </div>
        </li>`).join("")}</ol>
        <button type="button" class="plan-add-stop" data-act="add-stop">＋ 장소 추가</button>
      </div>`).join("");
    }
    renderCostTotal();
  }

  function focusLastPlace(di) {
    const inputs = $$(`.plan-day[data-day="${di}"] .stop-place`);
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  // 빈 칸은 빼고, 끝에 남은 빈 날도 정리 (중간의 빈 날은 "쉬는 날"일 수 있어서 남겨요)
  function cleanPlan(plan) {
    const days = plan.map((d) => ({
      stops: d.stops.map((s) => {
        const o = { t: s.t || "", p: s.p.trim(), m: s.m.trim() };
        if (isWebUrl(s.u)) o.u = s.u;
        return o;
      }).filter((s) => s.t || s.p || s.m || s.u)
    }));
    while (days.length && !days[days.length - 1].stops.length) days.pop();
    return days;
  }

  /* ---------- 지도에서 찾은 장소 목록 (붙여넣기 · 공유받기 공용) ---------- */
  function foundListHTML(items) {
    return `<ul class="found-list">${items.map((it, i) => `<li class="found-item">
      <label class="pick found-check" aria-label="${i + 1}번째 장소 넣기"><input type="checkbox" data-found="${i}" checked><span class="pick-box"></span></label>
      <div class="found-body">
        <input type="text" class="found-name" data-found-name="${i}" value="${esc(it.name)}" maxlength="60" placeholder="장소 이름을 적어 주세요" aria-label="장소 이름">
        <small><span class="src src-${it.source}">${TripTools.SOURCE_LABEL[it.source]}</span>${it.address ? ` ${esc(it.address)}` : ""}</small>
      </div>
    </li>`).join("")}</ul>`;
  }
  // 체크한 것만, 고친 이름으로 → 일정표 장소
  function readFound(box, items) {
    return items.map((it, i) => {
      if (!$(`[data-found="${i}"]`, box).checked) return null;
      const name = $(`[data-found-name="${i}"]`, box).value.trim() || `${TripTools.SOURCE_LABEL[it.source]} 장소 ${i + 1}`;
      const stop = { t: "", p: name.slice(0, 60), m: it.address || "" };
      if (isWebUrl(it.url)) stop.u = it.url;
      return stop;
    }).filter(Boolean);
  }
  const checkedCount = (box) => $$("[data-found]", box).filter((c) => c.checked).length;

  // 장소들을 일정표의 어느 날에 넣기 (dayIdx === plan.length 이면 새 날)
  function addStopsToPlan(plan, stops, dayIdx) {
    if (dayIdx >= plan.length) plan.push({ stops: [] });
    const day = plan[dayIdx];
    day.stops = day.stops.filter((s) => s.t || (s.p || "").trim() || (s.m || "").trim() || s.u); // 비어 있는 칸은 정리
    day.stops.push(...stops);
    return dayIdx;
  }
  function dayOptionsHTML(plan) {
    const opts = plan.map((d, i) => `<option value="${i}">${i + 1}일차에 넣기</option>`);
    opts.push(`<option value="${plan.length}">새 날(${plan.length + 1}일차)로 넣기</option>`);
    return opts.join("");
  }

  /* ---------- 📋 지도 장소 붙여넣기 ---------- */
  let pasteItems = [], pasteTimer;

  function closeToolPanels() {
    ["paste", "ai"].forEach((k) => {
      $(`#${k}Panel`).hidden = true;
      $(`#${k}Toggle`).setAttribute("aria-expanded", "false");
      $(`#${k}Toggle`).classList.remove("on");
    });
    $("#pasteBox").value = "";
    $("#pastePreview").innerHTML = "";
    pasteItems = [];
    $("#aiReplyBox").value = "";
    $("#aiReplyBox").hidden = true;
    $("#aiPreview").innerHTML = "";
    ui.aiResult = null;
  }
  function toggleToolPanel(kind) {
    const panel = $(`#${kind}Panel`), open = panel.hidden;
    closeToolPanelsOnly();
    panel.hidden = !open;
    $(`#${kind}Toggle`).setAttribute("aria-expanded", String(open));
    $(`#${kind}Toggle`).classList.toggle("on", open);
    if (open && kind === "ai") prepAi();
    if (open) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function closeToolPanelsOnly() {
    ["paste", "ai"].forEach((k) => {
      $(`#${k}Panel`).hidden = true;
      $(`#${k}Toggle`).setAttribute("aria-expanded", "false");
      $(`#${k}Toggle`).classList.remove("on");
    });
  }

  function renderPastePreview() {
    const box = $("#pastePreview"), text = $("#pasteBox").value.trim();
    pasteItems = text ? TripTools.parseShared(text) : [];
    if (!text) { box.innerHTML = ""; return; }
    if (!pasteItems.length) {
      box.innerHTML = `<p class="found-empty">장소를 못 찾았어요 😢<br><small>지도 앱에서 <b>공유 → 복사</b>로 가져온 글인지 확인해 주세요. 장소 이름만 한 줄에 하나씩 적어도 돼요.</small></p>`;
      return;
    }
    const days = cleanPlan(draft.plan).length;
    box.innerHTML = `<div class="found-head">찾은 장소 <b>${pasteItems.length}</b>곳 <small>이름이 틀리면 바로 고쳐도 돼요</small></div>
      ${foundListHTML(pasteItems)}
      <div class="found-foot">
        <select id="pasteDay" class="share-select" aria-label="넣을 날">${dayOptionsHTML(draft.plan)}</select>
        <button type="button" class="btn btn-primary btn-small" id="pasteAdd"></button>
      </div>`;
    $("#pasteDay").value = String(days ? days - 1 : draft.plan.length);
    updatePasteButton();
  }
  function updatePasteButton() {
    const n = checkedCount($("#pastePreview")), b = $("#pasteAdd");
    if (!b) return;
    b.textContent = n ? `${n}곳 일정에 넣기` : "넣을 장소를 골라 주세요";
    b.disabled = !n;
  }
  function addPasted() {
    const stops = readFound($("#pastePreview"), pasteItems);
    if (!stops.length) return;
    const di = addStopsToPlan(draft.plan, stops, Number($("#pasteDay").value));
    closeToolPanels();
    renderPlan();
    const day = $(`.plan-day[data-day="${di}"]`);
    if (day) day.scrollIntoView({ behavior: "smooth", block: "start" });
    toast(`📍 ${stops.length}곳을 ${di + 1}일차에 넣었어요. 시간만 적어 주세요!`);
  }
  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (!t || !t.trim()) { toast("복사한 내용이 없어요"); return; }
      $("#pasteBox").value = t;
      renderPastePreview();
    } catch (e) {
      $("#pasteBox").focus();
      toast("아래 칸을 길게 눌러 붙여넣어 주세요");
    }
  }

  /* ---------- 🤖 AI로 일정 짜기 (질문 복사 → Claude → 답 붙여넣기) ---------- */
  const AI_PREF_KEY = "wheretogo.ai.v1"; // 출발지·이동 수단·인원만 이 기기에 기억 (편의용)
  function aiPrefs() {
    try { return JSON.parse(localStorage.getItem(AI_PREF_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveAiPrefs() {
    try {
      localStorage.setItem(AI_PREF_KEY, JSON.stringify({ from: $("#aiFrom").value.trim(), move: $("#aiMove").value, people: Number($("#aiPeople").value) || 2 }));
    } catch (e) { /* 저장 못 해도 괜찮아요 */ }
  }
  const aiBudgetFor = (p, days) => p.budget * Math.max(1, days - 1);

  function prepAi() {
    const p = BY_ID[draft.id], r = get(draft.id), pr = aiPrefs();
    const days = Math.min(5, Math.max(1, cleanPlan(draft.plan).length || 2));
    $("#aiDays").value = String(days);
    $("#aiPeople").value = (r.cost && r.cost.ppl) || (draft.cost.ppl > 1 ? draft.cost.ppl : 0) || pr.people || 2;
    $("#aiFrom").value = pr.from || "";
    $("#aiMove").value = pr.move === "public" ? "public" : "car";
    $("#aiBudget").value = aiBudgetFor(p, days);
    ui.aiBudgetTouched = false;
    ui.aiStyles = p.types.slice();
    renderAiStyles();
    const must = aiMustPlaces();
    $("#aiUseStopsRow").hidden = !must.length;
    $("#aiUseStopsText").textContent = `일정표에 있는 장소 ${must.length}곳은 꼭 넣고 동선 정리하기`;
    $("#aiReplyBox").hidden = true;
    $("#aiPreview").innerHTML = "";
  }
  function renderAiStyles() {
    $("#aiStyles").innerHTML = TYPES.map((t) => {
      const on = ui.aiStyles.includes(t.code);
      return `<button type="button" class="chip${on ? " on" : ""}" data-ai-style="${t.code}" aria-pressed="${on}">${t.emoji} ${t.label}</button>`;
    }).join("");
  }
  function aiMustPlaces() {
    const names = [];
    cleanPlan(draft.plan).forEach((d) => d.stops.forEach((s) => { if (s.p && !names.includes(s.p)) names.push(s.p); }));
    return names.slice(0, 25);
  }
  function makeAiPrompt() {
    const p = BY_ID[draft.id];
    return TripTools.buildPrompt({
      place: p,
      days: Number($("#aiDays").value) || 2,
      people: Math.min(20, Math.max(1, Number($("#aiPeople").value) || 1)),
      budget: Number($("#aiBudget").value.replace(/[^\d]/g, "")) || 0,
      from: $("#aiFrom").value.trim(),
      move: $("#aiMove").value,
      styles: ui.aiStyles.map((c) => TYPE[c].label),
      must: $("#aiUseStops").checked ? aiMustPlaces() : [],
      request: $("#aiRequest").value.trim(),
      start: $("#recDate").value
    });
  }

  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  // 버튼을 누른 그 순간에 바로 복사해야 휴대폰에서도 막히지 않아요
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
      return true;
    }
    return legacyCopy(text);
  }

  function askAi(openClaude) {
    const prompt = makeAiPrompt();
    saveAiPrefs();
    copyText(prompt);
    if (openClaude) {
      const w = window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, "_blank");
      if (w) w.opener = null;
      toast("질문을 복사했어요! Claude에 질문이 안 채워져 있으면 붙여넣기만 해 주세요");
    } else {
      toast("질문을 복사했어요. 쓰시는 AI 앱에 붙여넣어 주세요");
    }
  }

  async function pasteAiReply() {
    try {
      const t = await navigator.clipboard.readText();
      if (t && handleAiReply(t)) return;
    } catch (e) { /* 아래 칸으로 받기 */ }
    $("#aiReplyBox").hidden = false;
    $("#aiReplyBox").focus();
    toast("아래 칸을 길게 눌러 AI 답을 붙여넣어 주세요");
  }

  function handleAiReply(text) {
    const box = $("#aiPreview");
    const res = TripTools.parseAiReply(text);
    ui.aiResult = res;
    if (!res) {
      box.innerHTML = text.trim()
        ? `<p class="found-empty">일정 코드를 못 찾았어요 😢<br><small>Claude 답 <b>맨 아래 코드 상자의 [복사]</b>를 누른 뒤 다시 붙여넣어 주세요.</small></p>`
        : "";
      return false;
    }
    const p = BY_ID[draft.id];
    const hasPlan = cleanPlan(draft.plan).length > 0;
    const hasCost = costSum(draft.cost) > 0;
    const sum = res.cost ? costSum(res.cost) : 0;
    const costDefault = !(draft.visited && hasCost); // 다녀온 곳의 실제 쓴 돈은 함부로 바꾸지 않아요
    box.innerHTML = `<div class="ai-result">
      <div class="ai-sum">🤖 <b>AI 일정 도착!</b> ${res.plan.map((d, i) => `${i + 1}일차 ${d.stops.length}곳`).join(" · ")}${sum ? ` · 예산 ${manwon(sum)}` : ""}</div>
      <ol class="ai-peek">${res.plan[0].stops.slice(0, 4).map((s) => `<li><b>${esc(s.t || "--:--")}</b> ${esc(s.p)}</li>`).join("")}${res.plan[0].stops.length > 4 ? "<li>…</li>" : ""}</ol>
      <label class="ai-check"><input type="checkbox" id="aiApplyPlan" checked> 일정표에 넣기</label>
      ${hasPlan ? `<div class="ai-mode">
        <label><input type="radio" name="aiMode" value="replace" checked> 지금 일정을 이걸로 바꾸기</label>
        <label><input type="radio" name="aiMode" value="append"> 지금 일정 뒤에 이어 붙이기</label>
      </div>` : ""}
      ${res.cost ? `<label class="ai-check"><input type="checkbox" id="aiApplyCost"${costDefault ? " checked" : ""}> 💸 ${draft.visited ? "쓴 돈" : "예산"} 칸 채우기 (${res.cost.ppl}명 · ${manwon(sum)})${hasCost ? " <small>지금 적힌 금액을 바꿔요</small>" : ""}</label>` : ""}
      ${res.tips.length ? `<ul class="ai-tips">${res.tips.map((t) => `<li>💡 ${esc(t)}</li>`).join("")}</ul>` : ""}
      <button type="button" class="btn btn-primary" id="aiApply">적용하기</button>
      <p class="ai-note">AI가 추천한 곳은 문을 닫았거나 정보가 다를 수 있어요. 일정표의 🗺 버튼으로 한 번씩 확인해 주세요. (${p.name})</p>
    </div>`;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return true;
  }

  function applyAiResult() {
    const res = ui.aiResult;
    if (!res || !draft) return;
    const usePlan = $("#aiApplyPlan").checked;
    const useCost = $("#aiApplyCost") && $("#aiApplyCost").checked;
    if (!usePlan && !useCost) { toast("넣을 항목을 골라 주세요"); return; }
    if (usePlan) {
      const mode = ($('input[name="aiMode"]:checked') || {}).value || "replace";
      // 지도에서 붙여넣었던 장소가 AI 일정에도 있으면 그 지도 링크를 이어 붙여요
      const key = (s) => (s || "").replace(/\s+/g, "");
      const links = {};
      cleanPlan(draft.plan).forEach((d) => d.stops.forEach((s) => { if (s.u && s.p) links[key(s.p)] = s.u; }));
      const fresh = res.plan.map((d) => ({
        stops: d.stops.map((s) => (links[key(s.p)] ? { ...s, u: links[key(s.p)] } : { ...s }))
      }));
      draft.plan = mode === "append" ? cleanPlan(draft.plan).concat(fresh) : fresh;
    }
    if (useCost) draft.cost = { ...res.cost };
    closeToolPanels();
    renderPlan();
    renderCost();
    toast("🤖 AI 일정을 넣었어요! 확인하고 [저장하기]를 눌러 주세요");
  }

  /* ---------- 📥 다른 앱(지도)에서 공유받기 — 안드로이드 홈 화면 앱 ---------- */
  let shareItems = [];

  // 공유받은 주소·이름에 여행지 이름이 들어 있으면 그 여행지를 먼저 골라 둬요
  function guessPlace(items) {
    const pick = (text) => {
      let best = null;
      PLACES.forEach((p) => {
        const n = p.name.replace(/도$/, "");
        if (text.includes(n) && (!best || n.length > best.name.replace(/도$/, "").length)) best = p;
      });
      return best;
    };
    return pick(items.map((i) => i.address).join(" ")) || pick(items.map((i) => i.name).join(" "));
  }

  function openShare(text) {
    shareItems = TripTools.parseShared(text);
    if (!shareItems.length) { toast("공유받은 내용에서 장소를 못 찾았어요 😢"); return; }
    $("#shareTitle").textContent = `📥 공유받은 장소 ${shareItems.length}곳`;
    $("#shareFound").innerHTML = foundListHTML(shareItems);

    const planned = PLACES.filter((p) => get(p.id).planned);
    const withPlan = PLACES.filter((p) => !get(p.id).planned && (get(p.id).plan || []).length);
    const opt = (p) => `<option value="${p.id}">${p.emoji} ${p.name}${regionOf(p) ? ` (${p.region})` : ""}</option>`;
    $("#shareTarget").innerHTML =
      (planned.length ? `<optgroup label="🚩 갈거임">${planned.map(opt).join("")}</optgroup>` : "") +
      (withPlan.length ? `<optgroup label="🗓 일정이 있는 곳">${withPlan.map(opt).join("")}</optgroup>` : "") +
      `<optgroup label="전체 여행지">${PLACES.map(opt).join("")}</optgroup>`;
    const guess = guessPlace(shareItems);
    $("#shareTarget").value = (guess || planned[0] || withPlan[0] || PLACES[0]).id;
    renderShareDays();
    openLayer($("#shareSheet"));
  }

  function renderShareDays() {
    const plan = cleanPlan(get($("#shareTarget").value).plan || []);
    $("#shareDayRow").innerHTML = `<select id="shareDay" class="share-select" aria-label="넣을 날">${dayOptionsHTML(plan)}</select>`;
    $("#shareDay").value = String(plan.length ? plan.length - 1 : 0);
  }

  function addShared() {
    const id = $("#shareTarget").value;
    const stops = readFound($("#shareFound"), shareItems);
    if (!stops.length) { toast("넣을 장소를 골라 주세요"); return; }
    const r = rec(id);
    const plan = cleanPlan(r.plan || []);
    const di = addStopsToPlan(plan, stops, Number($("#shareDay").value));
    r.plan = cleanPlan(plan);
    save();
    Backup.touch();
    closeLayer($("#shareSheet"));
    renderAll();
    openRecord(id, "plan");
    toast(`📍 ${BY_ID[id].name} ${di + 1}일차에 ${stops.length}곳을 넣었어요!`);
  }

  /* ---------- 쓴 돈 / 예상 예산 ---------- */
  function cleanCost(c) {
    const o = {};
    COST_FIELDS.forEach(([k]) => {
      const n = Math.round(Number(c[k]) || 0);
      if (n > 0) o[k] = n;
    });
    const ppl = Math.round(Number(c.ppl) || 1);
    if (ppl > 1) o.ppl = Math.min(ppl, 50);
    return Object.keys(o).length ? o : null;
  }

  function renderCost() {
    $("#costGrid").innerHTML = COST_FIELDS.map(([k, label]) => `<label class="cost-row">
      <span>${label}</span>
      <span class="cost-input"><input type="text" inputmode="numeric" data-cost="${k}" value="${draft.cost[k] ? Number(draft.cost[k]).toLocaleString("ko-KR") : ""}" placeholder="0" aria-label="${label} 금액"> 원</span>
    </label>`).join("");
    $("#costPeople").value = draft.cost.ppl || 1;
    renderCostTotal();
  }

  function renderCostTotal() {
    if (!draft) return;
    const p = BY_ID[draft.id], c = draft.cost;
    const sum = costSum(c), ppl = Math.max(1, Number(c.ppl) || 1);
    const local = (sum - (Number(c.tr) || 0)) / ppl; // 교통을 뺀 1인 경비 → 여행지 평균(추정)과 비교
    const nights = Math.max(1, draft.plan.length - 1);
    const est = p.budget * 10000 * nights;
    let compare = "";
    if (sum) {
      const diff = local - est;
      compare = Math.abs(diff) < 5000 ? "평균이랑 거의 비슷해요 👌"
        : diff < 0 ? `평균보다 ${manwon(-diff)} ${draft.visited ? "덜 썼어요" : "적게 잡았어요"} 👍`
        : `평균보다 ${manwon(diff)} ${draft.visited ? "더 썼어요" : "넉넉하게 잡았어요"} 💸`;
    }
    $("#costTotal").innerHTML = `
      <div class="cost-sum"><span>${draft.visited ? "총 쓴 돈" : "총 예산"}</span><b>${won(sum)}</b></div>
      <div class="cost-sub">1인당 ${won(sum / ppl)}${c.tr ? ` · 교통 빼면 1인 ${won(local)}` : ""}</div>
      <div class="cost-ref">📊 ${p.name} 평균(추정) ${nights}박 기준 1인 약 ${manwon(est)}<small>오가는 교통 제외${p.budgetNote ? ` · ${p.budgetNote}` : ""}</small></div>
      ${compare ? `<div class="cost-compare">${compare}</div>` : ""}`;
  }

  function renderPhotoGrid() {
    const g = $("#photoGrid");
    let h = draft.photos.map((pid) =>
      `<div class="photo-cell" data-pid="${pid}"><button type="button" class="view" aria-label="사진 크게 보기"></button><button type="button" class="photo-del" aria-label="사진 지우기">×</button></div>`
    ).join("");
    for (let i = 0; i < draft.busy; i++) h += `<div class="photo-cell photo-loading">불러오는 중…</div>`;
    h += `<button type="button" class="photo-add" id="photoAdd"><span>＋</span>사진 추가</button>`;
    g.innerHTML = h;
    $$(".photo-cell[data-pid]", g).forEach((el) => {
      Photos.url(el.dataset.pid).then((u) => { if (u) el.style.backgroundImage = `url("${u}")`; }).catch(() => {});
    });
  }

  function removeDraftPhoto(pid) {
    draft.photos = draft.photos.filter((x) => x !== pid);
    if (draft.added.includes(pid)) {
      draft.added = draft.added.filter((x) => x !== pid);
      Photos.del(pid);
    } else {
      draft.removed.push(pid);
    }
    renderPhotoGrid();
  }

  function isDraftDirty() {
    const r = get(draft.id);
    return draft.added.length > 0 || draft.removed.length > 0 ||
      draft.visited !== !!r.visited || draft.planned !== !!r.planned ||
      $("#recDate").value !== (r.date || "") || $("#recMemo").value.trim() !== (r.memo || "") ||
      JSON.stringify(cleanPlan(draft.plan)) !== JSON.stringify(r.plan || []) ||
      JSON.stringify(cleanCost(draft.cost)) !== JSON.stringify(r.cost || null);
  }

  // false를 돌려주면 닫기 취소
  function cancelRecord() {
    if (!draft) return true;
    if (isDraftDirty() && !confirm("저장하지 않고 닫을까요?")) return false;
    draft.added.forEach((pid) => Photos.del(pid));
    draft = null;
    return true;
  }

  function saveRecord() {
    if (!draft) return;
    if (draft.busy) { toast("사진을 불러오는 중이에요. 잠깐만!"); return; }
    const r = rec(draft.id), p = BY_ID[draft.id];
    if (draft.visited && !r.visited) r.visitedAt = Date.now();
    r.visited = draft.visited;
    r.planned = draft.planned;
    const date = $("#recDate").value, memo = $("#recMemo").value.trim();
    if (date) r.date = date; else delete r.date;
    if (memo) r.memo = memo; else delete r.memo;
    if (draft.photos.length) r.photos = draft.photos.slice(); else delete r.photos;
    const plan = cleanPlan(draft.plan), cost = cleanCost(draft.cost);
    if (plan.length) r.plan = plan; else delete r.plan;
    if (cost) r.cost = cost; else delete r.cost;
    draft.removed.forEach((pid) => Photos.del(pid));
    draft = null;
    save();
    Backup.touch();
    closeLayer($("#recordSheet"), true);
    renderAll();
    toast(`💾 ${p.name} 기록 저장 완료!`);
  }

  async function addPhotos(files) {
    const d = draft;
    if (!d) return;
    Photos.askPersist();
    for (const f of files) {
      if (f.type && !/^image\//.test(f.type)) continue;
      d.busy++;
      if (d === draft) renderPhotoGrid();
      try {
        const blob = await Photos.compress(f, 1600, "image/jpeg", 0.82);
        const pid = await Photos.put(blob);
        if (d === draft) { d.photos.push(pid); d.added.push(pid); }
        else Photos.del(pid);
      } catch (err) {
        toast("사진을 불러오지 못했어요 😢");
      }
      d.busy--;
      if (d === draft) renderPhotoGrid();
    }
  }

  function showLightbox(pid) {
    Photos.url(pid).then((u) => {
      if (!u) return;
      $("#lightboxImg").src = u;
      $("#lightbox").hidden = false;
    });
  }

  /* ================= 모달·시트 열고 닫기 ================= */
  const layers = [];
  function openLayer(el) {
    if (!el.hidden) return;
    el.hidden = false;
    layers.push({ el, focus: document.activeElement });
    document.body.style.overflow = "hidden";
    const panel = $(".modal-card, .sheet-panel", el);
    if (panel) { panel.setAttribute("tabindex", "-1"); panel.focus({ preventScroll: true }); }
  }
  function closeLayer(el, committed) {
    if (!el || el.hidden) return;
    if (el.id === "recordSheet" && !committed && !cancelRecord()) return;
    el.hidden = true;
    const i = layers.findIndex((l) => l.el === el);
    const L = i >= 0 ? layers.splice(i, 1)[0] : null;
    if (!layers.length) document.body.style.overflow = "";
    if (L && L.focus && document.contains(L.focus)) L.focus.focus({ preventScroll: true });
  }

  /* ================= 설정 ================= */
  function fmtStamp(t) {
    const d = new Date(t);
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  }
  function fmtSize(bytes) {
    return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1048576).toFixed(1)}MB`;
  }

  function openSettings() {
    renderBackupStatus();
    renderStorageInfo();
    renderCharSlots();
    $("#backupReady").hidden = true;
    openLayer($("#settingsSheet"));
  }

  function renderBackupStatus() {
    const m = Backup.meta();
    let when = "아직 백업한 적이 없어요";
    if (m.lastBackup) {
      const days = Math.floor((Date.now() - m.lastBackup) / 86400000);
      when = `마지막 백업 ${fmtStamp(m.lastBackup)} (${days === 0 ? "오늘" : `${days}일 전`})`;
    }
    const badge = Backup.isDirty(m) ? `<span class="tag-warn">백업 후 바뀐 기록 있음</span>`
      : m.lastBackup ? `<span class="tag-ok">최신 상태</span>` : "";
    $("#backupStatus").innerHTML = `<span>${when}</span>${badge}`;
  }

  async function renderStorageInfo() {
    const info = [];
    try {
      if (navigator.storage && navigator.storage.persisted) {
        info.push((await navigator.storage.persisted()) ? "저장 공간 보호 켜짐 ✅" : "저장 공간 보호 꺼짐 · 홈 화면 앱으로 쓰면 더 안전해요");
      }
      if (navigator.storage && navigator.storage.estimate) {
        info.push(`사용 중 ${fmtSize((await navigator.storage.estimate()).usage || 0)}`);
      }
    } catch (e) { /* 지원 안 하는 브라우저 */ }
    $("#storageInfo").textContent = info.join(" · ");
  }

  function renderCharSlots() {
    $("#charSlots").innerHTML = Chars.LIST.map((n) => `<div class="slot-group">
      <strong>${Chars.NAMES[n]}</strong>
      <div class="slot-row">${Chars.SLOTS.filter((s) => s.name === n).map((s) => {
        const has = Chars.hasCustom(s.key);
        return `<div class="slot${has ? " has" : ""}">
          <label class="slot-pick" aria-label="${Chars.NAMES[n]} ${s.label} 그림 넣기">${Chars.tag(n, s.mood)}<input type="file" accept="image/*" data-slot="${s.key}"></label>
          <span class="slot-label">${s.label}</span>
          ${has ? `<button type="button" class="slot-reset" data-slot-reset="${s.key}" aria-label="${Chars.NAMES[n]} ${s.label} 그림 지우기">×</button>` : ""}
        </div>`;
      }).join("")}</div>
    </div>`).join("");
  }

  function refreshChars() {
    Chars.hydrate(document);
    renderCharSlots();
  }

  function downloadFile(file) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  let preparedBackup = null;

  async function makeBackup() {
    const btn = $("#backupBtn");
    btn.disabled = true;
    btn.textContent = "만드는 중…";
    $("#backupReady").hidden = true;
    try {
      preparedBackup = await Backup.build();
      const s = preparedBackup.summary;
      $("#backupReadyText").innerHTML = `준비 완료! 가봤음 ${s.visited}곳 · 갈거임 ${s.planned}곳 · 사진 ${preparedBackup.photos}장 <small>(${fmtSize(preparedBackup.file.size)})</small>`;
      $("#backupReady").hidden = false;
    } catch (e) {
      toast("백업 파일을 만들지 못했어요 😢");
    }
    btn.disabled = false;
    btn.textContent = "백업 파일 만들기";
  }

  // 폰에서는 공유 창(→ 파일에 저장 / 구글 드라이브 / 카톡)으로, PC에서는 다운로드로
  async function saveBackup() {
    if (!preparedBackup) return;
    const { file, createdAt } = preparedBackup;
    const touchDevice = window.matchMedia("(pointer: coarse)").matches;
    if (touchDevice && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "우리 어디 가지? 백업" });
      } catch (e) {
        if (e.name === "AbortError") return; // 공유 창을 그냥 닫음
        downloadFile(file);
      }
    } else {
      downloadFile(file);
    }
    Backup.markBackedUp(createdAt);
    preparedBackup = null;
    $("#backupReady").hidden = true;
    renderBackupStatus();
    toast("💾 백업 완료! 안전한 곳에 잘 보관해줘");
  }

  async function restoreBackup(file) {
    let b;
    try {
      b = await Backup.read(file);
    } catch (e) {
      toast("'우리 어디 가지?' 백업 파일이 아니에요 😢");
      return;
    }
    const s = b.summary;
    const ok = confirm(`${fmtStamp(b.createdAt)}에 만든 백업이에요.\n가봤음 ${s.visited}곳 · 갈거임 ${s.planned}곳 · 사진 ${b.photos.length}장\n\n지금 기록을 이 백업 내용으로 바꿀까요?`);
    if (!ok) return;
    try {
      await Backup.apply(b);
      sessionStorage.setItem("wheretogo.restored", "1");
      location.reload();
    } catch (e) {
      toast("복원하지 못했어요 😢");
    }
  }

  /* ================= 토스트·꽃가루 ================= */
  let toastTimer;
  function toast(msg, action) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : "");
    if (action) t.querySelector("button").onclick = () => { t.hidden = true; action.fn(); };
    t.hidden = false;
    t.style.animation = "none";
    void t.offsetWidth;
    t.style.animation = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 4200 : 2400);
  }

  function confetti() {
    const box = $("#confetti");
    const set = ["🎉", "✨", "💖", "⭐", "🌸", "🍙", "🎊"];
    let h = "";
    for (let i = 0; i < 34; i++) {
      const left = Math.random() * 100, dur = 1.8 + Math.random() * 1.6, delay = Math.random() * 0.6, size = 16 + Math.random() * 16;
      h += `<span style="left:${left.toFixed(1)}%;font-size:${size.toFixed(0)}px;animation-duration:${dur.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s">${set[i % set.length]}</span>`;
    }
    box.innerHTML = h;
    clearTimeout(confetti.t);
    confetti.t = setTimeout(() => { box.innerHTML = ""; }, 4200);
  }

  /* ================= 하단 바로가기 ================= */
  const SECTIONS = ["sec-roulette", "sec-list", "sec-album"];
  function scrollToSection(id) {
    document.getElementById(id).scrollIntoView({ behavior: "smooth", block: "start" });
  }
  let navQueued = false;
  function updateNav() {
    navQueued = false;
    const line = window.innerHeight * 0.4;
    let active = SECTIONS[0];
    SECTIONS.forEach((id) => { if (document.getElementById(id).getBoundingClientRect().top <= line) active = id; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) active = "sec-album";
    $$("#bottomNav button").forEach((b) => b.classList.toggle("on", b.dataset.target === active));
  }

  /* ================= 이벤트 ================= */
  $("#spinBtn").addEventListener("click", spin);
  $("#hubBtn").addEventListener("click", spin);
  $("#againBtn").addEventListener("click", () => { closeLayer($("#resultModal")); spin(); });
  $("#locateBtn").addEventListener("click", () => locate(ui.resultId));

  $("#includeVisited").addEventListener("change", (e) => {
    state.includeVisited = e.target.checked;
    save();
    renderWheel();
    toast(state.includeVisited ? "가봤음 여행지도 룰렛에 넣었어요" : "가봤음 여행지는 룰렛에서 뺐어요");
  });

  $("#planned").addEventListener("click", (e) => {
    const chip = e.target.closest(".plan-chip");
    if (chip) openRecord(chip.dataset.id);
  });

  $("#tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t) return;
    state.filter = t.dataset.filter;
    ui.page = 1;
    save();
    renderTabs();
    renderList();
  });

  $("#search").addEventListener("input", (e) => {
    ui.query = e.target.value.trim();
    ui.page = 1;
    renderList();
  });

  $("#filterBtn").addEventListener("click", () => {
    $("#facets").hidden = !$("#facets").hidden;
    renderFacets();
  });
  $("#facets").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    const { group, code } = c.dataset;
    const next = cleanFacets(state.facets);
    next[group] = next[group].includes(code) ? next[group].filter((x) => x !== code) : next[group].concat(code);
    setFacets(next);
  });
  const resetFacets = () => { setFacets(cleanFacets()); toast("필터를 모두 풀었어요"); };
  $("#facetReset").addEventListener("click", resetFacets);
  $("#activeFacets").addEventListener("click", (e) => {
    if (e.target.closest('[data-act="reset-facets"]')) resetFacets();
  });

  $("#selectAll").addEventListener("click", () => {
    const list = filteredList();
    if (!list.length) return;
    const allSel = list.every((p) => get(p.id).selected);
    list.forEach((p) => { rec(p.id).selected = !allSel; });
    save();
    renderList();
    renderWheel();
    toast(allSel ? `${list.length}곳을 룰렛에서 뺐어요` : `${list.length}곳을 룰렛에 담았어요!`);
  });

  $("#placeList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = btn.closest(".place").dataset.id;
    if (btn.dataset.act === "visited") toggleVisited(id);
    else if (btn.dataset.act === "planned") togglePlanned(id);
    else if (btn.dataset.act === "record") openRecord(id);
  });
  $("#placeList").addEventListener("change", (e) => {
    if (e.target.dataset.act !== "pick") return;
    rec(e.target.closest(".place").dataset.id).selected = e.target.checked;
    save();
    renderWheel();
    renderSelectBar();
  });

  $("#pager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-page]");
    if (!b || b.disabled) return;
    ui.page = Number(b.dataset.page);
    renderList();
    $("#tabs").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#album").addEventListener("click", (e) => {
    const card = e.target.closest(".album-card");
    if (card) openRecord(card.dataset.id);
  });

  $("#draftVisited").addEventListener("click", () => {
    draft.visited = !draft.visited;
    if (draft.visited) draft.planned = false;
    renderDraft();
  });
  $("#draftPlanned").addEventListener("click", () => {
    draft.planned = !draft.planned;
    renderDraft();
  });
  $("#recSave").addEventListener("click", saveRecord);
  $("#sheetTabs").addEventListener("click", (e) => {
    const t = e.target.closest(".sheet-tab");
    if (t) showPane(t.dataset.pane);
  });
  $("#recDate").addEventListener("change", () => { if (draft) renderPlan(); });

  $("#planDays").addEventListener("input", (e) => {
    const field = e.target.dataset.field;
    if (!field || !draft) return;
    const di = Number(e.target.closest(".plan-day").dataset.day);
    const si = Number(e.target.closest(".plan-stop").dataset.stop);
    draft.plan[di].stops[si][field] = e.target.value;
  });
  $("#planDays").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b || !draft) return;
    const di = Number(b.closest(".plan-day").dataset.day);
    const day = draft.plan[di];
    if (b.dataset.act === "add-stop") {
      day.stops.push(emptyStop());
      renderPlan();
      focusLastPlace(di);
    } else if (b.dataset.act === "del-stop") {
      day.stops.splice(Number(b.closest(".plan-stop").dataset.stop), 1);
      if (!day.stops.length) day.stops.push(emptyStop());
      renderPlan();
    } else if (b.dataset.act === "del-day") {
      const hasContent = day.stops.some((s) => s.t || s.p.trim() || s.m.trim() || s.u);
      if (hasContent && !confirm(`${di + 1}일차 일정을 지울까요?`)) return;
      draft.plan.splice(di, 1);
      renderPlan();
    } else if (b.dataset.act === "map-stop") {
      openStopOnMap(BY_ID[draft.id], day.stops[Number(b.closest(".plan-stop").dataset.stop)]);
    }
  });
  $("#addDay").addEventListener("click", () => {
    if (!draft) return;
    draft.plan.push({ stops: [emptyStop()] });
    renderPlan();
    focusLastPlace(draft.plan.length - 1);
  });

  // 지도 버튼 (룰렛 결과 · 기록 화면)
  document.addEventListener("click", (e) => {
    const sw = e.target.closest("[data-map-app]");
    if (sw) {
      state.mapApp = sw.dataset.mapApp;
      save();
      renderMapBoxes();
      toast(`이제 ${TripTools.MAP_APPS[state.mapApp]}으로 열어요`);
      return;
    }
    const b = e.target.closest("[data-map]");
    if (b) openMapKind(b.dataset.map, BY_ID[b.closest(".map-btns").dataset.id]);
  });

  // 지도 장소 붙여넣기
  $("#pasteToggle").addEventListener("click", () => toggleToolPanel("paste"));
  $("#pasteFromClip").addEventListener("click", pasteFromClipboard);
  $("#pasteBox").addEventListener("input", () => {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(renderPastePreview, 250);
  });
  $("#pastePreview").addEventListener("change", (e) => { if (e.target.dataset.found !== undefined) updatePasteButton(); });
  $("#pastePreview").addEventListener("click", (e) => { if (e.target.closest("#pasteAdd")) addPasted(); });

  // AI로 일정 짜기
  $("#aiToggle").addEventListener("click", () => toggleToolPanel("ai"));
  $("#aiDays").addEventListener("change", () => {
    if (!ui.aiBudgetTouched && draft) $("#aiBudget").value = aiBudgetFor(BY_ID[draft.id], Number($("#aiDays").value));
  });
  $("#aiBudget").addEventListener("input", (e) => {
    ui.aiBudgetTouched = true;
    e.target.value = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
  });
  $("#aiStyles").addEventListener("click", (e) => {
    const c = e.target.closest("[data-ai-style]");
    if (!c) return;
    const code = c.dataset.aiStyle;
    ui.aiStyles = ui.aiStyles.includes(code) ? ui.aiStyles.filter((x) => x !== code) : ui.aiStyles.concat(code);
    renderAiStyles();
  });
  $("#aiAsk").addEventListener("click", () => askAi(true));
  $("#aiCopyOnly").addEventListener("click", () => askAi(false));
  $("#aiPaste").addEventListener("click", pasteAiReply);
  let aiTimer;
  $("#aiReplyBox").addEventListener("input", (e) => {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(() => handleAiReply(e.target.value), 300);
  });
  $("#aiPreview").addEventListener("click", (e) => { if (e.target.closest("#aiApply")) applyAiResult(); });

  // 공유받은 장소
  $("#shareTarget").addEventListener("change", renderShareDays);
  $("#shareAdd").addEventListener("click", addShared);

  $("#costGrid").addEventListener("input", (e) => {
    const k = e.target.dataset.cost;
    if (!k || !draft) return;
    const n = Number(e.target.value.replace(/[^\d]/g, "").slice(0, 10)) || 0;
    draft.cost[k] = n;
    e.target.value = n ? n.toLocaleString("ko-KR") : "";
    renderCostTotal();
  });
  $("#costPeople").addEventListener("input", (e) => {
    if (!draft) return;
    draft.cost.ppl = Math.min(50, Math.max(1, Math.round(Number(e.target.value)) || 1));
    renderCostTotal();
  });
  $("#photoGrid").addEventListener("click", (e) => {
    if (e.target.closest("#photoAdd")) { $("#photoInput").click(); return; }
    const cell = e.target.closest(".photo-cell[data-pid]");
    if (!cell) return;
    if (e.target.closest(".photo-del")) removeDraftPhoto(cell.dataset.pid);
    else showLightbox(cell.dataset.pid);
  });
  $("#photoInput").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    addPhotos(files);
  });
  $("#lightbox").addEventListener("click", () => { $("#lightbox").hidden = true; });

  $("#settingsBtn").addEventListener("click", openSettings);
  $("#albumBackup").addEventListener("click", openSettings);
  $("#backupBtn").addEventListener("click", makeBackup);
  $("#backupSave").addEventListener("click", saveBackup);
  $("#restoreInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) restoreBackup(f);
  });

  $("#charSlots").addEventListener("change", async (e) => {
    const slot = e.target.dataset.slot, f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!slot || !f) return;
    const tile = e.target.closest(".slot");
    tile.classList.add("busy");
    try {
      // 투명 여백 자르기 + 정사각형 맞추기, 1024px보다 클 때만 고품질 축소
      await Chars.setCustom(slot, await Photos.prepareCharacter(f, 1024));
      Backup.touch();
      refreshChars();
      toast("그림을 넣었어요!");
    } catch (err) {
      tile.classList.remove("busy");
      toast("그림을 넣지 못했어요 😢");
    }
  });
  $("#charSlots").addEventListener("click", async (e) => {
    const slot = e.target.dataset.slotReset;
    if (!slot) return;
    await Chars.setCustom(slot, null);
    Backup.touch();
    refreshChars();
    toast("기본 그림으로 돌아왔어요");
  });

  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]");
    if (c) closeLayer(c.closest(".modal, .sheet"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#lightbox").hidden) { $("#lightbox").hidden = true; return; }
    const top = layers[layers.length - 1];
    if (top) closeLayer(top.el);
  });

  $("#bottomNav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-target]");
    if (b) scrollToSection(b.dataset.target);
  });
  window.addEventListener("scroll", () => {
    if (!navQueued) { navQueued = true; requestAnimationFrame(updateNav); }
  }, { passive: true });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { drawWheel(); updateNav(); }, 150);
  });

  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("#installBtn").hidden = false;
  });
  $("#installBtn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) { /* 무시 */ }
    installPrompt = null;
    $("#installBtn").hidden = true;
  });

  /* ================= 시작 ================= */
  $("#includeVisited").checked = !!state.includeVisited;
  Chars.hydrate(document);
  renderFacets();
  renderAll();
  updateNav();
  Chars.init();
  Photos.askPersist();
  // 안드로이드: 지도 앱에서 "공유 → 어디가지"로 보내면 ./?share_text=… 로 열려요 (manifest의 share_target)
  const sp = new URLSearchParams(location.search);
  const sharedText = ["share_title", "share_text", "share_url"].map((k) => sp.get(k) || "").filter(Boolean).join("\n");
  if (sharedText) {
    history.replaceState(null, "", location.pathname);
    setTimeout(() => openShare(sharedText), 300);
  } else if (sessionStorage.getItem("wheretogo.restored")) {
    sessionStorage.removeItem("wheretogo.restored");
    setTimeout(() => toast("🎉 백업에서 복원했어요!"), 400);
  } else {
    const nag = Backup.reminder();
    if (nag) setTimeout(() => toast(`💾 ${nag}`, { label: "백업하기", fn: openSettings }), 1500);
  }
  if (document.fonts && document.fonts.load) {
    document.fonts.load('16px "Jua"').then(() => { if (!ui.spinning) drawWheel(); }).catch(() => {});
  }
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }
})();

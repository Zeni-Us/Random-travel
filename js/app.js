(function () {
  "use strict";

  const PLACES = window.PLACES;
  const BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));
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
  // places[id] = { selected, visited, planned, visitedAt, date, memo, photos: [photoId] }
  function defaultState() {
    const places = {};
    PLACES.slice(0, 10).forEach((p) => { places[p.id] = { selected: true }; });
    return { places, includeVisited: false, filter: "all" };
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.places) {
        const st = Object.assign(defaultState(), s);
        if (!FILTERS.includes(st.filter)) st.filter = "all";
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
  function filteredList() {
    const q = ui.query.replace(/\s+/g, "");
    return PLACES.filter((p) => matchFilter(p) && (!q || (p.name + p.region + p.desc).replace(/\s+/g, "").includes(q)));
  }
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
    openLayer($("#resultModal"));
    confetti();
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
    const counts = { all: PLACES.length, visited: 0, notyet: 0, planned: 0 };
    PLACES.forEach((p) => {
      const r = get(p.id);
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
    if (r.memo) meta.push("📝");
    return `<li class="place${r.visited ? " is-visited" : ""}${r.planned ? " is-planned" : ""}" data-id="${p.id}">
      <label class="pick" aria-label="${p.name} 룰렛에 넣기"><input type="checkbox" data-act="pick"${r.selected ? " checked" : ""}><span class="pick-box"></span></label>
      <div class="place-main">
        <div class="place-top"><span class="rank${p.rank <= 3 ? " top" : ""}">${p.rank}</span><span class="emoji">${p.emoji}</span><strong class="name">${p.name}</strong>${regionOf(p) ? `<span class="region">${p.region}</span>` : ""}</div>
        <p class="desc">${p.desc}</p>
        <div class="place-actions">
          <button type="button" class="pill pill-visited${r.visited ? " on" : ""}" data-act="visited" aria-pressed="${!!r.visited}">👣 가봤음</button>
          <button type="button" class="pill pill-planned${r.planned ? " on" : ""}" data-act="planned" aria-pressed="${!!r.planned}">🚩 갈거임</button>
          ${meta.length ? `<span class="rec-meta">${meta.join(" · ")}</span>` : ""}
        </div>
      </div>
      <button type="button" class="plus${meta.length ? " has" : ""}" data-act="record" aria-label="${p.name} 사진·메모·날짜 남기기">+</button>
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
      const allDone = state.filter === "notyet" && !ui.query;
      const msg = ui.query ? `'${esc(ui.query)}'에 맞는 여행지가 없어요`
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
      return `<button type="button" class="album-card" data-id="${p.id}">
        <div class="album-cover"${ph[0] ? ` data-photo="${ph[0]}"` : ""}>${p.emoji}</div>
        <div class="album-info">
          <strong>${p.emoji} ${p.name}</strong>
          <span class="date">${r.date ? fmtDate(r.date) : "날짜를 남겨줘"}</span>
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

  function openRecord(id) {
    const p = BY_ID[id], r = get(id);
    draft = { id, visited: !!r.visited, planned: !!r.planned, photos: (r.photos || []).slice(), added: [], removed: [], busy: 0 };
    $("#sheetEmoji").textContent = p.emoji;
    $("#sheetTitle").textContent = p.name;
    $("#sheetSub").textContent = regionDesc(p);
    $("#recDate").value = r.date || "";
    $("#recMemo").value = r.memo || "";
    renderDraft();
    renderPhotoGrid();
    openLayer($("#recordSheet"));
  }

  function renderDraft() {
    $("#draftVisited").classList.toggle("on", draft.visited);
    $("#draftVisited").setAttribute("aria-pressed", draft.visited);
    $("#draftPlanned").classList.toggle("on", draft.planned);
    $("#draftPlanned").setAttribute("aria-pressed", draft.planned);
    $("#dateLabel").textContent = draft.visited ? "📅 다녀온 날" : draft.planned ? "📅 가기로 한 날" : "📅 날짜";
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
      $("#recDate").value !== (r.date || "") || $("#recMemo").value.trim() !== (r.memo || "");
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
  renderAll();
  updateNav();
  Chars.init();
  Photos.askPersist();
  if (sessionStorage.getItem("wheretogo.restored")) {
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

/* 백업·복원 — 기록 + 여행 사진 + 캐릭터 그림을 파일 하나(.json)에 담아요 */
(function () {
  "use strict";

  const APP = "wheretogo";
  const VERSION = 1;
  const STATE_KEY = "wheretogo.v1";
  const META_KEY = "wheretogo.meta.v1";
  const DAY = 86400000;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const PHOTO_RE = /^p_[a-z0-9]+$/;
  const TIME_RE = /^\d{2}:\d{2}$/;
  const pad = (n) => String(n).padStart(2, "0");

  /* ---------- 백업 기록 (마지막 백업 시각, 마지막 변경 시각) ---------- */
  function meta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { /* 아주 작아서 거의 안 남 */ }
  }
  // 소중한 기록(가봤음·갈거임·사진·메모·캐릭터 그림)이 바뀔 때 부르기
  function touch() {
    const m = meta(), now = Date.now();
    m.changedAt = now;
    if (!m.firstChangeAt) m.firstChangeAt = now;
    saveMeta(m);
  }
  function markBackedUp(t) {
    const m = meta();
    m.lastBackup = t || Date.now();
    saveMeta(m);
  }
  function isDirty(m) {
    m = m || meta();
    return !!m.changedAt && (!m.lastBackup || m.changedAt > m.lastBackup);
  }
  // 백업 안 한 변경이 7일 넘게 쌓이면 알려주기 (같은 알림은 3일에 한 번만)
  function reminder() {
    const m = meta(), now = Date.now();
    if (!isDirty(m)) return null;
    const since = m.lastBackup || m.firstChangeAt || m.changedAt;
    if (now - since < 7 * DAY) return null;
    if (m.lastNag && now - m.lastNag < 3 * DAY) return null;
    m.lastNag = now;
    saveMeta(m);
    return m.lastBackup ? `마지막 백업 후 ${Math.floor((now - m.lastBackup) / DAY)}일 지났어요` : "추억이 쌓였어요! 백업해 둘까요?";
  }

  function summarize(state) {
    const s = { visited: 0, planned: 0 };
    Object.values(state.places || {}).forEach((r) => {
      if (r.visited) s.visited++;
      if (r.planned) s.planned++;
    });
    return s;
  }

  /* ---------- 만들기 ---------- */
  async function build() {
    const state = JSON.parse(localStorage.getItem(STATE_KEY) || "null") || { places: {} };
    const created = new Date();
    const ids = new Set();
    Object.values(state.places || {}).forEach((r) => (r.photos || []).forEach((id) => ids.add(id)));

    // 큰 문자열 하나로 합치지 않고 조각째 Blob으로 만들어 폰 메모리를 아껴요
    const parts = [`{"app":"${APP}","version":${VERSION},"createdAt":${JSON.stringify(created.toISOString())},"state":${JSON.stringify(state)},"photos":{`];
    let photos = 0;
    for (const id of ids) {
      const blob = await Photos.getBlob(id);
      if (!blob) continue;
      parts.push((photos ? "," : "") + JSON.stringify(id) + ":" + JSON.stringify(await Photos.blobToDataUrl(blob)));
      photos++;
    }
    parts.push('},"chars":{');
    let chars = 0;
    for (const slot of Chars.customSlots()) {
      const blob = await Photos.getBlob("char:" + slot);
      if (!blob) continue;
      parts.push((chars ? "," : "") + JSON.stringify(slot) + ":" + JSON.stringify(await Photos.blobToDataUrl(blob)));
      chars++;
    }
    parts.push("}}");

    const stamp = `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}`;
    const file = new File(parts, `우리어디가지_백업_${stamp}.json`, { type: "application/json" });
    return { file, photos, chars, summary: summarize(state), createdAt: created.getTime() };
  }

  /* ---------- 읽기 (아직 아무것도 바꾸지 않음) ---------- */
  function sanitizeState(raw) {
    const known = new Set(window.PLACES.map((p) => p.id));
    const places = {};
    Object.entries(raw.places || {}).forEach(([id, r]) => {
      if (!known.has(id) || !r || typeof r !== "object") return;
      const o = {};
      ["selected", "visited", "planned"].forEach((k) => { if (r[k] === true) o[k] = true; });
      if (typeof r.visitedAt === "number") o.visitedAt = r.visitedAt;
      if (typeof r.date === "string" && DATE_RE.test(r.date)) o.date = r.date;
      if (typeof r.memo === "string" && r.memo.trim()) o.memo = r.memo.slice(0, 2000);
      if (Array.isArray(r.photos)) {
        const ph = r.photos.filter((x) => typeof x === "string" && PHOTO_RE.test(x));
        if (ph.length) o.photos = ph;
      }
      const plan = sanitizePlan(r.plan);
      if (plan) o.plan = plan;
      const cost = sanitizeCost(r.cost);
      if (cost) o.cost = cost;
      places[id] = o;
    });
    const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(0, 20) : []);
    const f = raw.facets && typeof raw.facets === "object" ? raw.facets : {};
    return {
      places,
      includeVisited: raw.includeVisited === true,
      filter: ["all", "visited", "notyet", "planned"].includes(raw.filter) ? raw.filter : "all",
      mapApp: raw.mapApp === "kakao" ? "kakao" : "naver",
      facets: { areas: strings(f.areas), tiers: strings(f.tiers), types: strings(f.types) } // 앱이 다시 한번 걸러요
    };
  }

  // 일정표: [{ stops: [{ t: "HH:MM", p: 장소, m: 메모 }] }] — 최대 30일, 하루 50곳
  function sanitizePlan(plan) {
    if (!Array.isArray(plan)) return null;
    const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    const days = plan.slice(0, 30).map((d) => ({
      stops: (d && Array.isArray(d.stops) ? d.stops : []).slice(0, 50).map((s) => {
        const o = {
          t: s && typeof s.t === "string" && TIME_RE.test(s.t) ? s.t : "",
          p: str(s && s.p, 60),
          m: str(s && s.m, 120)
        };
        // 지도 링크는 http(s) 주소만 (javascript: 같은 건 버려요)
        if (s && typeof s.u === "string" && /^https?:\/\//i.test(s.u) && s.u.length <= 500) o.u = s.u;
        return o;
      }).filter((s) => s.t || s.p || s.m || s.u)
    }));
    while (days.length && !days[days.length - 1].stops.length) days.pop();
    return days.length ? days : null;
  }

  // 쓴 돈 / 예상 예산 (원): 교통 tr · 숙박 st · 식비 fd · 관광·체험 ac · 쇼핑·기타 et · 인원 ppl
  function sanitizeCost(c) {
    if (!c || typeof c !== "object") return null;
    const o = {};
    ["tr", "st", "fd", "ac", "et"].forEach((k) => {
      const n = Math.round(Number(c[k]));
      if (Number.isFinite(n) && n > 0) o[k] = Math.min(n, 9999999999);
    });
    const ppl = Math.round(Number(c.ppl));
    if (Number.isFinite(ppl) && ppl > 1) o.ppl = Math.min(ppl, 50);
    return Object.keys(o).length ? o : null;
  }

  const isImageData = (v) => typeof v === "string" && v.startsWith("data:image/");

  async function read(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { throw new Error("not-backup"); }
    if (!data || data.app !== APP || !data.state || typeof data.state.places !== "object") throw new Error("not-backup");

    const state = sanitizeState(data.state);
    const slotKeys = new Set(Chars.SLOTS.map((s) => s.key));
    const photos = [], chars = [];
    for (const [id, v] of Object.entries(data.photos || {})) {
      if (PHOTO_RE.test(id) && isImageData(v)) photos.push([id, await Photos.dataUrlToBlob(v)]);
    }
    for (const [slot, v] of Object.entries(data.chars || {})) {
      if (slotKeys.has(slot) && isImageData(v)) chars.push([slot, await Photos.dataUrlToBlob(v)]);
    }
    return { state, photos, chars, createdAt: Date.parse(data.createdAt) || Date.now(), summary: summarize(state) };
  }

  /* ---------- 되돌리기 ---------- */
  // 새 내용을 먼저 다 써 넣고 나서 남는 옛 사진만 지워요 (중간에 실패해도 기존 사진이 사라지지 않게)
  async function apply(b) {
    const keep = new Set();
    for (const [id, blob] of b.photos) { await Photos.putWithId(id, blob); keep.add(id); }
    for (const [slot, blob] of b.chars) { await Photos.putWithId("char:" + slot, blob); keep.add("char:" + slot); }
    localStorage.setItem(STATE_KEY, JSON.stringify(b.state));
    Chars.replaceSlotList(b.chars.map((c) => c[0]));
    for (const k of await Photos.keys()) {
      if (!keep.has(k)) await Photos.del(k);
    }
    const m = meta();
    m.lastBackup = b.createdAt;
    m.changedAt = b.createdAt;
    m.firstChangeAt = m.firstChangeAt || b.createdAt;
    saveMeta(m);
  }

  window.Backup = { build, read, apply, meta, touch, markBackedUp, isDirty, reminder };
})();

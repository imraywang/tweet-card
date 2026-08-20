/* Ray 推文卡片工场 —— 无框架单页应用 */

// 后台标签页里 rAF 被冻结，会卡死 html-to-image 导出和卡片测量；隐藏时退化为 setTimeout
const _raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) =>
  document.hidden ? setTimeout(() => cb(performance.now()), 32) : _raf(cb);

const $ = (id) => document.getElementById(id);

const DEFAULT_PROFILE = { name: "你的名字", handle: "yourname", avatar: "avatar.png", verified: true };

const state = {
  profile: { ...DEFAULT_PROFILE },
  posts: [],
  filtered: [],
  selected: null,        // 当前上卡的推文对象
  customText: "",
  tab: "library",        // library | custom
  mode: "poster",        // poster | card
  theme: "light",        // light | dark
  metricsOn: true,
  // 默认落在抖音安全区中央：右侧 140px / 底部 300px / 顶部 150px / 左侧 60px（画布px，预览折半）
  cardScale: 92,         // 用户设置的缩放（%），在 fitScale 基础上叠加
  fitScale: 1,           // 长文自动适配画框的缩放
  cardX: -20,            // 拖动偏移（px，相对画框中心）
  cardY: -37,
  cardOpacity: 100,
  guidesOn: true,        // 抖音安全区参考线（仅预览，不进导出）
  search: "",
  chip: { kind: "all", v: "" },
  month: "",
  sort: "new",           // new | hot | saved
  bg: null,              // 当前背景的 URL / dataURL
  fakeMetrics: null,     // 卡片上显示的随机互动数据
};

const LIST_CAP = 200;

/* ---------- 工具 ---------- */

function fmtNum(n) {
  if (n == null) return "0";
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "万";
  if (n >= 1000) return n.toLocaleString("en-US");
  return String(n);
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  return (y === now.getFullYear() ? "" : `${y}年`) + `${m}月${d}日`;
}

function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/* ---------- 账号信息（profile.json 默认值 + localStorage 本机覆盖） ---------- */

const PROFILE_KEY = "tcs-profile";
const POSTS_KEY = "tcs-posts";

async function loadProfile() {
  try {
    const base = await fetch("profile.json").then((r) => (r.ok ? r.json() : {}));
    Object.assign(state.profile, base);
  } catch { /* 没有 profile.json 就用内置默认 */ }
  try {
    Object.assign(state.profile, JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"));
  } catch { /* 本机覆盖损坏则忽略 */ }
  applyProfile();
}

function saveProfileOverride(patch) {
  Object.assign(state.profile, patch);
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    localStorage.setItem(PROFILE_KEY, JSON.stringify(Object.assign(saved, patch)));
  } catch (e) {
    alert("保存到本机失败（可能是头像图片太大）：" + e.message);
  }
  applyProfile();
}

function applyProfile() {
  const p = state.profile;
  const avatarSrc = p.avatarData || p.avatar || "avatar.png";
  $("tc-avatar").src = avatarSrc;
  $("brand-avatar").src = avatarSrc;
  $("profile-avatar-preview").src = avatarSrc;
  $("tc-name-text").textContent = p.name;
  $("tc-handle-text").textContent = "@" + p.handle;
  $("tc-badge").style.display = p.verified ? "" : "none";
  $("brand-eyebrow").textContent = `${p.name} · @${p.handle}`.toUpperCase();
  $("profile-name").value = p.name;
  $("profile-handle").value = p.handle;
  $("badge-on").classList.toggle("active", !!p.verified);
  $("badge-off").classList.toggle("active", !p.verified);
}

/* 导入的推文库：字段宽容，缺什么补什么 */
function normalizePosts(arr) {
  return arr
    .filter((p) => p && typeof p.text === "string" && p.text.trim())
    .map((p, i) => ({
      id: String(p.id || i + 1),
      date: p.date || todayISO(),
      datetime: p.datetime || p.date || "",
      text: p.text,
      long: !!p.long,
      sourceUrl: p.sourceUrl || "",
      topic: p.topic || "未分类",
      metrics: Object.assign({ likes: 0, replies: 0, reposts: 0, bookmarks: 0, views: 0 }, p.metrics || {}),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* ---------- 素材库 ---------- */

function applyFilter() {
  const q = state.search.trim().toLowerCase();
  let list = state.posts;
  if (state.chip.kind === "topic") list = list.filter((p) => p.topic === state.chip.v);
  else if (state.chip.kind === "tag") list = list.filter((p) => (p.tags || []).includes(state.chip.v));
  if (state.month) list = list.filter((p) => p.date.startsWith(state.month));
  if (q) list = list.filter((p) => p.text.toLowerCase().includes(q));
  if (state.sort === "hot") list = [...list].sort((a, b) => b.metrics.likes - a.metrics.likes);
  else if (state.sort === "saved") list = [...list].sort((a, b) => b.metrics.bookmarks - a.metrics.bookmarks);
  state.filtered = list;
  renderList();
}

/* 客观特征标签：从数据确定性推导，任何账号都适用。
   爆款/高收藏按库内分位数（前 10%），样本 ≥20 条才启用。 */
const TAG_DEFS = [
  ["🔥 爆款", (p, ctx) => ctx.likesP90 > 0 && p.metrics.likes >= ctx.likesP90],
  ["⭐ 高收藏", (p, ctx) => ctx.bmP90 > 0 && p.metrics.bookmarks >= ctx.bmP90],
  ["📜 长推", (p) => p.text.length > 300],
  ["📋 清单体", (p) => /(^|\n)\s*(?:[1１][、.．)）]|1️⃣)/.test(p.text)],
  ["❓ 提问式", (p) => /[？?]/.test(p.text.split("\n")[0]) || /[？?]\s*$/.test(p.text)],
  ["💬 金句", (p) => p.text.length <= 60],
];

function computeTags() {
  const withLikes = state.posts.filter((p) => p.metrics && p.metrics.likes > 0);
  const pct = (values, q) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length * q)]; };
  const ctx = {
    likesP90: withLikes.length >= 20 ? pct(withLikes.map((p) => p.metrics.likes), 0.9) : 0,
    bmP90: withLikes.length >= 20 ? pct(withLikes.map((p) => p.metrics.bookmarks), 0.9) : 0,
  };
  state.posts.forEach((p) => {
    p.tags = TAG_DEFS.filter(([, match]) => match(p, ctx)).map(([name]) => name);
  });
}

function renderChips() {
  const wrap = $("topic-chips");
  wrap.innerHTML = "";
  const mk = (label, count, active, onclick) => {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " active" : "");
    b.innerHTML = `${label}<em>${count}</em>`;
    b.onclick = onclick;
    wrap.appendChild(b);
  };
  const pick = (kind, v) => () => { state.chip = { kind, v }; renderChips(); applyFilter(); };
  mk("全部", state.posts.length, state.chip.kind === "all", pick("all", ""));
  const topicCounts = {};
  state.posts.forEach((p) => { if (p.topic && p.topic !== "未分类") topicCounts[p.topic] = (topicCounts[p.topic] || 0) + 1; });
  Object.entries(topicCounts).forEach(([t, n]) => mk(t, n, state.chip.kind === "topic" && state.chip.v === t, pick("topic", t)));
  const tagCounts = {};
  state.posts.forEach((p) => (p.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  TAG_DEFS.forEach(([name]) => { if (tagCounts[name]) mk(name, tagCounts[name], state.chip.kind === "tag" && state.chip.v === name, pick("tag", name)); });
}

function renderMonthOptions() {
  const sel = $("month-filter");
  const months = [...new Set(state.posts.map((p) => p.date.slice(0, 7)))].sort().reverse();
  sel.innerHTML = '<option value="">全部时间</option>' +
    months.map((m) => `<option value="${m}">${Number(m.slice(0, 4))}年${Number(m.slice(5))}月</option>`).join("");
  sel.value = months.includes(state.month) ? state.month : "";
  state.month = sel.value;
}

function refreshLibrary() {
  computeTags();
  renderChips();
  renderMonthOptions();
  applyFilter();
}

function renderList() {
  const ul = $("post-list");
  ul.innerHTML = "";
  state.filtered.slice(0, LIST_CAP).forEach((p) => {
    const li = document.createElement("li");
    li.className = "post-item" + (state.selected && state.selected.id === p.id ? " active" : "");
    const label = p.topic && p.topic !== "未分类" ? p.topic : ((p.tags && p.tags[0]) || "");
    li.innerHTML = `
      <div class="pi-meta"><span>${p.date}${label ? " · " + label : ""}</span><span>❤ ${fmtNum(p.metrics.likes)}</span></div>
      <div class="pi-text"></div>`;
    li.querySelector(".pi-text").textContent = p.text;
    li.onclick = () => selectPost(p);
    ul.appendChild(li);
  });
  if (state.filtered.length > LIST_CAP) {
    const li = document.createElement("li");
    li.className = "list-more";
    li.textContent = `共 ${state.filtered.length} 条，仅显示前 ${LIST_CAP} 条，继续用关键词缩小范围`;
    ul.appendChild(li);
  }
  $("lib-count").textContent = `· ${state.filtered.length}/${state.posts.length} 条`;
}

/* 随机但好看的互动数据：浏览量对数均匀分布，其余按真实比例区间派生 */
function rollMetrics() {
  const r = (min, max) => min + Math.random() * (max - min);
  const views = Math.round(30000 * Math.pow(25, Math.random()) / 100) * 100; // 3万 ~ 75万
  const likes = Math.round(views * r(0.022, 0.045));
  state.fakeMetrics = {
    views,
    likes,
    bookmarks: Math.round(likes * r(0.55, 1.05)),
    reposts: Math.round(likes * r(0.15, 0.32)),
    replies: Math.round(likes * r(0.05, 0.12)),
  };
}

function selectPost(p) {
  state.selected = p;
  rollMetrics();
  renderList();
  renderCard();
}

function randomPost() {
  if (!state.filtered.length) return;
  const p = state.filtered[Math.floor(Math.random() * state.filtered.length)];
  selectPost(p);
  const active = document.querySelector(".post-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

/* ---------- 卡片渲染 ---------- */

const METRIC_ICONS = {
  replies: '<svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg>',
  reposts: '<svg viewBox="0 0 24 24"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"/></svg>',
  likes: '<svg viewBox="0 0 24 24"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg>',
  bookmarks: '<svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z"/></svg>',
  views: '<svg viewBox="0 0 24 24"><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"/></svg>',
};

function renderCard() {
  const isCustom = state.tab === "custom";
  const text = isCustom ? (state.customText || "写点什么……") : (state.selected ? state.selected.text : "");
  const date = isCustom ? todayISO() : (state.selected ? state.selected.date : todayISO());

  const body = $("tc-body");
  body.textContent = text;
  body.className = "tc-body " + (text.length > 500 ? "size-xs" : text.length > 320 ? "size-s" : text.length > 170 ? "size-m" : "");

  $("tc-date").textContent = fmtDate(date);

  const card = $("tweet-card");
  card.classList.toggle("dark", state.theme === "dark");
  $("scale-val").textContent = state.cardScale + "%";

  // 背景半透明（只透卡片底色，文字不透）
  const alpha = state.cardOpacity / 100;
  card.style.backgroundColor = state.theme === "dark"
    ? `rgba(0, 0, 0, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
  $("opacity-val").textContent = state.cardOpacity + "%";

  const metricsEl = $("tc-metrics");
  const m = state.fakeMetrics;
  if (state.metricsOn && m) {
    metricsEl.classList.remove("hidden");
    metricsEl.innerHTML = ["replies", "reposts", "likes", "bookmarks", "views"]
      .map((k) => `<span>${METRIC_ICONS[k]}<b>${fmtNum(m[k])}</b></span>`).join("");
  } else {
    metricsEl.classList.add("hidden");
  }

  const link = $("source-link");
  if (!isCustom && state.selected && state.selected.sourceUrl) {
    link.style.display = "";
    link.href = state.selected.sourceUrl;
  } else {
    link.style.display = "none";
  }

  const stage = $("stage");
  const isFrame = state.mode !== "card"; // poster(3:4) 或 tall(9:16)
  stage.classList.toggle("card-only", !isFrame);
  stage.classList.toggle("tall", state.mode === "tall");
  $("preview-label").textContent = state.mode === "card" ? "纯卡片 · 透明背景 PNG"
    : state.mode === "tall" ? "9:16 竖图 · 1080×1920" : "3:4 竖图 · 1080×1440";
  $("drag-hint").style.display = isFrame ? "" : "none";

  // 安全区参考线只在竖图模式且开关打开时显示
  $("safe-guides").classList.toggle("hidden", !isFrame || !state.guidesOn);
  $("guides-toggle").style.display = isFrame ? "" : "none";
  $("live-btn").style.display = isFrame ? "" : "none";

  // 竖图模式：卡片浮动（整体缩放 + 可拖动）；长文先自动缩到画框内，再叠加用户缩放
  card.classList.toggle("floating", isFrame);
  if (isFrame) {
    requestAnimationFrame(() => {
      state.fitScale = Math.min(1, (stage.clientHeight * 0.92) / card.offsetHeight);
      applyCardTransform();
    });
  } else {
    card.style.transform = "";
  }
}

function applyCardTransform() {
  const card = $("tweet-card");
  if (state.mode === "card") return;
  const s = (state.fitScale * state.cardScale) / 100;
  card.style.transform = `translate(-50%, -50%) translate(${state.cardX}px, ${state.cardY}px) scale(${s.toFixed(3)})`;
}

/* 拖动卡片（仅竖图模式），双击回中 */
function initDrag() {
  const card = $("tweet-card");
  const stage = $("stage");
  let drag = null;
  card.addEventListener("pointerdown", (e) => {
    if (state.mode === "card") return;
    e.preventDefault();
    drag = { x0: e.clientX, y0: e.clientY, baseX: state.cardX, baseY: state.cardY };
    card.classList.add("dragging");
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const limX = stage.clientWidth * 0.55, limY = stage.clientHeight * 0.55;
    state.cardX = Math.max(-limX, Math.min(limX, drag.baseX + e.clientX - drag.x0));
    state.cardY = Math.max(-limY, Math.min(limY, drag.baseY + e.clientY - drag.y0));
    applyCardTransform();
  });
  const end = () => { drag = null; card.classList.remove("dragging"); };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
  card.addEventListener("dblclick", () => { state.cardX = 0; state.cardY = 0; applyCardTransform(); });
}

/* ---------- 背景 ---------- */

async function loadBackgrounds() {
  const manifest = await fetch("backgrounds/manifest.json").then((r) => r.json());
  const grid = $("bg-grid");
  manifest.forEach((item, i) => {
    const btn = document.createElement("button");
    btn.className = "bg-thumb";
    btn.title = item.name;
    btn.innerHTML = `<img src="backgrounds/${item.file}" alt="${item.name}" />`;
    btn.onclick = () => setBg("backgrounds/" + item.file, btn);
    grid.appendChild(btn);
    if (i === 0) setBg("backgrounds/" + item.file, btn);
  });
}

function setBg(src, thumbEl) {
  state.bg = src;
  $("stage-bg").src = src;
  document.querySelectorAll(".bg-thumb").forEach((b) => b.classList.remove("active"));
  if (thumbEl) thumbEl.classList.add("active");
}

function addCustomThumb(dataUrl) {
  const grid = $("bg-grid");
  const btn = document.createElement("button");
  btn.className = "bg-thumb";
  btn.innerHTML = `<img src="${dataUrl}" alt="自定义背景" />`;
  btn.onclick = () => setBg(dataUrl, btn);
  grid.appendChild(btn);
  setBg(dataUrl, btn);
}

/* ---------- 导出 ---------- */

async function exportPng() {
  const btn = $("export-btn");
  btn.disabled = true;
  btn.textContent = "生成中…";
  try {
    const stage = $("stage");
    const pixelRatio = state.mode === "card" ? 3 : 2; // 竖图 540x720 → 1080x1440
    const dataUrl = await htmlToImage.toPng(stage, {
      pixelRatio,
      backgroundColor: state.mode === "card" ? undefined : "#000",
      filter: (node) => node.id !== "safe-guides", // 参考线不进成品
    });
    const a = document.createElement("a");
    const tag = state.tab === "custom" ? "custom" : (state.selected ? state.selected.id : "empty");
    a.download = `${state.profile.handle}-card-${(state.selected && state.tab !== "custom" ? state.selected.date : todayISO()).replaceAll("-", "")}-${tag}.png`;
    a.href = dataUrl;
    a.click();
  } catch (err) {
    alert("导出失败：" + err.message + "\n如果用了网络图片背景，可能是跨域限制，请下载后用「上传图片」。");
  } finally {
    btn.disabled = false;
    btn.textContent = "下载 PNG";
  }
}

/* ---------- BYOK：用用户自己的 X API Key 同步推文 ----------
   Key 只存 localStorage；浏览器无法直连 api.x.com（无 CORS 头），
   请求经 tools.upthos.com 的无状态转发（Pages Function，不记录不存储）。 */

const X_PROXY = "https://tools.upthos.com/api/x/";
const XKEY_KEY = "tcs-xkey";
const XSYNC_KEY = "tcs-xsync"; // { handle, newestId }

async function xApi(path, params, token) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(X_PROXY + path + (qs ? "?" + qs : ""), {
    headers: { Authorization: "Bearer " + token },
  });
  if (r.status === 401) throw new Error("Key 无效或无权限（401）");
  if (r.status === 403) throw new Error("你的套餐无此端点权限（403）");
  if (r.status === 429) throw new Error("RATE_LIMIT");
  if (!r.ok) throw new Error("X API 错误 " + r.status);
  return r.json();
}

/* 清洗 API 返回：长推取全文，t.co 换成可读链接，媒体链接删除（与 build_posts.py 同逻辑） */
function cleanApiText(p) {
  const note = p.note_tweet || {};
  let text = note.text || p.text || "";
  const urls = [...((p.entities || {}).urls || []), ...((note.entities || {}).urls || [])];
  for (const u of urls) {
    if (!u.url) continue;
    const expanded = u.expanded_url || "", display = u.display_url || "";
    if (expanded.includes("/photo/") || expanded.includes("/video/") || display.startsWith("pic.x.com") || display.startsWith("pic.twitter.com")) {
      text = text.replaceAll(u.url, "");
    } else {
      text = text.replaceAll(u.url, display);
    }
  }
  text = text.replace(/https:\/\/t\.co\/\w+/g, "");
  return text.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
}

function apiToPost(p, handle) {
  const d = new Date(p.created_at);
  const pm = p.public_metrics || {};
  return {
    id: p.id,
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    datetime: "",
    text: cleanApiText(p),
    long: !!p.note_tweet,
    sourceUrl: `https://x.com/${handle}/status/${p.id}`,
    topic: "未分类",
    metrics: {
      likes: pm.like_count || 0,
      replies: pm.reply_count || 0,
      reposts: (pm.retweet_count || 0) + (pm.quote_count || 0),
      bookmarks: pm.bookmark_count || 0,
      views: pm.impression_count || 0,
    },
  };
}

async function xSync() {
  const btn = $("x-sync"), status = $("x-status");
  const token = $("x-token").value.trim();
  const handle = $("x-handle").value.trim().replace(/^@+/, "");
  const limit = Number($("x-limit").value);
  if (!token) { status.textContent = "请先填 Bearer Token"; return; }
  if (!token.startsWith("AA") || token.length < 60) {
    status.textContent = "这不像 Bearer Token（应为 AAAA 开头的 100+ 位长字符串）。API Key / Secret 不能用，请到 Keys and tokens 页复制 Bearer Token";
    return;
  }
  if (!handle) { status.textContent = "请填用户名"; return; }

  btn.disabled = true;
  const collected = [];
  try {
    localStorage.setItem(XKEY_KEY, token);

    status.textContent = "查询用户…";
    const ur = await xApi("2/users/by/username/" + handle, { "user.fields": "profile_image_url,verified,verified_type" }, token);
    if (!ur.data) throw new Error("找不到用户 @" + handle);
    const user = ur.data;

    let sync = null;
    try { sync = JSON.parse(localStorage.getItem(XSYNC_KEY) || "null"); } catch { /* 忽略 */ }
    const incremental = sync && sync.handle === handle && sync.newestId;

    const base = {
      max_results: "100",
      exclude: "replies,retweets",
      "tweet.fields": "created_at,public_metrics,note_tweet,entities",
    };
    if (incremental) base.since_id = sync.newestId;

    let nextToken = null, rateLimited = false;
    while (collected.length < limit) {
      status.textContent = `拉取中… 已 ${collected.length} 条`;
      const params = { ...base };
      if (nextToken) params.pagination_token = nextToken;
      let page;
      try {
        page = await xApi(`2/users/${user.id}/tweets`, params, token);
      } catch (e) {
        if (e.message === "RATE_LIMIT" && collected.length) { rateLimited = true; break; }
        throw e;
      }
      (page.data || []).forEach((p) => collected.push(apiToPost(p, handle)));
      nextToken = page.meta && page.meta.next_token;
      if (!nextToken) break;
    }

    const merged = new Map();
    if (incremental) state.posts.forEach((p) => merged.set(p.id, p));
    collected.forEach((p) => { if (p.text) merged.set(p.id, p); });
    if (!merged.size) throw new Error(incremental ? "没有新推文" : "没拉到任何推文");
    state.posts = [...merged.values()].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

    localStorage.setItem(XSYNC_KEY, JSON.stringify({ handle, newestId: state.posts[0].id }));
    try { localStorage.setItem(POSTS_KEY, JSON.stringify(state.posts)); }
    catch { alert("推文库太大无法保存到本机，仅本次会话有效。可让 Claude 把它写入 posts.json 持久化。"); }

    saveProfileOverride({ name: user.name, handle: user.username, verified: !!(user.verified || user.verified_type === "blue") });
    try {
      const av = await fetch(user.profile_image_url.replace("_normal", "_400x400"));
      if (av.ok) {
        const blob = await av.blob();
        const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        saveProfileOverride({ avatarData: dataUrl });
      }
    } catch { /* 头像拉不到就让用户手动传 */ }

    state.chip = { kind: "all", v: "" };
    state.month = "";
    refreshLibrary();
    $("tab-library").click();
    selectPost(state.posts[0]);
    status.textContent = rateLimited
      ? `已同步 ${collected.length} 条后触发频控，15 分钟后可再拉`
      : `完成：新增 ${collected.length} 条，库内共 ${state.posts.length} 条`;
  } catch (err) {
    status.textContent = err.message === "RATE_LIMIT" ? "触发 X API 频控（429），请 15 分钟后再试" : "失败：" + err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 导出 Live 图（3 秒动效 MP4，WebCodecs 编码） ----------
   背景缓慢推近 + 卡片轻微呼吸上浮，文字保持静止清晰。
   手机端用 intoLive / 快捷指令把 MP4 转成实况照片后即可按 Live 图发布。 */

function drawCover(ctx, img, W, H, zoom) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const ir = iw / ih, r = W / H;
  let dw, dh;
  if (ir > r) { dh = H * zoom; dw = dh * ir; } else { dw = W * zoom; dh = dw / ir; }
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

async function exportLive() {
  if (state.mode === "card") return;
  if (!("VideoEncoder" in window)) {
    alert("当前浏览器不支持视频编码（WebCodecs）。请使用新版 Chrome / Edge / Safari。");
    return;
  }
  const btn = $("live-btn");
  btn.disabled = true;
  try {
    const W = 1080, H = state.mode === "tall" ? 1920 : 1440;
    const FPS = 30, DUR = 3, TOTAL = FPS * DUR;

    const codec = { codec: "avc1.640028", width: W, height: H, bitrate: 8_000_000, framerate: FPS };
    const support = await VideoEncoder.isConfigSupported(codec);
    if (!support.supported) throw new Error("此设备不支持 H.264 1080p 编码");

    // 卡片只光栅化一次，逐帧只做画布合成
    btn.textContent = "准备卡片…";
    const card = $("tweet-card");
    const cardCanvas = await htmlToImage.toCanvas(card, { pixelRatio: 2 });
    const s = (state.fitScale * state.cardScale) / 100;
    const cw = card.offsetWidth * 2 * s, ch = card.offsetHeight * 2 * s;
    const cx = W / 2 + state.cardX * 2, cy = H / 2 + state.cardY * 2;

    const bg = new Image();
    await new Promise((res, rej) => { bg.onload = res; bg.onerror = rej; bg.src = state.bg; });

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width: W, height: H },
      fastStart: "in-memory",
    });
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error(e),
    });
    encoder.configure(codec);

    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");

    for (let f = 0; f < TOTAL; f++) {
      const t = f / (TOTAL - 1);
      const breathe = 0.5 - 0.5 * Math.cos(t * Math.PI * 2); // 0→1→0，收尾回原位
      drawCover(ctx, bg, W, H, 1 + 0.06 * t);                // 背景缓慢推近
      const cs = 1 + 0.012 * breathe;                        // 卡片轻微呼吸
      const dy = -14 * breathe;                              // 轻微上浮
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 10;
      ctx.drawImage(cardCanvas, cx - (cw * cs) / 2, cy + dy - (ch * cs) / 2, cw * cs, ch * cs);
      ctx.restore();
      const frame = new VideoFrame(cv, { timestamp: (f * 1e6) / FPS, duration: 1e6 / FPS });
      encoder.encode(frame, { keyFrame: f % FPS === 0 });
      frame.close();
      if (f % 6 === 0) {
        btn.textContent = `渲染 ${Math.round((f / TOTAL) * 100)}%`;
        await new Promise((r) => setTimeout(r));
      }
    }
    btn.textContent = "编码中…";
    await encoder.flush();
    muxer.finalize();

    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const a = document.createElement("a");
    const tag = state.tab === "custom" ? "custom" : (state.selected ? state.selected.id : "empty");
    a.download = `${state.profile.handle}-live-${todayISO().replaceAll("-", "")}-${tag}.mp4`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);

    if (!localStorage.getItem("tcs-live-hint")) {
      localStorage.setItem("tcs-live-hint", "1");
      alert("已导出 3 秒动效 MP4。\n\n发布为 Live 图：把视频传到手机，用 intoLive（免费 App）或快捷指令转成实况照片，抖音/小红书发布时从相册选择即可带「实况」标识。");
    }
  } catch (err) {
    alert("Live 图导出失败：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "导出 Live 图";
  }
}

/* ---------- 事件绑定 ---------- */

function bindSegmented(pairs, onChange) {
  // pairs: [[element, value], ...]
  pairs.forEach(([el, value]) => {
    el.onclick = () => {
      pairs.forEach(([e]) => e.classList.remove("active"));
      el.classList.add("active");
      onChange(value);
    };
  });
}

function bind() {
  bindSegmented([[$("tab-library"), "library"], [$("tab-custom"), "custom"]], (v) => {
    state.tab = v;
    $("library-section").classList.toggle("hidden", v !== "library");
    $("custom-section").classList.toggle("hidden", v !== "custom");
    renderCard();
  });

  bindSegmented([[$("mode-poster"), "poster"], [$("mode-tall"), "tall"], [$("mode-card"), "card"]], (v) => { state.mode = v; renderCard(); });
  bindSegmented([[$("theme-light"), "light"], [$("theme-dark"), "dark"]], (v) => { state.theme = v; renderCard(); });
  bindSegmented([[$("metrics-on"), true], [$("metrics-off"), false]], (v) => { state.metricsOn = v; renderCard(); });

  document.querySelectorAll(".sort-chip").forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll(".sort-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.sort = chip.dataset.sort;
      applyFilter();
    };
  });

  $("search").oninput = (e) => { state.search = e.target.value; applyFilter(); };
  $("month-filter").onchange = (e) => { state.month = e.target.value; applyFilter(); };
  $("random-btn").onclick = randomPost;
  $("custom-text").oninput = (e) => { state.customText = e.target.value; renderCard(); };
  $("card-scale").oninput = (e) => { state.cardScale = Number(e.target.value); $("scale-val").textContent = state.cardScale + "%"; applyCardTransform(); };
  $("card-opacity").oninput = (e) => { state.cardOpacity = Number(e.target.value); renderCard(); };

  $("bg-upload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addCustomThumb(reader.result);
    reader.readAsDataURL(file);
  };

  $("bg-url").onkeydown = async (e) => {
    if (e.key !== "Enter") return;
    const url = e.target.value.trim();
    if (!url) return;
    try {
      const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
      const reader = new FileReader();
      reader.onload = () => addCustomThumb(reader.result);
      reader.readAsDataURL(blob);
    } catch {
      alert("拉取失败（多半是跨域限制）。请把图片下载到本地后用「上传图片」。");
    }
  };

  $("copy-text").onclick = async () => {
    const text = state.tab === "custom" ? state.customText : (state.selected ? state.selected.text : "");
    await navigator.clipboard.writeText(text);
    $("copy-text").textContent = "已复制 ✓";
    setTimeout(() => ($("copy-text").textContent = "复制文案"), 1200);
  };

  $("shuffle-metrics").onclick = () => { rollMetrics(); renderCard(); };

  $("guides-toggle").onclick = () => {
    state.guidesOn = !state.guidesOn;
    $("guides-toggle").textContent = state.guidesOn ? "安全区 ✓" : "安全区";
    $("guides-toggle").classList.toggle("active", state.guidesOn);
    renderCard();
  };

  $("export-btn").onclick = exportPng;
  $("live-btn").onclick = exportLive;

  /* ---- 账号信息 ---- */
  $("profile-name").oninput = (e) => { saveProfileOverride({ name: e.target.value || DEFAULT_PROFILE.name }); renderCard(); };
  $("profile-handle").oninput = (e) => { saveProfileOverride({ handle: e.target.value.replace(/^@+/, "") || DEFAULT_PROFILE.handle }); renderCard(); };
  $("badge-on").onclick = () => saveProfileOverride({ verified: true });
  $("badge-off").onclick = () => saveProfileOverride({ verified: false });

  $("avatar-upload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => saveProfileOverride({ avatarData: reader.result });
    reader.readAsDataURL(file);
  };

  $("posts-upload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw new Error("需要一个 JSON 数组");
        const posts = normalizePosts(arr);
        if (!posts.length) throw new Error("没有找到带 text 字段的条目");
        state.posts = posts;
        try { localStorage.setItem(POSTS_KEY, JSON.stringify(posts)); }
        catch { alert("推文库太大，无法保存到本机，仅本次会话有效。想永久使用请把文件存为项目里的 posts.json"); }
        state.chip = { kind: "all", v: "" };
        state.month = "";
        refreshLibrary();
        selectPost(state.posts[0]);
      } catch (err) {
        alert("导入失败：" + err.message + "\n格式见 README：[{\"date\":\"2026-01-01\",\"text\":\"...\"}]");
      }
    };
    reader.readAsText(file);
  };

  $("profile-reset").onclick = () => {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(POSTS_KEY);
    localStorage.removeItem(XSYNC_KEY);
    location.reload();
  };

  /* ---- X API 同步（BYOK） ---- */
  $("x-token").value = localStorage.getItem(XKEY_KEY) || "";
  if (state.profile.handle && state.profile.handle !== DEFAULT_PROFILE.handle) $("x-handle").value = state.profile.handle;
  $("x-sync").onclick = xSync;
  $("x-clear").onclick = () => {
    localStorage.removeItem(XKEY_KEY);
    $("x-token").value = "";
    $("x-status").textContent = "已清除本机保存的 Key";
  };
}

/* ---------- 启动 ---------- */

async function loadPosts() {
  // 优先级：本机导入的库 → posts.json → posts.sample.json（示例数据）
  try {
    const saved = JSON.parse(localStorage.getItem(POSTS_KEY) || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* 忽略损坏的本机数据 */ }
  for (const src of ["posts.json", "posts.sample.json"]) {
    try {
      const r = await fetch(src);
      if (r.ok) return normalizePosts(await r.json());
    } catch { /* 继续尝试下一个来源 */ }
  }
  return [];
}

async function init() {
  await loadProfile();
  state.posts = await loadPosts();
  refreshLibrary();
  bind();
  initDrag();
  loadBackgrounds();
  if (state.posts.length) selectPost(state.posts[0]);
}

init();

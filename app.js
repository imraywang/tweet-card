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
  topic: "全部",
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
  if (state.topic !== "全部") list = list.filter((p) => p.topic === state.topic);
  if (q) list = list.filter((p) => p.text.toLowerCase().includes(q));
  if (state.sort === "hot") list = [...list].sort((a, b) => b.metrics.likes - a.metrics.likes);
  else if (state.sort === "saved") list = [...list].sort((a, b) => b.metrics.bookmarks - a.metrics.bookmarks);
  state.filtered = list;
  renderList();
}

function renderTopicChips() {
  const counts = { 全部: state.posts.length };
  state.posts.forEach((p) => { counts[p.topic] = (counts[p.topic] || 0) + 1; });
  const wrap = $("topic-chips");
  wrap.innerHTML = "";
  Object.entries(counts).forEach(([topic, n]) => {
    const b = document.createElement("button");
    b.className = "chip" + (topic === state.topic ? " active" : "");
    b.innerHTML = `${topic}<em>${n}</em>`;
    b.onclick = () => { state.topic = topic; renderTopicChips(); applyFilter(); };
    wrap.appendChild(b);
  });
}

function renderList() {
  const ul = $("post-list");
  ul.innerHTML = "";
  state.filtered.slice(0, LIST_CAP).forEach((p) => {
    const li = document.createElement("li");
    li.className = "post-item" + (state.selected && state.selected.id === p.id ? " active" : "");
    li.innerHTML = `
      <div class="pi-meta"><span>${p.date} · ${p.topic}</span><span>❤ ${fmtNum(p.metrics.likes)}</span></div>
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
        state.topic = "全部";
        renderTopicChips();
        applyFilter();
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
    location.reload();
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
  renderTopicChips();
  applyFilter();
  bind();
  initDrag();
  loadBackgrounds();
  if (state.posts.length) selectPost(state.posts[0]);
}

init();

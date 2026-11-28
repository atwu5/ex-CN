/* ============================================================
   全球基金查询 · 前端应用（无构建，原生 JS）
   数据：data/etf.json · data/otc.json · data/meta.json（由 scripts/fetch_data.py 生成）
   ============================================================ */
"use strict";

/* ---------------- 工具 ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtPct = (v, sign = true, digits = 2) => {
  if (v == null || isNaN(v)) return "—";
  const s = sign && v > 0 ? "+" : "";
  return s + Number(v).toFixed(digits) + "%";
};
const fmtNum = (v, digits = 2) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(digits));
const fmtYi = (v) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(2) + "亿");
const fmtAmount = (wan) => {
  if (wan == null || isNaN(wan)) return "—";
  if (wan >= 1e4) return (wan / 1e4).toFixed(2) + "亿";
  if (wan >= 1) return Math.round(wan).toLocaleString("zh-CN") + "万";
  return "—";
};
const fmtLimit = (yuan) => {
  if (yuan == null || isNaN(yuan)) return "—";
  if (yuan >= 1e4) return yuan / 1e4 + "万元";
  return yuan + "元";
};
const clsOf = (v) => (v == null ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat");
const pctHtml = (v, opts = {}) => {
  const warnBig = opts.warn && Math.abs(v) >= 5;
  return `<span class="num ${clsOf(v)}${warnBig ? " warn-prem" : ""}">${fmtPct(v, opts.sign !== false)}</span>`;
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const LS = {
  get(k, d) { try { const v = localStorage.getItem("gfp." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("gfp." + k, JSON.stringify(v)); } catch { } },
};

let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------------- 列定义 ---------------- */
const FEE_GROUPS = { basic: "基本信息", ret: "区间收益", risk: "风险指标", fee: "费用", trade: "交易信息" };

function col(key, label, w, opts = {}) {
  return Object.assign({ key, label, w, align: "right", type: "text", sortable: true, group: "basic" }, opts);
}

const REGION_BADGE = (r) => r === "中国香港" ? "tag-hk" : "tag-gold";

const COMMON_RENDER = {
  name: (f, tab) => {
    const tags = [];
    if (tab === "etf") tags.push(`<span class="tag">${esc(f.style || "")}</span>`);
    else tags.push(`<span class="tag">${esc(f.style || "")}</span>`);
    if (f.share && f.share !== "主份额" && tab !== "etf") tags.push(`<span class="tag">${esc(f.share)}</span>`);
    if (tab === "watch") {
      const m = f.onExchange ? (f.subStatus ? "场内外" : "场内") : "场外";
      tags.push(`<span class="tag ${m === "场内" || m === "场内外" ? "tag-gold" : ""}">${m}</span>`);
    }
    return `<div class="fund-name">
      <button class="mobile-expand" aria-label="展开" data-expand="${f.code}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg></button>
      <div><div class="fund-name-text" data-detail="${f.code}" title="${esc(f.name)}">${esc(f.name)}</div>${tags.length ? `<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap">${tags.join("")}</div>` : ""}</div>
      <span class="fund-code mobile-code">${esc(f.code)}</span>
    </div>`;
  },
  code: (f) => `<span class="num fund-code">${esc(f.code)}</span>`,
  trackIndex: (f) => f.trackIndex ? `<span class="cell-dim" title="${esc(f.trackIndex)}">${esc(f.trackIndex.length > 18 ? f.trackIndex.slice(0, 18) + "…" : f.trackIndex)}</span>` : `<span class="cell-dim">—</span>`,
  regions: (f) => (f.regions || []).length ? f.regions.slice(0, 2).map(r => `<span class="tag ${REGION_BADGE(r)}">${esc(r)}</span>`).join(" ") : `<span class="cell-dim">—</span>`,
  industries: (f) => (f.industries || []).length ? f.industries.slice(0, 2).map(r => `<span class="tag">${esc(r)}</span>`).join(" ") : `<span class="cell-dim">—</span>`,
  scaleYi: (f) => `<span class="num">${fmtYi(f.scaleYi)}</span>`,
  mgr: (f) => `<span class="cell-dim">${esc(f.manager || "—")}</span>`,
  company: (f) => `<span class="cell-dim">${esc(f.company || "—")}</span>`,
  founded: (f) => `<span class="num cell-dim">${esc(f.founded || "—")}</span>`,
};

/* etf tab */
const ETF_COLS = [
  col("name", "基金名称", 216, { fixed: true, align: "left", render: COMMON_RENDER.name }),
  col("code", "基金代码", 84, { fixed: true, align: "left", render: COMMON_RENDER.code }),
  col("price", "最新价", 78, { type: "num", render: f => `<span class="num">${fmtNum(f.price, 3)}</span>` }),
  col("changePct", "日涨跌幅", 88, { render: f => pctHtml(f.changePct) }),
  col("premiumPct", "溢价率", 86, { render: f => pctHtml(f.premiumPct, { warn: true }), title: "溢价率为正代表价格高于基金净值参考（IOPV）" }),
  col("trackIndex", "跟踪指数", 158, { align: "left", render: COMMON_RENDER.trackIndex }),
  col("scaleYi", "规模", 96, { render: COMMON_RENDER.scaleYi }),
  col("opsFee", "运作费率", 84, { render: f => `<span class="num">${f.opsFee != null ? fmtPct(f.opsFee, false) : "—"}</span>`, title: "管理费+托管费（年化）" }),
  col("amountWan", "成交额", 92, { render: f => `<span class="num">${fmtAmount(f.amountWan)}</span>`, title: "当日成交金额（流动性）" }),
  col("y1", "近1年收益", 96, { key2: "returns.y1", render: f => pctHtml(ret(f, "y1")) }),
  col("ops", "操作", 86, { fixed: true, align: "center", sortable: false, render: null }),
];
/* etf 隐藏可选列 */
const ETF_COLS_EXTRA = [
  col("iopv", "IOPV估值", 88, { render: f => `<span class="num">${fmtNum(f.iopv, 4)}</span>` }),
  col("turnover", "换手率", 80, { render: f => `<span class="num">${f.turnover != null ? fmtPct(f.turnover, false) : "—"}</span>` }),
  col("regions", "国家/地区", 150, { align: "left", render: COMMON_RENDER.regions }),
  col("industries", "行业主题", 150, { align: "left", render: COMMON_RENDER.industries }),
  col("mgmtFee", "管理费率", 84, { render: f => `<span class="num">${fmtPct(f.mgmtFee, false)}</span>` }),
  col("custFee", "托管费率", 84, { render: f => `<span class="num">${fmtPct(f.custFee, false)}</span>` }),
  col("trackingErr", "跟踪误差", 86, { render: f => `<span class="num">${fmtPct(f.trackingErr, false)}</span>` }),
  col("mdd1y", "最大回撤(近1年)", 120, { render: f => pctHtml(f.mdd1y, { sign: false }) }),
  col("mddAll", "最大回撤(成立来)", 128, { render: f => pctHtml(f.mddAll, { sign: false }) }),
  ...RET_COLS(),
  col("company", "基金公司", 130, { align: "left", render: COMMON_RENDER.company }),
  col("manager", "基金经理", 100, { align: "left", render: COMMON_RENDER.mgr }),
  col("founded", "成立日期", 100, { render: COMMON_RENDER.founded }),
  col("quoteTime", "行情时间", 120, { sortable: false, render: f => `<span class="num cell-dim">${esc(f.quoteTime || "—")}</span>` }),
];

function RET_COLS() {
  const defs = [["w", "近1周", 7, 74], ["m1", "近1月", 30, 74], ["m3", "近3月", 91, 74], ["m6", "近6月", 91 + 91, 74], ["y2", "近2年", 730, 74], ["y3", "近3年", 1095, 74], ["ytd", "今年来", 0, 74], ["since", "成立来", 0, 76]];
  return defs.map(([k, label]) => col(k, label, 78, {
    key2: "returns." + k,
    render: f => pctHtml(ret(f, k)),
  }));
}
function ret(f, k) { return (f.returns || {})[k]; }

/* otc tab */
const OTC_COLS = [
  col("name", "基金名称", 216, { fixed: true, align: "left", render: COMMON_RENDER.name }),
  col("code", "基金代码", 84, { fixed: true, align: "left", render: COMMON_RENDER.code }),
  col("nav", "单位净值", 86, { render: f => `<span class="num">${fmtNum(f.nav, 4)}</span>` }),
  col("navChg", "净值日涨幅", 92, { render: f => pctHtml(f.navChg) }),
  col("y1", "近1年收益", 96, { key2: "returns.y1", render: f => pctHtml(ret(f, "y1")) }),
  col("subStatus", "申购状态", 88, {
    render: f => {
      if (!f.subStatus) return `<span class="cell-dim">—</span>`;
      const c = f.subStatus.includes("开放") ? "status-open" : f.subStatus.includes("限") ? "status-limited" : "status-closed";
      const tip = f.subLimit != null ? ` title="单日累计购买上限 ${esc(fmtLimit(f.subLimit))}"` : "";
      return `<span class="num ${c}"${tip}>${esc(f.subStatus)}</span>`;
    },
  }),
  col("trackIndex", "跟踪指数", 158, { align: "left", render: COMMON_RENDER.trackIndex }),
  col("scaleYi", "规模", 96, { render: COMMON_RENDER.scaleYi }),
  col("opsFee", "运作费率", 84, { render: f => `<span class="num">${f.opsFee != null ? fmtPct(f.opsFee, false) : "—"}</span>`, title: "管理费+托管费+销售服务费（年化）" }),
  col("ops", "操作", 86, { fixed: true, align: "center", sortable: false, render: null }),
];
const OTC_COLS_EXTRA = [
  col("navAcc", "累计净值", 86, { render: f => `<span class="num">${fmtNum(f.navAcc, 4)}</span>` }),
  col("regions", "国家/地区", 150, { align: "left", render: COMMON_RENDER.regions }),
  col("industries", "行业主题", 150, { align: "left", render: COMMON_RENDER.industries }),
  col("mgmtFee", "管理费率", 84, { render: f => `<span class="num">${fmtPct(f.mgmtFee, false)}</span>` }),
  col("custFee", "托管费率", 84, { render: f => `<span class="num">${fmtPct(f.custFee, false)}</span>` }),
  col("svcFee", "销售服务费", 90, { render: f => `<span class="num">${fmtPct(f.svcFee, false)}</span>` }),
  col("subFee", "申购费率", 84, { render: f => `<span class="num">${f.subFee != null ? fmtPct(f.subFee, false) : "—"}</span>`, title: "最高申购费率（原费率）" }),
  col("subLimit", "申购限额", 96, { render: f => `<span class="num">${fmtLimit(f.subLimit)}</span>` }),
  col("trackingErr", "跟踪误差", 86, { render: f => `<span class="num">${fmtPct(f.trackingErr, false)}</span>` }),
  col("mdd1y", "最大回撤(近1年)", 120, { render: f => pctHtml(f.mdd1y, { sign: false }) }),
  col("mddAll", "最大回撤(成立来)", 128, { render: f => pctHtml(f.mddAll, { sign: false }) }),
  ...RET_COLS(),
  col("company", "基金公司", 130, { align: "left", render: COMMON_RENDER.company }),
  col("manager", "基金经理", 100, { align: "left", render: COMMON_RENDER.mgr }),
  col("founded", "成立日期", 100, { render: COMMON_RENDER.founded }),
  col("navDate", "净值日期", 96, { sortable: false, render: f => `<span class="num cell-dim">${esc(f.navDate || "—")}</span>` }),
];

/* watch 视图 */
const WATCH_COLS = [
  col("name", "基金名称", 216, { fixed: true, align: "left", render: COMMON_RENDER.name }),
  col("code", "基金代码", 84, { fixed: true, align: "left", render: COMMON_RENDER.code }),
  col("market", "交易方式", 84, {
    render: f => `<span class="tag ${f.onExchange ? "tag-gold" : ""}">${f.onExchange ? (f.subStatus ? "场内外" : "场内") : "场外"}</span>`,
  }),
  col("price", "场内价", 80, { render: f => `<span class="num">${fmtNum(f.price, 3)}</span>` }),
  col("changePct", "日涨跌", 84, { render: f => pctHtml(f.changePct != null ? f.changePct : f.navChg) }),
  col("premiumPct", "溢价率", 86, { render: f => pctHtml(f.premiumPct, { warn: true }) }),
  col("nav", "单位净值", 86, { render: f => `<span class="num">${fmtNum(f.nav, 4)}</span>` }),
  col("y1", "近1年收益", 96, { key2: "returns.y1", render: f => pctHtml(ret(f, "y1")) }),
  col("opsFee", "运作费率", 84, { render: f => `<span class="num">${f.opsFee != null ? fmtPct(f.opsFee, false) : "—"}</span>` }),
  col("subStatus", "申购状态", 88, { render: OTC_COLS.find(c => c.key === "subStatus").render }),
  col("ops", "操作", 86, { fixed: true, align: "center", sortable: false, render: null }),
];

const COLS_BY_TAB = { etf: [...ETF_COLS, ...ETF_COLS_EXTRA], otc: [...OTC_COLS, ...OTC_COLS_EXTRA], watch: WATCH_COLS };
const DEFAULT_VISIBLE = {
  etf: ["name", "code", "price", "changePct", "premiumPct", "trackIndex", "scaleYi", "opsFee", "amountWan", "y1", "ops"],
  otc: ["name", "code", "nav", "navChg", "y1", "subStatus", "trackIndex", "scaleYi", "opsFee", "ops"],
  watch: WATCH_COLS.map(c => c.key),
};

/* ---------------- 状态 ---------------- */
const state = {
  view: "query",            // query | watch
  tab: "etf",               // etf | otc
  data: { etf: null, otc: null },   // {updated, funds}
  meta: null,
  loading: false,
  search: "",
  filters: { regions: new Set(), styles: new Set(), industries: new Set(), indices: new Set(), scaleMin: null, scaleMax: null, feeMax: null, premMin: null, premMax: null, retMin: null, liqMin: "", subStatus: "" },
  sort: { key: "y1", dir: -1 },
  page: 1,
  pageSize: LS.get("pageSize", 50),
  density: LS.get("density", "standard"),
  visible: LS.get("cols", DEFAULT_VISIBLE),
  widths: LS.get("widths", {}),
  watch: new Set(LS.get("watch", [])),
  compare: [],
  expanded: new Set(),
};

/* ---------------- 数据加载 ---------------- */
async function fetchJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(url + "?t=" + Date.now(), { cache: "no-store", signal: ctrl.signal });
      if (!r.ok) throw new Error(url + " -> " + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r2 => setTimeout(r2, 300 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function loadMeta(silent) {
  try {
    state.meta = await fetchJSON("data/meta.json");
    renderMeta();
  } catch (e) {
    if (!silent) toast("meta.json 加载失败：" + e.message);
  }
}

async function loadTab(tab, force) {
  if (state.data[tab] && !force) return;
  setLoading(true);
  try {
    state.data[tab] = await fetchJSON(`data/${tab}.json`);
  } catch (e) {
    toast(`data/${tab}.json 加载失败`);
    state.data[tab] = { updated: "", funds: [] };
  }
  setLoading(false);
}

function setLoading(on) {
  state.loading = on;
  $("#skeleton").hidden = !on;
  $("#fundTable").style.visibility = on ? "hidden" : "visible";
  if (on) {
    const sk = $("#skeleton");
    sk.innerHTML = Array.from({ length: 9 }, () => `<div class="sk-row"></div>`).join("");
  }
}

/* ---------------- 筛选选项 ---------------- */
function currentFunds() {
  if (state.view === "watch") return watchFunds();
  const d = state.data[state.tab];
  return d ? d.funds : [];
}

function watchFunds() {
  const out = [];
  const seen = new Set();
  const pick = (arr) => {
    for (const f of arr || []) {
      if (state.watch.has(f.code) && !seen.has(f.code)) { seen.add(f.code); out.push(f); }
    }
  };
  pick((state.data.etf || {}).funds);
  pick((state.data.otc || {}).funds);
  return out;
}

function rebuildFilterOptions() {
  const funds = currentFunds();
  const tab = state.tab;
  const cnt = (fn) => {
    const m = new Map();
    for (const f of funds) for (const v of fn(f) || []) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const regions = cnt(f => f.regions);
  const styles = cnt(f => [f.style]);
  const inds = cnt(f => f.industries);
  const idx = cnt(f => f.trackIndex ? [f.trackIndex] : []);

  const chip = (v, n, active) => `<button class="chip${active ? " is-active" : ""}" data-k="${esc(v)}">${esc(v)}<span class="chip-n">${n}</span></button>`;
  $("#regionChips").innerHTML = regions.map(([v, n]) => chip(v, n, state.filters.regions.has(v))).join("") || `<span class="cell-dim" style="font-size:12.5px">—</span>`;
  $("#styleChips").innerHTML = styles.map(([v, n]) => chip(v, n, state.filters.styles.has(v))).join("");
  $("#industryChips").innerHTML = inds.slice(0, 12).map(([v, n]) => chip(v, n, state.filters.industries.has(v))).join("");
  INDEX_OPTS = idx;
  refreshIndexPanels();

  // 移动端排序下拉
  const cols = COLS_BY_TAB[tab].filter(c => c.sortable && c.key !== "name" && c.key !== "code");
  const cur = state.sort.key + ":" + state.sort.dir;
  $("#sortSelect").innerHTML = cols.map(c => {
    const keys = [c.key + ":-1", c.key + ":1"];
    return keys.map(k => {
      const [key, dir] = k.split(":");
      const label = c.label + (dir === "-1" ? " ↓" : " ↑");
      return `<option value="${key}:${dir}"${key + ":" + dir === cur ? " selected" : ""}>${label}</option>`;
    }).join("");
  }).join("");

  // etf/otc 专属筛选显隐
  $$(".etf-only").forEach(el => el.style.display = tab === "etf" ? "" : "none");
  $$(".otc-only").forEach(el => el.hidden = tab !== "otc");
}

/* ---------------- 跟踪指数多选面板 ---------------- */
let INDEX_OPTS = [];

function indexToggleLabel() {
  const n = state.filters.indices.size;
  return n ? `跟踪指数 · 已选 ${n}` : `全部指数（${INDEX_OPTS.length}）`;
}

function refreshIndexToggle() {
  const btn = $("#indexToggle");
  if (btn) btn.textContent = indexToggleLabel() + " ▾";
}

function refreshIndexPanels() {
  refreshIndexToggle();
  for (const sel of ["#indexPanel", "#sIndexPanel"]) {
    const p = $(sel);
    if (p && p.querySelector(".index-list")) updateIndexList(p);
  }
}

function ensureIndexSkeleton(root) {
  if (root.querySelector(".index-search")) return;
  root.innerHTML = `<input type="search" class="index-search" placeholder="搜索指数名称…">
    <div class="index-list"></div>
    <div class="index-panel-foot"><span class="index-total"></span><button type="button" class="index-clear">清空已选</button></div>`;
}

function updateIndexList(root) {
  const term = (root.dataset.term || "").trim().toLowerCase();
  const list = root.querySelector(".index-list");
  if (!list) return;
  const items = INDEX_OPTS.filter(([v]) => !term || v.toLowerCase().includes(term));
  list.innerHTML = items.length
    ? items.map(([v, n]) => `<label class="index-item" title="${esc(v)}"><input type="checkbox" value="${esc(v)}"${state.filters.indices.has(v) ? " checked" : ""}><span class="iname">${esc(v)}</span><span class="n">${n}</span></label>`).join("")
    : `<div class="index-empty">无匹配指数</div>`;
  const tot = root.querySelector(".index-total");
  if (tot) tot.textContent = `共 ${INDEX_OPTS.length} 个指数 · 已选 ${state.filters.indices.size}`;
}

function onIndexChange(fromRoot) {
  refreshIndexToggle();
  state.page = 1;
  renderTable();
  renderSelectedChips();
  const n = activeFilterCount();
  $("#filterBadge").hidden = !n; $("#filterBadge").textContent = n;
  for (const sel of ["#indexPanel", "#sIndexPanel"]) {
    const p = $(sel);
    if (p && p !== fromRoot && p.querySelector(".index-list")) updateIndexList(p);
  }
}

function bindIndexPanel(root) {
  root.addEventListener("input", (e) => {
    if (e.target.classList.contains("index-search")) {
      root.dataset.term = e.target.value;
      updateIndexList(root);
    }
  });
  root.addEventListener("change", (e) => {
    const cb = e.target.closest("input[type=checkbox]");
    if (!cb) return;
    cb.checked ? state.filters.indices.add(cb.value) : state.filters.indices.delete(cb.value);
    onIndexChange(root);
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest(".index-clear")) {
      state.filters.indices.clear();
      updateIndexList(root);
      onIndexChange(root);
    }
  });
}

/* ---------------- 筛选/排序/分页 ---------------- */
function activeFilterCount() {
  const f = state.filters;
  let n = f.regions.size + f.styles.size + f.industries.size + f.indices.size;
  if (f.scaleMin != null) n++;
  if (f.scaleMax != null) n++;
  if (f.feeMax != null) n++;
  if (f.premMin != null) n++;
  if (f.premMax != null) n++;
  if (f.retMin != null) n++;
  if (f.liqMin) n++;
  if (f.subStatus) n++;
  if (state.search) n++;
  return n;
}

function applyFilters(funds) {
  const f = state.filters;
  const q = state.search.trim().toLowerCase();
  let out = funds.filter(x => {
    if (q) {
      const hay = [x.name, x.code, x.trackIndex, x.company, x.manager, ...(x.regions || []),
        ...((x.holdings || []).map(h => h.n))].join("|").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.regions.size && !(x.regions || []).some(r => f.regions.has(r))) return false;
    if (f.styles.size && !f.styles.has(x.style)) return false;
    if (f.industries.size && !(x.industries || []).some(r => f.industries.has(r))) return false;
    if (f.indices.size && !f.indices.has(x.trackIndex || "")) return false;
    if (f.scaleMin != null && !(x.scaleYi >= f.scaleMin)) return false;
    if (f.scaleMax != null && !(x.scaleYi <= f.scaleMax)) return false;
    if (f.feeMax != null && !(x.opsFee != null && x.opsFee <= f.feeMax)) return false;
    if (f.premMin != null && !(x.premiumPct != null && x.premiumPct >= f.premMin)) return false;
    if (f.premMax != null && !(x.premiumPct != null && x.premiumPct <= f.premMax)) return false;
    if (f.retMin != null && !(ret(x, "y1") != null && ret(x, "y1") >= f.retMin)) return false;
    if (f.liqMin && !(x.amountWan != null && x.amountWan >= +f.liqMin)) return false;
    if (f.subStatus && x.subStatus !== f.subStatus) return false;
    return true;
  });
  return out;
}

function sortVal(f, c) {
  if (c.key2) {
    const [a, b] = c.key2.split(".");
    return (f[a] || {})[b];
  }
  return f[c.key];
}

function applySort(funds) {
  const { key, dir } = state.sort;
  const cols = COLS_BY_TAB[state.tab];
  const c = cols.find(x => x.key === key);
  if (!c) return funds;
  const sv = (f) => sortVal(f, c);
  const isNum = (v) => typeof v === "number" && !isNaN(v);
  const sorted = [...funds].sort((a, b) => {
    const va = sv(a), vb = sv(b);
    const na = !isNum(va) && va == null, nb = !isNum(vb) && vb == null;
    if (na && nb) return 0;
    if (na) return 1;          // 缺失始终沉底
    if (nb) return -1;
    if (isNum(va) && isNum(vb)) return (va - vb) * dir;
    return String(va ?? "").localeCompare(String(vb ?? ""), "zh-CN") * dir;
  });
  return sorted;
}

function paginate(funds) {
  const total = funds.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * state.pageSize;
  return { rows: funds.slice(start, start + state.pageSize), total, pages };
}

/* ---------------- 表格渲染 ---------------- */
function visibleCols() {
  const cols = COLS_BY_TAB[state.tab];
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  let keys = state.visible[state.tab];
  if (!keys || !keys.length) keys = DEFAULT_VISIBLE[state.tab];
  if (state.view === "watch") keys = DEFAULT_VISIBLE.watch;
  const list = keys.map(k => cols.find(c => c.key === k)).filter(Boolean);
  // 移动端代码并入名称列
  const fin = isMobile ? list.filter(c => c.key !== "code") : list;
  // 固定列保序：name 在前，ops 在后
  const fixedL = fin.filter(c => c.key === "name");
  const ops = fin.find(c => c.key === "ops");
  const rest = fin.filter(c => c.key !== "name" && c.key !== "ops");
  return [...fixedL, ...rest, ...(ops ? [ops] : [])];
}

function colW(c) { return state.widths[state.tab + "." + c.key] || c.w; }

function renderTable() {
  const funds = currentFunds();
  const filtered = state.view === "watch" ? funds : applyFilters(funds);
  const sorted = state.sort.key ? applySort(filtered) : filtered;
  const { rows, total, pages } = paginate(sorted);

  const cols = visibleCols();
  const isMobile = window.matchMedia("(max-width: 767px)").matches;

  /* colgroup */
  $("#tableCols").innerHTML = cols.map(c =>
    `<col style="width:${colW(c)}px;min-width:${c.key === "name" && isMobile ? 148 : colW(c)}px">`).join("");

  /* thead */
  let left = 0;
  const headCells = cols.map((c, i) => {
    const stickyL = c.fixed && c.key !== "ops";
    const stickyR = c.key === "ops";
    let style = "";
    if (stickyL) { style = `style="left:${left}px"`; left += colW(c); }
    if (stickyR) style = `style="right:0"`;
    const sortedCls = state.sort.key === c.key ? " sorted" : "";
    const arrow = state.sort.key === c.key ? `<span class="sort-arrow">${state.sort.dir === -1 ? "▼" : "▲"}</span>` : "";
    const resizer = c.sortable !== false && !stickyR && !isMobile ? `<span class="col-resizer" data-col="${c.key}"></span>` : "";
    const sortableCls = c.sortable ? " th-sortable" : "";
    const ariaSort = state.sort.key === c.key ? (state.sort.dir === -1 ? "descending" : "ascending") : "none";
    return `<th class="${stickyL ? "sticky-col" : ""}${stickyR ? " op-col" : ""}${stickyL && cols[i + 1] && cols[i + 1].fixed ? " edge-r" : ""}${stickyR ? " edge-l" : ""}" ${style} ${c.sortable ? `data-sort="${c.key}"` : ""} aria-sort="${ariaSort}">
      <span class="th-inner${sortableCls}${sortedCls}" ${c.title ? `title="${esc(c.title)}"` : ""}>${esc(c.label)}${arrow}${resizer}</span></th>`;
  }).join("");
  $("#tableHead").innerHTML = `<tr>${headCells}</tr>`;

  /* tbody */
  const isWatch = state.view === "watch";
  const bodyRows = rows.map(f => {
    const tds = cols.map((c, i) => {
      if (c.key === "ops") {
        const starred = state.watch.has(f.code);
        const cmpIdx = state.compare.findIndex(x => x.code === f.code);
        return `<td class="op-col edge-l"><div class="row-ops">
          <button class="op-btn${starred ? " starred" : ""}" data-watch="${f.code}" title="${starred ? "移出自选" : "加入自选"}" aria-label="自选">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="${starred ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z"/></svg>
          </button>
          <button class="op-btn${cmpIdx >= 0 ? " checked" : ""}" data-compare="${f.code}" title="${cmpIdx >= 0 ? "移出对比" : "加入对比（最多5只）"}" aria-label="对比">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 3v18M15 3v18M3 9h18M3 15h18" opacity=".9"/></svg>
          </button>
        </div></td>`;
      }
      let style = "";
      if (c.fixed) {
        let l = 0;
        for (let j = 0; j < i; j++) if (cols[j].fixed && cols[j].key !== "ops") l += colW(cols[j]);
        style = ` class="sticky-col${cols[i + 1] && cols[i + 1].fixed ? " edge-r" : ""}" style="left:${l}px"`;
      }
      const content = c.render ? c.render(f, isWatch ? "watch" : state.tab) : `<span class="num">${esc(f[c.key] ?? "—")}</span>`;
      return `<td${style}>${content}</td>`;
    }).join("");
    const expanded = state.expanded.has(f.code) && isMobile;
    let expandHtml = "";
    if (isMobile && state.expanded.has(f.code)) {
      expandHtml = `<tr class="expand-row"><td colspan="${cols.length}"><div class="expand-grid">${expandCells(f)}</div></td></tr>`;
    }
    return `<tr data-row="${f.code}">${tds}</tr>${expandHtml}`;
  }).join("");
  $("#tableBody").innerHTML = bodyRows;

  /* 空态 */
  const empty = $("#emptyState");
  if (!rows.length && !state.loading) {
    empty.hidden = false;
    empty.innerHTML = state.view === "watch" && !state.watch.size
      ? `<div class="empty-ico">★</div><p>还没有自选基金，点击列表操作列的星标即可添加</p>`
      : `<div class="empty-ico">⌕</div><p>没有符合条件的基金，试试调整筛选条件或重置</p>`;
  } else empty.hidden = true;

  /* 汇总信息 */
  $("#resultCount").innerHTML = `共 <b>${total.toLocaleString("zh-CN")}</b> 只`;
  $("#pageInfo").textContent = total ? `第 ${state.page} / ${pages} 页 · 共 ${total.toLocaleString("zh-CN")} 只` : "共 0 只";
  renderPager(pages, total);
  renderSelectedChips();
  const n = activeFilterCount();
  $("#filterBadge").hidden = !n;
  $("#filterBadge").textContent = n;
}

function expandCells(f) {
  const isEtf = state.tab === "etf";
  const cells = [];
  const push = (k, v) => cells.push(`<div class="metric-cell"><div class="k">${k}</div><div class="v">${v}</div></div>`);
  if (isEtf) {
    push("最新价", `<span class="num">${fmtNum(f.price, 3)}</span>`);
    push("日涨跌幅", pctHtml(f.changePct));
    push("溢价率", pctHtml(f.premiumPct, { warn: true }));
    push("成交额", `<span class="num">${fmtAmount(f.amountWan)}</span>`);
  } else {
    push("单位净值", `<span class="num">${fmtNum(f.nav, 4)}</span>`);
    push("净值日涨幅", pctHtml(f.navChg));
    push("申购状态", f.subStatus ? esc(f.subStatus) : "—");
    push("申购限额", `<span class="num">${fmtLimit(f.subLimit)}</span>`);
  }
  push("近1年收益", pctHtml(ret(f, "y1")));
  push("近3月收益", pctHtml(ret(f, "m3")));
  push("规模", `<span class="num">${fmtYi(f.scaleYi)}</span>`);
  push("运作费率", `<span class="num">${f.opsFee != null ? fmtPct(f.opsFee, false) : "—"}</span>`);
  push("最大回撤(近1年)", pctHtml(f.mdd1y, { sign: false }));
  push("跟踪指数", f.trackIndex ? esc(f.trackIndex.length > 12 ? f.trackIndex.slice(0, 12) + "…" : f.trackIndex) : "—");
  return cells.join("");
}

function renderPager(pages, total) {
  const el = $("#pager");
  if (!total || pages <= 1) { el.innerHTML = ""; return; }
  const btn = (p, label, opts = {}) => `<button class="page-btn${opts.cur ? " is-current" : ""}" data-page="${p}" ${opts.disabled ? "disabled" : ""}>${label}</button>`;
  let html = btn(state.page - 1, "‹", { disabled: state.page <= 1 });
  const win = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - state.page) <= 1) win.push(p);
    else if (win[win.length - 1] !== "…") win.push("…");
  }
  html += win.map(p => p === "…" ? `<span class="page-gap">…</span>` : btn(p, p, { cur: p === state.page })).join("");
  html += btn(state.page + 1, "›", { disabled: state.page >= pages });
  el.innerHTML = html;
}

/* ---------------- 筛选交互 ---------------- */
function renderSelectedChips() {
  const f = state.filters;
  const chips = [];
  const add = (k, label) => chips.push(`<span class="selected-chip">${esc(label)}<button data-clear="${esc(k)}" aria-label="移除">✕</button></span>`);
  f.regions.forEach(v => add("region:" + v, v));
  f.styles.forEach(v => add("style:" + v, v));
  f.industries.forEach(v => add("industry:" + v, v));
  f.indices.forEach(v => add("index:" + v, "指数·" + (v.length > 12 ? v.slice(0, 12) + "…" : v)));
  if (f.scaleMin != null) add("scaleMin", "规模≥" + f.scaleMin + "亿");
  if (f.scaleMax != null) add("scaleMax", "规模≤" + f.scaleMax + "亿");
  if (f.feeMax != null) add("feeMax", "费率≤" + f.feeMax + "%");
  if (f.premMin != null) add("premMin", "溢价≥" + f.premMin + "%");
  if (f.premMax != null) add("premMax", "溢价≤" + f.premMax + "%");
  if (f.retMin != null) add("retMin", "近1年≥" + f.retMin + "%");
  if (f.liqMin) add("liqMin", "成交额≥" + fmtAmount(+f.liqMin));
  if (f.subStatus) add("subStatus", f.subStatus);
  if (state.search) add("search", "“" + state.search + "”");
  $("#selectedChips").innerHTML = chips.join("") + (chips.length ? `<button class="selected-clear" id="clearAllChips">清空全部</button>` : "");
  $("#selectedRow").hidden = !chips.length;
}

function clearFilterToken(token) {
  const f = state.filters;
  if (token.startsWith("region:")) f.regions.delete(token.slice(7));
  else if (token.startsWith("style:")) f.styles.delete(token.slice(6));
  else if (token.startsWith("industry:")) f.industries.delete(token.slice(9));
  else if (token.startsWith("index:")) f.indices.delete(token.slice(6));
  else if (token === "scaleMin") f.scaleMin = null;
  else if (token === "scaleMax") f.scaleMax = null;
  else if (token === "feeMax") f.feeMax = null;
  else if (token === "premMin") f.premMin = null;
  else if (token === "premMax") f.premMax = null;
  else if (token === "retMin") f.retMin = null;
  else if (token === "liqMin") f.liqMin = "";
  else if (token === "subStatus") f.subStatus = "";
  else if (token === "search") { state.search = ""; $("#searchInput").value = ""; }
  syncAdvancedInputs();
  state.page = 1;
  renderTable();
  rebuildFilterOptions();
}

function resetFilters() {
  state.filters = { regions: new Set(), styles: new Set(), industries: new Set(), indices: new Set(), scaleMin: null, scaleMax: null, feeMax: null, premMin: null, premMax: null, retMin: null, liqMin: "", subStatus: "" };
  state.search = "";
  $("#searchInput").value = "";
  syncAdvancedInputs();
  state.page = 1;
  rebuildFilterOptions();
  renderTable();
}

function syncAdvancedInputs() {
  const f = state.filters;
  $("#scaleMin").value = f.scaleMin ?? "";
  $("#scaleMax").value = f.scaleMax ?? "";
  $("#feeMax").value = f.feeMax ?? "";
  $("#premMin").value = f.premMin ?? "";
  $("#premMax").value = f.premMax ?? "";
  $("#retMin").value = f.retMin ?? "";
  $("#liqMin").value = f.liqMin;
  $("#subStatusSelect").value = f.subStatus;
}

/* ---------------- 字段设置 ---------------- */
function renderColsMenu() {
  const cols = COLS_BY_TAB[state.tab];
  const visible = state.visible[state.tab] || DEFAULT_VISIBLE[state.tab];
  const visSet = new Set(visible);
  const groups = new Map();
  for (const c of cols) {
    if (["name", "code", "ops"].includes(c.key)) continue;
    const g = FEE_GROUPS[c.group] || "更多字段";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  let html = "";
  for (const [g, list] of groups) {
    html += `<div class="dropdown-group">${g}</div>`;
    html += list.map(c => `<label class="dropdown-item">
      <input type="checkbox" data-colcheck="${c.key}" ${visSet.has(c.key) ? "checked" : ""}>${esc(c.label)}</label>`).join("");
  }
  $("#colsMenu").innerHTML = html;
}

function toggleCol(key, on) {
  const vis = new Set(state.visible[state.tab] || DEFAULT_VISIBLE[state.tab]);
  if (on) vis.add(key); else vis.delete(key);
  state.visible[state.tab] = [...vis];
  LS.set("cols", state.visible);
  renderTable();
}

/* ---------------- 对比 ---------------- */
function toggleCompare(code) {
  const i = state.compare.findIndex(x => x.code === code);
  if (i >= 0) state.compare.splice(i, 1);
  else {
    if (state.compare.length >= 5) { toast("最多同时对比 5 只基金"); return; }
    const f = findFund(code);
    if (!f) return;
    state.compare.push({ code, name: f.name, tab: state.tab });
  }
  renderCompareBar();
  renderTable();
}

function findFund(code) {
  return (state.data.etf?.funds || []).find(f => f.code === code) ||
    (state.data.otc?.funds || []).find(f => f.code === code) || null;
}

function renderCompareBar() {
  const bar = $("#compareBar");
  bar.hidden = !state.compare.length;
  $("#compareChips").innerHTML = state.compare.map(c =>
    `<span class="compare-chip">${esc(c.name.length > 14 ? c.name.slice(0, 14) + "…" : c.name)}<button data-cmpdel="${c.code}" aria-label="移除">✕</button></span>`).join("")
    + (state.compare.length < 2 ? `<span class="compare-hint">再选 ${2 - state.compare.length} 只开始对比</span>` : "");
}

function buildCompareTable() {
  const items = state.compare.map(c => findFund(c.code)).filter(Boolean);
  if (!items.length) return;
  const row = (label, fn) => `<tr><th>${label}</th>${items.map(f => `<td>${fn(f)}</td>`).join("")}</tr>`;
  const g = (label) => `<tr class="cmp-group"><td colspan="${items.length + 1}">${label}</td></tr>`;

  let html = `<table class="cmp-table"><thead><tr><th style="z-index:2"></th>${items.map(f =>
    `<td class="fund-col"><span data-detail="${f.code}" style="cursor:pointer">${esc(f.name.length > 16 ? f.name.slice(0, 16) + "…" : f.name)}</span><span class="fund-code">${esc(f.code)} · ${esc(f.style || "")}</span></td>`).join("")}</tr></thead><tbody>`;
  html += g("基本信息");
  html += row("基金类型", f => esc(f.fundType || f.style || "—"));
  html += row("国家/地区", f => (f.regions || []).join("、") || "—");
  html += row("跟踪指数", f => esc(f.trackIndex || "—"));
  html += row("行业主题", f => (f.industries || []).join("、") || "—");
  html += row("基金公司", f => esc(f.company || "—"));
  html += row("基金经理", f => esc(f.manager || "—"));
  html += row("成立日期", f => `<span class="num">${esc(f.founded || "—")}</span>`);
  html += row("最新规模", f => `<span class="num">${fmtYi(f.scaleYi)}</span>${f.scaleDate ? `<span class="cell-dim" style="font-size:11px">（${esc(f.scaleDate)}）</span>` : ""}`);
  html += g("区间收益（%）");
  const defs = [["w", "近1周"], ["m1", "近1月"], ["m3", "近3月"], ["m6", "近6月"], ["y1", "近1年"], ["y2", "近2年"], ["y3", "近3年"], ["ytd", "今年来"], ["since", "成立来"]];
  for (const [k, label] of defs) html += row(label, f => pctHtml(ret(f, k)));
  html += g("风险指标");
  html += row("最大回撤（近1年）", f => pctHtml(f.mdd1y, { sign: false }));
  html += row("最大回撤（成立来）", f => pctHtml(f.mddAll, { sign: false }));
  html += row("跟踪误差", f => `<span class="num">${fmtPct(f.trackingErr, false)}</span>`);
  html += g("费用（年化）");
  html += row("管理费率", f => `<span class="num">${fmtPct(f.mgmtFee, false)}</span>`);
  html += row("托管费率", f => `<span class="num">${fmtPct(f.custFee, false)}</span>`);
  if (items.some(f => f.svcFee != null)) html += row("销售服务费", f => `<span class="num">${fmtPct(f.svcFee, false)}</span>`);
  html += row("运作费率合计", f => `<span class="num"><b>${fmtPct(f.opsFee, false)}</b></span>`);
  if (items.some(f => f.subFee != null)) html += row("最高申购费率", f => `<span class="num">${fmtPct(f.subFee, false)}</span>`);
  const hasEtf = items.some(f => f.price != null);
  const hasOtc = items.some(f => f.nav != null);
  if (hasEtf) {
    html += g("场内交易");
    html += row("最新价", f => `<span class="num">${fmtNum(f.price, 3)}</span>`);
    html += row("日涨跌幅", f => pctHtml(f.changePct));
    html += row("溢价率", f => pctHtml(f.premiumPct, { warn: true }));
    html += row("IOPV估值", f => `<span class="num">${fmtNum(f.iopv, 4)}</span>`);
    html += row("成交额", f => `<span class="num">${fmtAmount(f.amountWan)}</span>`);
  }
  if (hasOtc) {
    html += g("场外交易");
    html += row("单位净值", f => `<span class="num">${fmtNum(f.nav, 4)}</span>`);
    html += row("净值日涨幅", f => pctHtml(f.navChg));
    html += row("申购状态", f => f.subStatus ? `<span class="num">${esc(f.subStatus)}</span>` : "—");
    html += row("申购限额", f => `<span class="num">${fmtLimit(f.subLimit)}</span>`);
    html += row("净值日期", f => `<span class="num cell-dim">${esc(f.navDate || "—")}</span>`);
  }
  html += `</tbody></table>`;
  $("#compareBody").innerHTML = html;
  openModal("compareModal");
}

/* ---------------- 详情弹窗 ---------------- */
async function openDetail(code) {
  const f = findFund(code);
  if (!f) return;
  const isEtf = !!(state.data.etf?.funds || []).some(x => x.code === code);
  const star = state.watch.has(code);
  $("#detailTitle").innerHTML = `${esc(f.name)} <span class="fund-code">${esc(f.code)}</span>`;
  const tags = [`<span class="tag tag-gold">${esc(f.style || "")}</span>`,
    ...(f.regions || []).map(r => `<span class="tag ${REGION_BADGE(r)}">${esc(r)}</span>`),
    ...(f.industries || []).map(r => `<span class="tag">${esc(r)}</span>`)];
  const cells = [];
  const push = (k, v) => cells.push(`<div class="metric-cell"><div class="k">${k}</div><div class="v">${v}</div></div>`);
  const isOtc = f.nav != null;
  if (f.price != null) {
    push("最新价", `<span class="num">${fmtNum(f.price, 3)}</span>`);
    push("日涨跌幅", pctHtml(f.changePct));
    push("溢价率", pctHtml(f.premiumPct, { warn: true }));
    push("IOPV估值", `<span class="num">${fmtNum(f.iopv, 4)}</span>`);
    push("成交额", `<span class="num">${fmtAmount(f.amountWan)}</span>`);
    push("换手率", `<span class="num">${fmtPct(f.turnover, false)}</span>`);
  }
  if (isOtc) {
    push("单位净值", `<span class="num">${fmtNum(f.nav, 4)}</span>`);
    push("累计净值", `<span class="num">${fmtNum(f.navAcc, 4)}</span>`);
    push("净值日涨幅", pctHtml(f.navChg));
    push("净值日期", `<span class="num">${esc(f.navDate || "—")}</span>`);
    push("申购状态", f.subStatus ? esc(f.subStatus) : "—");
    push("申购限额", `<span class="num">${fmtLimit(f.subLimit)}</span>`);
  }
  push("基金类型", esc(f.fundType || "—"));
  push("运作费率", `<span class="num">${fmtPct(f.opsFee, false)}</span>`);
  push("最新规模", `<span class="num">${fmtYi(f.scaleYi)}</span>`);
  push("跟踪误差", `<span class="num">${fmtPct(f.trackingErr, false)}</span>`);
  push("最大回撤(近1年)", pctHtml(f.mdd1y, { sign: false }));
  push("最大回撤(成立来)", pctHtml(f.mddAll, { sign: false }));
  push("基金公司", esc(f.company || "—"));
  push("基金经理", esc(f.manager || "—"));
  push("成立日期", `<span class="num">${esc(f.founded || "—")}</span>`);

  const retCells = [["w", "近1周"], ["m1", "近1月"], ["m3", "近3月"], ["m6", "近6月"], ["y1", "近1年"], ["y2", "近2年"], ["y3", "近3年"], ["ytd", "今年来"], ["since", "成立来"]]
    .map(([k, label]) => `<div class="return-cell"><div class="k">${label}</div><div class="v">${pctHtml(ret(f, k))}</div></div>`).join("");

  const holdings = (f.holdings || []).length ? `
    <div class="detail-section"><h4>前十大持仓</h4>
      <table class="holdings-table"><thead><tr><th style="width:44px">#</th><th>股票名称</th><th style="text-align:right">占净值比例</th></tr></thead>
      <tbody>${f.holdings.map((h, i) => `<tr><td class="num">${i + 1}</td><td>${esc(h.n)}</td><td class="num">${h.w != null ? h.w.toFixed(2) + "%" : "—"}</td></tr>`).join("")}</tbody></table>
    </div>` : "";

  $("#detailBody").innerHTML = `
    <div class="detail-head"><div class="detail-tags">${tags.join("")}</div></div>
    <div class="detail-section"><h4>核心指标</h4><div class="metric-grid">${cells.join("")}</div></div>
    <div class="detail-section"><h4>近1年净值走势</h4><canvas class="spark" id="sparkCanvas" height="130"></canvas><div class="spark-tip" id="sparkTip">加载中…</div></div>
    <div class="detail-section"><h4>区间收益</h4><div class="return-strip">${retCells}</div></div>
    ${f.trackIndex ? `<div class="detail-section"><h4>跟踪标的</h4><p style="font-size:13.5px">${esc(f.trackIndex)}${f.benchmark ? ` · 业绩比较基准：${esc(f.benchmark)}` : ""}</p></div>` : (f.benchmark ? `<div class="detail-section"><h4>业绩比较基准</h4><p style="font-size:13.5px">${esc(f.benchmark)}</p></div>` : "")}
    ${holdings}
    <div class="detail-section" style="margin-top:20px"><p class="cell-dim" style="font-size:12px">数据来自东方财富·天天基金公开接口 · 更新于 ${esc(state.meta?.generatedAtText || "")}</p></div>`;
  $("#detailFoot").innerHTML = `
    <div class="foot-btns">
      <button class="btn btn-outline btn-sm" id="detailCompare">＋ 加入对比</button>
      <button class="btn btn-outline btn-sm" id="detailWatch">${star ? "★ 已自选" : "☆ 加自选"}</button>
    </div>
    <div class="foot-links">
      <a href="http://fund.eastmoney.com/${esc(f.code)}.html" target="_blank" rel="noopener">天天基金档案 ↗</a>
      ${f.price != null ? `<a href="https://quote.eastmoney.com/${f.market === "SZ" ? "sz" : "sh"}${esc(f.code)}.html" target="_blank" rel="noopener">场内行情 ↗</a>` : ""}
      <a class="ms-link" href="https://www.morningstar.cn/fund/${esc(f.code)}.html" target="_blank" rel="noopener">晨星基金详情（推荐）↗</a>
    </div>`;
  openModal("detailDrawer");
  $("#detailCompare").onclick = () => toggleCompare(code);
  $("#detailWatch").onclick = () => { toggleWatch(code); $("#detailWatch").textContent = state.watch.has(code) ? "★ 已自选" : "☆ 加自选"; };
  requestAnimationFrame(() => drawSpark(code));
}

async function drawSpark(code) {
  const canvas = $("#sparkCanvas");
  const tip = $("#sparkTip");
  let pts;
  try {
    const j = await fetchJSON("data/trend/" + code + ".json");
    pts = j.pts || [];
  } catch {
    tip.textContent = "暂无走势数据";
    return;
  }
  if (pts.length < 2) { tip.textContent = "暂无走势数据"; return; }
  tip.textContent = `近1年单位净值走势 · ${new Date(pts[0].x).toLocaleDateString("zh-CN")} — ${new Date(pts[pts.length - 1].x).toLocaleDateString("zh-CN")}`;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600, H = 130;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (maxY === minY) { maxY += 0.01; minY -= 0.01; }
  const padY = (maxY - minY) * 0.12;
  minY -= padY; maxY += padY;
  const px = x => 8 + (x - minX) / (maxX - minX) * (W - 16);
  const py = y => 8 + (1 - (y - minY) / (maxY - minY)) * (H - 20);
  const first = pts[0].y, last = pts[pts.length - 1].y;
  const up = last >= first;
  const color = up ? "#D94848" : "#169B70";
  // 网格
  ctx.strokeStyle = "#E8EBF0"; ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const y = 8 + i * (H - 20) / 4;
    ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - 8, y); ctx.stroke();
  }
  // 渐变填充
  const grad = ctx.createLinearGradient ? ctx.createLinearGradient(0, 0, 0, H) : null;
  if (grad && grad.addColorStop) {
    grad.addColorStop(0, up ? "rgba(217,72,72,.14)" : "rgba(22,155,112,.14)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(px(p.x), py(p.y)) : ctx.moveTo(px(p.x), py(p.y)));
    ctx.lineTo(px(maxX), H - 8); ctx.lineTo(px(minX), H - 8); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
  }
  // 主线
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(px(p.x), py(p.y)) : ctx.moveTo(px(p.x), py(p.y)));
  ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.stroke();
  // 起止点
  for (const p of [pts[0], pts[pts.length - 1]]) {
    ctx.beginPath(); ctx.arc(px(p.x), py(p.y), 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(px(p.x), py(p.y), 1.6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
  }
}

/* ---------------- 自选 ---------------- */
function toggleWatch(code) {
  if (state.watch.has(code)) state.watch.delete(code);
  else state.watch.add(code);
  LS.set("watch", [...state.watch]);
  $("#watchBadge").textContent = state.watch.size;
  $("#watchBadge").hidden = !state.watch.size;
  renderTable();
}

/* ---------------- 概览与状态 ---------------- */
function renderMeta() {
  const m = state.meta;
  if (!m) return;
  $("#ovTotal").textContent = (m.etfCount + m.otcCount).toLocaleString("zh-CN");
  $("#ovEtf").textContent = m.etfCount.toLocaleString("zh-CN");
  $("#ovOtc").textContent = m.otcCount.toLocaleString("zh-CN");
  $("#ovRegion").textContent = m.regionCount;
  $("#ovIndex").textContent = m.indexCount;
  $("#updatedAt").textContent = m.generatedAtText || "--";
  $("#tabCountEtf").textContent = m.etfCount;
  $("#tabCountOtc").textContent = m.otcCount;
  const t = Date.parse(m.generatedAt);
  const stale = !t || (Date.now() - t) > 4 * 86400 * 1000;
  $("#statusDot").classList.toggle("stale", stale);
  $("#statusDot").title = stale ? "数据可能已滞后，建议刷新" : "数据较新";
  $("#footerSources").innerHTML = (m.sources || []).map(s => `<a href="${s.url}" target="_blank" rel="noopener">数据来源：${esc(s.name)} ↗</a>`).join("");
  $("#footerDisclaimer").textContent = m.disclaimer || "";
}

/* ---------------- 弹窗管理 ---------------- */
function openModal(id) { $("#" + id).hidden = false; document.body.style.overflow = "hidden"; }
function closeModal(id) { $("#" + id).hidden = true; document.body.style.overflow = ""; }

/* ---------------- 移动端筛选面板 ---------------- */
function openFilterSheet() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="filter-group"><span class="filter-label">国家/地区</span><div class="chip-list" id="sRegion"></div></div>
    <div class="filter-group"><span class="filter-label">基金类型</span><div class="chip-list" id="sStyle"></div></div>
    <div class="filter-group"><span class="filter-label">行业主题</span><div class="chip-list" id="sInd"></div></div>
    <div class="filter-group"><span class="filter-label">跟踪指数（可多选）</span></div>
    <div class="index-panel" id="sIndexPanel"></div>
    <div class="filter-group${state.tab === "etf" ? "" : " etf-only"}"><span class="filter-label">溢价率（%）</span>
      <div class="range-inputs"><input type="number" id="sPremMin" placeholder="最小" step="0.1"><span class="range-sep">—</span><input type="number" id="sPremMax" placeholder="最大" step="0.1"></div></div>
    <div class="filter-group"><span class="filter-label">规模（亿元）</span>
      <div class="range-inputs"><input type="number" id="sScaleMin" placeholder="最小" step="0.1"><span class="range-sep">—</span><input type="number" id="sScaleMax" placeholder="最大" step="0.1"></div></div>
    <div class="filter-group"><span class="filter-label">运作费率 ≤ %</span><input type="number" id="sFeeMax" placeholder="如 1.0" step="0.05"></div>
    <div class="filter-group"><span class="filter-label">近1年收益 ≥ %</span><input type="number" id="sRetMin" placeholder="如 20" step="1"></div>
    ${state.tab === "etf" ? `<div class="filter-group"><span class="filter-label">流动性（成交额 ≥）</span><select class="select" id="sLiq"><option value="">不限</option><option value="1000">≥1000万</option><option value="5000">≥5000万</option><option value="10000">≥1亿</option></select></div>` : `<div class="filter-group"><span class="filter-label">申购状态</span><select class="select" id="sSub"><option value="">不限</option><option value="开放申购">开放申购</option><option value="限大额">限大额</option><option value="暂停申购">暂停申购</option></select></div>`}
    <div class="filter-group"><span class="filter-label">关键词</span><input type="search" id="sSearch" placeholder="名称/代码/指数/持仓" style="height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;outline:none"></div>`;
  const body = $("#sheetBody");
  body.innerHTML = "";
  body.appendChild(wrap);
  // 同步主面板选项与当前筛选值
  const f = state.filters;
  $("#sRegion", body).innerHTML = $("#regionChips").innerHTML;
  $("#sStyle", body).innerHTML = $("#styleChips").innerHTML;
  $("#sInd", body).innerHTML = $("#industryChips").innerHTML;
  const sIdx = $("#sIndexPanel", body);
  ensureIndexSkeleton(sIdx);
  updateIndexList(sIdx);
  bindIndexPanel(sIdx);
  $("#sPremMin", body).value = f.premMin ?? "";
  $("#sPremMax", body).value = f.premMax ?? "";
  $("#sScaleMin", body).value = f.scaleMin ?? "";
  $("#sScaleMax", body).value = f.scaleMax ?? "";
  $("#sFeeMax", body).value = f.feeMax ?? "";
  $("#sRetMin", body).value = f.retMin ?? "";
  $("#sSearch", body).value = state.search;
  const liq = $("#sLiq", body); if (liq) liq.value = f.liqMin;
  const sub = $("#sSub", body); if (sub) sub.value = f.subStatus;
  openModal("filterSheet");
}

function applySheet() {
  const body = $("#sheetBody");
  const f = state.filters;
  const numv = (id) => { const v = $(id, body).value; return v === "" ? null : +v; };
  f.premMin = numv("#sPremMin"); f.premMax = numv("#sPremMax");
  f.scaleMin = numv("#sScaleMin"); f.scaleMax = numv("#sScaleMax");
  f.feeMax = numv("#sFeeMax"); f.retMin = numv("#sRetMin");
  state.search = $("#sSearch", body).value.trim();
  $("#searchInput").value = state.search;
  const liq = $("#sLiq", body); if (liq) f.liqMin = liq.value;
  const sub = $("#sSub", body); if (sub) f.subStatus = sub.value;
  state.page = 1;
  syncAdvancedInputs();
  rebuildFilterOptions();
  renderTable();
  closeModal("filterSheet");
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  /* 视图/Tab 切换 */
  $("#topnav").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    state.view = btn.dataset.view;
    $$("#topnav .topnav-link").forEach(b => b.classList.toggle("is-active", b === btn));
    if (state.view === "watch") {
      await loadTab("etf"); await loadTab("otc");
    }
    state.sort = { key: "y1", dir: -1 };
    state.page = 1;
    location.hash = state.view === "watch" ? "#watch" : "#" + state.tab;
    rebuildFilterOptions(); renderColsMenu(); renderTable();
    $(".query-panel").style.display = state.view === "watch" ? "none" : "";
  });

  $("#tabBar").addEventListener("click", async (e) => {
    const btn = e.target.closest(".tab");
    if (!btn || btn.dataset.tab === state.tab) return;
    state.tab = btn.dataset.tab;
    $$("#tabBar .tab").forEach(b => b.classList.toggle("is-active", b === btn));
    state.sort = { key: "y1", dir: -1 };
    state.page = 1;
    state.expanded.clear();
    location.hash = "#" + state.tab;
    await loadTab(state.tab);
    rebuildFilterOptions(); renderColsMenu(); renderTable();
  });

  /* 搜索 */
  $("#searchInput").addEventListener("input", debounce((e) => {
    state.search = e.target.value;
    state.page = 1;
    renderTable();
  }, 220));

  /* 高级筛选开关 */
  $("#advancedToggle").addEventListener("click", () => {
    const panel = $("#advancedPanel");
    panel.hidden = !panel.hidden;
    $("#advancedToggle").setAttribute("aria-expanded", String(!panel.hidden));
  });

  /* 重置 */
  $("#resetBtn").addEventListener("click", resetFilters);

  /* 筛选 chips / 选择器 */
  ["regionChips", "styleChips", "industryChips"].forEach(id => {
    $("#" + id).addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const setMap = { regionChips: "regions", styleChips: "styles", industryChips: "industries" };
      const set = state.filters[setMap[id]];
      const v = chip.dataset.k;
      set.has(v) ? set.delete(v) : set.add(v);
      chip.classList.toggle("is-active");
      state.page = 1;
      renderTable(); renderSelectedChips();
      const n = activeFilterCount();
      $("#filterBadge").hidden = !n; $("#filterBadge").textContent = n;
    });
  });
  /* 跟踪指数多选面板（桌面端） */
  $("#indexToggle").addEventListener("click", () => {
    const p = $("#indexPanel");
    p.hidden = !p.hidden;
    if (!p.hidden) { ensureIndexSkeleton(p); updateIndexList(p); }
  });
  bindIndexPanel($("#indexPanel"));
  /* 高级筛选输入 */
  const bindNum = (id, key) => {
    $("#" + id).addEventListener("change", (e) => {
      const v = e.target.value;
      state.filters[key] = v === "" ? null : +v;
      state.page = 1; renderTable();
    });
  };
  bindNum("scaleMin", "scaleMin"); bindNum("scaleMax", "scaleMax");
  bindNum("feeMax", "feeMax"); bindNum("premMin", "premMin"); bindNum("premMax", "premMax");
  bindNum("retMin", "retMin");
  $("#liqMin").addEventListener("change", e => { state.filters.liqMin = e.target.value; state.page = 1; renderTable(); });
  $("#subStatusSelect").addEventListener("change", e => { state.filters.subStatus = e.target.value; state.page = 1; renderTable(); });

  /* 已选 chips 移除 */
  $("#selectedChips").addEventListener("click", (e) => {
    if (e.target.id === "clearAllChips") return resetFilters();
    const btn = e.target.closest("[data-clear]");
    if (btn) clearFilterToken(btn.dataset.clear);
  });

  /* 表格：排序 / 行操作 / 列宽 */
  $("#tableHead").addEventListener("click", (e) => {
    if (e.target.closest(".col-resizer")) return;
    const th = e.target.closest("[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    if (state.sort.key === key) {
      if (state.sort.dir === -1) state.sort.dir = 1;
      else state.sort.key = "y1", state.sort.dir = -1;   // 第三次点击回到默认
      if (key === "y1" && state.sort.dir === 1) { /* y1 升序允许 */ }
    } else {
      state.sort = { key, dir: -1 };
    }
    renderTable();
  });

  let resizing = null;
  $("#tableHead").addEventListener("pointerdown", (e) => {
    const rz = e.target.closest(".col-resizer");
    if (!rz) return;
    e.preventDefault();
    const key = rz.dataset.col;
    const colDef = COLS_BY_TAB[state.tab].find(c => c.key === key);
    resizing = { key, startX: e.clientX, startW: colW(colDef), def: colDef };
    $("#tableHead").style.cursor = "col-resize";
  });
  window.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const w = Math.max(56, Math.min(420, resizing.startW + e.clientX - resizing.startX));
    state.widths[state.tab + "." + resizing.key] = w;
  });
  window.addEventListener("pointerup", () => {
    if (!resizing) return;
    LS.set("widths", state.widths);
    resizing = null;
    $("#tableHead").style.cursor = "";
    renderTable();
  });

  $("#tableBody").addEventListener("click", (e) => {
    const detail = e.target.closest("[data-detail]");
    if (detail) return openDetail(detail.dataset.detail);
    const watch = e.target.closest("[data-watch]");
    if (watch) return toggleWatch(watch.dataset.watch);
    const cmp = e.target.closest("[data-compare]");
    if (cmp) return toggleCompare(cmp.dataset.compare);
    const exp = e.target.closest("[data-expand]");
    if (exp) {
      const code = exp.dataset.expand;
      state.expanded.has(code) ? state.expanded.delete(code) : state.expanded.add(code);
      exp.classList.toggle("open");
      renderTable();
      const row = $(`#tableBody tr[data-row="${code}"]`);
      if (row && state.expanded.has(code)) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });

  /* 分页 */
  $("#pager").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-page]");
    if (!btn || btn.disabled) return;
    state.page = +btn.dataset.page;
    renderTable();
    $("#tableScroll").scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#pageSizeSelect").addEventListener("change", (e) => {
    state.pageSize = +e.target.value;
    LS.set("pageSize", state.pageSize);
    state.page = 1;
    renderTable();
  });

  /* 密度 */
  $("#densityToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".density-btn");
    if (!btn) return;
    state.density = btn.dataset.density;
    LS.set("density", state.density);
    $$(".density-btn").forEach(b => b.classList.toggle("is-active", b === btn));
    $("#fundTable").classList.toggle("compact", state.density === "compact");
  });

  /* 字段设置 */
  $("#colsDropdown").addEventListener("click", (e) => {
    if (e.target.closest(".dropdown-toggle")) {
      renderColsMenu();
      const menu = $("#colsMenu");
      menu.hidden = !menu.hidden;
      e.stopPropagation();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#colsDropdown")) $("#colsMenu").hidden = true;
  });
  $("#colsMenu").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-colcheck]");
    if (cb) toggleCol(cb.dataset.colcheck, cb.checked);
  });

  /* 对比栏 */
  $("#compareChips").addEventListener("click", (e) => {
    const del = e.target.closest("[data-cmpdel]");
    if (del) toggleCompare(del.dataset.cmpdel);
  });
  $("#compareClear").addEventListener("click", () => { state.compare = []; renderCompareBar(); renderTable(); });
  $("#compareStart").addEventListener("click", buildCompareTable);
  $("#compareBody").addEventListener("click", (e) => {
    const d = e.target.closest("[data-detail]");
    if (d) openDetail(d.dataset.detail);
  });

  /* 弹窗与抽屉关闭 */
  $$(".modal-mask, .drawer-mask").forEach(mask => {
    mask.addEventListener("click", (e) => {
      if (e.target === mask || e.target.closest("[data-close]")) closeModal(mask.id);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $$(".modal-mask:not([hidden]), .drawer-mask:not([hidden])").forEach(m => closeModal(m.id)); if (!$("#filterSheet").hidden) closeModal("filterSheet"); }
  });

  /* 移动端 */
  $("#mobileFilterBtn").addEventListener("click", openFilterSheet);
  $("#sheetOk").addEventListener("click", applySheet);
  $("#sheetReset").addEventListener("click", () => {
    resetFilters();
    closeModal("filterSheet");
  });
  $("#filterSheet").addEventListener("click", (e) => {
    if (e.target.id === "filterSheet" || e.target.closest("[data-close]")) closeModal("filterSheet");
  });
  $("#sheetBody").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const map = { sRegion: "regions", sStyle: "styles", sInd: "industries" };
    const grp = chip.parentElement.id;
    const set = state.filters[map[grp]];
    if (!set) return;
    const v = chip.dataset.k;
    set.has(v) ? set.delete(v) : set.add(v);
    chip.classList.toggle("is-active", set.has(v));
    const mainId = { sRegion: "#regionChips", sStyle: "#styleChips", sInd: "#industryChips" }[grp];
    const mainChip = $(`${mainId} .chip[data-k="${CSS.escape(v)}"]`);
    if (mainChip) mainChip.classList.toggle("is-active", set.has(v));
    state.page = 1;
    renderTable();
    const n = activeFilterCount();
    $("#filterBadge").hidden = !n; $("#filterBadge").textContent = n;
  });
  $("#mobileSort").addEventListener("change", (e) => {
    if (e.target.id !== "sortSelect") return;
    const [key, dir] = e.target.value.split(":");
    state.sort = { key, dir: +dir };
    state.page = 1;
    renderTable();
  });

  /* 刷新 */
  $("#refreshBtn").addEventListener("click", async () => {
    const btn = $("#refreshBtn");
    btn.classList.add("spinning");
    await Promise.all([loadMeta(true), loadTab(state.tab, true)]);
    btn.classList.remove("spinning");
    rebuildFilterOptions();
    renderTable();
    toast("数据已更新");
  });

  window.addEventListener("resize", debounce(() => {
    if (window.matchMedia("(max-width: 767px)").matches !== state.__wasMobile) {
      state.__wasMobile = window.matchMedia("(max-width: 767px)").matches;
      renderTable();
    }
  }, 200));
  state.__wasMobile = window.matchMedia("(max-width: 767px)").matches;
  applyMobileLayout();
}

function applyMobileLayout() {
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  $("#mobileFilterBtn").hidden = !isMobile;
  $("#mobileSort").hidden = !isMobile;
  $("#sortSelect").parentElement.hidden = !isMobile;
}

/* ---------------- 启动 ---------------- */
async function init() {
  bindEvents();
  $$(".density-btn").forEach(b => b.classList.toggle("is-active", b.dataset.density === state.density));
  $("#fundTable").classList.toggle("compact", state.density === "compact");
  $("#pageSizeSelect").value = state.pageSize;
  $("#watchBadge").textContent = state.watch.size;
  $("#watchBadge").hidden = !state.watch.size;

  const hash = location.hash.replace("#", "");
  if (hash === "otc" || hash === "etf") state.tab = hash;
  else if (hash === "watch") state.view = "watch";
  $$("#tabBar .tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === state.tab));
  $$("#topnav .topnav-link").forEach(b => b.classList.toggle("is-active", b.dataset.view === state.view));
  if (state.view === "watch") $(".query-panel").style.display = "none";

  await loadMeta();
  await loadTab(state.tab);
  rebuildFilterOptions();
  renderColsMenu();
  renderTable();
}

init();

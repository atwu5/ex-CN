#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全球基金查询 · 数据采集管道
================================
数据全部来自东方财富/天天基金公开接口，逐基金实时抓取，不做任何人工虚构。
覆盖范围：境内发行、主要投资于非 A 股市场的公募权益类基金（跨境 ETF/LOF、QDII、
ETF 联接、境外指数基金、境外权益主动基金），剔除黄金、原油、商品、债券、REITs、货币。

公开接口清单（均为东方财富公开数据端点）：
  1. rankhandler.aspx  ft=qdii / ft=zs   基金排行榜（收益率、手续费）
  2. push2delay clist  b:MK0021/23/25    场内基金实时行情（价格、涨跌、折溢价、IOPV、成交额）
  3. pingzhongdata/{code}.js           净值走势、累计净值、规模变动、基金经理
  4. fundf10 jbgk_{code}.html          基金类型、费率、规模、成立日期、跟踪标的
  5. fundf10 tsdata_{code}.html        跟踪误差
  6. fundf10 FundArchivesDatas jjcc    前十大持仓
  7. fund.eastmoney.com/{code}.html    申购状态、申购限额、赎回状态

用法：
  python3 scripts/fetch_data.py            # 全量更新，输出到 data/
  LIMIT=20 python3 scripts/fetch_data.py   # 调试模式，只处理少量基金
"""
import concurrent.futures as cf
import json
import os
import random
import re
import sys
import threading
import time
from datetime import datetime, timedelta

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
TREND_DIR = os.path.join(DATA_DIR, "trend")
LIMIT = int(os.environ.get("LIMIT", "0"))
WORKERS = int(os.environ.get("WORKERS", "8"))

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
S = requests.Session()
S.headers.update({"User-Agent": UA})
_tl = threading.local()

PRINT_LOCK = threading.Lock()


def log(msg):
    with PRINT_LOCK:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def get_text(url, params=None, referer=None, timeout=25):
    """带重试的 GET，返回文本。失败返回 None。"""
    if not hasattr(_tl, "last"):
        _tl.last = 0.0
    sess = _tl.session if hasattr(_tl, "session") else S
    headers = {"Referer": referer} if referer else None
    for i in range(4):
        try:
            now = time.time()
            wait = _tl.last + random.uniform(0.03, 0.10) - now
            if wait > 0:
                time.sleep(wait)
            _tl.last = time.time()
            r = sess.get(url, params=params, headers=headers, timeout=timeout)
            if r.status_code == 200:
                return r.content.decode("utf-8", "ignore")
            if r.status_code in (404,):
                return None
        except Exception:
            time.sleep(0.8 * (i + 1) + random.random())
    return None


def get_json(url, params=None, referer=None, timeout=25):
    t = get_text(url, params, referer, timeout)
    if not t:
        return None
    try:
        return json.loads(t)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 一、基金名录与行情
# ---------------------------------------------------------------------------

def fetch_rank(ft, page_size=100):
    """天天基金排行榜，返回 [字段数组]（含收益率序列）。首页拿总数后并行翻页。"""
    url = "https://fund.eastmoney.com/data/rankhandler.aspx"

    def fetch_page(pi):
        params = {"op": "ph", "dt": "kf", "ft": ft, "rs": "", "gs": 0,
                  "sc": "1nzf", "st": "desc", "sd": "2025-11-27", "ed": "2026-11-27",
                  "qdii": "", "subsubType": ",", "subSubType": ",",
                  "pi": pi, "pn": page_size, "dx": 1}
        t = get_text(url, params, referer="http://fund.eastmoney.com/data/fundranking.html")
        if not t:
            return []
        m = re.search(r"datas:\[(.*?)\]", t, re.S)
        if not m:
            return []
        return [x.split(",") for x in re.findall(r'"(.*?)"', m.group(1))]

    first = fetch_page(1)
    if not first:
        return []
    total = None
    t = get_text(url, {"op": "ph", "dt": "kf", "ft": ft, "rs": "", "gs": 0,
                       "sc": "1nzf", "st": "desc", "sd": "2025-11-27", "ed": "2026-11-27",
                       "qdii": "", "subsubType": ",", "subSubType": ",",
                       "pi": 1, "pn": 1, "dx": 1},
                 referer="http://fund.eastmoney.com/data/fundranking.html")
    if t:
        m = re.search(r"allRecords:(\d+)", t)
        total = int(m.group(1)) if m else None
    n_pages = ((total or len(first)) + page_size - 1) // page_size
    with cf.ThreadPoolExecutor(max_workers=min(6, max(1, n_pages - 1))) as ex:
        rest = list(ex.map(fetch_page, range(2, n_pages + 1)))
    out = first + [r for page in rest for r in page]
    log(f"rank[{ft}] = {len(out)} 行（共 {total}）")
    return out


RANK_FIELDS = ["code", "name", "py", "date", "nav", "navAcc", "navChg",
               "w", "m1", "m3", "m6", "y1", "y2", "y3", "ytd", "since",
               "founded", "a", "b", "subFee", "subFeeReal", "c", "d", "e", "f"]


def parse_rank_row(cells):
    if len(cells) < 20:
        return None
    d = dict(zip(RANK_FIELDS, cells))

    def num(k):
        v = d.get(k, "")
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    return {
        "code": d["code"],
        "name": d["name"],
        "nav": num("nav"),
        "navAcc": num("navAcc"),
        "navChg": num("navChg"),
        "returns": {k: num(k) for k in ("w", "m1", "m3", "m6", "y1", "y2", "y3", "ytd", "since")},
        "subFee": num("subFee"),
        "navDate": d.get("date") or None,
        "founded": d.get("founded") or None,
    }


QUOTE_URL = "https://push2delay.eastmoney.com/api/qt/clist/get"
QUOTE_FIELDS = "f12,f13,f14,f2,f3,f6,f8,f20,f402,f441,f124,f297"


def fetch_board_quotes(fs):
    """场内行情板块，返回 {code: quote}。"""
    out, pn, total = {}, 1, None
    while True:
        params = {"pn": pn, "pz": 500, "po": 1, "np": 1,
                  "ut": "bd1d9ddb04089700cf9c27f6f7426281", "fltt": 2, "invt": 2,
                  "wbp2u": "|0|0|0|web", "fid": "f12", "fs": fs, "fields": QUOTE_FIELDS}
        j = get_json(QUOTE_URL, params, referer="https://quote.eastmoney.com/")
        data = (j or {}).get("data") or {}
        diff = data.get("diff") or []
        if not diff:
            break
        for r in diff:
            out[r["f12"]] = r
        total = data.get("total")
        if total is None or len(out) >= total:
            break
        pn += 1
    return out


def to_f(v):
    try:
        if v in (None, "", "-"):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def quote_fields(q):
    """把 push2 行情字段转成业务字段。"""
    ts = to_f(q.get("f124"))
    qt = None
    if ts:
        qt = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    disc = to_f(q.get("f402"))
    return {
        "price": to_f(q.get("f2")),
        "changePct": to_f(q.get("f3")),
        "amountWan": round(to_f(q.get("f6")) / 1e4, 1) if to_f(q.get("f6")) else None,
        "turnover": to_f(q.get("f8")),
        "mktCapYi": round(to_f(q.get("f20")) / 1e8, 2) if to_f(q.get("f20")) else None,
        "premiumPct": round(-disc, 2) if disc is not None else None,  # 折价率取负 → 溢价率
        "iopv": to_f(q.get("f441")),
        "quoteTime": qt,
    }


# ---------------------------------------------------------------------------
# 二、分类（国家/地区、行业主题、是否海外权益）
# ---------------------------------------------------------------------------

EXCLUDE_PAT = re.compile(
    r"债|货币|现金|理财|黄金|金价|贵金属|原油|油气|石油|商品|抗通胀|大宗|"
    r"房地产|不动产|REIT|地产|公开价格指数|期货|A股|沪深|上证|创业板|科创板|北证")

REGION_RULES = [
    ("美国", r"纳斯达克|纳指|标普|普尔|道琼|美国|美股"),
    ("中国香港", r"恒生|港股|香港|中概|港币|国企指数|恒指|港通"),
    ("日本", r"日经|日本|东证|东京"),
    ("印度", r"印度|孟买|Nifty"),
    ("欧洲", r"欧洲|欧元|德国|法国|英国|DAX|CAC|富时|欧盟|斯托克"),
    ("韩国", r"韩国|KOSPI"),
    ("澳洲", r"澳大利亚|澳洲|新西兰"),
    ("加拿大", r"加拿大"),
    ("拉美", r"拉美|巴西|墨西哥"),
    ("沙特", r"沙特"),
    ("亚太", r"亚太|亚洲|东盟|东南亚|越南|印尼|泰国|马来西亚|新加坡|菲律宾|中韩"),
    ("新兴市场", r"新兴市场|金砖"),
    ("大中华", r"大中华|大中华区|中华交易服务|海峡两岸"),
    ("全球", r"全球|海外|环球|国际|世界"),
]

INDUSTRY_RULES = [
    ("科技", r"科技|互联网|信息技术|云计算|人工智能|AI|芯片|半导体|机器人|数码|电子|软件|移动|智联|数字"),
    ("医药生物", r"医药|医疗|生物|健康|创新药|基因"),
    ("消费", r"消费|食品|饮料|零售|白酒|家电"),
    ("金融", r"金融|银行|保险|券商|证券"),
    ("新能源车", r"新能源车|电动车|汽车|智能车"),
    ("新能源", r"新能源|光伏|碳中和|储能"),
    ("高股息", r"高股息|股息|红利"),
    ("先进制造", r"制造|工业|装备|航空|军工|国防"),
    ("通信", r"通信|电信|5G|6G"),
    ("资源", r"资源|矿业|金属|铜|铝|锂"),
]


def match_rules(text, rules):
    if not text:
        return []
    # 生物科技归入医药生物，避免重复计入科技
    text = re.sub(r"生物科技", "生物医药", text)
    out = []
    for label, pat in rules:
        if re.search(pat, text):
            out.append(label)
    return out


def overseas_hit(name):
    """名称是否命中海外市场关键词（不用裸“新兴”，避免新兴产业等误伤）。"""
    pats = ("纳斯达克|纳指|标普|普尔|道琼|美国|美股|日经|日本|恒生|港股|香港|中概|海外|全球|"
            "国际|环球|亚太|亚洲|欧洲|欧元|德国|法国|英国|印度|越南|东南亚|东盟|沙特|新兴市场|"
            "金砖|澳洲|澳大利亚|新西兰|韩国|台湾|拉美|巴西|墨西哥|加拿大|大中华|中资|美元|"
            "东证|世界|DAX|CAC|富时|斯托克|Nifty|中韩")
    return bool(re.search(pats, name or ""))


# fundcode_search.js 中的官方类型：直接判定为海外权益
OVERSEAS_TYPES = {"指数型-海外股票", "QDII-混合偏股", "QDII-普通股票", "QDII-混合灵活", "QDII-混合平衡"}


def load_fund_types():
    """全量基金名录与官方类型（fundcode_search.js，约 2.8 万条）。"""
    t = get_text("https://fund.eastmoney.com/js/fundcode_search.js",
                 referer="https://fund.eastmoney.com/")
    if not t:
        return {}
    import json as _json
    try:
        data = _json.loads(t[t.find("["):t.rfind("]") + 1])
    except Exception:
        return {}
    return {x[0]: x for x in data if len(x) >= 4}


def is_excluded(name):
    return bool(EXCLUDE_PAT.search(name or ""))


# ---------------------------------------------------------------------------
# 三、单基金详情抓取
# ---------------------------------------------------------------------------

def parse_pingzhong(code):
    t = get_text(f"https://fund.eastmoney.com/pingzhongdata/{code}.js",
                 referer="https://fund.eastmoney.com/")
    if not t:
        return {}
    out = {}

    def jvar(name):
        m = re.search(r"var\s+%s\s*=\s*(\[.*?\]|\{.*?\})\s*;" % re.escape(name), t, re.S)
        if not m:
            return None
        try:
            return json.loads(m.group(1))
        except Exception:
            return None

    m = re.search(r'var\s+fS_name\s*=\s*"([^"]*)"', t)
    out["name"] = m.group(1) if m else None
    for k, key in (("syl_1n", "y1"), ("syl_6y", "m6"), ("syl_3y", "m3"), ("syl_1y", "ytd")):
        m = re.search(r'var\s+%s\s*=\s*"([^"]*)"' % k, t)
        try:
            out.setdefault("syl", {})[key] = float(m.group(1)) if m and m.group(1) else None
        except ValueError:
            out.setdefault("syl", {})[key] = None
    out["netTrend"] = jvar("Data_netWorthTrend") or []
    out["acTrend"] = jvar("Data_ACWorthTrend") or []
    out["scaleHist"] = jvar("Data_fluctuationScale")
    mgr = jvar("Data_currentFundManager") or []
    out["manager"] = mgr[0].get("name") if mgr else None
    return out


def parse_jbgk(code):
    t = get_text(f"https://fundf10.eastmoney.com/jbgk_{code}.html",
                 referer="https://fundf10.eastmoney.com/")
    if not t:
        return {}

    def cell(th):
        m = re.search(r"<th>%s</th><td[^>]*>(.*?)</td>" % re.escape(th), t, re.S)
        if not m:
            return None
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(1))).strip()

    def pct(s):
        if not s:
            return None
        m = re.search(r"([\d.]+)\s*%", s)
        return float(m.group(1)) if m else None

    out = {}
    out["fundType"] = cell("基金类型")
    seg = cell("成立日期/规模") or ""
    m = re.search(r"([\d]{4}年[\d]{1,2}月[\d]{1,2}日)", seg)
    if m:
        out["founded"] = m.group(1).replace("年", "-").replace("月", "-").replace("日", "")
    seg = cell("净资产规模") or ""
    m = re.search(r"([\d.,]+)\s*亿元（截止至：([\d年月日]+)）", seg)
    if m:
        out["scaleYi"] = float(m.group(1).replace(",", ""))
        out["scaleDate"] = m.group(2).replace("年", "-").replace("月", "-").replace("日", "")
    m = re.search(r'基金管理人</th><td><a href="[^"]*">([^<]+)</a>', t)
    out["company"] = m.group(1).strip() if m else None
    out["mgmtFee"] = pct(cell("管理费率"))
    out["custFee"] = pct(cell("托管费率"))
    out["svcFee"] = pct(cell("销售服务费率"))
    out["subFee"] = pct(cell("最高申购费率"))
    out["trackIndex"] = cell("跟踪标的")
    out["benchmark"] = cell("业绩比较基准")
    return out


def parse_tsdata(code):
    t = get_text(f"https://fundf10.eastmoney.com/tsdata_{code}.html",
                 referer="https://fundf10.eastmoney.com/")
    if not t:
        return None
    plain = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t))
    m = re.search(r"跟踪误差[^%]{0,120}?([\d.]+)\s*%", plain)
    return float(m.group(1)) if m else None


def parse_holdings(code):
    t = get_text("https://fundf10.eastmoney.com/FundArchivesDatas.aspx",
                 params={"type": "jjcc", "code": code, "topline": "10", "year": "", "month": ""},
                 referer="https://fundf10.eastmoney.com/")
    if not t or "<table" not in t:
        return []
    rows = []
    for tr in re.split(r"<tr", t)[1:]:
        links = re.findall(r"<a[^>]*>([^<]{2,24})</a>", tr)
        if len(links) < 2:
            continue
        name = links[1].strip()
        m = re.search(r"([\d.]+)\s*%", tr)
        if not name or not m:
            continue
        rows.append({"n": name, "w": float(m.group(1))})
        if len(rows) >= 10:
            break
    return rows


def parse_trade_status(code):
    """场外基金申购状态与限额（天天基金基金主页）。"""
    t = get_text(f"https://fund.eastmoney.com/{code}.html",
                 referer="https://fund.eastmoney.com/")
    if not t:
        return None, None, None
    m = re.search(r'交易状态：</span><span class="staticCell">([^<(（]+)', t)
    status = m.group(1).strip() if m else None
    limit = None
    m2 = re.search(r"单日累计购买上限([\d.,]+)(万元|元)", t)
    if m2:
        v = float(m2.group(1).replace(",", ""))
        limit = v * 10000 if m2.group(2) == "万元" else v
    m3 = re.search(r'赎回状态：</span><span class="staticCell">([^<(（]+)', t)
    redeem = m3.group(1).strip() if m3 else None
    return status, limit, redeem


# ---------------------------------------------------------------------------
# 四、衍生指标计算
# ---------------------------------------------------------------------------

def returns_from_trend(ac_trend):
    """由累计净值走势计算区间收益率（%）。成立不满该区间的返回 None（缺失沉底）。"""
    if not ac_trend or len(ac_trend) < 2:
        return {}
    pts = [(p[0], p[1]) for p in ac_trend if len(p) >= 2 and isinstance(p[1], (int, float))]
    if not pts:
        return {}
    pts.sort()
    last_t, last_v = pts[-1]
    res = {}

    def ret_days(days):
        target = last_t - days * 86400 * 1000
        for t0, v0 in pts:
            if t0 >= target:
                # 基准点距目标日超过 10 天 ⇒ 基金当时尚未成立
                if t0 - target > 10 * 86400 * 1000:
                    return None
                if v0 and v0 > 0:
                    return round((last_v / v0 - 1) * 100, 2)
                return None
        return None

    for key, days in (("w", 7), ("m1", 30), ("m3", 91), ("m6", 182),
                      ("y1", 365), ("y2", 730), ("y3", 1095)):
        res[key] = ret_days(days)

    # 今年来
    year = datetime.fromtimestamp(last_t / 1000).year
    ytd_v = None
    for t0, v0 in pts:
        if datetime.fromtimestamp(t0 / 1000).year < year:
            ytd_v = v0
        else:
            break
    res["ytd"] = round((last_v / ytd_v - 1) * 100, 2) if ytd_v else None
    # 成立以来
    first_t, first_v = pts[0]
    res["since"] = round((last_v / first_v - 1) * 100, 2) if first_v else None
    return res


def mdd_from_trend(net_trend, since_ts=None):
    """最大回撤（%），net_trend: [{x,y}]。返回 (近1年, 成立来)。"""
    if not net_trend:
        return None, None
    pts = [(p.get("x"), p.get("y")) for p in net_trend
           if isinstance(p.get("x"), (int, float)) and isinstance(p.get("y"), (int, float))]
    pts.sort()

    def calc(window_ts):
        peak, mdd = None, None
        for t0, v0 in pts:
            if window_ts and t0 < window_ts or not v0:
                continue
            if peak is None or v0 > peak:
                peak = v0
            elif peak:
                d = (v0 / peak - 1) * 100
                mdd = d if mdd is None else min(mdd, d)
        return round(mdd, 2) if mdd is not None else None

    if not pts:
        return None, None
    last_t = pts[-1][0]
    return calc(last_t - 365 * 86400 * 1000), calc(None)


def share_class_of(name):
    n = name or ""
    if re.search(r"美元(?:现汇|现钞)?份额|[（(]美元", n):
        return "美元"
    if re.search(r"人民币[RC]?\)?份额|\(人民币\)|（人民币）", n):
        return "人民币"
    if re.search(r"[（(]D$|·D$|D类", n):
        return "D"
    m = re.search(r"([ACDEIR])\)?(?:份额)?$", n)
    if m:
        return m.group(1)
    return "主份额"


def clean_track(track):
    if not track or track.strip() in ("--", ""):
        return None
    if "无跟踪标的" in track:
        return None
    return track.strip()


def fund_style_of(name, track_index, fund_type):
    n = name or ""
    ft = fund_type or ""
    if re.search(r"ETF联接|联接基金", n):
        return "ETF联接"
    if "LOF" in n:
        return "指数LOF" if (track_index or "指数" in ft) else "LOF"
    if "指数" in ft:
        return "被动指数"
    if track_index:
        return "被动指数"
    return "QDII主动" if "QDII" in ft else "主动管理"


# ---------------------------------------------------------------------------
# 五、组装
# ---------------------------------------------------------------------------

def enrich_otc(code, rank_row, also_on_exchange):
    pz = parse_pingzhong(code)
    jb = parse_jbgk(code)
    name = (pz.get("name") or rank_row.get("name") or "").strip()
    if not name:
        return None
    fund_type = jb.get("fundType") or ""
    track = clean_track(jb.get("trackIndex"))
    # 海外权益确认：类型含海外/QDII，或跟踪标的/名称命中海外关键词
    keep = (("海外" in fund_type) or ("QDII" in fund_type) or ("QDII" in name)
            or overseas_hit(name) or overseas_hit(track or ""))
    if not keep:
        return None

    returns = rank_row.get("returns") or {}
    syl = pz.get("syl") or {}
    for k, v in syl.items():
        if returns.get(k) in (None, "") and v is not None:
            returns[k] = v
    if not any(v is not None for v in returns.values()):
        returns = returns_from_trend(pz.get("acTrend") or [])

    mdd1y, mdd_all = mdd_from_trend(pz.get("netTrend") or [])
    status, limit, redeem = parse_trade_status(code)
    style = fund_style_of(name, track, fund_type)
    is_index = style in ("被动指数", "ETF联接", "指数LOF")
    mgmt, cust, svc = jb.get("mgmtFee"), jb.get("custFee"), jb.get("svcFee")
    ops = None
    if mgmt is not None and cust is not None:
        ops = round(mgmt + cust + (svc or 0), 2)

    item = {
        "code": code,
        "name": name,
        "share": share_class_of(name),
        "style": style,
        "fundType": fund_type or None,
        "regions": match_rules(" ".join(filter(None, [name, track, jb.get("benchmark")])), REGION_RULES) or ["全球"],
        "industries": match_rules(" ".join(filter(None, [name, track])), INDUSTRY_RULES),
        "trackIndex": track,
        "nav": rank_row.get("nav"),
        "navAcc": rank_row.get("navAcc"),
        "navChg": rank_row.get("navChg"),
        "navDate": rank_row.get("navDate"),
        "returns": returns,
        "mdd1y": mdd1y,
        "mddAll": mdd_all,
        "scaleYi": jb.get("scaleYi"),
        "scaleDate": jb.get("scaleDate"),
        "mgmtFee": mgmt, "custFee": cust, "svcFee": svc, "opsFee": ops,
        "subFee": jb.get("subFee"),
        "subStatus": status,
        "subLimit": limit,
        "redeemStatus": redeem,
        "trackingErr": parse_tsdata(code) if is_index else None,
        "holdings": parse_holdings(code) if not is_index else parse_holdings(code),
        "manager": pz.get("manager"),
        "company": jb.get("company"),
        "founded": jb.get("founded") or rank_row.get("founded"),
        "onExchange": also_on_exchange,
    }
    if item["scaleYi"] is None:
        sh = pz.get("scaleHist")
        try:
            if isinstance(sh, list) and sh and isinstance(sh[-1], dict):
                item["scaleYi"] = sh[-1].get("y")
        except Exception:
            pass
    if not item.get("navDate") and pz.get("netTrend"):
        try:
            item["navDate"] = datetime.fromtimestamp(pz["netTrend"][-1]["x"] / 1000).strftime("%Y-%m-%d")
        except Exception:
            pass
    write_trend(code, pz.get("netTrend") or [])
    return item


def enrich_etf(code, q, also_otc):
    pz = parse_pingzhong(code)
    jb = parse_jbgk(code)
    name = (pz.get("name") or q.get("f14") or "").strip()
    if not name or is_excluded(name):
        return None
    fund_type = jb.get("fundType") or ""
    track = clean_track(jb.get("trackIndex"))
    keep = (("海外" in fund_type) or ("QDII" in fund_type) or ("QDII" in name)
            or overseas_hit(name) or overseas_hit(track or ""))
    if not keep:
        return None

    returns = returns_from_trend(pz.get("acTrend") or [])
    for k, v in (pz.get("syl") or {}).items():
        if returns.get(k) is None and v is not None:
            returns[k] = v
    mdd1y, mdd_all = mdd_from_trend(pz.get("netTrend") or [])
    mgmt, cust = jb.get("mgmtFee"), jb.get("custFee")
    ops = round(mgmt + cust, 2) if (mgmt is not None and cust is not None) else None
    item = {
        "code": code,
        "name": name,
        "market": "SH" if code.startswith(("5", "6")) else "SZ",
        "style": "ETF" if "ETF" in name.upper() else "LOF",
        "fundType": fund_type or None,
        "regions": match_rules(" ".join(filter(None, [name, track, jb.get("benchmark")])), REGION_RULES) or ["全球"],
        "industries": match_rules(" ".join(filter(None, [name, track])), INDUSTRY_RULES),
        "trackIndex": track,
        "returns": returns,
        "mdd1y": mdd1y,
        "mddAll": mdd_all,
        "scaleYi": jb.get("scaleYi"),
        "scaleDate": jb.get("scaleDate"),
        "mgmtFee": mgmt, "custFee": cust, "svcFee": None, "opsFee": ops,
        "subFee": jb.get("subFee"),
        "trackingErr": parse_tsdata(code),
        "holdings": parse_holdings(code),
        "manager": pz.get("manager"),
        "company": jb.get("company"),
        "founded": jb.get("founded"),
        "onExchange": True,
    }
    item.update(quote_fields(q))
    if item["scaleYi"] is None:
        item["scaleYi"] = item.get("mktCapYi")
    write_trend(code, pz.get("netTrend") or [])
    return item


def write_trend(code, net_trend):
    """近 1 年净值走势，降采样到 ~120 点，供详情页懒加载。"""
    pts = [(p.get("x"), p.get("y")) for p in net_trend
           if isinstance(p.get("x"), (int, float)) and isinstance(p.get("y"), (int, float))]
    pts.sort()
    if pts:
        cutoff = pts[-1][0] - 365 * 86400 * 1000
        pts = [p for p in pts if p[0] >= cutoff]
    step = max(1, len(pts) // 120)
    pts = pts[::step]
    if pts and pts[-1] != (net_trend[-1].get("x"), net_trend[-1].get("y")):
        pts.append((net_trend[-1].get("x"), net_trend[-1].get("y")))
    payload = {"code": code, "pts": [{"x": x, "y": y} for x, y in pts]}
    with open(os.path.join(TREND_DIR, f"{code}.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def bounded_enrich(fn, *args):
    try:
        return fn(*args)
    except Exception as e:
        log(f"enrich error {args[0]}: {e!r}")
        return None


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main():
    os.makedirs(TREND_DIR, exist_ok=True)
    for f in os.listdir(TREND_DIR):
        os.remove(os.path.join(TREND_DIR, f))

    log("== 拉取基金名录与行情 ==")
    fund_types = load_fund_types()
    log(f"全量名录 {len(fund_types)} 条")
    qdii_rows = [r for r in (parse_rank_row(c) for c in fetch_rank("qdii")) if r]
    zs_rows = [r for r in (parse_rank_row(c) for c in fetch_rank("zs")) if r]
    rank_by_code = {r["code"]: r for r in qdii_rows}
    for r in zs_rows:
        rank_by_code.setdefault(r["code"], r)

    etf_quotes = {}
    for fs in ("b:MK0021,b:MK0023",):
        etf_quotes.update(fetch_board_quotes(fs))
    lof_quotes = fetch_board_quotes("b:MK0025")
    log(f"场内行情：ETF {len(etf_quotes)} 只，LOF {len(lof_quotes)} 只")

    def type_overseas(code):
        rec = fund_types.get(code)
        return bool(rec and rec[3] in OVERSEAS_TYPES)

    def board_name(code, quotes):
        rec = fund_types.get(code)
        if rec:
            return rec[2]
        return (quotes.get(code) or {}).get("f14") or ""

    # 场内候选：官方类型为海外股票，或名称命中海外关键词的 ETF / LOF
    etf_codes = [c for c in etf_quotes
                 if (type_overseas(c) or overseas_hit(board_name(c, etf_quotes)))
                 and not is_excluded(board_name(c, etf_quotes))]
    lof_codes = [c for c in lof_quotes
                 if (type_overseas(c) or overseas_hit(board_name(c, lof_quotes)))
                 and not is_excluded(board_name(c, lof_quotes))]
    log(f"场内海外候选：ETF {len(etf_codes)} 只，LOF {len(lof_codes)} 只")

    # 场外候选：QDII 排行（剔除非权益）+ 指数型排行命中关键词 + 官方类型为海外/QDII权益
    otc_codes = []
    for r in qdii_rows:
        if not is_excluded(r["name"]):
            otc_codes.append(r["code"])
    zs_hits = [r["code"] for r in zs_rows
               if overseas_hit(r["name"]) and not is_excluded(r["name"])]
    type_hits = [c for c, rec in fund_types.items()
                 if rec[3] in OVERSEAS_TYPES and not is_excluded(rec[2])
                 and c not in etf_quotes]  # ETF 本体只进场内页
    log(f"场外候选：QDII {len(otc_codes)} 只，指数型海外 {len(zs_hits)} 只，类型驱动 {len(type_hits)} 只")

    otc_set = [c for c in dict.fromkeys(otc_codes + zs_hits + type_hits)
               if c not in etf_quotes]  # ETF 本体不重复进场外页
    etf_all = list(dict.fromkeys(etf_codes + lof_codes))
    if LIMIT:
        otc_set = otc_set[:LIMIT]
        etf_all = etf_all[:LIMIT]
    log(f"待抓取：场外 {len(otc_set)} 只，场内 {len(etf_all)} 只")

    log("== 并发抓取基金详情 ==")
    etf_items, otc_items = [], []
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {}
        for c in etf_all:
            q = etf_quotes.get(c) or lof_quotes.get(c)
            both = c in lof_quotes  # LOF 场内外同时存在
            futs[ex.submit(bounded_enrich, enrich_etf, c, q, both)] = ("etf", c)
        for c in otc_set:
            rr = rank_by_code.get(c) or {"code": c, "name": "", "returns": {}}
            both = c in lof_quotes
            futs[ex.submit(bounded_enrich, enrich_otc, c, rr, both)] = ("otc", c)
        done = 0
        for fut in cf.as_completed(futs):
            kind, code = futs[fut]
            item = fut.result()
            done += 1
            if done % 40 == 0:
                log(f"进度 {done}/{len(futs)}")
            if not item:
                continue
            if kind == "etf":
                etf_items.append(item)
                if code in lof_quotes:
                    otc_items.append(item)  # LOF 同步进入场外页
            else:
                otc_items.append(item)

    # 新鲜度过滤：净值日期缺失或超 40 天未更新 → 疑似清盘/停止披露，剔除
    cutoff = (datetime.now() - timedelta(days=40)).strftime("%Y-%m-%d")
    before = len(otc_items)
    otc_items = [i for i in otc_items if i.get("navDate") and i["navDate"] >= cutoff]
    etf_items = [i for i in etf_items if i.get("quoteTime")]
    if before - len(otc_items):
        log(f"新鲜度过滤：剔除 {before - len(otc_items)} 只停止披露/清盘基金")

    # 按近 1 年收益排序（缺失沉底）
    def y1_key(it):
        v = (it.get("returns") or {}).get("y1")
        return (1, 0) if v is None else (0, -v)

    etf_items.sort(key=y1_key)
    otc_items.sort(key=y1_key)

    now = datetime.now()
    meta = {
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "generatedAtText": now.strftime("%Y-%m-%d %H:%M"),
        "etfCount": len(etf_items),
        "otcCount": len({i["code"] for i in otc_items}),
        "regionCount": len({r for i in (etf_items + otc_items) for r in i.get("regions") or []}),
        "indexCount": len({i.get("trackIndex") for i in (etf_items + otc_items)
                           if i.get("trackIndex") and i.get("trackIndex") not in ("--", "")}),
        "quoteTime": max((i.get("quoteTime") or "" for i in etf_items), default=""),
        "sources": [
            {"name": "天天基金网（东方财富）", "url": "https://fund.eastmoney.com/"},
            {"name": "东方财富行情中心", "url": "https://quote.eastmoney.com/"},
        ],
        "disclaimer": "本站数据来自东方财富/天天基金公开接口，仅作信息汇总与筛选工具，"
                      "不构成任何投资建议。基金有风险，投资需谨慎。",
    }

    def dump(name, obj):
        path = os.path.join(DATA_DIR, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        log(f"写出 {name}（{os.path.getsize(path) // 1024} KB）")

    dump("meta.json", meta)
    dump("etf.json", {"updated": meta["generatedAtText"], "quoteTime": meta["quoteTime"], "funds": etf_items})
    dump("otc.json", {"updated": meta["generatedAtText"], "funds": otc_items})
    log(f"完成：场内 {len(etf_items)}，场外 {meta['otcCount']}，走势文件 {len(os.listdir(TREND_DIR))}")


if __name__ == "__main__":
    sys.exit(main())

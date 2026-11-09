#!/usr/bin/env python3
"""Build the monthly Journal's data: one fact file per finished month, from the SITE'S OWN numbers.

Serves this repo locally, opens it in a headless browser and, for every tracked game, runs the
site's own code (selectGame -> computeMonthly, bannerQimai, cnRunSeries, barColor, _rank) and
dumps what it computed. Nothing is re-derived here except sorting and peak-picking, so a figure
in the Journal can't drift from the one the site shows. Sensor Tower is NOT used (site rule).

    python scripts/build_journal.py                 every finished month
    python scripts/build_journal.py --month 2026-10 just one issue (plus the index)

Writes data/journal/YYYY-MM.json and data/journal/index.json. The written part of an issue
(headline, letter, per-game copy, character stories) lives in data/journal/notes/YYYY-MM.json
and data/journal/stories.json and is never touched by this script.
"""
import argparse, datetime, functools, re, http.server, json, pathlib, sys, threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "journal"
NAMES = {"genshin": "Genshin Impact", "hsr": "Honkai: Star Rail", "zzz": "Zenless Zone Zero",
         "wuwa": "Wuthering Waves", "nte": "Neverness to Everness", "endfield": "Arknights: Endfield",
         "uma": "Umamusume: Pretty Derby", "czn": "Chaos Zero Nightmare", "stellasora": "Stella Sora",
         "lads": "Love and Deepspace"}
# the six the audience follows lead every issue; the rest follow in revenue order
FEATURED = ["genshin", "hsr", "zzz", "wuwa", "endfield", "nte"]
# The CN 总流水 layer (天天背锅崩坏娘's monthly Bilibili chart, global all-platform CN¥ ranges) as
# the site stores it. It is published weeks after the month closes, so the page flags it.
ZL = {}; ZL_VIDEO = {}
def load_zl():
    d = json.loads((ROOT / "data" / "cn_monthly.json").read_text(encoding="utf-8"))
    raw = json.loads((ROOT / "data" / "cn_revenue.json").read_text(encoding="utf-8"))
    ZL.update({t: g.get("monthly", {}) for t, g in d["games"].items()})
    ZL_VIDEO.update({ym: e.get("bvid") for ym, e in raw.get("episodes_done", {}).items()})
# Star Rail splash art (scripts/journal_hsr_art.py): StarRailRes character id -> local webp + face
HSR_ART = {}
_SRR_ICON = re.compile(r"StarRailRes/master/icon/character/(\d+)\.png")
def splash_of(tag, icons):
    if tag != "hsr" or not icons: return None, None
    m = _SRR_ICON.search(icons[0]); a = m and HSR_ART.get(m.group(1))
    return (a["file"], a["face"]) if a else (None, None)

def zl_of(tag, ym):
    r = ZL.get(tag, {}).get(ym)
    if not r: return None
    hi = r["rev_max_cny"] if r.get("rev_max_cny") is not None else r["rev_min_cny"]
    return {"lo": r["rev_min_cny"], "hi": hi, "metric": r.get("metric_cn"), "conf": r.get("confidence"),
            "mihoyo": bool(r.get("excludes_mihoyo_payment_center"))}

EXTRACT = r"""
async (tag) => {
  await selectGame(tag, true);
  for (let i = 0; i < 200 && !(state.tag === tag && state.data && state.monthly); i++) await new Promise(r => setTimeout(r, 50));
  const ver = b => { try { return versionOf(b); } catch (e) { return null; } };
  const g = (state.qimai && state.qimai.games && state.qimai.games[tag]) || null;
  const real = state.data.banners.filter(b => !b._synthetic && !b.pending);
  const banners = real.map(b => {
    const qm = bannerQimai(b), cn = (typeof cnRunSeries === "function" && cnRunSeries(b)) || [];
    return { i: b._i, name: b.name, en: b.en || "", agents: b.agents || [], leads: b.leads || [],
      rerun: !!b.rerun, ongoing: !!b.ongoing, start: b.start, end: b.end, rev: b.rev,
      rank: b._rank, year: b.year, yrank: b.yrank, ytot: b.ytot, version: ver(b),
      img: b.banner_img || "", icons: b.icons || [], color: barColor(b),
      // the art's face point (the Compare collage's own lookup: manual override, else the detector's)
      face: (() => { const f = typeof cmpFace === "function" && cmpFace(tag, b.name, b.banner_img); return f ? [f.x, f.y] : null; })(),
      jp: jpOwn(b),                       // the banner's own Japan chart days (a mid-run launch takes the rest)
      cn: cn.map(d => [d.iso, d.rank, d.best]),
      jpd: (() => { const bd = dailyBreakdown(b); return bd ? bd.days.map(d => Math.round(d.add * 1e4) / 1e4) : []; })(),
      qmd: (qm.daily || []).map(v => Math.round(v || 0)),
      qm: { total: qm.total || 0, monthly: Object.fromEntries((qm.months || []).map(m => [m.ym, m.rev])), start: qm.start || null },
      qmRank: (typeof qimaiRankInfo === "function" && qimaiRankInfo(b)) || null,
      // the day-indexed series the tracker's Compare (bannerSnapshot -> buildComparison) works on --
      // the site's own cmpSeries, so a rank lifted by a mid-run launch is flagged the same way
      snap: cmpSeries(b) };
  });
  const monthly = {};
  for (const ym in state.monthly) monthly[ym] = { ours: state.monthly[ym].ours, banners: state.monthly[ym].banners.map(x => [x.i, x.rev]) };
  return { tag, jpname: state.data.jp, unit: state.data.unit, source: state.data.banners_from,
    giMonthly: state.data.monthly || {}, monthly, qimai: g ? (g.monthly || {}) : {}, qimaiLast: g ? g.last : null,
    count: real.length, banners };
}
"""

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

# The tracker's head-to-head, run on two banners cut to their days inside the month. Sensor Tower
# and the CN monthly layer are off: they're whole-run monthly figures (and ST isn't used on the site).
H2H = r"""
async (pairs) => {
  state.compare = state.compare || { picks: [], sources: {} };
  state.compare.sources = { gamei: true, qimai: true, st: false, cn: false, jp: true, cnrank: true };
  // Margin-weighted scoring (the tracker's Compare counts 1 point per measure won; here a win is
  // worth more the bigger it is, with diminishing returns): revenue and rank measures score the log
  // of the ratio, a 2x lead or more = the full point. A China measure the other side can't have
  // (game not sold in China) is worth HALF a point: NO_CHINA_W below. Rank days another banner's launch lifted already
  // count at the banner's own pace (cmpSeries / deBoost on the site).
  //
  // Day counts (days at #1, in the top 3 / top 10, the day it left the top 200) score by RARITY:
  // the share of comparable banners that sit between the two -- every tracked banner that started
  // within a year either side of the pair, cut to the same number of days. One day at China's #1
  // against none is nearly a full point (3% of 2025-26 banners got there), four days in the top 10
  // against one is worth what separates them. A flat "days / a third of the window" scored those
  // the same as any other day.
  const LN2 = Math.log(2);
  const ratioW = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return hi <= 0 ? 0 : lo <= 0 ? 1 : Math.min(1, Math.log(hi / lo) / LN2); };
  const COUNT = /_(top1|top3|top10|drop)$/;
  if (!window._cntRuns) {                 // every banner's series, once, from every game
    const runs = [];
    for (const g of state.games) {
      const ctx = await loadCtx(g.game);
      withCtx(ctx, () => { for (const b of ctx.data.banners) { if (b._synthetic || b.pending) continue;
        try { const x = cmpSeries(b); runs.push({ t: Date.parse(b.start), x }); } catch (e) {} } });
    }
    window._cntRuns = runs; window._cntCache = {};
  }
  // the reference values of one count measure at window k
  const ref = (metric, k) => {
    const key = metric + "|" + k; if (window._cntCache[key]) return window._cntCache[key];
    const cn = metric.startsWith("cnr_"), f = metric.split("_")[1], out = [];
    for (const r of window._cntRuns) { const x = r.x, arr = cn ? x.cn : x.jp; if (!arr || arr.length < k) continue;
      const st = cn ? cmpRankStats(arr, k, x.cnKnown, x.cnBest, 0, x.cnBoost) : cmpRankStats(arr, k, null, null, 1, x.jpBoost);
      if (st.none) continue;
      out.push({ t: r.t, v: f === "drop" ? (st.droppedOut ? st.heldDays : k + 1) : st[f] }); }
    return (window._cntCache[key] = out);
  };
  const DAY = 864e5, YEAR = 365 * DAY;
  const rarity = (metric, k, lo, hi, mid) => {
    let R = ref(metric, k).filter(r => Math.abs(r.t - mid) <= YEAR);
    if (R.length < 30) R = ref(metric, k);
    if (!R.length) return Math.min(1, (hi - lo) / Math.max(1, k / 3));
    return R.filter(r => r.v >= lo && r.v < hi).length / R.length;
  };
  // per-source weights (build_journal.py --weights; all 1 by default): gamei/jp = Japan, qimai/cnrank = China
  const WT = window._W || {}, wt = src => WT[src] ?? 1;
  // A game not sold in China (Umamusume) vs one that is: the China measures count at half weight
  // for that pair (user rule, Nov 2026). In full, Uma could never win a month despite topping Japan;
  // left out entirely, every pair became "who did best in Japan" and Uma took 32 of 74 months.
  const NO_CHINA_W = 0.5;
  return pairs.map(([a, b]) => { const R = buildComparison([a, b]), E = [a, b], pts = [0, 0];
    const mid = (Date.parse(a.start) + Date.parse(b.start)) / 2;
    for (const r of R.rows) {
      if (r.unscored) continue;
      const w8 = wt(r.src) * ((r.src === "qimai" || r.src === "cnrank") && (E[0].noChina || E[1].noChina) ? NO_CHINA_W : 1);
      const v = r.cells.map(c => c.v);
      if (v[0] == null || v[1] == null) {
        if ((r.src === "qimai" || r.src === "cnrank") && (v[0] != null) !== (v[1] != null) && E[v[0] != null ? 1 : 0].noChina) pts[v[0] != null ? 0 : 1] += w8;
        continue;
      }
      if (v[0] === v[1]) continue;
      const w = r.better === "high" ? (v[0] > v[1] ? 0 : 1) : (v[0] < v[1] ? 0 : 1);
      pts[w] += w8 * (COUNT.test(r.metric) ? rarity(r.metric, r.k || 1, Math.min(v[0], v[1]), Math.max(v[0], v[1]), mid) : ratioW(v[0], v[1]));
    }
    const overall = Math.abs(pts[0] - pts[1]) < 1e-9 ? "even" : pts[0] > pts[1] ? 0 : 1;
    return { points: pts.map(x => Math.round(x * 100) / 100), overall }; });
}
"""
SITE = {}

def open_site():
    from playwright.sync_api import sync_playwright
    srv = serve(); pw = sync_playwright().start(); br = pw.chromium.launch(); pg = br.new_page()
    pg.goto(f"http://127.0.0.1:{srv.server_address[1]}/index.html", wait_until="networkidle")
    pg.wait_for_function("typeof state!=='undefined' && state.data && state.data.banners && state.qimai!==undefined")
    SITE.update(srv=srv, pw=pw, br=br, pg=pg)

def close_site():
    SITE["br"].close(); SITE["pw"].stop(); SITE["srv"].shutdown()

def extract():
    pg = SITE["pg"]; games = {}
    for t in pg.evaluate("state.games.map(g=>g.game)"):
        games[t] = pg.evaluate(EXTRACT, t)
        print(f"  {t}: {games[t]['count']} banners", file=sys.stderr)
    return games

def ym_of(d): return d[:7]
def days_in(ym):
    y, m = map(int, ym.split("-"))
    nxt = datetime.date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - datetime.date(y, m, 1)).days
THIS_YM = datetime.date.today().strftime("%Y-%m")
def next_ym(ym):
    y, m = map(int, ym.split("-"))
    return f"{y + (m == 12)}-{m % 12 + 1:02d}"
def prev_ym(ym):
    y, m = map(int, ym.split("-"))
    return f"{y - (m == 1)}-{(m - 2) % 12 + 1:02d}"
def label(b): return " & ".join(b["agents"]) if b["agents"] else (b["en"] or b["name"])

def month_start(ym): return datetime.date.fromisoformat(ym + "-01")
def run_end(b):
    """Last day the run counts for: its end date, or today while it is still running."""
    e = datetime.date.fromisoformat(b["end"]) if b.get("end") else datetime.date.today()
    return min(e, datetime.date.today())
def run_days(b): return (run_end(b) - datetime.date.fromisoformat(b["start"])).days + 1
def month_days(b, ym):
    """How many days of month ym the banner actually ran (a Sep 28 opener has 3 September days)."""
    a = max(datetime.date.fromisoformat(b["start"]), month_start(ym))
    z = min(run_end(b), month_start(ym) + datetime.timedelta(days=days_in(ym) - 1))
    return max(0, (z - a).days + 1)

def jp_peak(b, ym=None):
    """Best (lowest) Japan iOS grossing rank on the run's days — inside month ym if given."""
    s0 = datetime.date.fromisoformat(b["start"]); best = None; day = None
    for i, r in enumerate(b["jp"]):
        if r is None or r <= 0: continue
        d = (s0 + datetime.timedelta(days=i)).isoformat()
        if ym and ym_of(d) != ym: continue
        if best is None or r < best: best, day = r, d
    return best, day

def cn_peak(b, ym=None):
    best = None; day = None
    for iso, r, bst in b["cn"]:
        v = bst if bst is not None else r
        if v is None or (ym and ym_of(iso) != ym): continue
        if best is None or v < best: best, day = v, iso
    return best, day

def month_total(G, ym):
    """Japan month total: game-i's own monthly figure, else the sum of banner figures (older months)."""
    v = G["giMonthly"].get(ym)
    if v: return v, "game-i"
    m = G["monthly"].get(ym)
    return (m["ours"], "banners") if m and m["ours"] > 0 else (None, None)

# A banner's standing is the MEDIAN of its ranks across every source's measures, not Japan revenue
# alone: a banner that wins China revenue and both peak ranks beats one that only edged Japan.
MONTH_KEYS = [("rev_month", False), ("cn_month", False), ("jp_peak", True), ("cn_peak", True)]   # (field, lower is better)

def combined_order(rows, keys):
    """Rank rows on each measure (ties share a rank; no value = last), then sort by the median rank,
    the mean rank, and Japan revenue. Measures nobody has a value for (e.g. China for a game not
    released there) are left out. Writes r["mranks"] {field: rank} and r["score"] (the median)."""
    used = []
    for k, low in keys:
        have = [r[k] for r in rows if r[k]]
        if not have: continue
        used.append(k)
        for r in rows:
            v = r[k]
            r.setdefault("mranks", {})[k] = (1 + sum(1 for x in have if (x < v if low else x > v))) if v else len(have) + 1
    for r in rows:
        rk = sorted(r.get("mranks", {}).get(k, 1) for k in used) or [1]
        n = len(rk); r["score"] = (rk[(n - 1) // 2] + rk[n // 2]) / 2; r["_mean"] = sum(rk) / n
    rows.sort(key=lambda r: (r["score"], r.pop("_mean"), -(r[keys[0][0]] or 0)))
    return used

import math
def ratio_w(x, y):
    lo, hi = min(x, y), max(x, y)
    return 0 if hi <= 0 else 1 if lo <= 0 else min(1, math.log(hi / lo) / math.log(2))

def mw_order(rows, keys):
    """A game's banners ranked head to head on the month's four figures (Japan and China revenue,
    Japan and China peak), each win worth more the bigger it is: the log of the ratio, a 2x lead
    or more = a full point. A missing value loses the measure in full; a measure no banner has is
    left out. Order = head-to-heads won, then their own head-to-head, then points."""
    used = [(k, low) for k, low in keys if any(r[k] for r in rows)]
    k = len(rows); res = {}; pts_tot = [0.0] * k
    for i in range(k):
        for j in range(i + 1, k):
            a, b = rows[i], rows[j]; pa = pb = 0.0
            for key, low in used:
                x, y = a[key], b[key]
                if not x and not y: continue
                if not y: pa += 1; continue
                if not x: pb += 1; continue
                if x == y: continue
                w = ratio_w(x, y)
                if (x < y) == low: pa += w
                else: pb += w
            pts_tot[i] += pa; pts_tot[j] += pb
            res[(i, j)] = "a" if pa > pb + 1e-9 else "b" if pb > pa + 1e-9 else ("a" if (a["rev_month"] or 0) >= (b["rev_month"] or 0) else "b")
    wins = [0] * k
    for (i, j), w in res.items(): wins[i if w == "a" else j] += 1
    def cmp(i, j):
        if wins[i] != wins[j]: return wins[j] - wins[i]
        w = res.get((min(i, j), max(i, j)))
        return (-1 if (w == "a") == (i < j) else 1) if w else 0
    order = sorted(range(k), key=functools.cmp_to_key(cmp))
    for i in range(k): rows[i]["beat"] = [wins[i], k - 1]
    rows[:] = [rows[i] for i in order]

def game_month(G, ym):
    by_i = {b["i"]: b for b in G["banners"]}
    jp, jp_src = month_total(G, ym)
    pj, _ = month_total(G, prev_ym(ym))
    q = G["qimai"].get(ym) or {}; pq = G["qimai"].get(prev_ym(ym)) or {}
    cn = q.get("qtot") or None; pcn = pq.get("qtot") or None
    rows = []
    for i, rev in (G["monthly"].get(ym) or {}).get("banners", []):
        b = by_i.get(i)
        if not b: continue
        jpk, jpd = jp_peak(b, ym); cnk, cnd = cn_peak(b, ym)
        jpa, _ = jp_peak(b); cna, _ = cn_peak(b)
        # a banner that opened on a month's last day or two (Hsin, Sep 30) is that month's carry-over
        # in the NEXT issue instead: it counts as the next month's opening, measured from its first day
        first = ym_of(b["start"]); moved = month_days(b, first) < MIN_DUEL_DAYS and next_ym(first) < THIS_YM
        open_ym = next_ym(first) if moved else first
        d0 = max(0, (month_start(ym) - datetime.date.fromisoformat(b["start"])).days); dm = month_days(b, ym)
        from_start = moved and ym == open_ym
        rows.append({"label": label(b), "name": b["name"], "rerun": b["rerun"], "new": ym == open_ym,
                     "w0": 0 if from_start else d0, "wdays": d0 + dm if from_start else dm,
                     "start": b["start"], "end": b["end"], "ongoing": b["ongoing"], "version": b["version"],
                     "rev_month": round(rev, 4), "rev_total": b["rev"], "cn_month": round(b["qm"]["monthly"].get(ym, 0)),
                     "cn_total": round(b["qm"]["total"]), "jp_peak": jpk, "jp_peak_day": jpd, "cn_peak": cnk, "cn_peak_day": cnd,
                     "jp_peak_run": jpa, "cn_peak_run": cna,
                     "alltime": [b["rank"], G["count"]], "year_rank": [b["yrank"], b["ytot"]] if b["yrank"] else None,
                     "cn_alltime": [b["qmRank"]["rank"], b["qmRank"]["of"]] if b["qmRank"] else None,
                     "days": month_days(b, ym), "run_days": run_days(b), "day0": max(0, (month_start(ym) - datetime.date.fromisoformat(b["start"])).days),
                     "jp_daily": b["jpd"], "cn_daily": b["qmd"],
                     # daily chart ranks, for the openings' equal-window head-to-heads (not written out)
                     "_snap": b["snap"],
                     "img": b["img"], "face": b["face"], "icons": b["icons"], "color": b["color"], "agents": b["agents"],
                     **dict(zip(("art", "art_face"), splash_of(G["tag"], b["icons"])))})
    if not rows and not jp and not cn: return None
    used = combined_order(rows, MONTH_KEYS)        # per-measure ranks (the stars and the copy)
    mw_order(rows, MONTH_KEYS)                      # the order itself: margin-weighted head to head
    # how this month sits in the game's own history (Japan, game-i months only)
    gi = {k: v for k, v in G["giMonthly"].items() if v and k <= ym}
    hist = None
    if jp_src == "game-i" and len(gi) >= 3:
        ordered = sorted(gi.values(), reverse=True)
        best_since = next((k for k in sorted(gi, reverse=True) if k < ym and gi[k] >= jp), None)
        low_since = next((k for k in sorted(gi, reverse=True) if k < ym and gi[k] <= jp), None)
        hist = {"rank": ordered.index(jp) + 1, "of": len(ordered), "best_since": best_since, "low_since": low_since,
                "first": min(gi)}
    # what came next: the first banners to open after this month (the latest issue gets the
    # announced ones from data/journal/upcoming.json instead, since the data has no future banners)
    m_end = (month_start(ym) + datetime.timedelta(days=days_in(ym) - 1)).isoformat()
    nxt = [{"label": label(b), "start": b["start"], "end": b["end"], "rerun": b["rerun"], "img": b["img"], "face": b["face"],
            **dict(zip(("art", "art_face"), splash_of(G["tag"], b["icons"]))),
            "icons": b["icons"], "color": b["color"]}
           for b in sorted(G["banners"], key=lambda b: b["start"]) if b["start"] > m_end][:2]
    zl, zlp = zl_of(G["tag"], ym), zl_of(G["tag"], prev_ym(ym))
    return {"tag": G["tag"], "name": NAMES.get(G["tag"], G["tag"]), "jpname": G["jpname"], "next": nxt, "zl": zl, "zl_prev": zlp,
            "icon": f"icons/games/{G['tag']}.png", "jp": jp, "jp_src": jp_src, "jp_prev": pj,
            "cn": cn, "cn_prev": pcn, "cn_partial": bool(G["qimaiLast"] and G["qimaiLast"][:7] == ym and int(G["qimaiLast"][8:]) < days_in(ym)),
            "hist": hist, "measures": used, "banners": rows}

# The month's openings are compared fairly on time, with the tracker's own head-to-head: each PAIR
# is cut to the same number of days — the shorter of the two runs inside the month (Phoenix had 11
# October days, Si 17, so both are read at day 11) — and scored by buildComparison on every measure
# the tracker's Compare uses (game-i and Qimai revenue: total, best-rank day, first week; Japan and
# China rank: peak, days at #1 / top 3 / top 10, median, day it left the top 200, decay). The side
# with more points wins; an even result goes to the bigger combined revenue over the window (Japan
# yen + China iPhone dollars at USD_JPY). A game not sold in China counts as $0 and below #200 there,
# with the China measures at half weight in its pairs (NO_CHINA_W in H2H).
# Banners are then ordered by head-to-heads won.
USD_JPY = 150            # fixed rate for the even-result tie-break only
MIN_DUEL_DAYS = 3        # fewer days in the month than this: listed as too new to rank, not ranked
NO_CHINA = set()         # games with no Qimai data at all (not sold in China)

def entity(r, n):
    """The banner's Compare snapshot cut to n days, starting at its first day INSIDE the month
    (day 1 for an opening; a carry-over starts mid-run, so its in-month days are compared)."""
    s, o = r["_snap"], r["w0"]; cut = lambda a: a[o:o + n] if a else None
    gi = s["gi"][o:o + n]; base = gi[0]["cum"] - gi[0]["add"] if gi else 0
    e = {"label": r["label"], "name": r["label"], "rev": r["rev_total"], "scheduled": r["run_days"],
         "ongoing": r["ongoing"], "runDays": n, "jp": s["jp"][o:o + n],
         "gi": [{"add": d["add"], "cum": d["cum"] - base} for d in gi],     # the running total restarts at the window
         "qmDaily": s["qmDaily"][o:o + n], "hasQm": s["hasQm"],
         "cn": cut(s["cn"]), "cnKnown": cut(s["cnKnown"]), "cnBest": cut(s["cnBest"]),
         "jpBoost": cut(s.get("jpBoost")), "cnBoost": cut(s.get("cnBoost")), "start": r["start"]}
    if r["tag"] in NO_CHINA:
        e.update(cn=[None] * n, cnKnown=[True] * n, cnBest=[None] * n, cnBoost=None, qmDaily=[0] * n, hasQm=True, noChina=True)
    return e

def duel_order(rows):
    """Sort rows in place by head-to-heads won (ties: their own head-to-head, then Japan revenue per
    day). Writes r["beat"] = [wins, opponents]. Banners with fewer than MIN_DUEL_DAYS days in the
    month go last, unranked: a day of data isn't enough to judge an opening."""
    late = [r for r in rows if r["wdays"] < MIN_DUEL_DAYS]
    for r in late: r["beat"] = None
    rows[:] = [r for r in rows if r["wdays"] >= MIN_DUEL_DAYS]
    k = len(rows)
    pairs = [(i, j) for i in range(k) for j in range(i + 1, k)]
    out = SITE["pg"].evaluate(H2H, [[entity(rows[i], min(rows[i]["wdays"], rows[j]["wdays"])),
                                     entity(rows[j], min(rows[i]["wdays"], rows[j]["wdays"]))] for i, j in pairs]) if pairs else []
    res = {}
    for (i, j), R in zip(pairs, out):
        if R["overall"] in (0, 1): win = "a" if R["overall"] == 0 else "b"
        else:
            n = min(rows[i]["wdays"], rows[j]["wdays"])
            tot = lambda r: sum(r["jp_daily"][r["w0"]:r["w0"] + n]) * 1e8 + sum(r["cn_daily"][r["w0"]:r["w0"] + n]) * USD_JPY
            win = "a" if tot(rows[i]) >= tot(rows[j]) else "b"
        res[(i, j)] = win
    wins = [0] * k
    for (i, j), w in res.items(): wins[i if w == "a" else j] += 1
    def cmp(i, j):
        if wins[i] != wins[j]: return wins[j] - wins[i]
        w = res.get((min(i, j), max(i, j)))
        if w: return -1 if (w == "a") == (i < j) else 1
        return 0
    order = sorted(range(k), key=functools.cmp_to_key(cmp))
    for i in range(k): rows[i]["beat"] = [wins[i], k - 1]
    note = None
    if k >= 2:                      # #1 vs #2 over their shared window, for the note under the grid
        a, b = rows[order[0]], rows[order[1]]; n = min(a["wdays"], b["wdays"])
        w = lambda r: {"label": r["label"], "tag": r["tag"], "days": r["days"], "new": r["new"],
                       "jp": round(sum(r["jp_daily"][r["w0"]:r["w0"] + n]), 4), "cn": round(sum(r["cn_daily"][r["w0"]:r["w0"] + n]))}
        note = {"n": n, "a": w(a), "b": w(b)}
    rows[:] = [rows[i] for i in order] + late
    return note

def market_series(games):
    """{ym: {"jp": {tag: oku}, "cn": {tag: usd}, "zl": {tag: cny midpoint}}} for every month any source covers."""
    out = {}
    for t, G in games.items():
        for ym in set(G["giMonthly"]) | set(G["monthly"]):
            v, _ = month_total(G, ym)
            if v: out.setdefault(ym, {}).setdefault("jp", {})[t] = v
        for ym, q in G["qimai"].items():
            if q.get("qtot"): out.setdefault(ym, {}).setdefault("cn", {})[t] = q["qtot"]
        for ym in ZL.get(t, {}):
            z = zl_of(t, ym)
            if z: out.setdefault(ym, {}).setdefault("zl", {})[t] = (z["lo"] + z["hi"]) / 2
    return out

def market(series, ym):
    """The month's totals per source: total, change on last month over the games present in both
    (so a launch doesn't read as growth), games up / down, the biggest movers, and where the
    month ranks among this year's months so far."""
    out = {}
    pm = prev_ym(ym)
    for key in ("jp", "cn", "zl"):
        cur = (series.get(ym) or {}).get(key) or {}
        if not cur:
            out[key] = None; continue
        prev = (series.get(pm) or {}).get(key) or {}
        common = [t for t in cur if t in prev]
        chg = {t: cur[t] / prev[t] - 1 for t in common if prev[t] > 0}
        yr = {m: sum(((series.get(m) or {}).get(key) or {}).values()) for m in series
              if m[:4] == ym[:4] and m <= ym and ((series.get(m) or {}).get(key))}
        total = sum(cur.values())
        ranked = sorted(yr.values(), reverse=True)
        out[key] = {"total": total, "n": len(cur),
                    "same": sum(cur[t] for t in common), "same_prev": sum(prev[t] for t in common), "same_n": len(common),
                    "down": sorted([t for t in chg if chg[t] < 0], key=lambda t: chg[t]),
                    "up": sorted([t for t in chg if chg[t] > 0], key=lambda t: -chg[t]),
                    "chg": {t: round(v, 4) for t, v in chg.items()},
                    "year_rank": ranked.index(total) + 1, "year_n": len(ranked)}
    if out.get("zl"):
        lo = sum(z["lo"] for z in (zl_of(t, ym) for t in ZL) if z); hi = sum(z["hi"] for z in (zl_of(t, ym) for t in ZL) if z)
        out["zl"].update({"lo": lo, "hi": hi, "video": ZL_VIDEO.get(ym)})
    latest_zl = max((m for t in ZL for m in ZL[t]), default=None)
    out["zl_pending"] = out.get("zl") is None and latest_zl is not None and ym > latest_zl
    return out

def build_issue(games, ym, number, series):
    gm = [x for x in (game_month(G, ym) for G in games.values()) if x]
    if not gm: return None
    def rank_by(key):
        have = sorted([g for g in gm if g[key]], key=lambda g: -g[key])
        for n, g in enumerate(have, 1): g[f"{key}_rank"] = [n, len(have)]
    rank_by("jp"); rank_by("cn")
    order = sorted(gm, key=lambda g: (g["tag"] not in FEATURED, -(g["jp"] or 0)))
    new = [{**{k: v for k, v in r.items() if k not in ("mranks", "score")}, "tag": g["tag"], "game": g["name"]}
           for g in gm for r in g["banners"] if r["new"]]
    # new banners are ranked on what they did inside this month (user rule), head to head over
    # equal numbers of days, so a late opener isn't measured against a rival's longer run
    top_pair = duel_order(new)
    debuts = new
    # cover star: the month's #1 opening (with art), whatever game it's from
    pool = [r for r in debuts if (r["img"] or r.get("art")) and r.get("beat")] or [r for r in debuts if r["img"] or r.get("art")] \
           or [dict(r, tag=g["tag"], game=g["name"]) for g in gm for r in g["banners"] if r["img"]]
    cover = pool[0] if pool else None
    # the month's top banners across every game, new or not, by the same head-to-head as the
    # openings — but every banner on its days INSIDE the month (a last-day opener moved into this
    # month's openings is still measured here from the 1st, like any carry-over)
    allb = [{**{k: v for k, v in r.items() if k not in ("mranks", "score")}, "tag": g["tag"], "game": g["name"],
             "w0": r["day0"], "wdays": r["days"]} for g in gm for r in g["banners"]]
    top_note = duel_order(allb)
    top = [{k: r[k] for k in ("label", "tag", "game", "new", "rerun", "rev_month", "cn_month", "jp_peak", "cn_peak", "days",
                              "img", "face", "art", "art_face", "icons", "color", "start", "end", "beat")} for r in allb if r["beat"]][:10]
    for g in gm:                                      # the daily ranks were only needed for the duels
        for r in g["banners"]: r.pop("_jpr", None); r.pop("_cnr", None); r.pop("_snap", None)
    return {"ym": ym, "number": number, "built": datetime.date.today().isoformat(), "top": top, "market": market(series, ym), "top_pair": top_pair, "top_note": top_note,
            "cover": cover and {k: cover[k] for k in ("label", "tag", "game", "img", "face", "art", "art_face", "color", "rev_month", "rerun")},
            "debuts": [{k: r[k] for k in ("label", "tag", "game", "rev_month", "cn_month", "jp_peak", "cn_peak", "days", "rev_total", "rerun", "ongoing", "img", "face", "art", "art_face", "icons", "color", "start", "beat")} for r in debuts],
            "games": order}

DRY = {}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--month", default="", help="build only this YYYY-MM (the index is always rebuilt)")
    ap.add_argument("--weights", default="", help="what-if head-to-head weights, e.g. gamei=1.2,jp=1.2 (sources: gamei jp qimai cnrank)")
    ap.add_argument("--dry", default="", help="write nothing; dump each issue's order to this JSON file (for what-if runs)")
    a = ap.parse_args()
    for s in (sys.stdout, sys.stderr):
        try: s.reconfigure(encoding="utf-8", errors="replace")
        except Exception: pass
    open_site()
    if a.weights:
        SITE["pg"].evaluate("w => { window._W = w; }", {k: float(v) for k, v in (x.split("=") for x in a.weights.split(","))})
    games = extract()
    NO_CHINA.update(t for t, G in games.items() if not G["qimai"])
    load_zl(); series = market_series(games)
    hp = OUT / "hsr_art.json"
    if hp.exists(): HSR_ART.update(json.loads(hp.read_text(encoding="utf-8")))
    this = datetime.date.today().strftime("%Y-%m")
    months = sorted({ym for G in games.values() for ym in list(G["monthly"]) + [k for k, v in G["giMonthly"].items() if v]
                     if ym < this})
    OUT.mkdir(parents=True, exist_ok=True); (OUT / "notes").mkdir(exist_ok=True)
    index = []
    for n, ym in enumerate(months, 1):
        f = OUT / f"{ym}.json"
        if a.month and ym != a.month and f.exists():
            iss = json.loads(f.read_text(encoding="utf-8"))
        else:
            iss = build_issue(games, ym, n, series)
            if not iss: continue
            if a.dry:
                DRY[ym] = {"cover": (iss["cover"] or {}).get("label"),
                           "debuts": [[d["label"], d.get("beat")] for d in iss["debuts"]],
                           "top": [[d["label"], d.get("beat")] for d in iss["top"]]}
                continue
            f.write_text(json.dumps(iss, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        notes = OUT / "notes" / f"{ym}.json"
        hl = json.loads(notes.read_text(encoding="utf-8")).get("headline") if notes.exists() else None
        index.append({"ym": ym, "number": iss["number"], "cover": iss["cover"], "headline": hl,
                      "games": [g["tag"] for g in iss["games"]], "written": notes.exists()})
    if a.dry:
        pathlib.Path(a.dry).write_text(json.dumps(DRY, ensure_ascii=False), encoding="utf-8"); close_site()
        print(f"dry run: {len(DRY)} issues -> {a.dry}"); return
    (OUT / "index.json").write_text(json.dumps({"built": datetime.date.today().isoformat(), "issues": index[::-1]},
                                               ensure_ascii=False, indent=1), encoding="utf-8")
    close_site()
    print(f"{len(index)} issues -> {OUT}")

if __name__ == "__main__":
    main()

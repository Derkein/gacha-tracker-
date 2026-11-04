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
import argparse, datetime, functools, http.server, json, pathlib, sys, threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "journal"
NAMES = {"genshin": "Genshin Impact", "hsr": "Honkai: Star Rail", "zzz": "Zenless Zone Zero",
         "wuwa": "Wuthering Waves", "nte": "Neverness to Everness", "endfield": "Arknights: Endfield",
         "uma": "Umamusume: Pretty Derby", "czn": "Chaos Zero Nightmare", "stellasora": "Stella Sora",
         "lads": "Love and Deepspace"}
# the six the audience follows lead every issue; the rest follow in revenue order
FEATURED = ["genshin", "hsr", "zzz", "wuwa", "endfield", "nte"]

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
      jp: b.rank_series || [],
      cn: cn.map(d => [d.iso, d.rank, d.best]),
      qm: { total: qm.total || 0, monthly: Object.fromEntries((qm.months || []).map(m => [m.ym, m.rev])), start: qm.start || null },
      qmRank: (typeof qimaiRankInfo === "function" && qimaiRankInfo(b)) || null };
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

def extract():
    from playwright.sync_api import sync_playwright
    srv = serve()
    url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    games = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        pg = br.new_page()
        pg.goto(url, wait_until="networkidle")
        pg.wait_for_function("typeof state!=='undefined' && state.data && state.data.banners && state.qimai!==undefined")
        tags = pg.evaluate("state.games.map(g=>g.game)")
        for t in tags:
            games[t] = pg.evaluate(EXTRACT, t)
            print(f"  {t}: {games[t]['count']} banners", file=sys.stderr)
        br.close()
    srv.shutdown()
    return games

def ym_of(d): return d[:7]
def days_in(ym):
    y, m = map(int, ym.split("-"))
    nxt = datetime.date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - datetime.date(y, m, 1)).days
def prev_ym(ym):
    y, m = map(int, ym.split("-"))
    return f"{y - (m == 1)}-{(m - 2) % 12 + 1:02d}"
def label(b): return " & ".join(b["agents"]) if b["agents"] else (b["en"] or b["name"])

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
        rows.append({"label": label(b), "name": b["name"], "rerun": b["rerun"], "new": ym_of(b["start"]) == ym,
                     "start": b["start"], "end": b["end"], "ongoing": b["ongoing"], "version": b["version"],
                     "rev_month": round(rev, 4), "rev_total": b["rev"], "cn_month": round(b["qm"]["monthly"].get(ym, 0)),
                     "cn_total": round(b["qm"]["total"]), "jp_peak": jpk, "jp_peak_day": jpd, "cn_peak": cnk, "cn_peak_day": cnd,
                     "jp_peak_run": jpa, "cn_peak_run": cna,
                     "alltime": [b["rank"], G["count"]], "year_rank": [b["yrank"], b["ytot"]] if b["yrank"] else None,
                     "cn_alltime": [b["qmRank"]["rank"], b["qmRank"]["of"]] if b["qmRank"] else None,
                     "img": b["img"], "face": b["face"], "icons": b["icons"], "color": b["color"], "agents": b["agents"]})
    if not rows and not jp and not cn: return None
    rows.sort(key=lambda r: (-(r["rev_month"] or 0), -(r["cn_month"] or 0)))
    # how this month sits in the game's own history (Japan, game-i months only)
    gi = {k: v for k, v in G["giMonthly"].items() if v and k <= ym}
    hist = None
    if jp_src == "game-i" and len(gi) >= 3:
        ordered = sorted(gi.values(), reverse=True)
        best_since = next((k for k in sorted(gi, reverse=True) if k < ym and gi[k] >= jp), None)
        low_since = next((k for k in sorted(gi, reverse=True) if k < ym and gi[k] <= jp), None)
        hist = {"rank": ordered.index(jp) + 1, "of": len(ordered), "best_since": best_since, "low_since": low_since,
                "first": min(gi)}
    return {"tag": G["tag"], "name": NAMES.get(G["tag"], G["tag"]), "jpname": G["jpname"],
            "icon": f"icons/games/{G['tag']}.png", "jp": jp, "jp_src": jp_src, "jp_prev": pj,
            "cn": cn, "cn_prev": pcn, "cn_partial": bool(G["qimaiLast"] and G["qimaiLast"][:7] == ym and int(G["qimaiLast"][8:]) < days_in(ym)),
            "hist": hist, "banners": rows}

def build_issue(games, ym, number):
    gm = [x for x in (game_month(G, ym) for G in games.values()) if x]
    if not gm: return None
    def rank_by(key):
        have = sorted([g for g in gm if g[key]], key=lambda g: -g[key])
        for n, g in enumerate(have, 1): g[f"{key}_rank"] = [n, len(have)]
    rank_by("jp"); rank_by("cn")
    order = sorted(gm, key=lambda g: (g["tag"] not in FEATURED, -(g["jp"] or 0)))
    new = [dict(r, tag=g["tag"], game=g["name"]) for g in gm for r in g["banners"] if r["new"]]
    # cover star: the month's biggest new banner with art, from the six featured games when one opened
    cover = max(new or [dict(r, tag=g["tag"], game=g["name"]) for g in gm for r in g["banners"]] or [None],
                key=lambda r: (r is not None and r["img"] != "", r is not None and r["tag"] in FEATURED, r and (r["rev_month"] or 0)), default=None)
    # a banner opening on the month's last days barely shows up; rank new banners by their own run
    debuts = sorted(new, key=lambda r: -(r["rev_total"] or 0))
    return {"ym": ym, "number": number, "built": datetime.date.today().isoformat(),
            "cover": cover and {k: cover[k] for k in ("label", "tag", "game", "img", "face", "color", "rev_month", "rerun")},
            "debuts": [{k: r[k] for k in ("label", "tag", "game", "rev_total", "jp_peak_run", "cn_peak_run", "rerun", "ongoing", "img", "face", "icons", "color", "start")} for r in debuts],
            "games": order}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--month", default="", help="build only this YYYY-MM (the index is always rebuilt)")
    a = ap.parse_args()
    for s in (sys.stdout, sys.stderr):
        try: s.reconfigure(encoding="utf-8", errors="replace")
        except Exception: pass
    games = extract()
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
            iss = build_issue(games, ym, n)
            if not iss: continue
            f.write_text(json.dumps(iss, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        notes = OUT / "notes" / f"{ym}.json"
        hl = json.loads(notes.read_text(encoding="utf-8")).get("headline") if notes.exists() else None
        index.append({"ym": ym, "number": iss["number"], "cover": iss["cover"], "headline": hl,
                      "games": [g["tag"] for g in iss["games"]], "written": notes.exists()})
    (OUT / "index.json").write_text(json.dumps({"built": datetime.date.today().isoformat(), "issues": index[::-1]},
                                               ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(index)} issues -> {OUT}")

if __name__ == "__main__":
    main()

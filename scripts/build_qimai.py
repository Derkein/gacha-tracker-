#!/usr/bin/env python3
"""Build data/qimai.json — per-banner China-iPhone revenue from Qimai's daily figures.

Qimai gives one China-iPhone gross figure per GAME per day (USD, App Store, model
estimate). This attributes each day's game total to the banners running that day, split
in proportion to game-i's reconstructed daily revenue for each (equal split if none of
the running banners is on game-i's JP chart that day; 100% to a solo banner). So Qimai
sets the daily dollar LEVEL and game-i's daily shape sets the SPLIT between co-runners.

Output per game:
  monthly[ym] = {qtot, attr, base}   # full Qimai month, attributed-to-banners, share denom
  banners[idx] = {total, monthly{ym:rev}, start, daily:[...]}  # idx = banner array index (=_i)
    daily[j] = attributed Qimai revenue on the banner's day j (start + j), aligned to its
               rank_series, so the modal can draw a real day-by-day build-up.

Source daily files: data/qimai_daily/<tag>.json  ({first, daily[]}), one per game.
Run from the gacha-tracker repo root (or anywhere — paths are absolute below).
"""
import json, io, math, datetime, collections, os

GT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # gacha-tracker/
DAILY = os.path.join(GT, "data", "qimai_daily")                      # raw game-total daily lives here
# every game that has BOTH a raw-daily file and a banner file, sorted for stable output
GAMES = sorted(t[:-5] for t in os.listdir(DAILY)
               if t.endswith(".json") and os.path.exists(os.path.join(GT, "data", t)))

# Days the CHINA server runs AHEAD of the global/JP server, per game. game-i tracks the
# global (Japan) banner calendar, but some games run China on an offset schedule, so a
# banner's China revenue lands on DIFFERENT calendar dates than its game-i (global) window.
# We shift each banner's China attribution window back by this many days so the China
# dollars land on the banner's ACTUAL China run, not its global one. 0 = servers in sync
# (HoYo games update every server in one maintenance, so no offset).
#   NTE (异环): CN and global run a deliberate, consistent 6-day offset, CN first
#   (CN launched Apr 23 vs global Apr 29; v1.3 CN Aug 13 vs global Aug 19). Verified 2026-09.
CN_LEAD = {"nte": 6}

RANK_VAL = [[1,5.90],[2,3.47],[3,3.03],[4,2.61],[5,2.03],[10,.9034],[50,.2584],[100,.1640],[200,.10]]
def rankValue(r):
    if r is None: return 0.0
    if r <= RANK_VAL[0][0]: return RANK_VAL[0][1]
    if r >= 200: return RANK_VAL[-1][1]
    for i in range(len(RANK_VAL)-1):
        r0,v0 = RANK_VAL[i]; r1,v1 = RANK_VAL[i+1]
        if r0 <= r <= r1:
            t = (math.log(r)-math.log(r0))/(math.log(r1)-math.log(r0))
            return math.exp(math.log(v0)+t*(math.log(v1)-math.log(v0)))
    return 0.0
def ym(d): return d.strftime("%Y-%m")

def load_qimai(tag):
    r = json.load(io.open(os.path.join(DAILY, f"{tag}.json"), encoding="utf-8"))
    d0 = datetime.date.fromisoformat(r["first"])
    return {d0+datetime.timedelta(days=i): (v or 0) for i,v in enumerate(r["daily"])}

out = {"meta": {"source":"qimai pred/revenue","currency":"USD","country":"cn","device":"iphone",
       "note":"Per-banner China-iPhone revenue. Each day's Qimai game total is split among that "
              "day's running banners in proportion to game-i's reconstructed daily revenue "
              "(equal if none charted in JP). monthly[ym]={qtot,attr,base}; banners[idx]="
              "{total,monthly,start,daily[] aligned to the banner's rank_series days}."},
       "games": {}}

for tag in GAMES:
    data = json.load(io.open(f"{GT}/data/{tag}.json", encoding="utf-8"))
    banners = [b for b in data["banners"] if not b.get("_synthetic")]
    q = load_qimai(tag)
    lead = CN_LEAD.get(tag, 0)   # China server runs this many days ahead of global
    binfo = []
    for idx,b in enumerate(banners):
        s = b.get("rank_series") or []
        start = datetime.date.fromisoformat(b["start"][:10])
        raw = [rankValue(x) for x in s]; tot = sum(raw) or 0
        rev = b.get("rev") or 0
        gid = [(rev*rw/tot) if tot>0 else 0.0 for rw in raw]   # game-i reconstructed daily
        binfo.append({"idx":idx, "start":start, "len":len(s), "gid":gid})
    bmonthly = collections.defaultdict(lambda: collections.defaultdict(float))
    btotal   = collections.defaultdict(float)
    bdaily   = collections.defaultdict(dict)   # idx -> {j: value}
    gm = collections.defaultdict(lambda: {"qtot":0.0, "attr":0.0})
    for d,inc in q.items():
        # MONTHLY buckets use the GLOBAL-equivalent month (China date + lead) so the
        # by-Month view — which lists banners by their game-i/global month — stays complete
        # and consistent: a banner's China revenue lands in the same month its global run
        # is shown under, so the column sums to 100% instead of orphaning revenue whose CN
        # month differs from its global month. The DAILY series (below) stays on true China
        # dates for the banner modal; only the month rollup is re-aligned.
        gmo = ym(d + datetime.timedelta(days=lead))
        gm[gmo]["qtot"] += inc
        if inc <= 0: continue
        run = []
        for bi in binfo:
            # China date d maps to run-day j of the banner's CHINA window, which starts
            # `lead` days before its global start. gid (game-i's daily shape) is indexed by
            # run-day, not calendar, so it stays valid under the shift.
            j = (d-bi["start"]).days + lead
            if 0 <= j < bi["len"]: run.append((bi["idx"], j, bi["gid"][j]))
        if not run: continue
        wsum = sum(w for _,_,w in run)
        for idx,j,w in run:
            a = inc*w/wsum if wsum>0 else inc/len(run)
            bmonthly[idx][gmo] += a; btotal[idx] += a
            bdaily[idx][j] = bdaily[idx].get(j,0.0) + a
        gm[gmo]["attr"] += inc
    monthly = {}
    for m,v in gm.items():
        qt,at = round(v["qtot"]), round(v["attr"])
        monthly[m] = {"qtot":qt, "attr":at, "base": qt if (qt>0 and (qt-at)/qt>=0.08) else at}
    bans = {}
    for bi in binfo:
        idx = bi["idx"]
        if idx not in btotal: continue
        mo = {k:round(x) for k,x in bmonthly[idx].items() if round(x) > 0}
        daily = [round(bdaily[idx].get(j,0.0)) for j in range(bi["len"])]
        # start = the banner's CHINA run start (global start shifted back by `lead`), so the
        # daily[] series and its labels line up with when the banner actually ran in China.
        cn_start = bi["start"] - datetime.timedelta(days=lead)
        bans[str(idx)] = {"total":round(btotal[idx]), "start":cn_start.isoformat(),
                          "monthly":mo, "daily":daily}
    # first/last China date Qimai actually has data for, so the site can label a banner day
    # that game-i's (global) calendar reaches but Qimai hasn't posted yet as "no data yet"
    # rather than a real ¥0 / below-#200 day.
    cov = sorted(q)
    out["games"][tag] = {"cn_lead": lead,
                         "first": cov[0].isoformat() if cov else None,
                         "last":  cov[-1].isoformat() if cov else None,
                         "monthly": dict(sorted(monthly.items())), "banners": bans}
    life = round(sum(q.values())); attr = round(sum(btotal.values()))
    print(f"{tag}: lifetime ${life:,} | {len(bans)} banners ${attr:,} ({100*attr/life:.1f}%) | "
          f"daily points {sum(len(v['daily']) for v in bans.values())}")

path = f"{GT}/data/qimai.json"
json.dump(out, io.open(path,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
print("wrote", path, os.path.getsize(path), "bytes")

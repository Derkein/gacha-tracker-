#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build data/compare.json -- the cross-game layer the site's Compare view needs.

Every other view is about ONE game, so the page only ever loads that game's file.
Comparing the seven means having all seven at once, plus context the per-game files
don't carry at all:

  * game-i monthly revenue per game, for the FULL history. Each game's own file
    publishes only game-i's last ~3 years of monthly totals, but its banner list
    goes back to launch, so the monthly series is reconstructed from the banners
    exactly the way app.js's computeMonthly() does -- same daily attribution, same
    below-#200 rule -- and the reconstruction is checked against index.json's
    lifetime total before it is written.

  * where each tracked game sat in the CN chart: its rank that month, and the size
    of the chart's top 15. Chart depth grew from 15 rows in Nov 2021 to ~45 today,
    so "share of everything charted" would drift upward for structural reasons;
    share of the top 15 is measured on the same basis in every month.

  * the wider CN market -- the biggest games we DON'T track. The archive holds every
    game the ranking ever charted, and that is the only place on the site where a
    tracked game can be sized against the rest of the genre.

Sensor Tower and CN per-game monthlies are NOT copied here: the page already loads
data/reported_revenue.json and data/cn_monthly.json for every game.

    python scripts/build_compare.py
"""

import datetime
import io
import json
import math
import os
import statistics
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DATA = "data"
OUT = os.path.join(DATA, "compare.json")
BOARD_SIZE = 30          # wider-market board: this many games by lifetime total
BOARD_MIN_MONTHS = 3     # ...ignoring one-off rows, which are usually a bad OCR read
RERUN_WINDOW = 180       # days either side, to find "a new banner at the same time"
RERUN_MIN_PEERS = 3      # ...and how many are needed before that median means anything
RERUN_MIN_ROWS = 3       # a game needs this many usable reruns before a median is shown

# English titles for the charted games we don't track, so the market board isn't a
# wall of Chinese for an English-reading audience. Only titles with an official or
# universally-used English name are listed; anything else keeps its Chinese title
# rather than getting a guessed translation. A few keys are the OCR spelling that
# won the vote (坐白禁区 for 尘白禁区) -- the map is keyed on what the data holds.
EN_NAMES = {
    "命运-冠位指定": "Fate/Grand Order",
    "明日方舟": "Arknights",
    "Nikke胜利女神": "Goddess of Victory: Nikke",
    "恋与深空": "Love and Deepspace",
    "火影忍者": "Naruto Mobile",
    "阴阳师": "Onmyoji",
    "幻塔": "Tower of Fantasy",
    "光与夜之恋": "Light and Night",
    "游戏王Master Duel": "Yu-Gi-Oh! Master Duel",
    "游戏王决斗链接": "Yu-Gi-Oh! Duel Links",
    "偶像梦幻祭2": "Ensemble Stars!! Music",
    "蔚蓝档案": "Blue Archive",
    "碧蓝航线": "Azur Lane",
    "重返未来1999": "Reverse: 1999",
    "少女前线2追放": "Girls' Frontline 2: Exilium",
    "少女前线": "Girls' Frontline",
    "崩坏3": "Honkai Impact 3rd",
    "崩坏学园2": "Honkai Gakuen 2",
    "无限暖暖": "Infinity Nikki",
    "闪耀暖暖": "Shining Nikki",
    "无期迷途": "Path to Nowhere",
    "女神异闻录夜幕魅影": "Persona5: The Phantom X",
    "战双帕弥什": "Punishing: Gray Raven",
    "深空之眼": "Aether Gazer",
    "第七史诗": "Epic Seven",
    "坐白禁区": "Snowbreak: Containment Zone",
    "公主连结": "Princess Connect! Re:Dive",
    "影之诗": "Shadowverse",
    "雀魂": "Mahjong Soul",
    "炽焰天穹": "Heaven Burns Red",
    "学园偶像大师": "Gakuen Idolmaster",
    "超越时空的猫": "Another Eden",
    "BangDream": "BanG Dream! Girls Band Party",
    "未定事件簿": "Tears of Themis",
    "初音未来缤纷舞台": "Project SEKAI",
    "铃兰之剑": "Sword of Convallaria",
    "世界弹射物语": "World Flipper",
    "光与暗之交战": "The Seven Deadly Sins: Grand Cross",
    "恋与制作人": "Mr Love: Queen's Choice",
    "白夜极光": "Alchemy Stars",
    "云图计划": "Girls' Frontline: Neural Cloud",
    "坎特伯雷公主与骑士唤醒冠军之剑的奇幻冒险": "Guardian Tales",
    "世界之外": "Beyond the World",
    "星痕共鸣": "Star Resonance",
    "魔法少女小圆Magia Exedra": "Madoka Magica: Magia Exedra",
    "Memento Mori": "MementoMori",
}


def load(name):
    with io.open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


def ym_of(date, offset_days):
    d = datetime.date.fromisoformat(date) + datetime.timedelta(days=offset_days)
    return "%04d-%02d" % (d.year, d.month)


# app.js's RANK_VAL / rankValue(): daily store rank -> relative revenue weight,
# log-interpolated between the anchor points. Rank 1 is worth ~59x rank 200, so the
# split across days is nowhere near uniform and must use this curve, not a flat
# "was it charting" flag -- a banner that peaked at #1 on day one and drifted to #150
# earns most of its total in that first week.
RANK_VAL = [(1, 5.90), (2, 3.47), (3, 3.03), (4, 2.61), (5, 2.03),
            (10, .9034), (50, .2584), (100, .1640), (200, .10)]


def rank_value(r):
    if r is None:
        return 0.0                      # below game-i's trackable top 200: earns nothing
    if r <= RANK_VAL[0][0]:
        return RANK_VAL[0][1]
    if r >= 200:
        return RANK_VAL[-1][1]
    for (r0, v0), (r1, v1) in zip(RANK_VAL, RANK_VAL[1:]):
        if r0 <= r <= r1:
            t = (math.log(r) - math.log(r0)) / (math.log(r1) - math.log(r0))
            return math.exp(math.log(v0) + t * (math.log(v1) - math.log(v0)))
    return 0.0


def gamei_monthly(data):
    """Reconstruct game-i monthly revenue from the banner list.

    Mirrors app.js computeMonthly(): a banner's total is split across its days in
    proportion to rank_value(that day's rank), and each day's share is credited to
    the calendar month that day fell in. Days below game-i's trackable top 200 are
    null in the series and earn nothing, so they neither add revenue nor dilute the
    days that did.
    """
    out = {}
    for b in data["banners"]:
        if b.get("_synthetic") or b.get("pending"):
            continue
        weights = [rank_value(r) for r in (b.get("rank_series") or [])]
        total = sum(weights)
        if not total:
            continue
        for i, w in enumerate(weights):
            if not w:
                continue
            ym = ym_of(b["start"], i)
            out[ym] = out.get(ym, 0.0) + b["rev"] * w / total
    return {k: round(v, 4) for k, v in sorted(out.items())}


def rerun_rows(data):
    """Match every returning character back to their debut banner.

    NOT derived from the `rerun` flag. That flag is set three different ways --
    a 復刻 tag in the title, the headliner having led an earlier banner, or (only
    for the games with an icons/<game>.json) a re-derivation from the resolved
    English name -- so it means something slightly different in each game and is
    empty for the ones whose banners are named after an event rather than a
    character. Here a character is simply "returning" the second time they appear
    in the banner list, which is the same rule in every game.

    Two things make a returning row uncomparable, and both are counted rather
    than quietly dropped:

      * the row also introduces someone new, so its revenue is part debut;
      * a returning character's own debut row was shared with others, so there is
        no figure that belongs to that character alone to compare against.

    game-i bundles reruns: one row can replay two or three characters at once
    (アリス復刻&0号・アンビー復刻&アストラ復刻). Those stay whole -- the row is
    compared against the SUM of those characters' debuts, never against an invented
    per-character split.
    """
    banners = sorted((b for b in data["banners"]
                      if not b.get("_synthetic") and not b.get("pending")),
                     key=lambda b: (b["start"], b["name"]))
    debut, seq = {}, []
    for b in banners:
        chars = b.get("agents") or []
        if not chars:
            continue
        back = [c for c in chars if c in debut]
        new = [c for c in chars if c not in debut]
        seq.append({"b": b, "back": back, "new": new})
        for c in new:
            debut[c] = b

    # "a new banner at the same time": rows that introduce only new characters
    pure = [r["b"] for r in seq if not r["back"]]
    rows, mixed, shared, returning = [], 0, 0, 0
    for r in seq:
        if not r["back"]:
            continue
        returning += 1
        if r["new"]:
            mixed += 1
            continue
        if any(len(debut[c].get("agents") or []) != 1 for c in r["back"]):
            shared += 1
            continue
        b = r["b"]
        d0 = datetime.date.fromisoformat(b["start"])
        peers = sorted(x["rev"] for x in pure
                       if abs((datetime.date.fromisoformat(x["start"]) - d0).days)
                       <= RERUN_WINDOW)
        base = sum(debut[c]["rev"] for c in r["back"])
        rows.append({
            "start": b["start"], "chars": r["back"], "rev": round(b["rev"], 2),
            "debut": round(base, 2),
            "debut_at": [debut[c]["start"] for c in r["back"]],
            "peer": round(statistics.median(peers), 2) if len(peers) >= RERUN_MIN_PEERS else None,
            "peer_n": len(peers),
        })
    return {"rows": rows, "mixed": mixed, "shared": shared, "returning": returning,
            "pure_debuts": len(pure)}


def mid(row):
    hi = row.get("rev_max_cny")
    return (row["rev_min_cny"] + (row["rev_min_cny"] if hi is None else hi)) / 2.0


def main():
    idx = load("index.json")
    cn = load("cn_revenue.json")
    tracked = [g["game"] for g in idx["games"]]

    games, gamei, reruns = [], {}, []
    for g in idx["games"]:
        tag = g["game"]
        data = load("%s.json" % tag)
        series = gamei_monthly(data)
        gamei[tag] = series
        # the reconstruction must reproduce the lifetime total the index publishes;
        # if it doesn't, the attribution rule has drifted from app.js and every
        # cross-game chart built on it would be quietly wrong
        recon, stated = sum(series.values()), g["total_oku"]
        if stated and abs(recon - stated) / stated > 0.01:
            sys.exit("%s: reconstructed %.1f oku vs index %.1f -- attribution drifted"
                     % (tag, recon, stated))
        starts = sorted(b["start"] for b in data["banners"]
                        if not b.get("_synthetic") and not b.get("pending"))
        games.append({"tag": tag, "name": g["name"], "banners": g["count"],
                      "launch": starts[0] if starts else None,
                      "first_month": min(series) if series else None})
        rr = rerun_rows(data)
        rr.update(tag=tag, name=g["name"])
        reruns.append(rr)
        print("%-9s %3d months  %s -> %s  %8.1f oku"
              % (tag, len(series), min(series or ["-"]), max(series or ["-"]), recon))

    # ---- CN market context -------------------------------------------------
    cg = cn["games"]
    months = sorted({m for g in cg.values() for m in g["monthly"]})
    market_months, rank = {}, {t: {} for t in tracked}
    for m in months:
        rows = sorted(((mid(g["monthly"][m]), k) for k, g in cg.items() if m in g["monthly"]),
                      reverse=True)
        market_months[m] = {"n": len(rows),
                            "top15": round(sum(v for v, _ in rows[:15])),
                            "total": round(sum(v for v, _ in rows))}
        for i, (_, k) in enumerate(rows):
            if k in rank:
                rank[k][m] = i + 1
    rank = {k: v for k, v in rank.items() if v}

    lifetime = sorted(((sum(mid(r) for r in g["monthly"].values()), k)
                       for k, g in cg.items()
                       if len(g["monthly"]) >= BOARD_MIN_MONTHS or k in tracked),
                      reverse=True)
    keep = [k for _, k in lifetime[:BOARD_SIZE]]
    latest = months[-1]
    for k in cg:                            # the newest month's chart, complete: the
        if latest in cg[k]["monthly"] and k not in keep:   # board doubles as "the whole
            keep.append(k)                                 # chart right now", so a game
    for t in tracked:                       # outside the all-time top 30 still shows.
        if t not in keep and t in cg:       # And a tracked game always makes the board.
            keep.append(t)
    board = []
    for k in keep:
        g = cg[k]
        board.append({
            "key": k,
            "name": None if k in tracked else (EN_NAMES.get(k) or g.get("name_cn") or k),
            "cn": None if k in tracked else (g.get("name_cn") or k),
            "tag": k if k in tracked else None,
            "months": {m: round(mid(r)) for m, r in sorted(g["monthly"].items())},
        })
    named = sum(1 for b in board if b["tag"] is None and EN_NAMES.get(b["key"]))
    untracked = sum(1 for b in board if b["tag"] is None)
    unnamed = [b["key"] for b in board if b["tag"] is None and not EN_NAMES.get(b["key"])]

    # ---- rerun decay -------------------------------------------------------
    # A median is only published where enough rows survived the matching; a game
    # with one or two usable reruns gets its rows shown and no summary number.
    for r in reruns:
        rows = r["rows"]
        r["coverage"] = round(len(rows) / r["returning"], 3) if r["returning"] else None
        peers = [x for x in rows if x["peer"]]
        r["med_own"] = (round(statistics.median(100 * x["rev"] / x["debut"]
                                                for x in rows if x["debut"]))
                        if len(rows) >= RERUN_MIN_ROWS else None)
        ratios = sorted(100 * x["rev"] / x["peer"] for x in peers)
        r["peer_rows"] = len(ratios)
        r["med_peer"] = round(statistics.median(ratios)) if len(ratios) >= RERUN_MIN_ROWS else None
        # the spread matters more than the median here: Genshin's reruns beat a
        # contemporary debut in 2021 and undercut one in 2026, and a lone median
        # would hide that the answer moved.
        r["peer_lo"] = round(ratios[0]) if ratios else None
        r["peer_hi"] = round(ratios[-1]) if ratios else None
    reruns.sort(key=lambda r: (-len(r["rows"]), r["tag"]))
    for r in reruns:
        print("rerun %-9s %2d usable of %3d returning rows (%2d mixed, %3d shared debut)"
              " med own=%s med vs peers=%s"
              % (r["tag"], len(r["rows"]), r["returning"], r["mixed"], r["shared"],
                 r["med_own"], r["med_peer"]))

    out = {
        "generated": datetime.datetime.now(datetime.timezone.utc)
                     .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": ("Cross-game layer for the Compare view. gamei = game-i JP revenue in "
                 "oku (億G, 100M yen) per month, reconstructed from each game's banner "
                 "list the same way the by-Month view does. market = where each tracked "
                 "game sat in the CN ranking, plus the biggest charted games we don't "
                 "track. Sensor Tower and CN per-game monthlies are not duplicated here "
                 "-- the page already loads reported_revenue.json and cn_monthly.json."),
        "units": {"gamei": "oku (100 million yen)", "market": "CNY"},
        "games": games,
        "gamei": gamei,
        "market": {
            "source": cn.get("source"),
            "source_url": cn.get("source_url"),
            "note": ("Chart depth grew from 15 rows (Nov 2021) to ~45 today, so a share "
                     "of everything charted would drift upward for structural reasons. "
                     "Share is therefore measured against the top 15, which every month "
                     "has. miHoYo rows are ranges; their midpoint is used for ranking "
                     "and share."),
            "months": market_months,
            "rank": rank,
            "board": board,
        },
        "reruns": {
            "window_days": RERUN_WINDOW,
            "min_peers": RERUN_MIN_PEERS,
            "min_rows": RERUN_MIN_ROWS,
            "note": ("A returning character is one appearing in the banner list for a "
                     "second time -- the same rule in every game, unlike the per-banner "
                     "`rerun` flag, which is derived three different ways and is empty "
                     "for the games whose banners are named after an event. A rerun row "
                     "is only comparable when it introduces nobody new AND every "
                     "returning character debuted in a row of their own; `coverage` is "
                     "the share of returning rows that cleared both tests. `debut` is "
                     "the sum of those characters' own debut revenue; `peer` is the "
                     "median revenue of banners introducing only new characters within "
                     "%d days either side, which is the comparison that isn't distorted "
                     "by the game's own rise or decline." % RERUN_WINDOW),
            "games": reruns,
        },
    }
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("\nCN market: %d months, %d games on the board (%d untracked, %d with an "
          "English title)" % (len(market_months), len(board), untracked, named))
    if unnamed:
        print("no English title (shown in Chinese): %s" % ", ".join(sorted(unnamed)))
    print("wrote %s (%d bytes)" % (OUT, os.path.getsize(OUT)))


if __name__ == "__main__":
    main()

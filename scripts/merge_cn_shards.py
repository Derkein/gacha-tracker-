#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge the parallel shard outputs of scrape_bilibili_cn.py into one file.

The backfill runs as N round-robin shards writing separate JSONs so they never
race on the same file. This stitches them back together, reports what is still
missing, and flags anything that looks like a bad read.

    python scripts/merge_cn_shards.py data/cn_shards/shard*.json \
        --index scripts/tiantian_archive.json --out data/cn_revenue.json
"""

import argparse
import difflib
import glob
import io
import json
import os
import re
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HEAD_KEYS = ("source", "source_url", "collection_url", "unit", "scope",
             "method", "caveats")

# Tracked slugs are already canonical and must never be folded into anything.
TRACKED = ("genshin", "hsr", "zzz", "wuwa", "nte", "endfield", "uma")

# One game the chart calls by more than one *real* title, which no amount of
# string similarity can join. The author writes whichever title was current, so
# the alias months are strictly consecutive with the canonical ones and never
# collide -- that disjointness is asserted below, so a wrong alias fails loudly
# instead of silently summing two different games.
#   Heaven Burns Red: JP title until Feb 2023, then the Traditional-Chinese
#   绯染天空 through Dec 2023, then the mainland 炽焰天穹 from the Jan 2024
#   bilibili release. 坎公骑冠剑 is the standard short form of Guardian Tales'
#   very long Chinese title; 如莺 is 如鸢 with a near-identical character; 追放
#   is 少女前线2追放 truncated past the digit guard.
ALIASES = {
    "炽焰天穹": ["Heaven Burns Red", "绯染天空"],
    "坎特伯雷公主与骑士唤醒冠军之剑的奇幻冒险": ["坎公骑冠剑"],
    "如鸢": ["如莺"],
    "少女前线2追放": ["追放"],
}


# A rank number or a stray column can bleed into the name cell mid-animation:
# "8 Goddessofvictory nikke", "1 Memento Mori", "偶像梦幻祭2 2". Strip a
# free-standing leading/trailing 1-2 digit group before comparing names -- a digit
# glued to the name (崩坏3, 少女前线2) is part of the title and must survive.
RE_LEAD_RANK = re.compile(r"^\d{1,2}\s+")
RE_TRAIL_RANK = re.compile(r"\s+\d{1,2}$")
# The revenue column read as the name column ("11217万"): not a game at all.
RE_JUNK_NAME = re.compile(r"^[\d.,]+\s*[万亿億]?$")


def clean_name(s):
    return RE_TRAIL_RANK.sub("", RE_LEAD_RANK.sub("", s)).strip()


def digits(s):
    return re.findall(r"\d+", s)


def same_game(a, b, cutoff):
    """Do two OCR'd names denote the same game?

    Digit runs must match first: 崩坏3 / 崩坏学园2 and 少女前线 / 少女前线2 are
    different games whose names are otherwise very close.

    Then either near-identical spelling (公主连接 / 公主连结 / 公主链接) or one
    name contained in the other, which catches both truncations picked up
    mid-animation (Duel <- 游戏王MasterDuel) and subtitle text bleeding onto the
    end of a name (食物语 而我每一日部是崭新的).

    Compared case-folded and with a bleed-in rank number stripped, so
    NIKKE / Nikke胜利女神 and "8 Goddessofvictory nikke" all land on one series.
    """
    a, b = clean_name(a).lower(), clean_name(b).lower()
    if digits(a) != digits(b):
        return False
    short, long_ = sorted((a, b), key=len)
    if len(short) >= 3 and short in long_:
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= cutoff


def canonicalise(games, cutoff=0.72):
    """Fold OCR spelling variants of the same game into one series.

    Every game in every chart is recorded, not just the tracked seven, so the
    archive stays useful if another game is added later. But OCR spells a name
    slightly differently from frame to frame -- FGO alone came back as 冠位指定,
    命运 冠位指定, 命运-冠位指定 and 命运一冠位指定 -- which splits one game's
    history across four keys. Cluster near-identical names and keep the variant
    seen in the most months as canonical.

    Two guards stop real games being merged: tracked slugs are never folded, and
    names whose digit runs differ are never folded, because 崩坏3 / 崩坏学园2 and
    少女前线 / 少女前线2 are different games that read as very similar strings.
    """
    junk = [k for k in games if k not in TRACKED and RE_JUNK_NAME.match(clean_name(k))]
    for k in junk:                 # the revenue cell read as the name cell
        games.pop(k)
    if junk:
        print("dropped non-name keys: %s" % ", ".join(sorted(junk)))
    keys = sorted(games, key=lambda k: (-len(games[k]["monthly"]), k))
    canon, taken = {}, set()
    for k in keys:
        if k in taken:
            continue
        group = [k]
        taken.add(k)
        if k in TRACKED:
            canon[k] = group
            continue
        for o in keys:
            if o in taken or o in TRACKED:
                continue
            # test against every variant already in the group, not just its head:
            # 公主链接 is 0.50 against the head 公主连结 but 0.75 against the
            # variant 公主连接 that already joined it.
            if any(same_game(m, o, cutoff) for m in group):
                group.append(o)
                taken.add(o)
        canon[k] = group

    out = {}
    for head, group in canon.items():
        rec = {"name_cn": games[head].get("name_cn", head), "monthly": {}}
        if len(group) > 1:
            rec["ocr_variants"] = sorted(g for g in group if g != head)
        for g in group:
            for month, row in games[g]["monthly"].items():
                prev = rec["monthly"].get(month)
                if prev is None or row.get("confidence", 0) > prev.get("confidence", 0):
                    rec["monthly"][month] = row
        rec["monthly"] = dict(sorted(rec["monthly"].items()))
        out[head] = rec

    # Alias merging runs on the *folded* series: an alias title has its own OCR
    # variants, and those must have been gathered onto it before it is absorbed.
    for head, alist in ALIASES.items():
        if head not in out:
            continue
        for alias in alist:
            if alias not in out:
                continue
            clash = set(out[head]["monthly"]) & set(out[alias]["monthly"])
            if clash:                  # not a rename -- two games, or a bad alias
                print("alias NOT applied (%s <- %s): both chart %s"
                      % (head, alias, ", ".join(sorted(clash))))
                continue
            merged_in = out.pop(alias)
            out[head]["monthly"].update(merged_in["monthly"])
            out[head]["monthly"] = dict(sorted(out[head]["monthly"].items()))
            out[head].setdefault("title_variants", []).append(alias)
            if merged_in.get("ocr_variants"):
                out[head]["ocr_variants"] = sorted(
                    set(out[head].get("ocr_variants", [])) | set(merged_in["ocr_variants"]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("shards", nargs="+")
    ap.add_argument("--index", help="archive index, to report missing months")
    ap.add_argument("--out", default="data/cn_revenue.json")
    ap.add_argument("--tracked", default="genshin,hsr,zzz,wuwa,nte,endfield,uma")
    args = ap.parse_args()

    paths = []
    for pat in args.shards:
        paths.extend(sorted(glob.glob(pat)) or ([pat] if os.path.exists(pat) else []))
    if not paths:
        sys.exit("no shard files matched")

    merged = {"games": {}, "episodes_done": {}, "failures": {}}
    head = {}
    for p in paths:
        d = json.load(io.open(p, encoding="utf-8"))
        for k in HEAD_KEYS:
            if k in d:
                head[k] = d[k]
        merged["episodes_done"].update(d.get("episodes_done", {}))
        merged["failures"].update(d.get("failures", {}))
        for slug, g in d.get("games", {}).items():
            tgt = merged["games"].setdefault(
                slug, {"name_cn": g.get("name_cn", ""), "monthly": {}})
            for month, row in g["monthly"].items():
                prev = tgt["monthly"].get(month)
                # Same month from two shards should not happen, but if it does
                # keep the higher-confidence read rather than last-write-wins.
                if prev is None or row.get("confidence", 0) > prev.get("confidence", 0):
                    tgt["monthly"][month] = row

    raw_keys = len(merged["games"])
    merged["games"] = canonicalise(merged["games"])
    folded = raw_keys - len(merged["games"])
    merged["games"] = dict(sorted(merged["games"].items()))
    merged["episodes_done"] = dict(sorted(merged["episodes_done"].items()))
    out = dict(head)
    out.update(merged)
    if not out["failures"]:
        out.pop("failures")

    with io.open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # The full archive carries every game in the charts (125 of them) so a new
    # game can be added later without re-scraping, but the browser only needs the
    # seven the site tracks. Emit a slim companion for the page to fetch.
    slim_path = os.path.join(os.path.dirname(args.out) or ".", "cn_monthly.json")
    tracked = args.tracked.split(",")
    slim = {k: out[k] for k in HEAD_KEYS if k in out}
    slim["note"] = ("Slim per-game view of cn_revenue.json for the site; the full "
                    "archive with every charted game stays in cn_revenue.json.")
    slim["games"] = {}
    for slug in tracked:
        g = merged["games"].get(slug)
        if not g:
            continue
        slim["games"][slug] = {
            "name_cn": g.get("name_cn", ""),
            "monthly": {m: {k: v for k, v in row.items()
                            if k in ("rev_min_cny", "rev_max_cny", "is_range",
                                     "metric_cn", "metric_inferred",
                                     "excludes_mihoyo_payment_center",
                                     "confidence")}
                        for m, row in g["monthly"].items()},
        }
    with io.open(slim_path, "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote %s (%d games, %d bytes)"
          % (slim_path, len(slim["games"]), os.path.getsize(slim_path)))

    done = set(merged["episodes_done"])
    print("shards merged : %d" % len(paths))
    print("games          : %d raw keys -> %d after folding OCR variants (%d folded)"
          % (raw_keys, len(merged["games"]), folded))
    print("months scraped: %d" % len(done))

    if args.index:
        idx = json.load(io.open(args.index, encoding="utf-8"))
        want = sorted(e["data_month"] for e in idx["episodes"]
                      if e["kind"] == "monthly" and e["scope"] == "global")
        missing = [m for m in want if m not in done]
        print("expected      : %d" % len(want))
        print("MISSING       : %s" % (", ".join(missing) if missing else "none"))
    if merged["failures"]:
        print("failures      : %s" % ", ".join(sorted(merged["failures"])))

    print()
    print("%-10s %-9s %-9s %5s  %-12s %s"
          % ("slug", "first", "last", "n", "metrics", "gaps in range"))
    for slug in args.tracked.split(","):
        g = merged["games"].get(slug)
        if not g:
            print("%-10s (not found)" % slug)
            continue
        ms = sorted(g["monthly"])
        labels = sorted({v.get("metric_cn") or "?" for v in g["monthly"].values()})
        # months absent between first and last sighting -- a real gap, as opposed
        # to the leading absence that just means the game had not launched yet
        def nxt(ym):
            y, m = int(ym[:4]), int(ym[5:])
            return "%04d-%02d" % (y + (m == 12), 1 if m == 12 else m + 1)
        gaps, cur = [], ms[0]
        while cur != ms[-1]:
            cur = nxt(cur)
            if cur not in g["monthly"]:
                gaps.append(cur)
        print("%-10s %-9s %-9s %5d  %-12s %s"
              % (slug, ms[0], ms[-1], len(ms), ",".join(labels),
                 ", ".join(gaps) if gaps else "none"))

    low = [(s, m, v["confidence"]) for s, g in merged["games"].items()
           for m, v in g["monthly"].items()
           if s in args.tracked.split(",") and v.get("confidence", 1) < 0.5]
    print()
    print("tracked rows with confidence < 0.5: %d" % len(low))
    for s, m, c in sorted(low):
        print("   %-10s %s  %.2f" % (s, m, c))
    print()
    print("wrote %s" % args.out)


if __name__ == "__main__":
    main()

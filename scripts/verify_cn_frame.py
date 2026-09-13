#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pull the actual video frames behind a scraped figure, so a human can read them.

scrape_bilibili_cn.py reads revenue off burned-in captions with OCR. That is a
guess, however confident, so this dumps the caption crops the figure came from as
PNGs you can look at, next to what the scraper recorded. Any disagreement between
the picture and the JSON is a scraper bug.

Two modes:

    # find every frame showing a game, and check it against data/cn_revenue.json
    python scripts/verify_cn_frame.py --month 2026-07 --game genshin

    # dump the caption crop at a specific timestamp (no OCR, instant)
    python scripts/verify_cn_frame.py --month 2026-07 --at 620

    # spot-check N random months for one game in a single pass
    python scripts/verify_cn_frame.py --game hsr --sample 5

Videos are read from the .bilicache written by the scraper's --keep-video; a
missing one is downloaded on demand.
"""

import argparse
import io
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_bilibili_cn as S                                   # noqa: E402

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = S.ROOT


def load_index(path):
    d = json.load(io.open(path, encoding="utf-8"))
    return {e["data_month"]: e for e in d["episodes"]
            if e["kind"] == "monthly" and e["scope"] == "global"}


def find_video(bvid, caches):
    for c in caches:
        for ext in ("mp4", "m4v", "mkv", "flv"):
            p = os.path.join(c, "%s.%s" % (bvid, ext))
            if os.path.exists(p) and os.path.getsize(p) > 1_000_000:
                return p
    return None


def crop_at(video, seconds, dest):
    """Fast keyframe seek, then one frame, cropped to the caption band."""
    x0, y0, x1, y1 = S.BOT
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-ss", str(seconds), "-i", video,
         "-frames:v", "1",
         "-vf", "crop=iw*%.4f:ih*%.4f:iw*%.4f:ih*%.4f"
                % (x1 - x0, y1 - y0, x0, y0),
         "-y", dest],
        check=True, capture_output=True)
    return dest


def scan_for_game(video, want_cn, want_slug, out_dir, max_hits=3):
    """OCR the episode until the target game's entry is found; dump its frames."""
    work = tempfile.mkdtemp(prefix="verify_")
    hits = []
    try:
        bot_dir, _ = S.extract_bands(video, work, both_bands=False)
        names = sorted(os.listdir(bot_dir))
        for i, fn in enumerate(names):
            p = os.path.join(bot_dir, fn)
            lines = S.ocr_lines(p)
            name, lo, hi, pct, mh, mt = S.parse_band(lines)
            if not name or lo is None:
                continue
            norm = S.normalize_name(name)
            slug = S.match_game(norm)
            if (want_slug and slug == want_slug) or (want_cn and want_cn in norm):
                dest = os.path.join(out_dir, "%s_t%04ds.png"
                                    % (want_slug or want_cn, int(i * 3)))
                os.replace(p, dest)
                hits.append({"t": i * 3, "png": dest, "ocr_lines": lines,
                             "lo_wan": lo, "hi_wan": hi, "metric": mt})
                if len(hits) >= max_hits:
                    break
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)
    return hits


def fmt_wan(w):
    return "%s万 (¥%.1fM)" % (w, w * 10000 / 1e6) if w is not None else "—"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month")
    ap.add_argument("--game", help="tracker slug (genshin/hsr/...) or CN name")
    ap.add_argument("--at", type=float, help="dump the crop at this second")
    ap.add_argument("--sample", type=int, help="check N spread-out months")
    ap.add_argument("--index", default=os.path.join(ROOT, "scripts",
                                                    "tiantian_archive.json"))
    ap.add_argument("--data", default=os.path.join(ROOT, "data", "cn_revenue.json"))
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "data", "cn_verify"))
    ap.add_argument("--cache", default=os.path.join(ROOT, ".bilicache"))
    args = ap.parse_args()

    idx = load_index(args.index)
    caches = [args.cache] + [os.path.join(args.cache, "s%d" % i) for i in (1, 2, 3, 4)]
    os.makedirs(args.out_dir, exist_ok=True)

    scraped = {}
    if os.path.exists(args.data):
        scraped = json.load(io.open(args.data, encoding="utf-8")).get("games", {})

    months = []
    if args.month:
        months = [args.month]
    elif args.sample:
        g = scraped.get(args.game, {}).get("monthly", {})
        have = sorted(g)
        if not have:
            sys.exit("no scraped months for %s in %s" % (args.game, args.data))
        step = max(1, len(have) // args.sample)
        months = have[::step][:args.sample]
    else:
        ap.error("need --month or --sample")

    slug = args.game if args.game in S.GAMES.values() else None
    cn = None if slug else args.game

    for month in months:
        ep = idx.get(month)
        if not ep:
            print("%s: not in index" % month)
            continue
        video = find_video(ep["bvid"], caches)
        if not video:
            print("%s: video not cached, downloading %s" % (month, ep["bvid"]))
            video = S.fetch_video(ep["bvid"], args.cache)

        print("=" * 68)
        print("%s  %s  %s" % (month, ep["bvid"], ep["title"][:44]))

        if args.at is not None:
            dest = os.path.join(args.out_dir, "%s_t%04ds.png" % (month, int(args.at)))
            crop_at(video, args.at, dest)
            print("  wrote %s" % dest)
            continue

        rec = scraped.get(slug or "", {}).get("monthly", {}).get(month)
        if rec:
            print("  SCRAPED : %s to %s   metric=%s conf=%.2f%s"
                  % (fmt_wan(rec["rev_min_cny"] // 10000),
                     fmt_wan(rec["rev_max_cny"] // 10000),
                     rec.get("metric_cn"), rec.get("confidence", 0),
                     "  ORDER_BREAK" if rec.get("order_break") else ""))
        else:
            print("  SCRAPED : (no row -- game absent from this month's chart)")

        hits = scan_for_game(video, cn, slug, args.out_dir)
        if not hits:
            print("  FRAMES  : none found")
            continue
        for h in hits:
            print("  FRAME   : t=%ds  %s" % (h["t"], os.path.basename(h["png"])))
            print("            ocr: %s" % " || ".join(h["ocr_lines"]))
            print("            reads %s to %s"
                  % (fmt_wan(h["lo_wan"]), fmt_wan(h["hi_wan"])))
        if rec:
            same = all(h["lo_wan"] * 10000 == rec["rev_min_cny"] for h in hits)
            print("  VERDICT : %s"
                  % ("frames agree with the stored figure" if same
                     else "*** MISMATCH -- open the PNGs and read them"))

    print()
    print("PNGs in %s -- open them and read the numbers yourself." % args.out_dir)


if __name__ == "__main__":
    main()

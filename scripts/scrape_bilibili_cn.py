#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read the monthly gacha revenue figures out of 天天背锅崩坏娘's Bilibili series.

The series (space.bilibili.com/20313793, collection 55224) has published a
"二次元手游全球总流水" ranking every month since Nov 2021 -- 58 consecutive data
months, the longest continuous CN-side gacha revenue record there is.  It is
published as a video MAD, though: no table, no API, no figures in the
description.  The author says so outright ("这不是表格视频...不适合贴表格之类的
数据"), so the only way in is to read the burned-in captions off the frames.

CAPTION FORMAT CHANGED SEVERAL TIMES.  Do NOT infer the metric from the video
title: the Sep 2023 episode is titled 全球总流水 but every caption in it still
reads 总收入.  The label is therefore read off each caption and stored per row.

  2021-11               "第15名：闪耀暖暖（国产），收入：3997万"
                        top 15 only, bare 收入 label, no previous-month box.
  2022-02               "第一名：原神（国产），总收入：225396万-274239万"
                        ~26 entries, 总收入; ranges ALREADY present for 原神, so
                        ranges are not a late-era feature.
  ~2023-09              "第40名：深空之眼（国产），9月总收入：1126万"
                        40 entries; previous-month box with MoM delta appears.
                        Still 总收入 -- note the episode is TITLED 全球总流水.
  ~2024-05              "第二名：原神（国产），5月总流水：94537万~117103万"
                        captions now read 总流水; 注：暂无支付中心数据 attached.
  2026                  "正片：绝区零（国产，米游），7月总流水：130248万~155058万"
                        米游 tag added; top entries labelled 正片, not 第N名.

Two quirks shape the parser:

  * miHoYo titles are given as a RANGE and flagged 注：暂无支付中心数据 -- the
    author excludes miHoYo's undisclosed 支付中心 (direct top-up) channel.
    Everything else is a single point value.
  * Any one frame OCRs unreliably while the caption animates in, so entries are
    segmented on the REVENUE (stable) and the game name is decided by a vote
    across the run (noisy: it fragments, picks up stray glyphs, and OCRs
    崩坏星穹铁道 variously as 崩坏星弯铁道 / 前坏星弯铁道).

Nothing is ever zero-filled.  The archive predates most of the tracked games, so
a game simply has no row for a month it did not appear in; `--report` prints the
first month each game was seen so pre-launch false positives are easy to spot.

Usage:
    python scripts/scrape_bilibili_cn.py --bvid BV1jrui6WEk4 --month 2026-07
    python scripts/scrape_bilibili_cn.py --index tiantian_archive.json --all
    python scripts/scrape_bilibili_cn.py --report data/cn_revenue.json
"""

import argparse
import collections
import difflib
import io
import json
import os
import re
import random
import shutil
import subprocess
import sys
import tempfile
import time

# Windows consoles default to cp1252 and every caption here is Chinese.
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")

# Bilibili serves up to 1080p without a login (only 1080p60 is member-gated), and
# without a browser UA + referer it answers HTTP 412.
#
# Prefer 852x480 AVC (30032) over the smaller 1080p AV1 stream. AV1 is a third
# the bytes but software-decodes ~10x slower -- measured, 120s of video took 90s
# to decode as AV1 against 8.6s as AVC, which made frame extraction, not OCR, the
# whole cost of a backfill. Resolution barely matters here anyway: RapidOCR's
# detector normalises the longest side to ~736px, so a 480p caption and a 1080p
# caption both arrive at roughly 19px glyphs. Verified character-for-character
# identical reads at 480p on the calibration frames.
# Bilibili uses TWO format-id schemes -- 30032 and 100047 are both 852x480 AVC,
# and eight episodes failed outright because the hard-coded ids matched
# neither. "best" is no fallback either: it means a COMBINED video+audio
# stream, which DASH videos here do not offer. Select by codec and height
# instead, preferring AVC at 480p and degrading gracefully.
FORMAT = ("bv*[vcodec^=avc][height<=480]/bv*[vcodec^=avc][height<=720]/"
          "bv*[vcodec^=avc]/bv*[height<=480]/bv*/best")

# One frame every 3s. Frame count is the biggest lever on runtime (OCR dominates
# at ~1.5s per frame-band) but 1/5s was measurably too sparse: 鸣潮 lost its range
# because the upper bound needs two frames to confirm, and a 2022 entry vanished
# outright. 1/3s leaves 5+ frames per entry and reproduces the hand-checked
# values exactly.

# onnxruntime defaults intra_op_num_threads to -1, meaning "one thread per core"
# PER PROCESS. Four shards then opened ~46 threads each, ~185 on 16 cores, and
# thrashed to ~5.7s/frame. Measured on an idle machine: 1 thread 2.20s/frame,
# 2 -> 1.64, 4 -> 1.47, 16 -> 1.85. The model barely parallelises, so 4 threads
# per process is the knee, and 4 shards x 4 threads exactly fills 16 cores.
OCR_THREADS = int(os.environ.get("CN_OCR_THREADS", "4"))
FPS = 1.0 / 3.0

# Do NOT upscale. RapidOCR's detector resizes so the longest side fits its own
# limit (~736px), so feeding it a 2x-upscaled 3840px band shrinks the glyphs and
# it starts dropping whole lines -- on a bright background it silently lost the
# revenue line for entire entries. Native 1920px crops read cleanly.
UPSCALE = 1

# Fractional crops. The bottom band is deliberately tall: captions wrap to two
# lines in the modern era, and sit slightly higher in the 2021-2023 layout.
BOT = (0.000, 0.740, 1.000, 0.995)
TOP = (0.400, 0.000, 1.000, 0.170)

# In CN industry usage 收入 is normally net of the store cut and 流水 gross
# billings, so rows carrying different labels must not be spliced into one
# series. Stored per row as `metric_cn`.
#
# 入 and 人 are near-identical glyphs and OCR routinely returns 总收人 for 总收入.
# Since the label is the anchor the revenue is matched against, an unmatched
# label silently DROPS the whole entry -- the 2022-03 episode yielded 3 entries
# instead of 19 that way. Accept both forms and normalise on the way out.
RE_METRIC = re.compile(
    r"(总[收収][入人]|总流水|[收収][入人]|流水|总[收収]|总流)(\s*[：:︓]\s*)?")


def canon_metric(label):
    """Normalise the label, including the truncations OCR leaves behind."""
    if not label:
        return label
    label = label.replace("収", "收").replace("收人", "收入")
    if label == "总收":
        label = "总收入"
    elif label == "总流":
        label = "总流水"
    return label

# At the 2021-2022 resolution RapidOCR frequently reads the full-width colon
# 「：」 as the digit 8, so "总收入：11350万" comes back as "总收入811350万" and the
# phantom 8 becomes the leading digit -- which is how FGO ended up above Genshin
# at an impossible 834748万. Every corrupted line is missing its colon while
# every clean one has it, so an absent separator is the reliable signal.
RE_PHANTOM_8 = re.compile(r"^\s*8(?=\d{4,}\s*万)")

# Games this tracker follows, by the CN names as they appear in the captions.
GAMES = {
    "原神": "genshin",
    "崩坏星穹铁道": "hsr",
    "崩坏：星穹铁道": "hsr",
    "绝区零": "zzz",
    "鸣潮": "wuwa",
    "明日方舟：终末地": "endfield",
    "明日方舟终末地": "endfield",
    "终末地": "endfield",
    "异环": "nte",
    "赛马娘": "uma",
    "赛马娘：闪耀优骏少女": "uma",
}

# Names that fuzzy-match a tracked title closely enough to be dangerous but are
# different games. 明日方舟 (Arknights) vs 明日方舟：终末地 (Endfield) is the one
# that actually bites.
NOT_TRACKED = {"明日方舟", "崩坏3", "崩坏学园2", "崩坏2"}

# A distinctive fragment of each tracked title. OCR mangles long names from the
# front as well as the back -- 崩坏星穹铁道 came back as 星弯铁道 and 穹铁道, which
# are too far from the full string to fuzzy-match and silently cost HSR nine
# months. Matching on a fragment that no other charting game contains is robust
# to damage at either end. Order matters: 终末地 is checked before 明日方舟 would
# ever apply, and 明日方舟 itself is not a token because Arknights is not tracked.
GAME_TOKENS = [
    ("原神", "genshin"),
    ("铁道", "hsr"),
    ("区零", "zzz"),
    ("鸣潮", "wuwa"),
    ("终末地", "endfield"),
    ("异环", "nte"),
    ("赛马娘", "uma"),
]

_ocr = None


def ocr_engine():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR(intra_op_num_threads=OCR_THREADS,
                        inter_op_num_threads=OCR_THREADS)
    return _ocr


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", **kw)


def fetch_video(bvid, cache_dir):
    """Download the video-only stream, reusing the cache if already present."""
    os.makedirs(cache_dir, exist_ok=True)
    for ext in ("mp4", "m4v", "mkv", "flv"):
        p = os.path.join(cache_dir, "%s.%s" % (bvid, ext))
        if os.path.exists(p) and os.path.getsize(p) > 1_000_000:
            return p
    # Bilibili throttles when several shards pull at once, so retry with backoff
    # and surface yt-dlp's own stderr -- a bare CalledProcessError says nothing.
    last = ""
    for attempt in range(4):
        if attempt:
            time.sleep(15 * attempt + random.uniform(0, 10))
        p = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "-f", FORMAT,
             "-o", os.path.join(cache_dir, "%(id)s.%(ext)s"),
             "--user-agent", UA, "--referer", "https://www.bilibili.com/",
             "--no-progress", "--quiet", "--no-warnings",
             "--retries", "5", "--socket-timeout", "30",
             "https://www.bilibili.com/video/%s/" % bvid],
            capture_output=True, text=True, encoding="utf-8", errors="replace")
        if p.returncode == 0:
            break
        last = (p.stderr or p.stdout or "").strip().replace("\n", " ")[:400]
        print("   yt-dlp attempt %d failed: %s" % (attempt + 1, last),
              file=sys.stderr)
    else:
        raise RuntimeError("yt-dlp failed for %s: %s" % (bvid, last))
    for ext in ("mp4", "m4v", "mkv", "flv"):
        p = os.path.join(cache_dir, "%s.%s" % (bvid, ext))
        if os.path.exists(p):
            return p
    raise RuntimeError("yt-dlp produced no file for %s" % bvid)


def extract_bands(video, out_dir, both_bands=False):
    """One ffmpeg pass -> the caption crops as PNG sequences."""
    bot_dir = os.path.join(out_dir, "bot")
    os.makedirs(bot_dir, exist_ok=True)

    def crop_expr(box):
        x0, y0, x1, y1 = box
        e = "crop=iw*%.4f:ih*%.4f:iw*%.4f:ih*%.4f" % (x1 - x0, y1 - y0, x0, y0)
        if UPSCALE != 1:
            e += ",scale=iw*%d:ih*%d" % (UPSCALE, UPSCALE)
        return e

    if not both_bands:
        run(["ffmpeg", "-loglevel", "error", "-i", video,
             "-vf", "fps=%.6f,%s" % (FPS, crop_expr(BOT)),
             os.path.join(bot_dir, "%05d.png"), "-y"])
        return bot_dir, None

    top_dir = os.path.join(out_dir, "top")
    os.makedirs(top_dir, exist_ok=True)
    fc = ("[0:v]fps=%.6f,split=2[a][b];[a]%s[bot];[b]%s[top]"
          % (FPS, crop_expr(BOT), crop_expr(TOP)))
    run(["ffmpeg", "-loglevel", "error", "-i", video, "-filter_complex", fc,
         "-map", "[bot]", os.path.join(bot_dir, "%05d.png"),
         "-map", "[top]", os.path.join(top_dir, "%05d.png"), "-y"])
    return bot_dir, top_dir


def ocr_lines(path):
    import numpy as np
    from PIL import Image
    res, _ = ocr_engine()(np.array(Image.open(path).convert("RGB")))
    return [r[1] for r in res] if res else []


# --- parsing -----------------------------------------------------------------

# Revenue may be split across OCR detections ("7月总流水：" / "212345万~252792万"),
# so match against the joined line soup rather than any single line. The range
# separator comes back as any of ~ ～ - —.
RE_REV = re.compile(r"(\d{2,9})\s*万\s*(?:[~～\-—]\s*(\d{2,9})\s*万)?")
RE_NAME_TAGGED = re.compile(
    r"(?:正片|第[^：:）)]{1,5}名)\s*[：:日]?\s*([^（(：:，,]{2,24}?)\s*[（(]")
RE_NAME_BARE = re.compile(r"([^（(：:，,\s]{2,24}?)\s*[（(]\s*(?:国产|非)")
# OCR sometimes loses the brackets entirely -- "第一名：原神（国产）" comes back as
# "第一名： 原神 国产", and requiring the bracket cost Genshin four months. Accept
# the 国产/非 marker with the bracket optional.
RE_NAME_NOPAREN = re.compile(
    r"(?:正片|第[^：:）)]{1,5}名)\s*[：:日]?\s*([^（(：:，,\s]{2,24}?)\s*[（(]?\s*(?:国产|非)")
RE_PCT = re.compile(r"([+\-−]?\s*\d{1,4})\s*%")

# A caption carries a rank marker only when it is a real chart entry.
RE_RANK_MARKER = re.compile(r"(正片|第[^：:）)]{1,5}名)")


def clean_name(s):
    s = re.sub(r"^(?:正片|第[^：:]{1,5}名)[：:日]?\s*", "", s or "").strip()
    return re.sub(r"[\s。、,，:：]+$", "", s)


def normalize_name(s):
    """Strip the junk OCR sprays around a caption's game name."""
    s = clean_name(s)
    s = re.sub(r"^[^一-鿿A-Za-z0-9]+", "", s)      # "！ 原神", "0"
    # Same phantom-8 problem on the rank separator: "第一名：原神" reads as
    # "第一名8 原神" and "第十名：光与夜之恋" as "第十名88 光与夜之恋". Strip a short
    # leading digit run only when real CJK follows, so 少女前线2 etc. survive.
    # Circled and full-width digits appear too ("1③闪耀暖暖"), and leaving them on
    # splits a game's history because the variant-folder refuses to merge names
    # whose digits differ -- a guard that exists to keep 崩坏3 and 崩坏学园2 apart.
    s = re.sub(r"^[\d０-９①-⑳]{1,3}\s*(?=[一-鿿])", "", s)
    m = re.match(r"^(\S)\s+(\S{2,})$", s)                   # "学 学园偶像大师"
    if m:
        s = m.group(2)
    return re.sub(r"[\s，,。、：:）)]+$", "", s).strip()


def match_game(name):
    """Map an OCR'd CN name to a tracker slug, tolerating character errors.

    Exact first, then a tight fuzzy pass. The cutoff is deliberately high: at a
    looser threshold 明日方舟 (Arknights) matches 明日方舟：终末地 (Endfield),
    which would silently corrupt the Endfield series.
    """
    if name in NOT_TRACKED:
        return None
    if name in GAMES:
        return GAMES[name]
    for token, slug in GAME_TOKENS:
        if token in name:
            return slug
    hit = difflib.get_close_matches(name, list(GAMES), n=1, cutoff=0.8)
    return GAMES[hit[0]] if hit else None


def parse_band(lines):
    """Pull (name, rev_min, rev_max, pct, mihoyo, metric) out of one frame."""
    joined = " ".join(lines)

    name = None
    m = (RE_NAME_TAGGED.search(joined) or RE_NAME_BARE.search(joined)
         or RE_NAME_NOPAREN.search(joined))
    if m:
        name = clean_name(m.group(1))
    else:
        # Last resort: burned-in dialogue subtitles sometimes run straight into
        # the game name, destroying the 国产/非 marker the patterns above rely on
        # ("第五名：赛马娘月10肖急急永量2"). If the caption still carries a rank
        # marker, look for a tracked title's distinctive fragment in the text
        # right after it -- close enough to the rank that stray subtitle words
        # elsewhere in the frame cannot masquerade as the entry's name.
        rm = RE_RANK_MARKER.search(joined)
        if rm:
            window = joined[rm.end():rm.end() + 24]
            for token, _slug in GAME_TOKENS:
                if token in window:
                    name = token
                    break

    # Anchor on the metric label so stray on-screen numbers are ignored, and keep
    # whichever label was actually used -- it changes across the run.
    rev_min = rev_max = metric = None
    anchor = RE_METRIC.search(joined)
    if anchor:
        metric = canon_metric(anchor.group(1))
        tail = joined[anchor.end():]
        if not anchor.group(2):          # separator missing => it was read as 8
            tail = RE_PHANTOM_8.sub("", tail)
        m = RE_REV.search(tail)
        if m:
            rev_min = int(m.group(1))
            rev_max = int(m.group(2)) if m.group(2) else rev_min

    pct = None
    m = RE_PCT.search(joined)
    if m:
        pct = int(re.sub(r"[\s]", "", m.group(1)).replace("−", "-"))

    # Very rarely the label is mangled past recognition ("第五名：赛马娘月10肖急急
    # 永量2 21062万" -- the "10月总流水" has dissolved into the name). Only 11 of
    # 8931 rank-bearing frames look like this, and every one is a real entry, so
    # accept the figure when the caption still has a rank AND names a tracked
    # game. Requiring both keeps stray subtitle numbers out.
    if rev_min is None:
        rm = RE_RANK_MARKER.search(joined)
        if rm and any(t in joined[rm.end():rm.end() + 24] for t, _ in GAME_TOKENS):
            m2 = RE_REV.search(joined[rm.end():])
            if m2:
                rev_min = int(m2.group(1))
                rev_max = int(m2.group(2)) if m2.group(2) else rev_min
                for token, _slug in GAME_TOKENS:
                    if token in joined[rm.end():rm.end() + 24]:
                        name = token
                        break

    mihoyo = ("米游" in joined) or ("支付中心" in joined)
    return name, rev_min, rev_max, pct, mihoyo, metric


def segment(frames):
    """Split into entries on the revenue value, then vote on the name.

    Revenue OCRs far more reliably than the game name, so the stable field drives
    segmentation and the noisy one gets a vote. Doing it the other way round
    shattered single entries into up to four runs. Frames with no revenue read at
    all are absorbed into the current run -- those are the mid-transition frames.
    """
    # Key on rev_min ALONE. Keying on the (min, max) pair split ranges apart:
    # a frame that read "504070万" but missed the trailing "~600090万" yields
    # (504070, 504070), a different key from (504070, 600090), and the truncated
    # variant could then win the vote -- which is how 鸣潮 lost its range.
    runs, cur = [], None
    for f in frames:
        if f["rev_min"] is None:
            if cur is not None:
                cur["frames"].append(f)
            continue
        if cur is None or f["rev_min"] != cur["rev_min"]:
            cur = {"rev_min": f["rev_min"], "frames": [], "start": f["idx"]}
            runs.append(cur)
        cur["frames"].append(f)

    # A single frame misreading a digit (3707 -> 8707) opens a spurious one-frame
    # run and splits one entry into three. Adjacent runs that vote to the same
    # game name are the same entry, so merge them and let the revenue be decided
    # by the whole group -- the correct value wins on frame count.
    def run_name(r):
        c = collections.Counter()
        for f in r["frames"]:
            n = normalize_name(f["name"]) if f["name"] else None
            if n and len(n) >= 2:
                c[n] += 1
        return c.most_common(1)[0][0] if c else None

    merged, prev_name = [], None
    for r in runs:
        nm = run_name(r)
        if merged and nm and nm == prev_name:
            merged[-1]["frames"].extend(r["frames"])
            # the group's revenue is re-decided below from all its frames
            counts = collections.Counter(f["rev_min"] for f in merged[-1]["frames"]
                                         if f["rev_min"] is not None)
            merged[-1]["rev_min"] = counts.most_common(1)[0][0]
        else:
            merged.append(r)
            prev_name = nm
    runs = merged

    out = []
    for r in runs:
        # Vote only over frames that actually carry this run's revenue. The
        # absorbed transition frames belong to the neighbouring entry visually,
        # and counting them leaked the miHoYo flag onto 鸣潮 and deflated
        # confidence to 0.10 on entries that were in fact read cleanly.
        core = [f for f in r["frames"] if f["rev_min"] == r["rev_min"]]
        if not core:
            continue

        names = collections.Counter()
        for f in core:
            n = normalize_name(f["name"]) if f["name"] else None
            if n and len(n) >= 2:
                names[n] += 1
        # Deliberately NO fallback to the run's absorbed frames: those belong to
        # the neighbouring entry, and borrowing from them labelled Genshin's
        # 223311万 as "Duel". An entry with no name of its own is emitted as
        # unnamed below instead of being given someone else's.
        # A run can carry a revenue with no readable name -- the top entry is
        # on screen only briefly, and if OCR misses its name line in every frame
        # the entry used to be dropped silently. That is how Genshin, always #1
        # or #2, went missing from four months. Keep it as an unnamed row so the
        # gap is visible and fillable by hand; never guess the game from the
        # figure.
        if not names:
            rmin, rmax = r["rev_min"], r["rev_min"]
            ups = collections.Counter(f["rev_max"] for f in core
                                      if f["rev_max"] and f["rev_max"] > rmin)
            for val, cnt in ups.most_common():
                rmax = val
                break
            out.append({
                "name_cn": None, "slug": None, "unnamed": True,
                "rev_min_wan": rmin, "rev_max_wan": rmax,
                "is_range": rmax != rmin,
                "mihoyo": any(f["mihoyo"] for f in core),
                "metric_cn": None, "mom_pct": None,
                "frames": len(core), "name_variants": {}, "confidence": 0.0,
            })
            continue
        name, name_votes = names.most_common(1)[0]

        # A range only counts if more than one frame saw the same upper bound;
        # a lone sighting is more likely an OCR hallucination than a real range.
        uppers = collections.Counter(f["rev_max"] for f in core
                                     if f["rev_max"] and f["rev_max"] > r["rev_min"])
        rmax = r["rev_min"]
        for val, cnt in uppers.most_common():
            if cnt >= 2 or len(core) == 1:
                rmax = val
                break

        metrics = collections.Counter(f["metric"] for f in core if f["metric"])
        pcts = collections.Counter(f["pct"] for f in core if f["pct"] is not None)
        mihoyo = any(f["mihoyo"] for f in core)

        # Prefer the more specific label when both 总流水 and 流水 were read.
        label = None
        if metrics:
            label = sorted(metrics.items(), key=lambda kv: (-kv[1], -len(kv[0])))[0][0]

        out.append({
            "name_cn": name,
            "slug": match_game(name),
            "rev_min_wan": r["rev_min"],
            "rev_max_wan": rmax,
            "is_range": rmax != r["rev_min"],
            "mihoyo": mihoyo,
            "metric_cn": label,
            "mom_pct": pcts.most_common(1)[0][0] if pcts else None,
            "frames": len(core),
            "name_variants": dict(names),
            "confidence": round(name_votes / float(len(core)), 2),
        })
    return out


def check_order(entries):
    """Flag entries that break the chart's own rank ordering.

    Every episode counts DOWN the ranking (第40名 ... 第一名), so revenue must be
    non-decreasing through the run. A violation means a misread figure, which is
    how the phantom-colon bug announced itself: FGO landed above Genshin. This
    catches that whole class of error on episodes nobody hand-checks.
    """
    # Compare on the UPPER bound: the chart ranks miHoYo ranges by their high
    # estimate, so testing a range's minimum against a neighbouring point value
    # flags entries that are in fact correctly placed.
    #
    # Compare against the immediately preceding entry rather than a running max,
    # so one bad row flags itself instead of every correct row after it -- a
    # single misread poisoned the max and produced 13 false breaks in one episode.
    violations = 0
    for a, b in zip(entries, entries[1:]):
        if b["rev_max_wan"] < a["rev_max_wan"]:
            b["order_break"] = True
            violations += 1
    return violations


def ocr_cache_path(bvid, cache_dir):
    return os.path.join(cache_dir, "ocr", "%s.json" % bvid)


def pick_band(bot_lines, top_lines):
    """Choose which band holds this frame's chart entry.

    The top-right region is NOT always the same thing. From ~2024 it shows the
    PREVIOUS month's figure for the same game, but in earlier episodes the
    current entry itself is rendered up there instead of along the bottom --
    which is why Genshin vanished from 2023-01, where frames 360-384s have no
    bottom caption at all.

    Merging the two bands into one blob would be actively harmful: last month's
    number would land in this month's row. A real entry carries a rank marker
    (第N名 / 正片) and a game name; the previous-month box carries neither. So
    prefer the bottom band, fall back to the top band only when it looks like a
    genuine entry, and never take a bare figure from the top.
    """
    b = parse_band(bot_lines)
    if b[0] and b[1] is not None:                 # bottom has name + revenue
        return b
    t = parse_band(top_lines)
    joined_top = " ".join(top_lines)
    if t[0] and t[1] is not None and RE_RANK_MARKER.search(joined_top):
        return t
    return b


def scrape(bvid, cache_dir, both_bands=False, keep=False, drop_video=True,
           use_cache=True):
    """OCR an episode, caching the raw per-frame lines.

    OCR is ~99% of the runtime and its output never changes for a given video,
    while the parsing and segmentation on top of it have needed fixing repeatedly.
    Caching the raw lines turns a re-parse from hours into seconds.
    """
    cpath = ocr_cache_path(bvid, cache_dir)
    if use_cache and os.path.exists(cpath):
        raw = json.load(io.open(cpath, encoding="utf-8"))
        tops = raw.get("frames_top")
        if both_bands and not tops:
            print("  cache is bottom-band only, re-reading frames", file=sys.stderr)
        else:
            print("  %d frames (ocr cache%s)"
                  % (len(raw["frames"]), ", both bands" if tops else ""),
                  file=sys.stderr)
            cur = []
            for i, lines in enumerate(raw["frames"]):
                tl = tops[i] if tops and i < len(tops) else []
                n, lo, hi, pct, mh, mt = pick_band(lines, tl) if tl else parse_band(lines)
                cur.append({"idx": i, "name": n, "rev_min": lo, "rev_max": hi,
                            "pct": pct, "mihoyo": mh, "metric": mt})
            entries = segment(cur)
            bad = check_order(entries)
            if bad:
                print("  WARNING: %d entries break rank ordering" % bad,
                      file=sys.stderr)
            if len(entries) < 12:
                print("  WARNING: only %d entries -- suspect systematic drop"
                      % len(entries), file=sys.stderr)
            return entries, []

    video = fetch_video(bvid, cache_dir)
    work = tempfile.mkdtemp(prefix="bilicn_")
    try:
        bot_dir, top_dir = extract_bands(video, work, both_bands=both_bands)
        bots = sorted(os.listdir(bot_dir))
        tops = sorted(os.listdir(top_dir)) if top_dir else []
        print("  %d frames%s" % (len(bots), " x2 bands" if tops else ""),
              file=sys.stderr)

        cur, raw_bot, raw_top = [], [], []
        for i, fn in enumerate(bots):
            lines = ocr_lines(os.path.join(bot_dir, fn))
            raw_bot.append(lines)
            tl = []
            if tops and i < len(tops):
                tl = ocr_lines(os.path.join(top_dir, tops[i]))
            raw_top.append(tl)
            n, lo, hi, pct, mh, mt = pick_band(lines, tl) if tl else parse_band(lines)
            cur.append({"idx": i, "name": n, "rev_min": lo, "rev_max": hi,
                        "pct": pct, "mihoyo": mh, "metric": mt})

        os.makedirs(os.path.dirname(cpath), exist_ok=True)
        blob = {"bvid": bvid, "fps": FPS, "band": list(BOT), "frames": raw_bot}
        if tops:
            blob["band_top"] = list(TOP)
            blob["frames_top"] = raw_top
        with io.open(cpath, "w", encoding="utf-8") as f:
            json.dump(blob, f, ensure_ascii=False)

        prev = []
        entries = segment(cur)
        bad = check_order(entries)
        if bad:
            print("  WARNING: %d entries break rank ordering" % bad, file=sys.stderr)
        # Every episode in the run charts at least 15 titles. A much smaller
        # yield means frames are being dropped wholesale rather than the chart
        # being short -- that is how the 收人/收入 misread hid, turning a
        # 19-entry episode into 3. Shout rather than record it quietly.
        if len(entries) < 12:
            print("  WARNING: only %d entries -- suspect systematic drop"
                  % len(entries), file=sys.stderr)
        return entries, prev
    finally:
        if keep:
            print("  work dir kept: %s" % work, file=sys.stderr)
        else:
            shutil.rmtree(work, ignore_errors=True)
        if drop_video:
            # ~100MB each; 58 episodes would otherwise leave ~6GB behind.
            try:
                os.remove(video)
            except OSError:
                pass


# --- output ------------------------------------------------------------------

DOC_HEAD = {
    "source": "天天背锅崩坏娘 — 二次元手游全球总流水 (Bilibili)",
    "source_url": "https://space.bilibili.com/20313793",
    "collection_url": "https://space.bilibili.com/20313793/lists/55224?type=season",
    "unit": "cny",
    "scope": "global, all platforms (mobile + PC + PS + overseas Xbox)",
    "method": (
        "The author's stated method, shown on-screen in every recent episode: "
        "base data inferred from Sensor Tower / App Store / Google Play RANKINGS, "
        "not measured revenue. China Android ~2x China iOS (otome 1.5-2x). "
        "Overseas mobile = Google Play + iOS. PC/PS/Xbox estimated per game from "
        "official disclosures, genre and platform launch timing, with per-platform "
        "coefficients 0.3-1.8. miHoYo is exempted from those coefficients, and "
        "miHoYo's undisclosed 支付中心 direct top-up channel is NOT counted at all "
        "-- which is why miHoYo titles are published as a range and flagged "
        "注：暂无支付中心数据."
    ),
    "caveats": [
        "Estimates on estimates: rank-derived, not measured revenue.",
        "Per-game coefficients are NOT published by the author.",
        "The metric label changes across the run and is stored per row as "
        "metric_cn (收入 is normally net of the store cut, 流水 gross billings). "
        "Do not splice rows with different labels into one series.",
        "miHoYo figures are understated: 支付中心 revenue is excluded.",
        "Read by OCR from burned-in video captions; check 'confidence'.",
        "Never zero-filled: a game with no row for a month did not appear in that "
        "month's chart. The archive starts Nov 2021, before most tracked games "
        "launched.",
        "NOT comparable to game-i JP-iOS 億G or to the Sensor Tower USD layer. "
        "Show side by side, never sum.",
    ],
}


def load_doc(path):
    if os.path.exists(path):
        try:
            return json.load(io.open(path, encoding="utf-8"))
        except ValueError:
            pass
    d = dict(DOC_HEAD)
    d["games"] = {}
    d["episodes_done"] = {}
    return d


def save_doc(doc, path):
    doc.update(DOC_HEAD)
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1, sort_keys=False)
    shutil.move(tmp, path)


def report(path):
    doc = json.load(io.open(path, encoding="utf-8"))
    games = doc.get("games", {})
    print("months scraped: %d" % len(doc.get("episodes_done", {})))
    print()
    print("%-12s %-16s %-9s %-9s %5s  %s" %
          ("slug", "name_cn", "first", "last", "n", "metrics seen"))
    for slug in sorted(games):
        g = games[slug]
        ms = sorted(g["monthly"])
        labels = sorted({v.get("metric_cn") or "?" for v in g["monthly"].values()})
        print("%-12s %-16s %-9s %-9s %5d  %s" %
              (slug, g.get("name_cn", ""), ms[0], ms[-1], len(ms), ",".join(labels)))
    print()
    low = [(s, m, v["confidence"])
           for s, g in games.items() for m, v in g["monthly"].items()
           if v.get("confidence", 1) < 0.5]
    print("rows with confidence < 0.5: %d" % len(low))
    for s, m, c in sorted(low)[:20]:
        print("   %-12s %s  %.2f" % (s, m, c))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bvid")
    ap.add_argument("--month", help="data month YYYY-MM")
    ap.add_argument("--index", help="archive index json")
    ap.add_argument("--all", action="store_true", help="every monthly episode")
    ap.add_argument("--since", help="only data months >= this (YYYY-MM)")
    ap.add_argument("--until", help="only data months <= this (YYYY-MM)")
    ap.add_argument("--shard", help="run a slice as I/N, e.g. 2/4, for parallel "
                                    "backfill into separate --out files")
    ap.add_argument("--report", help="summarise an existing output file and exit")
    ap.add_argument("--cache", default=os.path.join(ROOT, ".bilicache"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "cn_revenue.json"))
    ap.add_argument("--both-bands", action="store_true",
                    help="also OCR the previous-month box (doubles runtime)")
    ap.add_argument("--keep-video", action="store_true")
    ap.add_argument("--keep", action="store_true", help="keep frame work dir")
    ap.add_argument("--redo", action="store_true", help="rescrape done months")
    ap.add_argument("--no-ocr-cache", action="store_true",
                    help="ignore the cached OCR lines and re-read frames")
    ap.add_argument("--tracked-only", action="store_true",
                    help="emit only games in GAMES")
    args = ap.parse_args()

    if args.report:
        report(args.report)
        return

    jobs = []
    if args.bvid:
        jobs.append({"bvid": args.bvid, "data_month": args.month})
    elif args.index:
        idx = json.load(io.open(args.index, encoding="utf-8"))
        jobs = [e for e in idx["episodes"]
                if e["kind"] == "monthly" and e["scope"] == "global"]
        jobs.sort(key=lambda e: e["data_month"])
        if args.since:
            jobs = [e for e in jobs if e["data_month"] >= args.since]
        if args.until:
            jobs = [e for e in jobs if e["data_month"] <= args.until]
        if not args.all:
            jobs = jobs[-1:]
        if args.shard:
            i, n = (int(x) for x in args.shard.split("/"))
            # Round-robin, not contiguous blocks: episode length grows over the
            # years, so contiguous slices would finish at very different times.
            jobs = [e for k, e in enumerate(jobs) if k % n == (i - 1) % n]
    else:
        ap.error("need --bvid, --index or --report")

    doc = load_doc(args.out)
    done = doc.setdefault("episodes_done", {})

    for n, job in enumerate(jobs, 1):
        month = job.get("data_month")
        if month in done and not args.redo:
            print("== %s (%s) already done, skipping" % (job["bvid"], month),
                  file=sys.stderr)
            continue
        print("== [%d/%d] %s (%s)" % (n, len(jobs), job["bvid"], month),
              file=sys.stderr)
        try:
            entries, _ = scrape(job["bvid"], args.cache,
                                both_bands=args.both_bands, keep=args.keep,
                                drop_video=not args.keep_video,
                                use_cache=not args.no_ocr_cache)
        except Exception as exc:                       # keep the batch running
            # Recorded as a failure, NOT as done, so a plain re-run retries it.
            print("   FAILED: %s" % exc, file=sys.stderr)
            doc.setdefault("failures", {})[month] = {
                "bvid": job["bvid"], "error": str(exc)[:300]}
            save_doc(doc, args.out)
            continue

        # A caption whose label was mangled past reading leaves metric_cn empty.
        # Fill it from the majority label of the SAME episode -- every entry in
        # one video is on one basis, so this is read from the data rather than
        # assumed. Left empty if the episode itself has no readable label.
        ep_labels = collections.Counter(e["metric_cn"] for e in entries
                                        if e.get("metric_cn"))
        ep_metric = ep_labels.most_common(1)[0][0] if ep_labels else None
        for e in entries:
            if not e.get("metric_cn") and not e.get("unnamed"):
                e["metric_cn"] = ep_metric
                e["metric_inferred_from_episode"] = True

        kept = 0
        for e in entries:
            if e.get("unnamed"):
                # revenue read, name unreadable -- surfaced separately so the
                # month's gap is visible instead of silently disappearing
                doc.setdefault("unnamed_entries", {}).setdefault(month, []).append({
                    "rev_min_cny": e["rev_min_wan"] * 10000,
                    "rev_max_cny": e["rev_max_wan"] * 10000,
                    "frames": e["frames"],
                })
                continue
            slug = e["slug"]
            if args.tracked_only and not slug:
                continue
            key = slug or e["name_cn"]
            rec = doc["games"].setdefault(key, {"name_cn": e["name_cn"],
                                                "monthly": {}})
            rec["monthly"][month] = {
                "rev_min_cny": e["rev_min_wan"] * 10000,
                "rev_max_cny": e["rev_max_wan"] * 10000,
                "is_range": e["is_range"],
                "excludes_mihoyo_payment_center": e["mihoyo"],
                "mom_pct": e["mom_pct"],
                "metric_cn": e["metric_cn"],
                "confidence": e["confidence"],
            }
            if e.get("metric_inferred_from_episode"):
                rec["monthly"][month]["metric_inferred"] = True
            if e.get("order_break"):
                rec["monthly"][month]["order_break"] = True
            kept += 1
        doc.get("failures", {}).pop(month, None)
        done[month] = {"bvid": job["bvid"], "entries": len(entries), "kept": kept}
        save_doc(doc, args.out)
        print("   %d entries, %d kept" % (len(entries), kept), file=sys.stderr)

    print("wrote %s (%d games, %d months)"
          % (args.out, len(doc["games"]), len(done)), file=sys.stderr)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Banner lists for games game-i has no ガチャ分析 page for, read from each game's OFFICIAL
Japanese news feed (plain JSON, no browser needed, so the daily GitHub Action can run it).

    stellasora  stellasora.jp news API: one 「巡遊者ピックアップガチャ【…】」 article per
                Trekker banner, with ▼ピックアップ対象 (★5巡遊者 …) and ▼開催期間.
    czn         STOVE community (Chaos Zero Nightmare JP, channel 11035): one
                「X / Y：ピックアップ救出開催」 post per new banner (Events boards), and the
                「アップデート内容のご案内」 patch notes, which also list permanent-pool
                pickups (reruns) as 「■ 戦闘員【X】… ピックアップ救出開催 / ピックアップ期間：…」.

Only CHARACTER banners are kept (Trekkers / combatants) — the paired Lost Record /
partner banners run on the same dates and are the equivalent of a weapon banner, which
game-i doesn't list for any game either.

Returns banners in scrape.py's shape minus the revenue fields: name (JP, as the official
notice writes it), start, end (YYYY-MM-DD, JST), year, related, banner_img.

    python scripts/official_banners.py stellasora      # print the list
"""
import html, json, re, sys, time, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (gacha-tracker; +https://github.com/)"}


def _get(url, headers=None, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=dict(UA, **(headers or {})))
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def _url(u):
    """Absolute, ASCII-safe image URL ('//cdn…' -> https; Korean file names percent-encoded)."""
    if not u:
        return u
    u = ("https:" + u) if u.startswith("//") else u
    return urllib.parse.quote(u, safe=":/?&=%#~+,;@!$'*()")


def _text(content):
    t = re.sub(r"<br\s*/?>|</p>|</div>|</li>", "\n", content or "")
    t = html.unescape(re.sub(r"<[^>]+>", "", t)).replace("　", " ")
    return re.sub(r"\n\s*\n+", "\n", t)


def _date(s, ref):
    """'2025年10月20日' / '2026/10/21' / '12月03日' (year taken from the post date `ref`,
    rolled forward when the month is earlier than the post's) -> date."""
    m = re.search(r"(\d{4})\s*[年/]\s*(\d{1,2})\s*[月/]\s*(\d{1,2})", s)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日", s)
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        y = ref.year + (1 if mo < ref.month - 6 else 0)
        return date(y, mo, d)
    return None


def _period(line, ref):
    """'A～B' -> (start, end), each the calendar date as written (JST). Like game-i's own
    banner dates, a run ending on the morning of the next banner's day keeps that day as
    its end; the site's same-day-handover handling takes it from there."""
    parts = re.split(r"[～〜~]", line, maxsplit=1)
    if len(parts) != 2:
        return None
    a = _date(parts[0], ref)
    b = _date(parts[1], a or ref)
    return (a, b) if (a and b and b >= a) else None


# ---------------------------------------------------------------- Stella Sora
SS_API = "https://stellasora.jp/api/resource/news"


def stellasora():
    rows, i = [], 1
    while True:
        d = _get(f"{SS_API}?index={i}&size=50&type=latest")["data"]
        rows += d["rows"]
        if len(rows) >= d["count"] or not d["rows"]:
            break
        i += 1
    out = []
    for r in rows:
        if not r["title"].startswith("巡遊者ピックアップガチャ"):
            continue
        det = _get(f"{SS_API}/{r['id']}")["data"]["news"]
        t = _text(det["content"])
        ref = datetime.fromtimestamp(int(det["publishTime"]) / 1000, JST).date()
        sec = t.split("ピックアップ対象", 1)[-1].split("開催期間", 1)[0]
        # 'ラール（聖夜）（CV：…）' — keep a variant tag like （聖夜） / （水着） with the name
        stars = re.findall(r"★5巡遊者(?:\s*[(（][^)）]*[)）])?\s*"
                           r"([^\s（(※・]+(?:[（(](?!CV)[^)）]*[)）])?)\s*[（(]CV", sec)
        m = re.search(r"開催期間\s*[:：]?\s*\n?\s*([^\n]+)", t)
        per = _period(m.group(1), ref) if m else None
        if not (stars and per):
            print(f"[stellasora] skipped {r['id']} {r['title']}: no ★5/period", file=sys.stderr)
            continue
        img = re.search(r'<img[^>]+src="([^"]+)"', det["content"])
        title = re.search(r"【(.+?)】", r["title"])
        out.append({"name": "・".join(dict.fromkeys(stars)),
                    "start": per[0].isoformat(), "end": per[1].isoformat(),
                    "year": per[0].year,
                    "related": title.group(1) if title else "",
                    "banner_img": _url(img.group(1) if img else det.get("thumbnail")),
                    # 熟練巡遊者募集 = a rate-up on an existing standard-pool Trekker, not a debut
                    "standard": "熟練巡遊者募集" in r["title"],
                    "src": f"https://stellasora.jp/news/{r['id']}"})
    return _dedupe(out)


# ---------------------------------------------------------------- Chaos Zero Nightmare
STOVE = "https://api.onstove.com/cwms/v3.0"
STOVE_H = {"Origin": "https://page.onstove.com", "Referer": "https://page.onstove.com/"}
CZN_EVENT_BOARDS = (139266, 139267)      # 開催中のイベント, 終了したイベント
CZN_NOTE_BOARDS = (139263, 142491)       # お知らせ (maintenance + patch notes), 更新内容


def _stove_list(board):
    out, p = [], 1
    while True:
        u = (f"{STOVE}/article_group/BOARD/{board}/article/list?interaction_type_code=VIEW"
             f"&content_yn=N&summary_yn=N&sort_type_code=LATEST&page={p}&size=50")
        L = _get(u, STOVE_H)["value"].get("list") or []
        out += L
        if len(L) < 50:
            return out
        p += 1


def _stove_body(aid):
    v = _get(f"{STOVE}/article?article_id={aid}&interaction_type_code=VIEW"
             f"&translation_yn=N&request_id=CM", STOVE_H)["value"]
    return v.get("content", ""), _text(v.get("content", ""))


def czn():
    out = []
    posts = [a for b in CZN_EVENT_BOARDS for a in _stove_list(b)
             if re.search(r"ピックアップ救出開催|救出開催", a["title"])]
    notes = [a for b in CZN_NOTE_BOARDS for a in _stove_list(b)
             if "アップデート内容" in a["title"]]
    for a in posts:                       # the launch post is just 「ハル / アステリア 救出開催」
        raw, t = _stove_body(a["article_id"])
        ref = datetime.fromtimestamp(a["create_datetime"] / 1000, JST).date()
        m = re.search(r"救出期間\s*[:：]?\s*\n?\s*([^\n]+)", t)
        per = _period(m.group(1), ref) if m else None
        names = re.findall(r"戦闘員「([^」]+)」", t)
        if not names:                     # title form: 'チズル / イツク：…' -> combatant first
            names = [re.sub(r"[◤◢\s]", "", a["title"]).split("/")[0]]
        if not per:
            print(f"[czn] skipped {a['article_id']} {a['title']}: no period", file=sys.stderr)
            continue
        names = [n for n in names if not re.search(r"★4", t.split(n)[0][-6:])]   # drop ★4 co-features
        imgs = [_url(u) for u in re.findall(r'<img[^>]+src="([^"]+)"', raw)]
        out.append({"name": "・".join(dict.fromkeys(names)), "start": per[0].isoformat(),
                    "end": per[1].isoformat(), "year": per[0].year, "related": "",
                    "banner_img": imgs, "standard": False,
                    "src": f"https://page.onstove.com/chaoszeronightmare/jp/view/{a['article_id']}"})
    # patch notes: every 「■ … 戦闘員【X】 … ピックアップ救出開催」 block + its period line —
    # catches reruns (常設ピックアップ救出), which get no post of their own
    for a in notes:
        raw, t = _stove_body(a["article_id"])
        ref = datetime.fromtimestamp(a["create_datetime"] / 1000, JST).date()
        lines = t.splitlines()
        for i, ln in enumerate(lines):
            m = re.search(r"■.*?戦闘員【([^】]+)】.*ピックアップ救出", ln)
            if not m:
                continue
            per = None
            for nxt in lines[i + 1:i + 25]:          # the block runs to the next ■ heading
                if nxt.lstrip().startswith("■"):
                    break
                if "期間" in nxt and re.search(r"\d+\s*[月/]", nxt):
                    per = _period(nxt.split("期間", 1)[1].lstrip("：: "), ref)
                    break
            if per:
                out.append({"name": m.group(1), "start": per[0].isoformat(), "end": per[1].isoformat(),
                            "year": per[0].year, "related": "", "banner_img": None,
                            # 常設ピックアップ = a rerun of an earlier combatant on the normal pool
                            "standard": "常設" in ln,
                            "src": f"https://page.onstove.com/chaoszeronightmare/jp/view/{a['article_id']}"})
    # each post is header image + banner art + footer image; the header/footer repeat on
    # every post, so the banner art is the post's first image no other post uses
    from collections import Counter
    seen = Counter(u for b in out if isinstance(b["banner_img"], list) for u in set(b["banner_img"]))
    for b in out:
        if isinstance(b["banner_img"], list):
            own = [u for u in b["banner_img"] if seen[u] == 1]
            b["banner_img"] = (own or b["banner_img"] or [None])[0]
    return _dedupe(out)


def _dedupe(rows):
    """One banner per (start, headliner); a later source only fills gaps (art, end)."""
    seen = {}
    for b in sorted(rows, key=lambda x: (x["start"], x["name"], x["banner_img"] is None)):
        k = (b["start"], b["name"].split("・")[0])
        if k in seen:
            if not seen[k]["banner_img"] and b["banner_img"]:
                seen[k]["banner_img"] = b["banner_img"]
            continue
        seen[k] = b
    return sorted(seen.values(), key=lambda x: (x["start"], x["name"]))


# ---------------------------------------------------------------- Love and Deepspace
# Infold publishes every new limited ★5 event as a Japanese PR TIMES release (its own JP news
# posts are images). The company feed holds its latest 100 releases (Love and Deepspace and
# Infinity Nikki mixed); release URLs are numbered, so anything older than the feed's window
# is fetched by number. One release can carry several gachas: each starts on a header line —
#   「X」星5思念期間限定確率UPガチャ開催 / 「X」星5セット思念… / 限定願う「X」開催 (birthdays
#   and single-lead limited wishes) / 復刻願う「X」開催 / イベント「X」開催 (2024 — kept only when
#   its text raises a ★5's 確率, since story events use the same wording) /
#   - X：星5思念期間限定確率UPガチャ開催 (2024) / 星5思念「ホムラ・…」が限定販売 (launch week)
# followed by (■)イベント期間 / 期間 / 獲得期限 and the ★5 memories as 【カレ・思念名】.
PRT_FEED = "https://prtimes.jp/companyrdf.php?company_id=131862"      # INFOLD PTE. LTD.
PRT_REL = "https://prtimes.jp/main/html/rd/p/{:09d}.000131862.html"
# JP -> EN for the five leads (gamerch's JP wiki list; シン arrived with Ver2.0 in July 2024
# and マヒル with Ver3.0 in January 2025, matching Sylus and Caleb)
LADS_LEADS = {"セイヤ": "Xavier", "レイ": "Zayne", "ホムラ": "Rafayel", "シン": "Sylus", "マヒル": "Caleb"}
_LADS_HEAD = re.compile(r"確率UPガチャ開催|復刻願う|限定願う「|限定販売|^イベント「[^」]+」開催$")


def _page(url, tries=3):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8")
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def _lads_release(n):
    """(publish date, banner image, body text) of release n, or None if it isn't Love and Deepspace."""
    try:
        h = _page(PRT_REL.format(n))
    except Exception:
        return None
    title = html.unescape((re.search(r'<meta property="og:title" content="([^"]*)"', h) or [None, ""])[1])
    if "恋と深空" not in title:
        return None
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日\s*\d{1,2}時\d{1,2}分", h)
    pub = date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None
    img = (re.search(r'<meta property="og:image" content="([^"]+)"', h) or [None, None])[1]
    if img:                                    # the query is only a resize: keep the original
        img = html.unescape(img).split("?", 1)[0]
    h = re.sub(r"<(script|style).*?</\1>", "", h, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", re.sub(r"<br\s*/?>", "\n", h)))
    t = re.sub(r"[ \t　]+", " ", t)
    t = re.sub(r"「\s*\n\s*", "「", re.sub(r"\s*\n\s*」", "」", t))      # names split across lines
    t = re.sub(r"\n\s*\n+", "\n", t)
    end = t.find("『恋と深空』とは")
    return pub, img, (t[:end] if end > 0 else t)


def _lads_blocks(t, pub, img, src):
    lines = [l.strip() for l in t.split("\n")]
    heads = [i for i, l in enumerate(lines) if _LADS_HEAD.search(l) and "報酬" not in l]
    out = []
    for k, i in enumerate(heads):
        head = lines[i]
        body = lines[i + 1:(heads[k + 1] if k + 1 < len(heads) else i + 14)]
        if "限定販売" in head:                     # launch-week item: 星5思念「ホムラ・花火のごとき誓い」が限定販売
            m = re.search(r"「([^」・]+)・([^」]+)」", head)
            name = m.group(2) if m else None
        else:
            m = re.search(r"「([^」]+)」", head) or re.search(r"^[-‐・\s]*([^：:]+)[：:]", head)
            name = m.group(1).strip() if m else None
        per = None
        for l in body[:6]:
            pm = re.search(r"(?:イベント期間|期間|獲得期限)\s*[:：]\s*(.+)", l)
            if pm:
                per = _period(pm.group(1), pub); break
        stars = []
        for l in [head] + body:
            if "星5" not in l:
                continue
            for jp, _ in re.findall(r"[【「]([^】」・]+)・([^】」]+)[】」]", l):
                if jp in LADS_LEADS and jp not in stars:
                    stars.append(jp)
        if head.startswith("イベント") and not any("確率" in l for l in body[:5]):
            continue                              # a story event, not a gacha
        if not (name and per and stars):
            if name and not head.startswith("イベント"):
                print(f"[lads] skipped 「{name}」 in {src}: {'no period' if not per else 'no ★5'}", file=sys.stderr)
            continue
        out.append({"name": name, "start": per[0].isoformat(), "end": per[1].isoformat(), "year": per[0].year,
                    "related": "", "banner_img": img, "standard": False,
                    # 復刻 = an earlier event's ★5 memories back again
                    "rerun_hint": "復刻" in head,
                    "agents": [LADS_LEADS[j] for j in stars], "en": " & ".join(LADS_LEADS[j] for j in stars),
                    "src": src})
    return out


# The English names, and the wishes the press releases never announce (reruns, single-★5
# limited wishes), come from the Fandom wiki's 「Limited Wish Pools」 table: one row per wish
# with its English name, its dates ("May 22nd, After Update - May 31st, 2026 04:59") and its
# ★5 memories; each memory's own page names its lead (| Character = …). The wiki is kept by
# players and runs a few months behind, so it only adds to what the releases give.
FANDOM_API = "https://loveanddeepspace.fandom.com/api.php"
_MONTHS = {m: i + 1 for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July",
                                           "August", "September", "October", "November", "December"])}


def _fandom(**p):
    p["format"] = "json"
    return _get(FANDOM_API + "?" + urllib.parse.urlencode(p))


def _fandom_dates(text):
    hits = re.findall(r"(January|February|March|April|May|June|July|August|September|October|November|December)"
                      r"\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?", text)
    if len(hits) < 2:
        return None
    (m1, d1, y1), (m2, d2, y2) = hits[0], hits[1]
    if not y2:
        return None
    y2 = int(y2)
    y1 = int(y1) if y1 else (y2 - 1 if _MONTHS[m1] > _MONTHS[m2] else y2)
    try:
        return date(y1, _MONTHS[m1], int(d1)), date(y2, _MONTHS[m2], int(d2))
    except ValueError:
        return None


def _fandom_wishes():
    """[(start, end, English name, [leads])] from the wiki's limited wish table, oldest first."""
    w = _fandom(action="parse", page="Wish/Limited Wish Pools", prop="wikitext")["parse"]["wikitext"]["*"]
    rows = []
    for r in w.split("\n|-"):
        sch = re.search(r"<small>(.*?)</small>", r, re.S)
        f = re.search(r"\[\[File:([^|\]]+)\|[^\]]*?(?:link=([^|\]]+))?\]\]", r)
        mem = re.findall(r"\{\{Memory Border\|([^|}]+)\|", r)
        per = _fandom_dates(re.sub(r"<[^>]+>", " ", sch.group(1))) if sch else None
        if not (per and f and mem):
            continue
        name = re.sub(r"^Limited Wish Pool:\s*", "", (f.group(2) or "").strip()) \
            or re.sub(r"(?i)[ _]banner|\.(png|jpe?g|webp)$", "", f.group(1)).replace("_", " ").strip()
        rows.append((per[0], per[1], name, mem))
    # each memory's lead, 50 pages a request
    titles = sorted({m for *_, ms in rows for m in ms})
    lead = {}
    for i in range(0, len(titles), 50):
        q = _fandom(action="query", prop="revisions", rvprop="content", rvslots="main",
                    titles="|".join(titles[i:i + 50]), redirects=1)["query"]
        for p in q.get("pages", {}).values():
            c = (p.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("*", "")
            m = re.search(r"\|\s*Character\s*=\s*([A-Za-z]+)", c)
            if m:
                lead[p["title"]] = m.group(1)
        for r in q.get("redirects", []):
            if r["to"] in lead:
                lead[r["from"]] = lead[r["to"]]
    out = []
    for s, e, name, mem in sorted(rows):
        leads = list(dict.fromkeys(lead[m] for m in mem if lead.get(m) in LADS_LEADS.values()))
        if leads:
            out.append((s, e, name, leads))
    return out


# The Chinese edition runs the SAME wish calendar as global — every global rerun / single-★5
# wish the Fandom table lists sits on the same dates there (When Tides Echo 2025-03-20 =
# 潮声回唱之时, Kitten Included 2026-05-22 = 爱猫及喵) — and the Bilibili wiki (BWIKI) keeps a
# page per wish (template 游戏活动: 活动类型=许愿, 开始/结束时间, 活动思念, the leads as 祁煜·…).
# It fills what neither the releases nor the wiki table cover (reruns after May 2026). BWIKI
# throttles scripts hard (HTTP 567 after a burst), so its list is kept in the repo
# (icons/names/lads_cn_wishes.json) and only topped up here, gently and never fatally.
BWIKI_API = "https://wiki.biligame.com/lysk/api.php"
LADS_CN = {"沈星回": "Xavier", "黎深": "Zayne", "祁煜": "Rafayel", "秦彻": "Sylus", "夏以昼": "Caleb"}


def _bwiki(**p):
    p["format"] = "json"
    return _get(BWIKI_API + "?" + urllib.parse.urlencode(p), {"User-Agent": "Mozilla/5.0"})


def _cn_wishes(root):
    path = root / "icons" / "names" / "lads_cn_wishes.json"
    have = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    try:
        titles, cont = [], {}
        while True:
            r = _bwiki(action="query", list="embeddedin", eititle="Template:游戏活动", eilimit=500, **cont)
            titles += [x["title"] for x in r["query"]["embeddedin"]]
            if "continue" not in r:
                break
            cont = r["continue"]
        known = {w["title"] for w in have}
        new = [t for t in titles if t not in known]
        for i in range(0, len(new), 10):
            q = _bwiki(action="query", prop="revisions", rvprop="content", rvslots="main",
                       titles="|".join(new[i:i + 10]))["query"]
            for pg in q.get("pages", {}).values():
                c = (pg.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("*", "")
                g = lambda k: re.sub(r"<!--.*?-->", "", (re.search(r"\|" + k + r"=([^\n|]*)", c) or [None, ""])[1]).strip()
                d = lambda v: re.match(r"\s*(\d{4})-(\d{1,2})-(\d{1,2})", v)
                ms, me = d(g("开始时间")), d(g("结束时间"))
                leads = list(dict.fromkeys(re.findall(r"(沈星回|黎深|祁煜|秦彻|夏以昼)·", c)))
                if g("活动类型") != "许愿" or "卡池" not in g("许愿类型") or not (ms and me and leads):
                    continue
                s_ = "%04d-%02d-%02d" % tuple(map(int, ms.groups()))
                e_ = "%04d-%02d-%02d" % tuple(map(int, me.groups()))
                have.append({"start": s_, "end": e_ if e_ >= s_ else s_[:4] + e_[4:], "title": pg["title"],
                             "type": g("许愿类型"), "memories": g("活动思念"), "leads": leads})
            time.sleep(1.0)
        have.sort(key=lambda w: w["start"])
        path.write_text(json.dumps(have, ensure_ascii=False, indent=0), encoding="utf-8")
    except Exception as e:
        print(f"[lads] BWIKI refresh skipped (non-fatal): {e}", file=sys.stderr)
    return have


# gamerch's JP wiki keeps the in-game Japanese name of EVERY limited wish, with its dates and ★5
# memories (【カレ・思念名】) — the solo wishes no release announces (猫にくびったけ) and the reruns
# that run beside a bigger banner (時と世界の境界 2026). Newest first; a row with no year
# (8/17(月)…) takes the year of the row above it. Kept in the repo like the BWIKI list.
GAMERCH_WISHES = "https://gamerch.com/loveanddeepspace/841087"


def _jp_wishes(root):
    path = root / "icons" / "names" / "lads_jp_wishes.json"
    have = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    try:
        raw = _page(GAMERCH_WISHES)
        # each wish's section opens with its title card (the solo wishes' only art)
        cards = {}
        for m in re.finditer(r"<h3[^>]*>\s*([^<]+?)\s*</h3>", raw):
            img = re.search(r"<img[^>]*data-(?:original|src)=\"(https://cdn\.gamerch\.com/contents/[^\"]+)\"",
                            raw[m.end():m.end() + 3000])
            cards.setdefault(re.sub(r"\s*\[復刻\]$", "", html.unescape(m.group(1))), []).append(img and img.group(1))
        t = html.unescape(re.sub(r"<[^>]+>", "\t", raw))
        t = re.sub(r"[ \t]*\t[ \t\n]*", "|", t)
        t = t[t.find("限定願う開催一覧", t.find("限定願う開催一覧|") + 10):]
        parts = re.split(r"\|([^|]{1,40}?)\|開催期間\|([^|]+)\|", t)
        rows, year = [], None
        for k in range(1, len(parts) - 2, 3):
            name, per, body = parts[k], parts[k + 1], parts[k + 2]
            mem = list(dict.fromkeys(re.findall(r"\|((?:セイヤ|レイ|ホムラ|シン|マヒル)・[^|]+)\|★5\|", body)))
            ds = re.findall(r"(?:(\d{4})/)?(\d{1,2})/(\d{1,2})", per)
            if "BOX" in name or len(ds) < 2:
                continue
            (y1, m1, d1), (y2, m2, d2) = ds[0], ds[1]
            year = int(y1) if y1 else year
            if year is None:
                continue
            s = date(year, int(m1), int(d1))
            e = date(int(y2) if y2 else year + (int(m2) < int(m1)), int(m2), int(d2))
            if (e - s).days > 60:                 # a typo'd month (2025/2/18~12/27 is 12/18~12/27)
                s = s.replace(month=e.month, year=e.year)
            name_ = re.sub(r"\s*\[復刻\]\s*$", "", name).strip()
            card = cards.get(name_) or [None]
            rows.append({"name": name_, "start": s.isoformat(), "end": e.isoformat(),
                         "rerun": "[復刻]" in name or "【復刻】" in body[:80], "mem": mem,
                         "leads": list(dict.fromkeys(LADS_LEADS[m.split("・")[0]] for m in mem)),
                         "card": card.pop(0) if len(card) > 1 else card[0]})
        if len(rows) >= len(have):
            have = sorted(rows, key=lambda w: w["start"])
            path.write_text(json.dumps(have, ensure_ascii=False, indent=0), encoding="utf-8")
    except Exception as e:
        print(f"[lads] gamerch wish list refresh skipped (non-fatal): {e}", file=sys.stderr)
    return have


def _keep_card(root, url):
    """gamerch's CDN wants its own Referer, so a title card is kept in the repo
    (icons/banner_art/lads-<hash>.webp) and the banner points at that copy."""
    import hashlib
    rel = "icons/banner_art/lads-" + hashlib.md5(url.encode()).hexdigest()[:10] + ".webp"
    path = root / rel
    if not path.exists():
        try:
            req = urllib.request.Request(url, headers=dict(UA, Referer="https://gamerch.com/"))
            data = urllib.request.urlopen(req, timeout=30).read()
            try:
                import io
                from PIL import Image
                Image.open(io.BytesIO(data)).convert("RGB").save(path, "WEBP", quality=85)
            except ImportError:
                path = path.with_suffix(url[url.rfind("."):])
                rel = rel[:rel.rfind(".")] + path.suffix
                path.write_bytes(data)
        except Exception as e:
            print(f"[lads] title card {url} not kept (non-fatal): {e}", file=sys.stderr)
            return None
    return rel


# English names for wishes the Fandom table doesn't have yet (it stops at May 2026). From the
# global account's posts (x.com/Love_Deepspace: In Earnest Hope, Lingering Light), Fandom's
# memory pages (Obtain = Limited Wish Pool: Po Zhen Zi / Once Upon a Frame / Secret's Kiss /
# Your Skyblue) and the banner schedules at enjoygm.com / ldshop.gg for the rest.
LADS_EN = {"密やかなキス": "Secret's Kiss", "心のままに願いへ": "Heartbound Wish", "日常の来処": "Tranquil Moments",
           "猫にくびったけ": "Kitten Included", "この空の全てを": "Your Skyblue", "一幕一会": "Once Upon a Frame",
           "湧き来る夏": "Summer Surge", "破陣子": "Po Zhen Zi", "戦塵が舞う中": "When Embers Rise",
           "逢える日を胸に": "In Earnest Hope", "今宵、眠れぬなら": "A Night That Never Ends",
           "この一瞬に願いを": "Lingering Light", "幾年も光と": "Lights Evermore"}


def lads():
    feed = _page(PRT_FEED)
    ids = sorted({int(n) for n in re.findall(r"/rd/p/(\d{9})\.000131862\.html", feed)})
    ids = list(range(1, ids[0])) + ids if ids else []
    out = []
    for n in ids:
        r = _lads_release(n)
        if r and r[0]:
            out += _lads_blocks(r[2], r[0], _url(r[1]), PRT_REL.format(n))
        time.sleep(0.3)
    try:
        wishes = _fandom_wishes()
    except Exception as e:                    # names / extra wishes are a bonus: never fail the list
        print(f"[lads] Fandom wish table unavailable (non-fatal): {e}", file=sys.stderr)
        wishes = []
    seen = set()
    for s, e, name, leads in wishes:
        # the same wish as a press-release banner (same start, a shared lead): its English name
        mine = [b for b in out if abs((date.fromisoformat(b["start"]) - s).days) <= 1
                and set(b["agents"]) & set(leads) and not b.get("title_en")]
        if mine:
            mine[0]["title_en"] = name
        else:                                 # a wish no release announced: a banner of its own
            out.append({"name": name, "start": s.isoformat(), "end": e.isoformat(), "year": s.year,
                        "related": "", "banner_img": None, "standard": False,
                        "rerun_hint": name.lower() in seen,
                        "agents": leads, "en": " & ".join(leads), "title_en": name,
                        "src": "https://loveanddeepspace.fandom.com/wiki/Wish/Limited_Wish_Pools"})
        seen.add(name.lower())
    # BWIKI: a wish neither the releases nor the Fandom table cover is a banner of its own. A rerun
    # (title 「X」2026) is named after its first run's global banner, found by the first run's dates.
    from pathlib import Path
    cn = _cn_wishes(Path(__file__).resolve().parent.parent)
    base = lambda t: re.sub(r"^「|」.*$", "", t)
    first_cn = {}
    for w in cn:
        first_cn.setdefault(base(w["title"]), w)
    for w in cn:
        s, e = date.fromisoformat(w["start"]), date.fromisoformat(w["end"])
        leads = [LADS_CN[x] for x in w["leads"] if x in LADS_CN]
        if not leads or any(abs((date.fromisoformat(b["start"]) - s).days) <= 1 and set(b["agents"]) & set(leads)
                            for b in out):
            continue
        orig = first_cn[base(w["title"])]
        src = next((b for b in out if orig is not w and abs((date.fromisoformat(b["start"]) -
                    date.fromisoformat(orig["start"])).days) <= 1 and set(b["agents"]) & set(leads)), None)
        out.append({"name": src["name"] if src else base(w["title"]), "start": s.isoformat(), "end": e.isoformat(),
                    "year": s.year, "related": "", "banner_img": src["banner_img"] if src else None,
                    "standard": False, "rerun_hint": orig is not w, "agents": leads, "en": " & ".join(leads),
                    "title_en": src.get("title_en") if src else None,
                    "src": "https://wiki.biligame.com/lysk/" + urllib.parse.quote(w["title"])})
    # gamerch: every banner goes by its Japanese wish name. A release already names the wish
    # (gamerch at times files a 2024 wish under its memory: 沸き立つ灼光 for 灼熱の祝福), so only
    # the wiki-sourced banners are renamed. A wish nothing else lists becomes a banner of its own,
    # with its first run's art.
    root = Path(__file__).resolve().parent.parent
    jp = _jp_wishes(root)
    near = lambda a, b: abs((date.fromisoformat(a) - date.fromisoformat(b)).days) <= 1
    same = lambda g, b: near(g["start"], b["start"]) and (not g["leads"] or set(g["leads"]) & set(b["agents"]))
    extra = [g for g in jp if g["leads"] and not any(same(g, b) for b in out)]
    for b in out:
        hits = sorted((g for g in jp if same(g, b)), key=lambda g: g["rerun"])    # new wish, then rerun
        if len(hits) > 1 and "&" not in b["name"]:   # a birthday's new wish and its rerun: this half only
            hits = [g for g in hits if g["name"] == b["name"]] or \
                   [g for g in hits if g["rerun"] == bool(b.get("rerun_hint"))][:1] or hits[:1]
        if hits:
            b["mem"] = [m for g in hits for m in g["mem"]]
            b["card"] = hits[0].get("card")
            if "prtimes.jp" not in b["src"]:
                b["name"] = "&".join(g["name"] for g in hits)
    for g in extra:
        src = next((b for b in sorted(out, key=lambda x: x["start"]) if b["name"] == g["name"]
                    and b["start"] < g["start"]), None)
        out.append({"name": g["name"], "start": g["start"], "end": g["end"], "year": int(g["start"][:4]),
                    "related": "", "banner_img": src["banner_img"] if src else None, "standard": False,
                    "rerun_hint": g["rerun"], "agents": g["leads"], "en": " & ".join(g["leads"]),
                    "title_en": src.get("title_en") if src else None, "mem": g["mem"], "card": g.get("card"),
                    "src": GAMERCH_WISHES})
    # One wish, one name: runs with the same ★5 memories share the LATEST run's names — a rerun is
    # announced under the wish's name where the first run used its memory's (花火のごとき誓い →
    # 夜空のさざ波; Fandom's Heartstring Symphony → Everlasting Dream).
    runs = {}
    for b in sorted(out, key=lambda x: x["start"]):
        if b.get("mem") and "&" not in b["name"]:
            runs.setdefault(frozenset(b["mem"]), []).append(b)
    for rs in runs.values():
        en = next((r["title_en"] for r in reversed(rs) if r.get("title_en")), None)
        for r in rs:
            r["name"], r["title_en"] = rs[-1]["name"], en or r.get("title_en")
    # English: Fandom's name where it has one, else LADS_EN; a pair reads as its halves' names
    en = dict(LADS_EN)
    for b in out:
        if b.get("title_en") and "&" not in b["name"]:
            en.setdefault(b["name"], b["title_en"])
    for b in out:
        halves = b["name"].split("&")
        if all(h in en for h in halves):
            b["title_en"] = " & ".join(en[h] for h in halves)
    # a wish no release or rerun lends art to (the solo wishes) shows its gamerch title card
    arted = {b["name"] for b in out if b["banner_img"]}       # reruns borrow their first run's art
    for b in out:
        b.pop("mem", None)
        card = b.pop("card", None)
        if not b["banner_img"] and card and b["name"] not in arted:
            b["banner_img"] = _keep_card(root, card)
    # a rerun the wiki has no row for keeps the English name its first run had (帰らぬ夜 →
    # No-Return Night)
    first = {}
    for b in sorted(out, key=lambda x: x["start"]):
        if b.get("title_en"):
            first.setdefault(b["name"], b["title_en"])
        elif b["name"] in first:
            b["title_en"] = first[b["name"]]
    # The site names a Love and Deepspace banner by its WISH (Throne of Eros), never by its leads:
    # the same five leads run every banner, so "Xavier" says nothing about which one it was. With
    # no English name yet, the banner goes by its own (Japanese) wish name. `leads` keeps who it
    # features — for the icons and the character search.
    for b in out:
        b["leads"] = b["agents"]
        b["agents"], b["en"] = ([b["title_en"]], b["title_en"]) if b.get("title_en") else ([], "")
    return _dedupe(out)


SOURCES = {"stellasora": stellasora, "czn": czn, "lads": lads}

CZN_CHAR_BOARD = 139270                  # 要員情報: one introduction post per character


def character_art(tag):
    """{JP headliner -> character art URL}. CZN's banner art is a red-washed promo with the
    title over it; its 要員情報 board has a 「キャラクター性能紹介 - X」 post per combatant whose
    first image is a clean character sheet (same template for everyone), which reads far
    better on the site. Stella Sora's banner art is already a clean character shot: {}."""
    if tag != "czn":
        return {}
    out = {}
    try:
        for a in sorted(_stove_list(CZN_CHAR_BOARD), key=lambda x: x["create_datetime"]):
            # 「キャラクター性能紹介 - X」, or the launch-era 「◤<tagline> - X◢」 (partners use 「X」)
            m = (re.search(r"キャラクター性能紹介\s*[-ー－]\s*([^\s◢]+)", a["title"])
                 or re.search(r"\s[-ー－]\s*([^\s◢「」]+)◢\s*$", a["title"]))
            if not m:
                continue
            raw = _stove_body(a["article_id"])[0]
            img = re.search(r'<img[^>]+src="([^"]+)"', raw)
            if img:                              # the newest introduction wins (re-releases)
                out[m.group(1)] = _url(img.group(1))
    except Exception as e:
        print(f"[czn] character art lookup failed (non-fatal): {e}", file=sys.stderr)
    return out


# ---------------------------------------------------------------- English names
# Both games publish the same notices in English on the same day, so a JP headliner is
# matched to the EN one announced on the same date (±1 day), in the same order. The map
# is cached in icons/names/<tag>_map.json and only ever grows (a missed match keeps the
# JP name until a later run finds it).
SS_EN_API = "https://stellasora.global/api/resource/news"
CZN_EN_EVENT_BOARDS, CZN_EN_NOTE_BOARDS = (139240, 139241), (139238, 142421)
SEED = {"stellasora": {"チトセ": "Chitose", "シア": "Shia"}}   # launch banners had no EN notice


def _day(ms):
    return datetime.fromtimestamp(int(ms) / 1000, JST).date()


def _ss_pairs():
    jp, en = [], []
    rows, i = [], 1
    while True:
        d = _get(f"{SS_API}?index={i}&size=50&type=latest")["data"]
        rows += d["rows"]
        if len(rows) >= d["count"] or not d["rows"]:
            break
        i += 1
    for r in rows:
        if r["title"].startswith("巡遊者ピックアップガチャ"):
            det = _get(f"{SS_API}/{r['id']}")["data"]["news"]
            sec = _text(det["content"]).split("ピックアップ対象", 1)[-1].split("開催期間", 1)[0]
            s = re.findall(r"★5巡遊者(?:\s*[(（][^)）]*[)）])?\s*([^\s（(※・]+(?:[（(](?!CV)[^)）]*[)）])?)\s*[（(]CV", sec)
            if s:
                jp.append((_day(r["publishTime"]), s[0]))
    rows, i = [], 1
    while True:
        d = _get(f"{SS_EN_API}?index={i}&size=50&type=latest")["data"]
        rows += d["rows"]
        if len(rows) >= d["count"] or not d["rows"]:
            break
        i += 1
    for r in rows:
        m = re.match(r"(.+?)\s+(?:exclusive\s+)?(?:limited|exclusive)\s+recruitment", r["title"], re.I)
        if m:
            en.append((_day(r["publishTime"]), m.group(1).strip()))
    return [(jp, en)]


def _czn_pairs():
    """(JP, EN) lists of (date, combatant) — event posts and patch-note headings."""
    def heads(boards, post_re, note_re, note_title):
        posts, notes = [], []
        for b in boards:
            for a in _stove_list(b):
                d = _day(a["create_datetime"])
                if re.search(post_re, a["title"], re.I):
                    t = re.sub(r"[◤◢]|\(.*?\)|（.*?）", "", a["title"]).strip()
                    posts.append((d, re.split(r"\s*[/&／]\s*|\s*：|\s+Rate|\s+Rescue|\s+救出", t)[0].strip()))
                elif re.search(note_title, a["title"], re.I):
                    for m in re.finditer(note_re, _stove_body(a["article_id"])[1]):
                        notes.append((d, m.group(1).strip()))
        return posts, notes
    jp_p, jp_n = heads(CZN_EVENT_BOARDS + CZN_NOTE_BOARDS, r"救出開催", r"■[^\n]*?戦闘員【([^】]+)】", r"アップデート内容")
    en_p, en_n = heads(CZN_EN_EVENT_BOARDS + CZN_EN_NOTE_BOARDS, r"Rate[- ]?Up Rescue|^Haru / Asteria Rescue",
                       r"■[^\n]*?Combatant \[([^\]]+)\]", r"Update")
    return [(jp_p, en_p), (jp_n, en_n)]


def english_names(tag, root):
    """Update and return the JP->EN headliner map for `tag` (icons/names/<tag>_map.json)."""
    path = root / "icons" / "names" / f"{tag}_map.json"
    m = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    m = {**SEED.get(tag, {}), **m}
    if tag == "lads":                    # the five leads are fixed (LADS_LEADS); banners carry them
        return {**m, **LADS_LEADS}
    try:
        pairs = _ss_pairs() if tag == "stellasora" else _czn_pairs()
    except Exception as e:                       # names are cosmetic: never fail the scrape
        print(f"[{tag}] EN name lookup failed (non-fatal): {e}", file=sys.stderr)
        pairs = []
    for jp, en in pairs:
        for d, name in jp:
            if name in m:
                continue
            same = [n for d2, n in en if abs((d2 - d).days) <= 1]
            mine = [n for d2, n in jp if abs((d2 - d).days) <= 1]
            if same and len(same) == len(mine):           # pair by position within that day
                m[name] = same[mine.index(name)]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(m, ensure_ascii=False, indent=0), encoding="utf-8")
    return m

if __name__ == "__main__":
    for tag in sys.argv[1:] or list(SOURCES):
        rows = SOURCES[tag]()
        print(f"== {tag}: {len(rows)} banners")
        for b in rows:
            print(f"  {b['start']} → {b['end']}  {b['name']}  ({b['related']})")

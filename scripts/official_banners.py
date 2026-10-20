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


SOURCES = {"stellasora": stellasora, "czn": czn}

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

#!/usr/bin/env python3
"""
Translate banner labels to official English character names for the data-only
games. Results are cached per game in icons/names/<tag>.json so daily runs don't
re-query the wikis.

Two strategies:
  * Arknights   — committed JP->EN operator map from game data (exact, incl. alters).
  * Others      — search the game's Fandom wiki (JP name -> English page title),
                  which we verified is JP-searchable. Character names are pulled
                  from either the banner title or the `related` rate-up list.
"""
import json, re, sys, ssl, urllib.request, urllib.parse, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
NAMES = ROOT / "icons" / "names"
AK_MAP = NAMES / "arknights_map.json"
AK_SRC = "https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData_YoStar/master/{}/gamedata/excel/character_table.json"
_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE

# Fandom-based games: wiki domain + how to pull JP character names from a banner
FANDOM = {
    "bluearchive": {"wiki": "bluearchive.fandom.com", "extract": "ba"},
    "uma":         {"wiki": "umamusume.fandom.com", "extract": "uma"},
    "fgo":         {"wiki": "fategrandorder.fandom.com", "extract": "fgo"},
    "gfl2":        {"wiki": "girls-frontline.fandom.com", "extract": "amp"},
}


def _open(url):
    req = urllib.request.Request(url, headers={"User-Agent": "gacha-tracker"})
    try:
        return urllib.request.urlopen(req, timeout=30)
    except (ssl.SSLError, urllib.error.URLError) as e:
        if isinstance(e, ssl.SSLError) or isinstance(getattr(e, "reason", None), ssl.SSLError):
            return urllib.request.urlopen(req, timeout=30, context=_CTX)
        raise


def getj(url):
    return json.loads(_open(url).read().decode("utf-8", "replace"))


# ---- per-game name extraction (returns a list of JP character names) ----
def extract(kind, b):
    name, rel = b["name"], b.get("related", "")
    if kind == "amp":                       # GFL2: banner title is the doll(s)
        return [t.strip() for t in re.split(r"[&＆/／]", name) if t.strip()][:3]
    if kind == "ba":                        # Blue Archive: ★3「Name(skin)」
        out = []
        for m in re.findall(r"「([^」]+)」", rel):
            out.append(re.sub(r"[（(][^）)]*[）)]", "", m).strip())
        return out[:3]
    if kind == "uma":                       # Umamusume: ★3[skin]Name
        return [m.strip() for m in re.findall(r"\][^\[、,/]*?([一-龠ぁ-んァ-ヶー・]{2,})(?=[、,/\[]|$)", rel)][:3]
    if kind == "fgo":                       # FGO: comma-separated servants
        return [t.strip() for t in re.split(r"[,、\n]", rel) if t.strip() and "種類" not in t and "年へ" not in t][:3]
    return []


# franchise / event / system pages a fuzzy search returns when a name has no page
BLOCK = {"Fate", "OATH System", "Gacha", "Umamusume", "Blue Archive", "Arknights",
         "Girls' Frontline 2: Exilium", "Girls' Frontline", "Granblue Fantasy"}


def bad_title(t):
    low = t.lower()
    return (":" in t or " - " in t or t.endswith(")") or t in BLOCK
            or " by the " in low or low.startswith("list of")
            or "campaign" in low or "event" in low or "summon" in low
            or bool(re.search(r"\b(19|20)\d\d\b", t)))          # event pages with a year


def resolve(dom, jp, cache):
    if jp in cache:
        return cache[jp]
    en = ""
    try:
        url = (f"https://{dom}/api.php?action=query&list=search&srlimit=4&format=json"
               f"&srsearch={urllib.parse.quote(jp)}")
        for r in getj(url)["query"]["search"]:
            t = r["title"].split("/")[0].strip()   # drop subpages e.g. Oguri Cap/Real Life
            if bad_title(t):
                continue
            en = t
            break
    except Exception as e:
        print(f"  [{dom}] {jp}: {e}")
    cache[jp] = en
    return en


def translate_fandom(tag, cfg):
    dfile = DATA / f"{tag}.json"
    data = json.loads(dfile.read_text(encoding="utf-8"))
    cfile = NAMES / f"{tag}.json"
    cache = json.loads(cfile.read_text(encoding="utf-8")) if cfile.exists() else {}
    dom, hit = cfg["wiki"], 0
    for b in data["banners"]:
        agents = []
        for jp in extract(cfg["extract"], b):
            en = resolve(dom, jp, cache)
            if en and en not in agents:
                agents.append(en)
        b["agents"] = agents[:3]
        if agents:
            b["en"] = " & ".join(agents[:3]); hit += 1
        else:
            b.pop("en", None)
    NAMES.mkdir(parents=True, exist_ok=True)
    cfile.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[{tag}] translated {hit}/{len(data['banners'])} banners")


# ---- Arknights (game-data map) ----
def refresh_ak_map():
    ja, en = getj(AK_SRC.format("ja_JP")), getj(AK_SRC.format("en_US"))
    m = {v["name"]: en[cid]["name"] for cid, v in ja.items()
         if v.get("name") and en.get(cid, {}).get("name") and v.get("profession") not in ("TOKEN", "TRAP")}
    NAMES.mkdir(parents=True, exist_ok=True)
    AK_MAP.write_text(json.dumps(m, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"arknights map: {len(m)} operators")


def translate_arknights():
    dfile = DATA / "arknights.json"
    if not dfile.exists():
        return
    if not AK_MAP.exists():
        refresh_ak_map()
    m = json.loads(AK_MAP.read_text(encoding="utf-8"))
    data = json.loads(dfile.read_text(encoding="utf-8"))
    hit = 0
    for b in data["banners"]:
        ops = re.findall(r"星6：([^\s星（(]+)", b.get("related", ""))[:3]
        agents = [m[o] for o in ops if o in m]
        b["agents"] = agents[:3]
        if agents:
            b["en"] = " & ".join(agents[:3]); hit += 1
        else:
            b.pop("en", None)
    dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[arknights] translated {hit}/{len(data['banners'])} banners")


def translate_endfield():
    """Endfield banner names are the operator; map JP->EN from a small committed map.
    (No reliable auto source: the EN wiki has no JP names and the game data is CN-only.)"""
    dfile, mfile = DATA / "endfield.json", NAMES / "endfield_map.json"
    if not dfile.exists() or not mfile.exists():
        return
    m = json.loads(mfile.read_text(encoding="utf-8"))
    data = json.loads(dfile.read_text(encoding="utf-8"))
    hit = 0
    for b in data["banners"]:
        toks = [t.strip() for t in re.split(r"[&＆/／]", b["name"]) if t.strip()]
        agents = [m[t] for t in toks if t in m]
        b["agents"] = agents[:3]
        if agents:
            b["en"] = " & ".join(agents[:3]); hit += 1
        else:
            b.pop("en", None)
    dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[endfield] translated {hit}/{len(data['banners'])} banners")


def main():
    if "--refresh" in sys.argv:
        refresh_ak_map()
    translate_arknights()
    translate_endfield()
    for tag, cfg in FANDOM.items():
        if (DATA / f"{tag}.json").exists():
            translate_fandom(tag, cfg)


if __name__ == "__main__":
    main()

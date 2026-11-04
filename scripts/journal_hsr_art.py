#!/usr/bin/env python3
"""Star Rail splash art for the Journal.

HSR's banner images are event posters (framed portraits plus text) that crop badly into the
Journal's covers and cards. Each HSR character has an official splash in StarRailRes — the same
community repo the tracker already uses for HSR icons — so for every HSR banner whose icon comes
from StarRailRes this fetches image/character_portrait/<id>.png once, saves a resized webp under
assets/journal/hsr/, and finds its face with compute_focus.py's detector so crops aim at the face.

    .focusenv/Scripts/python scripts/journal_hsr_art.py [--force]   (needs the detector venv, like compute_focus.py)

Writes data/journal/hsr_art.json: {id: {file, w, h, face: [x%, y%], det}}. build_journal.py reads it.
Downloads go through curl, which uses the system certificate store.
"""
import io, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
OUT = ROOT / "assets" / "journal" / "hsr"
MAP = ROOT / "data" / "journal" / "hsr_art.json"
SRC = "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/image/character_portrait/{}.png"
ICON = re.compile(r"StarRailRes/master/icon/character/(\d+)\.png")
MAX_W = 1100

def main():
    from PIL import Image
    from compute_focus import pick
    from imgutils.detect import detect_faces, detect_heads
    data = json.loads((ROOT / "data" / "hsr.json").read_text(encoding="utf-8"))
    ids = sorted({m.group(1) for b in data["banners"] for u in (b.get("icons") or [])[:1] if (m := ICON.search(u))})
    art = json.loads(MAP.read_text(encoding="utf-8")) if MAP.exists() else {}
    OUT.mkdir(parents=True, exist_ok=True)
    for cid in ids:
        f = OUT / f"{cid}.webp"
        if cid in art and f.exists() and "--force" not in sys.argv: continue
        r = subprocess.run(["curl", "-sSL", "--fail", SRC.format(cid)], capture_output=True)
        if r.returncode or not r.stdout:
            print(f"  {cid}: no splash ({r.stderr.decode(errors='replace').strip()})"); continue
        im = Image.open(io.BytesIO(r.stdout)).convert("RGBA")
        bb = im.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()   # trim the empty transparent margin
        if bb: im = im.crop(bb)
        if im.width > MAX_W: im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
        im.save(f, "WEBP", quality=80, method=6)
        rgb = Image.new("RGB", im.size, (128, 128, 128)); rgb.paste(im, mask=im.split()[3])
        pt = pick(detect_faces(rgb), *rgb.size, False) or pick(detect_heads(rgb), *rgb.size, False)
        x, y = pt if pt else (50.0, 30.0)
        art[cid] = {"file": f.relative_to(ROOT).as_posix(), "w": im.width, "h": im.height, "face": [round(x, 1), round(y, 1)], "det": bool(pt)}
        print(f"  {cid}: {im.width}x{im.height} {f.stat().st_size // 1024}KB face ({x:.0f}%,{y:.0f}%){'' if pt else ' (fallback)'}")
    MAP.write_text(json.dumps(art, indent=1), encoding="utf-8")
    print(f"{len(art)} splashes -> {OUT}")

if __name__ == "__main__":
    main()

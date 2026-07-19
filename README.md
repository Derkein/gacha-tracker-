# Gacha Revenue Tracker

**Live site → https://derkein.github.io/gacha-tracker-/**

An auto-updating, fan-made site that charts **estimated per-banner gacha revenue over time** for 11 gacha games, in a cleaner and more readable form than the raw source — with rankings, English character names, banner art and per-banner detail.

It doesn't measure or estimate anything itself: every number comes from [**game-i.daa.jp**](https://game-i.daa.jp/)'s published estimates (売上予測). This project just re-presents them.

Covered: **Zenless Zone Zero · Honkai: Star Rail · Wuthering Waves · Genshin Impact · Arknights: Endfield · Neverness to Everness · Umamusume · Fate/Grand Order · Blue Archive · Arknights.**

> Coverage varies by game and generally begins around **2024**, so titles older than that are missing their earlier banners.

## What you can do

- **Three chart views + a table** — Timeline, Graph (one line-chart per year), Ranking, and a plain data table. Toggle newest/oldest or highest/lowest first.
- **Per-year filter, "match highest" scaling, and round-top axis** controls on any chart view.
- **Click any banner** → a detail card with the banner art, its stats, and:
  - the **daily iOS store-rank curve** across the whole run (how high it peaked, how fast it faded);
  - an **estimated revenue build-up** — the total split across the run day-by-day, with a table of each day's rank, that day's estimated share, and the running cumulative.
- **"JP store rank today" tile** — each game's current iOS/Android top-grossing rank straight from game-i, with a two-month sparkline of the daily iOS rank.
- **ⓘ How these numbers work** — an in-page dialog explaining game-i's methodology and every caveat (below-200 days count as ¥0, midnight-JST snapshots, iOS-regressed model, still-running banners, etc.).

## What the numbers mean

Revenue is shown in **yen**. game-i reports in **"G"**, a deliberately vague unit it says just means "about" (〜ぐらい); by common convention **1億G ≈ ¥100 million**, which is how the yen figures here are derived.

These are **third-party estimates, not official sales** — game-i records each app's App Store / Google Play top-grossing rank daily and converts rank → revenue with a model calibrated against companies' disclosed earnings. They're directional, Japan-only (iOS + Android), and exclude PC/overseas stores. Use them to *compare* banners, not as exact figures. The full methodology and its limits are in the site's **ⓘ** dialog.

## How it works

A plain static site (`index.html` + `app.js` + `style.css`) that loads pre-built `data/*.json`. A scheduled GitHub Action re-scrapes daily (and on every push) and commits the refreshed data; GitHub Pages redeploys automatically. **No server, no build step, no manual data entry.**

```
scripts/build_icons.py   # JP name -> portrait + accent  ->  icons/<game>.json     (Enka + StarRailRes)
scripts/scrape.py        # game-i banners: name, dates, revenue, ranks, daily rank series, today's store rank
scripts/enrich_icons.py  # matches banners to portraits, adds icons/accent to data/<game>.json
scripts/translate_names.py  # English character names for data-only games (game wikis / game data)
scripts/face_icons.py    # icon-less games: crop a face circle from drip/banner art -> icons/faces/<game>/*.webp
scripts/bar_colors.py    # sample each banner's most prominent color -> tints the chart bars
```

Character portraits come from auto-updating community sources: circular head-icons from [Enka.Network](https://enka.network/) (ZZZ, Genshin) and [Mar-7th/StarRailRes](https://github.com/Mar-7th/StarRailRes) (Star Rail); for games with no portrait source, a face circle is cropped via anime face detection ([lbpcascade_animeface](https://github.com/nagadomi/lbpcascade_animeface) + OpenCV) from the character's drip/splash art (Fandom wikis) or the banner art. New HoYoverse characters get portraits automatically once Enka lists them; until then the banner art is used.

## Running it locally

Only needed if you want to hack on it — the live site is already up.

```bash
pip install -r requirements.txt   # once, only for face_icons.py (OpenCV + Pillow + numpy)
python scripts/scrape.py          # writes data/*.json
python scripts/enrich_icons.py    # attaches portraits
python scripts/translate_names.py # English names for data-only games
python scripts/face_icons.py      # face-crop icons for WuWa / Endfield / NTE
python -m http.server 8000        # then open http://localhost:8000
```

Serve it over HTTP (not the `file://` path) — the page fetches `data/*.json`. `scrape.py`, `build_icons.py`, `enrich_icons.py` and `translate_names.py` are pure standard library; only `face_icons.py` needs the pip install.

**Add a game:** add it to the `GAMES` dict in [`scripts/scrape.py`](scripts/scrape.py) — anything game-i tracks under `ガチャ分析/<name>` works. Add an Enka builder in `build_icons.py` for character portraits, or it falls back to banner art.

---

This is a **fan-made, non-commercial** project. Revenue figures are estimates and may be inaccurate. All game art, character names and trademarks belong to their respective owners; data is courtesy of [game-i.daa.jp](https://game-i.daa.jp/).

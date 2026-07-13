# Gacha Revenue Tracker

An auto-updating static site charting **estimated per-banner gacha revenue over time**
for Zenless Zone Zero, Honkai: Star Rail, Wuthering Waves, Genshin Impact,
Arknights: Endfield and Neverness to Everness. Timeline / ranking / graph / table views,
with character portraits and official banner art.

Revenue is shown in **G**, game-i's abstract estimate unit (their FAQ states "G has no
particular meaning"); values are translated from 億 (1e8) to M/B magnitudes, so 1B G = 10億.

- **Data source:** [game-i.daa.jp](https://game-i.daa.jp/) (third-party sales estimates, 売上予測, in 億G = 100M App Store units).
- **Portraits:** circular character head-icons from auto-updating community data sources —
  [Enka.Network](https://enka.network/) (ZZZ, Genshin) and
  [Mar-7th/StarRailRes](https://github.com/Mar-7th/StarRailRes) (Star Rail). Games without a
  reliable icon source (Wuthering Waves, Endfield, Neverness to Everness) use the official
  **banner splash art** instead, which game-i provides for every banner automatically.
- **Hosting:** GitHub Pages (a plain static site — no server, no build step).
- **Freshness:** a scheduled GitHub Action re-scrapes daily and commits changes.

> Revenue figures are **estimates** and may be inaccurate. This is a fan-made,
> non-commercial project; all art and trademarks belong to their respective owners.

## How it works

```
scripts/build_icons.py   # JP name -> Enka portrait + accent  ->  icons/<game>.json   (occasional)
scripts/scrape.py        # game-i banners (name, dates, revenue, ranks, art) -> data/<game>.json
scripts/enrich_icons.py  # matches banners to portraits, adds icons/accent to data/<game>.json
index.html + app.js      # loads data/*.json and renders the charts
```

The scraper is **pure standard library** (no `pip install`), so CI needs nothing extra.

### Add or change games
Edit the `GAMES` dict in [`scripts/scrape.py`](scripts/scrape.py). Any game that game-i
tracks under `ガチャ分析/<name>` works (Blue Archive, NIKKE, Gakumas, …). Add an Enka
builder in `scripts/build_icons.py` if you want character portraits; otherwise it uses
banner art automatically.

## Run locally

```bash
python scripts/scrape.py          # writes data/*.json
python scripts/enrich_icons.py    # attaches portraits (needs icons/*.json)
python -m http.server 8000        # then open http://localhost:8000
```
(Open it through a web server, not the file:// path — the page fetches `data/*.json`.)

## Automation

- **How much is automatic?** Effectively all of it. New banners appear in the source as
  soon as game-i adds them; the daily Action re-scrapes and commits, and Pages redeploys.
- **New characters:** `build_icons.py` refreshes portrait maps from Enka each run, so new
  HoYoverse agents get portraits automatically once Enka lists them (usually within days).
  Until then — and for non-Enka games — the banner's official art is used instead. No
  manual data entry is ever required.

---

## First-time setup (publish to GitHub Pages)

This repo is already initialised and committed locally. To put it online:

1. Create a **new empty** repo on GitHub (no README/license), e.g. `gacha-tracker`.
2. From this folder, point it at your repo and push:
   ```bash
   git remote add origin https://github.com/<YOUR-USERNAME>/gacha-tracker.git
   git branch -M main
   git push -u origin main
   ```
3. **Settings → Pages →** Source: *Deploy from a branch*, Branch: `main` / `/ (root)`. Save.
   Your site goes live at `https://<YOUR-USERNAME>.github.io/gacha-tracker/`.
4. **Settings → Actions → General →** Workflow permissions: *Read and write permissions*
   (lets the daily job commit refreshed data). Then the schedule in
   `.github/workflows/update.yml` takes over — or run it once now from the **Actions** tab.

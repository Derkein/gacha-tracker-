# Gacha Revenue Tracker

**Live site → https://derkein.github.io/gacha-tracker-/**

An auto-updating, fan-made site that charts **estimated per-banner gacha revenue over time** for 7 gacha games, in a cleaner and more readable form than the raw source — with rankings, English character names, banner art and per-banner detail.

It doesn't measure or estimate anything itself. It re-presents three third-party datasets: [**game-i.daa.jp**](https://game-i.daa.jp/)'s per-banner **Japan** revenue (売上予測, the default, in ¥), and the monthly **Sensor Tower** reports posted to [r/gachagaming](https://www.reddit.com/r/gachagaming/) for **global mobile** revenue (a toggle, in $), and [**天天背锅崩坏娘**](https://space.bilibili.com/20313793)'s monthly CN ranking for **global all-platform** revenue (a second toggle, in CN¥). All three measure different things and are shown side by side — never summed.

Covered: **Zenless Zone Zero · Honkai: Star Rail · Wuthering Waves · Genshin Impact · Arknights: Endfield · Neverness to Everness · Umamusume.**

> Coverage runs from each game's **launch** to today (e.g. back to 2020 for Genshin, 2023 for Star Rail). game-i's own per-banner data begins in **2018**.

## What you can do

- **Sources view** — the three layers can't be compared by value (different regions, platforms and currencies), so each month is scored as a **percentile within its own source's history** and the three are shown side by side. Rows are labelled *strong in all 3*, *sources agree*, or which source is out of step — surfacing months that were region-specific (a Japan-heavy banner lifts only game-i) or platform-specific (a PC/console push lifts only the CN figure). Includes Spearman rank correlations between each pair. All sources are ranked inside the **same era**, split at the CN 总收入→总流水 boundary, so no source gets an unfair window.
- **Three chart views + a table** — Timeline, Graph (one line-chart per year), Ranking, and a plain data table. Toggle newest/oldest or highest/lowest first.
- **Per-year / per-version filter** on the chart views, plus **by-Year, by-Month and by-Version** breakdowns with per-period detail cards (a by-Month card opens a calendar of that month's banners).
- **Character search** with icon autocomplete that filters every view.
- **Click any banner** → a detail card with the banner art, its stats, and:
  - the **daily iOS store-rank curve** across the whole run (how high it peaked, how fast it faded);
  - an **estimated revenue build-up** — the total split across the run day-by-day, with a table of each day's rank, that day's estimated share, and the running cumulative;
  - **how front-loaded the run was** — the share earned in its first 3 days and first week, the day it crossed half, and whether that's typical for the game. The shape differs a lot between games: a Star Rail banner takes ~70% of its whole run in the opening week, a Genshin one ~59%, an Umamusume one ~48%. Runs shorter than 14 days aren't compared (a short run packs more of itself into its first week by definition), and an unfinished run says so.
- **CN ranking layer (CN¥)** — a third source: 57 unbroken months (Nov 2021 →) of global, **all-platform** revenue (mobile + PC + PlayStation) from a Bilibili monthly ranking, OCR'd from the video captions since the author publishes no table. miHoYo titles are a **range** (he excludes their undisclosed 支付中心 top-up channel), and the metric changes basis at **Nov 2023** (总收入 → 总流水) — rows spanning it are tagged `mixed basis`.
- **game-i ¥ ⇄ Sensor Tower $ toggle** (Timeline & Ranking) — switch every bar, the ranking order, and the header tiles between game-i's JP revenue and estimated **global** revenue (USD) from the Sensor Tower monthly reports. Per-banner global is *assumed* (a banner's share of game-i's JP month applied to the month's real global total, summed across the months it ran); a banner's card shows the full month-by-month math.
- **"JP store rank today" tile** — each game's current iOS/Android top-grossing rank straight from game-i, with a two-month sparkline of the daily iOS rank.
- **ⓘ How these numbers work** — an in-page dialog explaining game-i's methodology and every caveat (below-200 days count as ¥0, midnight-JST snapshots, iOS-regressed model, still-running banners, etc.).

## What the numbers mean

Revenue is shown in **yen**. game-i reports in **"G"**, a deliberately vague unit it says just means "about" (〜ぐらい); by common convention **1億G ≈ ¥100 million**, which is how the yen figures here are derived.

These are **third-party estimates, not official sales** — game-i records each app's App Store / Google Play top-grossing rank daily and converts rank → revenue with a model calibrated against companies' disclosed earnings. They're directional, Japan-only (iOS + Android), and exclude PC/overseas stores. Use them to *compare* banners, not as exact figures. The full methodology and its limits are in the site's **ⓘ** dialog.

The **CN ranking** layer (`data/cn_monthly.json`, slimmed from the full `data/cn_revenue.json` archive of 125 charted games) is a game's **global monthly revenue across every platform** — mobile *plus PC, PlayStation and overseas Xbox* — in yuan, from [天天背锅崩坏娘](https://space.bilibili.com/20313793)'s 二次元手游全球总流水 series. He publishes only burned-in video captions, so `scripts/scrape_bilibili_cn.py` reads them by OCR, deciding each figure by a vote across the frames it appears in and checking the chart's own rank ordering. His stated method is rank-derived (China Android ≈ 2× China iOS; PC/PS coefficients 0.3–1.8), with per-game coefficients unpublished. **miHoYo figures exclude the 支付中心 channel and are therefore understated**, which is why they're ranges. Per-banner figures are assumed the same way the Sensor Tower ones are — and it's a weaker assumption here, since game-i measures Japan mobile while this total spans the world and includes PC.

**Store chart snapshots** (`data/ranks/`). The China chart now drives the site's **CN chart** tab; the rest are rank charts kept beside the revenue layers, never mixed with them:

| file | chart | cadence | history |
|---|---|---|---|
| `cn_ios_series.json` | **what the site draws** — China iPhone top-grossing, **all apps, 200 deep**, reduced to each day's depth and the tracked games' ranks | daily | **every day since Genshin's launch: 2,161 days**, 28 Sep 2020 → today, from one source (AppFollow, signed in). 16 days are absent because AppFollow has no grossing chart for them (28 Nov 2020, 22 Apr–4 May 2023, 8–9 Dec 2023) |
| `cn_ios_appfollow_days.jsonl` | the whole 200-app list for each day the workflow fetches | daily | appended by `fetch_cn_today.py`, so the repo keeps full charts going forward |
| `cn_ios.json`, `cn_ios_games.json`, `cn_ios_archive.json` | Apple's own feed (all apps, 100 deep), its games-only twin, and Appfigures' archived pages (50, then 30) | daily / past | still collected, and used to **cross-check** the series — but no longer merged into it. Mixing depths made days incomparable: a game "missing" meant below #10, #50 or #200 depending on who recorded that day |
| `steam_daily.json` | Steam global top sellers, games only, top 100 | daily | starts the day the scrape did — no free archive exists |
| `steam_weekly.json` | Steam global **weekly** top sellers, top 100 (Valve's official list) | weekly | complete back to the week of Genshin's launch (Sep 2020), requested directly from Valve — whose archive reaches past 2010 if more is ever wanted |

Each snapshot stores the **whole chart** as ordered ids plus one id → name map, so any game can be charted later without re-scraping. That also keeps two kinds of "missing" apart: a date that's present with a game absent means it **didn't make that day's depth**, while an absent date means **no snapshot**. Both China files are iPhone only — China has no Google Play and no public Android chart. Games are matched by store id, never name, because Apple renames listings every version. Genshin and Star Rail aren't on Steam.

`scripts/build_cn_ranks.py` rebuilds `cn_ios_series.json` from the full chart archive in the sibling `cn-ios-grossing` project (400k+ rows); `scripts/scrape_ranks.py --backfill` still refreshes the Apple/Appfigures cross-check files, and `--appfigures` / `--appfollow` run those pulls on their own.

**The China chart has its own daily workflow** (`.github/workflows/cn-chart.yml`), deliberately separate from the data refresh — that one also runs on every push, and each China day costs 10 of the account's 500 monthly API credits. It fires once a day at **16:30 UTC**: the China chart day rolls at 00:00 China time (16:00 UTC) and game-i rolls at 00:00 JST (15:00 UTC), so half an hour past Chinese midnight is the first moment both sides have closed the day it asks for. Re-running it is free — a day already held is never re-fetched.

**How it fetches.** `scripts/fetch_cn_today.py` asks AppFollow for any of the last few days the series is missing and writes both `data/ranks/cn_ios_series.json` (what the site draws) and `data/ranks/cn_ios_appfollow_days.jsonl` (the whole 200-app list per day). It prefers AppFollow's **official API** (`GET /api/v2/charts/topcharts`, header `X-AppFollow-API-Token`, secret `APPFOLLOW_TOKEN`) because that token doesn't expire; a free account gets 500 API credits a month and each day costs 10, so a daily run uses 300. Failing that it falls back to the browser session cookie (`AF_COOKIE`), which works but expires every few weeks. With neither set the step skips quietly — and a separate step then **fails the run** if the newest day held is more than three days old, so a dead key shows up as a red build instead of silently stale data.

**Checked against Diandian.** The saved China snapshots were compared, top 20 position by position, with Diandian's record of the real App Store chart: **16 of 19 days matched 20/20**, and the other three differed only in timing — Apple's chart changes at a few irregular moments a day, and on those fast-moving days no logged update coincided with our fetch. Results are in `data/ranks/diandian_check.json`; Diandian's free account caps chart views per day, so the rest were left unchecked. `cn_ios_archive.json` was spot-checked the same way against AppFollow's free record of the chart (top 10 only): the same ten apps on 5 of 6 days in 2020–21, identical order on 3, and the sixth lined up with AppFollow's next day, because its copy was stamped at midnight China time.

The **Sensor Tower** layer (`data/reported_revenue.json`) is a game's **combined worldwide** monthly revenue in USD, read from the r/gachagaming report images — regional servers summed (JP + global/US + KR) plus China (where a report gave China as iOS only, China Android is modelled at 1.75× the China iOS figure). Coverage runs from **Oct 2021**; older region-summed months are marked `*` and are approximate. Per-banner global figures are *assumed* (see above), so treat them as ballpark context, not precise sales — and never add them to the ¥ figures.

## How it works

A plain static site (`index.html` + `app.js` + `style.css`) that loads pre-built `data/*.json`. A scheduled GitHub Action re-scrapes daily (and on every push) and commits the refreshed data; GitHub Pages redeploys automatically. **No server, no build step, no manual data entry.**

```
scripts/scrape_bilibili_cn.py # CN monthly ranking: OCRs the figures off the Bilibili video frames
scripts/merge_cn_shards.py    # merges the parallel scrape shards -> data/cn_revenue.json + cn_monthly.json
scripts/verify_cn_frame.py    # pulls the source frames behind a stored figure, to check it by eye
scripts/scrape_ranks.py  # daily store charts: China iOS top-grossing + Steam top sellers -> data/ranks/
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

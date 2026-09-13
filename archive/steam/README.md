# Archived: Steam players tile

A "Steam players" tile beside "JP store rank today", showing Valve's live concurrent-player
count with a sparkline. Built, verified, then pulled from the live site. Kept here whole.

## Files here

| file | goes back to |
|---|---|
| `scrape_steam.py` | `scripts/` |
| `steam_players.json` | `data/` (holds the readings taken so far — history can't be backfilled, so keep it) |
| `steam.js` | `app.js`, immediately before `function monthTopBanner(ym){` |
| `steam.html` | `index.html` — the ⓘ-dialog tab button and its section, each labelled with its slot |
| `update.yml.step` | `.github/workflows/update.yml`, before "Check version buckets" |
| `readme-fragments.md` | `README.md` — a feature bullet and a methodology paragraph |

## Re-enabling it

1. Move the script and JSON back, paste `steam.js` into its slot.
2. Re-wire the four hooks unpicked from `app.js`:
   - `state`: add `steam:null`
   - `init()`: after the `cn_monthly.json` load,
     `try { state.steam = await getJSON("data/steam_players.json"); } catch(e){ state.steam=null; }`
   - `renderStats()`: append `+ steamTile()` after `nowTile(state.data.now)`, and add
     `+ Steam` to the `srcs` line when the selected game has a reading
   - `showInfoTab()`: `if($("#infoSteam")) $("#infoSteam").hidden = which!=="steam";`
3. Paste the `steam.html` fragments and the workflow step; bump the `?v=` cache-buster.

## What to know before bringing it back

- **Coverage:** ZZZ (appid 4162040), Wuthering Waves (3513350), Umamusume (3224770), NTE
  (4508340). Endfield (4732690) has a store page but no live stats until its Steam build
  ships. Genshin and Star Rail are not on Steam and never will be.
- **It is a floor.** Steam counts only Steam launches — mobile, PlayStation and
  standalone-launcher players are invisible.
- **One reading per UTC day at a fixed time (~00:30 JST)**, not a daily peak. The refresh
  workflow fires three times inside an hour; later same-day runs are dropped on purpose so
  every day is the same slice. A real peak needs a separate workflow sampling every few
  hours (~4–8 extra commits a day).
- **No backfill.** Valve publishes only the current count; SteamDB has history but is not
  scrapable. The archived JSON is the only history there is — and nothing is being
  collected while this is archived.

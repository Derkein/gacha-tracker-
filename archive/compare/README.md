# Archived: the Compare view

A cross-game view — the only one on the site that wasn't about a single game. Built,
verified and then pulled from the live site; kept here whole so it can go back without
being rebuilt.

Nothing about it was broken. It was removed to keep the live site focused.

## What it did

Four panels, all of them things a per-game file can't answer on its own:

1. **Who led each month, per source.** Three cards counting months at #1. The finding
   that justified the view: over the 57 months all three sources cover, they name the
   same #1 game in only 11 — **81% of months have a different winner depending on which
   source you ask.** game-i sees Japan mobile, where Umamusume leads 45 of 73 months;
   the two worldwide sources both say Genshin (40 of 61, 42 of 57).
2. **Month by month.** Each month split between the seven games as a stacked share.
3. **The launch race.** Cumulative revenue aligned to each game's own month 1, so a 2020
   debut and a 2026 one start from the same origin. Umamusume's first 12 months in Japan
   (¥111.75B) out-earned Genshin's entire six years there (¥111.05B).
4. **Do reruns hold up?** and **Inside the CN chart** — see below.

## Files here

| file | goes back to |
|---|---|
| `compare.js` | `app.js`, immediately before the `// ---- by-month view:` block |
| `compare.css` | end of `style.css` |
| `compare.html` | `index.html` — three fragments, each labelled with its slot |
| `build_compare.py` | `scripts/` |
| `update.yml.step` | `.github/workflows/update.yml`, before "Check version buckets" |
| `compare.json` | `data/` — regenerable, so a stale copy is fine to delete |

## Re-enabling it

1. Move `build_compare.py` to `scripts/`, run it, and confirm it writes
   `data/compare.json`. It exits non-zero if the game-i monthly series it reconstructs
   from each game's banner list stops matching `index.json`'s lifetime totals — that
   check is the reason the workflow step is *not* `continue-on-error`.
2. Paste `compare.js` back into `app.js` at the slot above, and `compare.css` onto the
   end of `style.css`.
3. Paste the three `compare.html` fragments into their slots.
4. Re-wire the six hooks that were unpicked from `app.js` (all one-liners):
   - `state`: add `compare:null, compareErr:null`
   - `render()`: `if(state.mode==="compare"){ loadCompare(); renderCompare(); return; }`
   - `setMode()`: add `["bCompare","compare"]` to the button list, and force
     `state.table=false` on entering compare (the Table toggle is hidden there, so
     arriving from table view would otherwise strand you)
   - `$("#bCompare").onclick=()=>setMode("compare");`
   - `updateControlVis()`: hide `#gfilter`, `#hintRow`, `#bTable` and `#search` in
     compare mode, and let the CN toggle appear whenever *any* game has CN data rather
     than only the selected one
   - `showInfoTab()` / `#infoBtn`: show `#infoCmp` for `"cmp"`, and open on that tab
     when the compare view is active
5. Add the workflow step.
6. Bump the `?v=` cache-buster on `app.js` and `style.css` in `index.html`.

`compare.json` loads lazily on the first visit to the view, not on page load — it is
~57KB and only that one view reads it. Keep it that way.

## Two things worth remembering

**The launch race and the market board both need rules that aren't obvious.** The
calendar month in progress is dropped from every cumulative curve (a half-counted month
bends the end of a line down and reads as a slowdown that isn't there), and a game whose
launch predates a source's coverage is *named and excluded* rather than drawn from
wherever that source happens to start. CN market share is measured against the chart's
**top 15**, never against "everything charted": the chart was 15 rows deep in Nov 2021
and ~45 today, so the latter would drift upward for purely structural reasons.

**The rerun panel is the shakiest thing that was on the site**, and was labelled as such.
Two ratios, because the obvious one misleads — "vs its own debut" mostly measures the
game's own rise or decline across the gap, while "vs a new banner then" (the median
banner introducing only new characters within 180 days either side) isolates the actual
question, and reverses the answer for Genshin: 52% of its own debut but **95%** of a
contemporary banner. Star Rail 38%, Wuthering Waves 42%. A character counts as returning
the second time they appear in the banner list — deliberately *not* the per-banner
`↻ rerun` flag, which is derived three different ways depending on the game and is empty
for the ones whose banners are named after an event. Coverage is thin and uneven, hence
the "n of m usable" chip: Genshin 24 of 71, Star Rail 7 of 13, Wuthering Waves 6 of 6,
Umamusume **2 of 132** (its banners nearly always bundle two or three characters, so
almost nothing can be attributed to one), ZZZ 1 of 1, and NTE and Endfield have never
re-run anything.

## What was kept in the live site

The CN archive clean-up done while building this stays — it was a data-quality fix, not
part of the view. `scripts/merge_cn_shards.py` now folds OCR name variants
case-insensitively, strips rank digits that bled into the name cell, drops keys that were
the revenue column misread as a name, and carries an explicit alias map for one game the
chart calls by three different real titles (Heaven Burns Red → 绯染天空 → 炽焰天穹,
53 consecutive months). That took the archive from 125 games to 106.
`data/cn_monthly.json`, which the site actually loads, is byte-identical either way.

## One bug fixed after archiving

`build_compare.py` originally split a banner's revenue **uniformly** across the days it
was charting, while `app.js`'s `computeMonthly()` weights each day by
`rankValue(rank)` — a log-interpolated curve where rank 1 is worth ~59× rank 200. The
lifetime totals matched either way, which is why the script's own self-check passed, but
the month-by-month split did not. It now carries a Python port of `RANK_VAL` /
`rankValue`. If that curve ever changes in `app.js`, change it here too.

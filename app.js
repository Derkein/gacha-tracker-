// Gacha Revenue Tracker — client logic. Data comes from data/*.json (built by scripts/).
const GAME_ACCENT = {          // per-game hue (used for bars/dots without a sampled color)
  zzz:"#e0a400", hsr:"#8a7bd8", wuwa:"#2fb6c0", genshin:"#d8a24a", endfield:"#e07b3a", nte:"#d94f8a",
  uma:"#3fb98f",
};
const state = { games:[], tag:null, data:null, ext:null, reported:null, mode:"time", table:false, reverse:false, bracket:0, tabsExpanded:false, graphYear:"all", graphDim:"year", matchHigh:true, monthYear:"all", periodSort:"timeline", dataSource:"gamei", search:"" };

// Major game-version (X.0) launch dates, JST — used to bucket banners into 1.X / 2.X
// groups. Only version-based games have these; sourced from each game's official
// version history (see release-date notes in the repo). A banner belongs to the
// latest major version whose launch date is on or before the banner's start.
const VERSIONS = {
  genshin: [["1.X","2020-09-28"],["2.X","2021-07-21"],["3.X","2022-08-24"],["4.X","2023-08-16"],["5.X","2024-08-28"],["6.X","2025-09-10"],["7.X","2026-08-12"]],
  hsr:     [["1.X","2023-04-26"],["2.X","2024-02-06"],["3.X","2025-01-14"],["4.X","2026-02-13"]],
  zzz:     [["1.X","2024-07-04"],["2.X","2025-06-06"],["3.X","2026-06-17"]],
  wuwa:    [["1.X","2024-05-22"],["2.X","2025-01-02"],["3.X","2025-12-25"]],
  endfield:[["1.X","2026-01-22"]],   // launched at 1.0; still 1.x
  nte:     [["1.X","2026-04-29"]],
};
const hasVersions = tag => !!VERSIONS[tag];
function versionOf(b){
  const v=VERSIONS[state.tag]; if(!v) return null;
  let cur=v[0][0];
  for(const [label,date] of v){ if(b.start>=date) cur=label; else break; }
  return cur;
}
// Manual per-character colour overrides (by agent name), when the sampled colours
// don't match the character's identity. Keep this small and deliberate.
// Curated per-character signature colors (keyed by agent name, per game). game-i's
// sampled art color often grabs a background/UI tone and collides (e.g. 4 ZZZ agents
// sampled the same near-white), so hand-set each character's own recognizable colour.
// Agents not listed fall back to the sampled art colour, then de-collision.
const ACCENT_OVERRIDE = {
  zzz: {
    "Sigrid":"#3d8ee0", "Norma":"#eec643", "Remielle":"#e87ba0",
    "Ellen":"#5cc4ea", "Zhu Yuan":"#1f9fd0", "Qingyi":"#6f7ce0", "Jane":"#b45ad0",
    "Caesar":"#f4c13e", "Burnice":"#e8562c", "Lighter":"#db4b3f",
    "Miyabi":"#4f8fe0", "Harumasa":"#ecc84a", "Yanagi":"#2bb2c4",
    "Astra Yao":"#f2a0cf", "Evelyn":"#d24d4a", "Soldier 0 - Anby":"#5a86e0",
    "Trigger":"#7266c4", "Vivian":"#9a6fe0", "Hugo":"#cf4436", "Yixuan":"#e0b83a",
    "Ju Fufu":"#f2913a", "Yuzuha":"#ef7ea8", "Alice":"#cf5566", "Orphie & Magus":"#db602a",
    "Lucia":"#3f9ed6", "Yidhari":"#9b4dd0", "Ye Shunguang":"#f0b02e", "Zhao":"#c98f3a",
    "Sunna":"#4fd6b8", "Aria":"#f08fb5", "Nangong Yu":"#6fa8d8",
    "Cissia":"#da3674", "Promeia":"#9c69ff", "Starlight - Billy":"#d8493c",
    "Velina":"#c8ccd6", "Dialyn":"#d3d7de", "Banyue":"#dcd8d1",
  },
  wuwa: {
    // the auto-sampler grabbed these banners' dark-blue backgrounds instead of the
    // character; set each from her splash art (Lucy = fire orange, not blue, etc.)
    "Lucy":"#e8763a", "Aemeath":"#e88fb8", "Denia":"#d86f8a",
    "Mornye":"#c4cdda", "Lynae":"#45b2cf",
  },
};
// true when a hex is near-white / washed-out grey (no usable hue) — some character
// portraits sample to ~#e8e7ea, which then paints every bar the same pale colour.
function isWashed(hex){
  if(!hex) return true;
  const n=parseInt(hex.slice(1),16), r=(n>>16&255)/255, g=(n>>8&255)/255, b=(n&255)/255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2, d=mx-mn;
  const s = d===0 ? 0 : d/(1-Math.abs(2*l-1));
  return l>0.82 && s<0.22;
}
// Color priority: a curated per-character override (the "adjust" for ones the data gets
// wrong) → the Enka/icon character accent (unless it sampled near-white) → the splash-art
// `bar` colour → the per-game hue. This is the original automatic behaviour; only the
// hand-listed corrections above sit in front of it.
function barColor(b){
  if(!b) return GAME_ACCENT[state.tag];
  const m=ACCENT_OVERRIDE[state.tag]||{};
  const ov=(b.agents||[]).map(a=>m[a]).find(Boolean); if(ov) return ov;
  if(b.accent && !isWashed(b.accent)) return b.accent;
  if(b.bar && !isWashed(b.bar)) return b.bar;
  return b.accent || b.bar || GAME_ACCENT[state.tag];
}
const $ = s => document.querySelector(s);

// ---- theme toggle (Auto → Light → Dark). Auto follows the OS; an explicit
// choice is stored and also applied pre-paint by the inline <head> script. ----
const THEMES=["auto","light","dark"], TICON={auto:"◐",light:"☀",dark:"☾"};
function applyTheme(t){
  if(t==="auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme",t);
  const btn=$("#themeBtn");
  if(btn){ btn.textContent=TICON[t];
    btn.title=`Theme: ${t[0].toUpperCase()+t.slice(1)}${t==="auto"?" (follows your system)":""} — click to change`;
    btn.setAttribute("aria-label",btn.title); }
}
let _theme = (()=>{ try{ return localStorage.getItem("theme")||"auto"; }catch(e){ return "auto"; } })();
applyTheme(_theme);
$("#themeBtn").onclick=()=>{
  _theme=THEMES[(THEMES.indexOf(_theme)+1)%THEMES.length];
  try{ localStorage.setItem("theme",_theme); }catch(e){}
  applyTheme(_theme);
};
const fmtDate = new Intl.DateTimeFormat("en",{year:"numeric",month:"short",day:"numeric"});
const per = s => fmtDate.format(new Date(s+"T00:00:00"));
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// game-i reports revenue in 億 (1e8) of "G". Per game-i's official X, G means "〜ぐらい"
// (about) and 1億G ≈ ¥1億 (~100M yen), i.e. G ≈ 1 yen. So translate 億→M/B magnitude and
// show it as an approximate yen figure.
function fmtG(oku){
  if (oku <= 0) return "0";
  const m = oku * 100;                       // millions of yen
  if (m >= 1000) return (m/1000).toFixed(2) + "B";
  if (m >= 100)  return Math.round(m) + "M";
  return (Math.round(m*10)/10) + "M";
}
const G = oku => "¥" + fmtG(oku);

// ---- external global monthly revenue, in USD (a comparison layer vs game-i) ----
// Source: the actual Sensor Tower / gacharevenue monthly REPORT figures, read from the
// report images (data/reported_revenue.json) — combined region (all regions incl. China
// iOS + a separate JP server where one exists), Oct 2021 -> present. Images only; the
// eog reconstruction (data/external_revenue.json, scripts/scrape_external.py) is kept in
// the repo but no longer used by the app. A month with no report yet simply shows no ST.
// A DIFFERENT measurement from game-i (global USD, not JP-iOS 億G) — shown side by side,
// NEVER summed with game-i.
function fmtUSD(v){
  if(v==null||v<=0) return "$0";
  if(v>=1e9) return "$"+(v/1e9).toFixed(2)+"B";
  if(v>=1e8) return "$"+Math.round(v/1e6)+"M";
  if(v>=1e6) return "$"+(v/1e6).toFixed(1)+"M";
  if(v>=1e3) return "$"+Math.round(v/1e3)+"K";
  return "$"+Math.round(v);
}
// {ym -> {rev, method}} for one game, straight from the published report figures
// (data/reported_revenue.json) — images only, no reconstruction. Months with no
// report yet (the newest, until its report is posted) simply have no ST value.
function extGameMonths(tag){
  tag = tag || state.tag; const out={};
  const rep=state.reported&&state.reported.months;
  if(rep) for(const ym in rep){ const v=rep[ym][tag];
    if(typeof v==="number") out[ym]={rev:v, method: rep[ym]._approx?"reported_approx":"reported", usonly: !!rep[ym]._usonly}; }
  return out;
}
// {rev, method} for one game+month (defaults to the current game), or null.
function extMonth(ym, tag){ return extGameMonths(tag)[ym]||null; }
// Sum external monthly revenue over months matching pred(ym) -> {rev,months,hasApprox} or null.
function extSum(pred, tag){
  const mm=extGameMonths(tag); let rev=0, months=0, hasApprox=false;
  for(const ym in mm){ if(!pred(ym)) continue;
    rev+=mm[ym].rev; months++;
    if(mm[ym].method==="approx"||mm[ym].method==="reported_approx") hasApprox=true; }
  return months?{rev,months,hasApprox}:null;
}
// A banner's ESTIMATED Sensor Tower revenue (global USD). Sensor Tower only publishes a
// monthly total per game, so per banner we take its share of that month's game-i revenue
// and apply it to the month's real ST figure, then SUM across every month the banner ran
// (a banner spanning two months adds both). Returns {total, months:[{ym,share,stMonth,
// contrib}], covered, missing, hasData, partial} — `partial` = ran in a month with no ST
// figure yet, so the total is incomplete. Cached on the banner (data is static per session).
function bannerST(b){
  if(!b || b._synthetic) return {total:0, months:[], covered:0, missing:0, hasData:false, partial:false};
  if(b._st) return b._st;
  const bm=state.monthly||{}, gi=state.data.monthly||{};
  const months=[]; let total=0, covered=0, missing=0;
  for(const ym of Object.keys(bm).sort()){
    const entry=bm[ym].banners.find(x=>x.i===b._i); if(!entry) continue;    // banner ran this month
    const o=bm[ym].ours||0, g=gi[ym];
    const base=(g!=null && o>0 && (g-o)/g>=0.08) ? g : o;                    // same denominator as the composition bar
    const share=base>0 ? entry.rev/base : 0;
    const st=extMonth(ym);
    if(st){ const c=share*st.rev; total+=c; covered++; months.push({ym, share, jp:entry.rev, stMonth:st.rev, contrib:c, method:st.method}); }
    else   { missing++; months.push({ym, share, jp:entry.rev, stMonth:null, contrib:null}); }
  }
  return (b._st={total, months, covered, missing, hasData:covered>0, partial:missing>0&&covered>0});
}
// Which major version a whole month belongs to (by the version live on the 1st) —
// same rule as versionOf, so months and banners bucket consistently. Data is monthly
// and versions are date-based, so a version's launch month is approximate.
function versionOfYm(ym){
  const v=VERSIONS[state.tag]; if(!v) return null;
  const d=ym+"-01"; let cur=v[0][0];
  for(const [label,date] of v){ if(d>=date) cur=label; else break; }
  return cur;
}
// A small "ST $X" chip (ST = Sensor Tower). "*" marks approximate values — a
// region-summed older report, or eog's newest not-yet-finalized month. The tooltip
// says whether it's a published report figure or the validated reconstruction.
function stChip(rev, method, extra){
  if(rev==null) return "";
  const isSum = method && typeof method==="object";
  const approx = method==="approx" || method==="reported_approx" || (isSum && method.hasApprox);
  let base;
  if(isSum) base = "gacharevenue / Sensor Tower monthly figures summed (published reports where available, else the validated eog reconstruction) — combined region, USD";
  else if(method==="reported"||method==="reported_approx") base = "gacharevenue / Sensor Tower published monthly report figure — combined region (all regions incl. China iOS + separate JP server), USD";
  else base = "gacharevenue combined estimate (USD) — reconstructed from eog.gg Sensor Tower data (China-Android modelled at 1.75× China-iOS), validated against the reports";
  const tip = base
    + (approx?". Approximate — region-summed from an older report, or eog's not-yet-finalized latest month":"")
    + (extra?". "+extra:"");
  return `<span class="st-chip${approx?" est":""}" title="${esc(tip)}">ST ${fmtUSD(rev)}${approx?"*":""}</span>`;
}

// self-hiding scrollbars: flag <html> while anything is scrolling (capture catches the
// non-bubbling scroll events from inner scrollers) and clear it after a short idle, so
// the styled thumb (style.css) only fades in during a scroll.
let _scrollIdle;
addEventListener("scroll", ()=>{
  const h=document.documentElement; h.classList.add("scrolling");
  clearTimeout(_scrollIdle); _scrollIdle=setTimeout(()=>h.classList.remove("scrolling"), 850);
}, {capture:true, passive:true});

// ---- color helpers (clamp lightness for readable bars in each theme) ----
function hexToHsl(h){h=h.replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");
  const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let hue=0,s=0,l=(mx+mn)/2;
  if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);
    hue=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;hue/=6;}return[hue,s,l];}
function hslToHex(h,s,l){function f(n){const k=(n+h*12)%12,a=s*Math.min(l,1-l);
  const c=l-a*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(c*255).toString(16).padStart(2,"0");}
  return "#"+f(0)+f(8)+f(4);}
function barShades(hex){const[h,s,l]=hexToHsl(hex||"#888");
  return[hslToHex(h,Math.max(s,.18),Math.min(Math.max(l,.34),.55)),
         hslToHex(h,Math.max(s,.22),Math.min(Math.max(l,.50),.70))];}

// ---- init ----
// no-cache revalidates with the server (ETag) so a stale or half-written cached
// copy after a Pages redeploy can't wedge the app; throws on HTTP errors so
// failures surface as a retry screen instead of an eternal "Loading…".
async function getJSON(url){
  const r = await fetch(url, {cache:"no-cache"});
  if(!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
function showError(err, retry){
  console.error(err);
  $("#chart").innerHTML =
    `<div class="loading err">Couldn't load data (${esc(err.message||String(err))}).<br>` +
    `This is usually a brief network hiccup or the site mid-redeploy.<br>` +
    `<button class="ghost" id="retryBtn">Retry</button></div>`;
  $("#retryBtn").onclick = retry;
}
async function init(){
  let idx;
  try { idx = await getJSON("data/index.json"); }
  catch(e){ showError(e, init); return; }
  // external comparison layer. Best-effort: a miss just hides the ST figures.
  // reported = canonical monthly report figures; ext = validated eog reconstruction (fallback).
  try { state.ext = await getJSON("data/external_revenue.json"); } catch(e){ state.ext=null; }
  try { state.reported = await getJSON("data/reported_revenue.json"); } catch(e){ state.reported=null; }
  state.pending = {};   // "pending banners" overlay is disabled (no lagging games tracked)
  state.games = (idx && idx.games) || [];
  if(!state.games.length){                    // empty index (e.g. a failed data refresh) — don't crash
    showError(new Error("no games in the data index (a refresh may have failed)"), init);
    return;
  }
  const tabs = $("#tabs"); tabs.innerHTML = "";
  state.games.forEach(g=>{
    const b=document.createElement("button"); b.className="tab"; b.dataset.tag=g.game;
    b.innerHTML=`<span class="g">${g.name}</span><span class="t">${g.count} banners · ${G(g.total_oku)}</span>`;
    b.onclick=()=>selectGame(g.game); tabs.appendChild(b);
  });
  // ResizeObserver fires after layout settles and on width changes; fonts.ready
  // covers late font metrics. Deterministic width math avoids wrap-timing flakiness.
  new ResizeObserver(layoutTabs).observe($("#tabs"));
  addEventListener("resize", layoutTabs);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutTabs);
  const start = (location.hash||"").replace("#","");
  selectGame(state.games.some(g=>g.game===start)?start:state.games[0].game);
}

// Collapse the game list to one no-wrap row with an "+N more" toggle. Collapsed is a
// single line, so we count how many tabs fit by summing their widths (deterministic).
function layoutTabs(){
  const tabs=$("#tabs"), toggle=$("#tabsToggle");
  if(!tabs.children.length || !tabs.clientWidth) return;
  tabs.classList.toggle("collapsed", !state.tabsExpanded);
  if(state.tabsExpanded){ toggle.hidden=false; toggle.textContent="Show less ▴"; return; }
  let used=0, fit=0;
  for(const t of tabs.children){ used += t.offsetWidth + 8; if(used > tabs.clientWidth && fit>0) break; fit++; }
  const hidden = tabs.children.length - fit;
  toggle.hidden = hidden<=0;
  toggle.textContent = `+${hidden} more ▾`;
}
$("#tabsToggle").onclick=()=>{ state.tabsExpanded=!state.tabsExpanded; layoutTabs(); };
let _loadSeq = 0;
async function selectGame(tag){
  state.tag=tag; location.hash=tag;
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.dataset.tag===tag));
  document.documentElement.style.setProperty("--accent", GAME_ACCENT[tag]||"#e0a400");
  $("#chart").innerHTML=`<div class="loading">Loading ${tag.toUpperCase()}…</div>`;
  const seq = ++_loadSeq;
  let data;
  try { data = await getJSON(`data/${tag}.json`); }
  catch(e){ if(seq===_loadSeq) showError(e, ()=>selectGame(tag)); return; }
  if(seq!==_loadSeq) return;   // a newer tab click won this race
  state.data = data;
  // rank by revenue *within our dataset* — game-i's cum is against the game's full
  // history (often far larger than what we scrape), so it isn't 1..N here.
  state.data.banners = state.data.banners.filter(b=>!b._synthetic && !b.pending);   // defensive on re-entry
  computeMonthly();                                        // per-month attribution from real banners
  state.data.banners = state.data.banners.concat(computeUnlisted());  // + synthetic 'unlisted revenue'
  // recent banners game-i hasn't logged yet (FGO/Arknights JP sources) — placeholders with
  // no revenue or rank curve, shown until game-i catches up.
  const pend = (state.pending && state.pending[tag]) || [];
  if(pend.length) state.data.banners = state.data.banners.concat(
    pend.map(p=>({...p, rev:0, year:+String(p.start).slice(0,4), pending:true})));
  [...state.data.banners].sort((a,b)=>b.rev-a.rev).forEach((b,i)=>b._rank=i+1);
  state.data.banners.forEach((x,i)=>x._i=i);
  computeSharing();
  populateGraphYears();
  resetSearch();                         // characters differ per game — clear any active search
  renderStats(); setMode(state.mode);   // setMode wires all mode-dependent control visibility, then renders
}

// tiny inverted sparkline of the daily iOS top-grossing rank (prev + current
// month). Rank 1 sits at the top; gaps are days below the trackable ~top 200.
function sparkline(now){
  if(!now.ranks) return "";
  const vals=[...now.ranks.prev, ...now.ranks.cur];
  while(vals.length && vals[vals.length-1]==null) vals.pop();   // future days
  const known=vals.filter(v=>v!=null);
  if(known.length<2) return "";
  const W=120,H=26,max=Math.max(...known),n=vals.length;
  let d="",pen=false;
  vals.forEach((v,i)=>{
    if(v==null){pen=false;return;}
    const x=(i/(n-1))*W, y=2+((v-1)/Math.max(max-1,1))*(H-4);
    d+=`${pen?"L":"M"}${x.toFixed(1)} ${y.toFixed(1)}`; pen=true;
  });
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}

function nowTile(now){
  if(!now || (now.ios==null && now.android==null)) return "";
  const r=v=>v==null?"200+":"#"+v;
  const add=now.next_add?` · game-i expects ≈${G(now.next_add/1e8)} more tomorrow`:"";
  const tip=`Daily iOS top-grossing rank, last two months (top = #1; gaps = below the trackable ~top 200, which game-i counts as ¥0)${add}`;
  return `<div class="tile" title="${esc(tip)}"><span class="l">JP store rank today</span>`+
         `<span class="v">iOS ${r(now.ios)}</span>`+
         `<span class="n">Android ${r(now.android)} · monthly sales ${now.month?"#"+now.month:"—"}</span>`+
         sparkline(now)+`</div>`;
}

function monthTopBanner(ym){ const bl=(state.monthly&&state.monthly[ym]&&state.monthly[ym].banners)||[]; return bl.length?state.data.banners[bl[0].i]:null; }
function renderStats(){
  const st = state.dataSource==="st";
  const fmt = st ? fmtUSD : G;
  const all = state.data.banners, real = all.filter(x=>!x._synthetic && !x.pending);
  const val = st ? (x=>bannerST(x).total) : (x=>x.rev);
  const sum = st ? real.reduce((a,x)=>a+val(x),0) : all.reduce((a,x)=>a+x.rev,0);
  const top = real.reduce((a,x)=> val(x)>val(a)?x:a);
  const topName = (top.agents&&top.agents.length) ? top.agents.join(" & ") : top.name;
  // highest single month, on the active data source
  let hmYm=null, hmVal=-1;
  if(st){ const mm=extGameMonths(state.tag); for(const ym in mm){ if(mm[ym].rev>hmVal){hmVal=mm[ym].rev; hmYm=ym;} } }
  else  { // mirror the by-Month total: game-i's published monthly where it exists, else the reconstructed banner sum
          const gi=state.data.monthly||{}, bm=state.monthly||{};
          for(const ym of new Set([...Object.keys(gi),...Object.keys(bm)])){
            const v = gi[ym]!=null ? gi[ym] : ((bm[ym]&&bm[ym].ours)||0);
            if(v>hmVal){hmVal=v; hmYm=ym;} } }
  const hmBanners = hmYm ? (((state.monthly&&state.monthly[hmYm]&&state.monthly[hmYm].banners)||[]).map(x=>state.data.banners[x.i])) : [];
  const hmName = hmYm ? `${MONTHS[+hmYm.slice(5,7)-1]} ${hmYm.slice(0,4)}` : "—";
  // a row of character icons at the BOTTOM of a tile (a month can hold several banners)
  const icRow = bans => {
    const list=(bans||[]).filter(x=>x&&x.icons&&x.icons[0]), cap=9;
    if(!list.length) return "";
    const imgs=list.slice(0,cap).map(x=>`<img class="tile-ic2" src="${esc(x.icons[0])}" alt="" referrerpolicy="no-referrer" data-fb="remove" title="${esc(x.agents&&x.agents.length?x.agents.join(" & "):x.name)}">`).join("");
    return `<div class="tile-ics">${imgs}${list.length>cap?`<span class="tile-icmore">+${list.length-cap}</span>`:""}</div>`;
  };
  const tile=(l,v,n,icons="",attr="")=>`<div class="tile${attr?" tile-click":""}"${attr?" "+attr:""}><span class="l">${l}</span><span class="v">${v}</span><span class="n">${esc(n)}</span>${icons}</div>`;
  $("#tiles").innerHTML=
      tile("Total revenue", fmt(sum), `across ${real.length} banners`)
    + tile("Highest banner", fmt(val(top)), topName, icRow([top]), `data-i="${top._i}" title="Open ${esc(topName)}"`)
    + tile("Highest month", hmVal>=0?fmt(hmVal):"—", hmName, icRow(hmBanners), hmYm?`data-period="month" data-key="${hmYm}" title="Open ${esc(hmName)}"`:"")
    + tile("Average / banner", fmt(sum/real.length), st?"mean estimate · combined":"mean estimate")
    + nowTile(state.data.now);
  $("#updated").textContent=`sources: game-i.daa.jp + Sensor Tower reports · updated ${new Date(state.data.updated).toISOString().slice(0,10)}`;
}

function esc(s){return (s||"").replace(/[&<>"'`]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));}
function scaleMax(m){const nice=[5,10,15,20,25,30,40,50,75,100,150,200];return nice.find(n=>n>=m)||Math.ceil(m/50)*50;}
function ticks(max,step){
  if(!step) step = max<=1?0.2 : max<=2.5?0.5 : max<=6?1 : max<=12?2 : max<=25?5 : max<=50?10 : max<=100?25 : 50;
  const t=[]; for(let v=0;v<=max+1e-9;v+=step) t.push(+v.toFixed(2)); return t;
}
function niceCeil(oku){ return Math.max(1, Math.ceil(oku)); }   // round up to next 100M (1億)
// USD axis (Sensor Tower mode): fit the axis tightly to the peak (the "match highest"
// behaviour) by rounding up to a fine 1-2-5-ish step, so the tallest bar nearly fills.
function usdTop(peak){
  if(peak<=0) return 1e6;
  const mag=Math.pow(10, Math.floor(Math.log10(peak)));
  const steps=[1,1.1,1.2,1.25,1.3,1.4,1.5,1.6,1.75,1.8,2,2.2,2.5,2.8,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,9.5,10];
  return (steps.find(m=>m*mag>=peak-1) || 10)*mag;
}
function usdTicks(max){
  const targ=max/4, mag=Math.pow(10, Math.floor(Math.log10(targ)));
  const step=([1,2,2.5,5,10].map(m=>m*mag).find(s=>s>=targ)) || 10*mag;
  const t=[]; for(let v=0; v<=max+1; v+=step) t.push(v); return t;
}
// axis top for a peak: a chosen bracket rounds up to it (2.04B @¥200M -> 2.2B); else
// "match highest" fits tightly (next 100M), otherwise a roomy round number.
function roundTop(peak, tight){
  if(state.bracket) return Math.ceil(peak/state.bracket - 1e-9)*state.bracket;
  return tight ? niceCeil(peak) : scaleMax(peak);
}
// ---- character search: match a banner against the active query across its JP name,
// English agent names and related field; empty query matches everything ----
function bannerText(b){ return [b.name, b.related, ...(b.agents||[])].filter(Boolean).join(" "); }
// normalize for matching: lowercase, drop separators (& / ,), collapse whitespace
function normSearch(s){ return (s||"").toLowerCase().replace(/[&/,・]/g," ").replace(/\s+/g," ").trim(); }
// token-AND match so "Miyabi & Harumasa" (label) matches text that stores agents space-joined
function searchMatch(b){ const q=normSearch(state.search); if(!q) return true;
  const t=normSearch(bannerText(b)); return q.split(" ").every(w=>t.includes(w)); }
function searching(){ return !!(state.search||"").trim(); }
function poolBanners(){
  const b=state.data.banners;
  if(state.graphYear==="all") return b;
  if(state.graphDim==="version") return b.filter(x=>versionOf(x)===state.graphYear);
  return b.filter(x=>String(x.year)===state.graphYear);
}

// ---- avatars ----
// No inline onerror handlers: image fallbacks are handled by one delegated
// listener (below), so a strict CSP with no 'unsafe-inline' script can apply and
// scraped names never land in an executable context. src/name are escaped too.
function avatarHTML(b){
  if(b._synthetic) return `<span class="mono syn">≈</span>`;
  if(b.icons&&b.icons.length){
    let h=`<img src="${esc(b.icons[0])}" alt="" referrerpolicy="no-referrer" data-fb="mono" data-nm="${esc(b.name)}">`;
    if(b.icons[1]) h+=`<img class="extra" src="${esc(b.icons[1])}" alt="" referrerpolicy="no-referrer" data-fb="remove">`;
    if(b.icons[2]) h+=`<img class="extra e2" src="${esc(b.icons[2])}" alt="" referrerpolicy="no-referrer" data-fb="remove">`;
    return h;
  }
  if(b.banner_img) return `<img class="artav" src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="mono" data-nm="${esc(b.name)}">`;
  return monoStr(b.name);
}
function monoStr(name){return `<span class="mono">${esc((name||"?").trim()[0]||"?")}</span>`;}
window.mono=function(name){const d=document.createElement("span");d.className="mono";d.textContent=(name||"?").trim()[0]||"?";return d;};
// image load failures fall back here instead of via inline handlers (error does
// not bubble, so listen in the capture phase).
document.addEventListener("error", e=>{
  const el=e.target;
  if(!el || el.tagName!=="IMG") return;
  if(el.dataset.fb==="remove") el.remove();
  else if(el.dataset.fb==="mono") el.replaceWith(mono(el.dataset.nm||""));
  // game-i's banner art is often a hotlinked Discord CDN URL that expires; when it
  // 404s, swap in the (stable) Enka portrait once instead of showing nothing.
  else if(el.dataset.fb==="art"){
    const alt=el.dataset.alt;
    if(alt && el.getAttribute("src")!==alt){ el.dataset.fb="remove"; el.src=alt; }
    else el.remove();
  }
}, true);

// ---- concurrent-banner "shared revenue" detection ----
// game-i splits each day's revenue equally among every banner running that day
// (see the methodology dialog). For each banner we find which days overlapped
// another banner and what share of its reconstructed revenue that represents, so
// the chart can flag the split. HoYo games merge simultaneous characters into one
// "A&B" entry, so this mostly lights up on event games (FGO, Arknights, …) where
// separate banners genuinely run at once. Computed once per game load.
const SHARE_MIN_DAYS = 3;                         // ignore trivial 1-day changeovers
// Synthetic "unlisted revenue" entries: when game-i's monthly total for a month
// is much larger than the banners it has listed (a rate-up/event game-i hasn't
// logged yet, or off-banner sales), add one entry for the difference so the
// game's timeline/graph/totals reflect that it kept earning. Only big positive
// gaps — small residuals are just reconstruction noise, and low-rank games
// (monthly < banners) get none. Derived client-side from the monthly table.
function computeUnlisted(){
  const gi=state.data.monthly||{}, bm=state.monthly||{}, out=[];
  // only within our banner-coverage window — months before the first tracked
  // banner are "not covered yet", not "game-i's list is behind".
  const real=state.data.banners.filter(b=>!b._synthetic);
  if(!real.length) return out;
  const firstYm=real.reduce((m,b)=>b.start.slice(0,7)<m?b.start.slice(0,7):m,"9999-99");
  const spans=real.map(b=>[Date.parse(b.start),Date.parse(b.end)]);
  const cutoff=Date.parse(state.data.updated)+9*3600e3;   // ~now (JST) — don't count future days
  for(const ym in gi){
    if(ym<=firstYm) continue;              // skip pre-coverage months and the partial first month
    const g=gi[ym]; if(!g) continue;
    const gap=g-((bm[ym]&&bm[ym].ours)||0);
    if(gap<1 || gap<g*0.4) continue;                 // >= 1億 (¥100M) AND >= 40% of the month
    const [y,mo]=ym.split("-").map(Number), last=new Date(y,mo,0).getDate();
    // Require days with NO listed banner running. Otherwise a large gap is just
    // a valuation artifact (month-start boost, or an ongoing banner whose current
    // month is under-reconstructed) rather than genuinely unlisted revenue —
    // e.g. an in-progress month whose only banner is clearly running.
    let counted=0, uncovered=0;
    for(let dd=1; dd<=last; dd++){
      const t=Date.UTC(y,mo-1,dd); if(t>cutoff) break;
      counted++;
      if(!spans.some(([s,e])=>s<=t && t<=e)) uncovered++;
    }
    if(!counted || uncovered/counted<0.4) continue;
    out.push({ name:"No rate-up banner listed",
      agents:["game-i monthly — not attributed to a banner"],
      rev:+gap.toFixed(2), start:`${ym}-01`, end:`${ym}-${String(last).padStart(2,"0")}`,
      year:y, _synthetic:true, cum:null, cumtot:null, yrank:null, ytot:null });
  }
  return out;
}

// Is a banner actually up on day `t`? A paused-and-resumed run only counts its
// sub-periods (so the gap is another banner's solo time, not shared).
function runsOn(b, t){
  const R = b._runs; return R.length===1 ? (R[0][0]<=t && t<=R[0][1]) : R.some(([a,z])=>a<=t && t<=z);
}
// Run boundaries (any sub-period), for handoff detection.
const startsOn=(b,t)=>b._runs.some(([a])=>a===t), endsOn=(b,t)=>b._runs.some(([,z])=>z===t);
// A "handoff" day: one banner ends exactly as the other starts (game-i shares that
// changeover date). They're not live at the same time, so it isn't real sharing.
const handoff=(b,o,t)=> (endsOn(b,t)&&startsOn(o,t)) || (startsOn(b,t)&&endsOn(o,t));
function computeSharing(){
  const all=state.data.banners.filter(b=>!b._synthetic), DAY=864e5;
  all.forEach(b=>{ b._runs = b.periods ? b.periods.map(p=>[Date.parse(p[0]),Date.parse(p[1])])
                                       : [[Date.parse(b.start),Date.parse(b.end)]]; });
  for(const b of all){
    const s=Date.parse(b.start), e=Date.parse(b.end), series=b.rank_series;
    // an ongoing banner's scheduled end is in the future — only count days it has
    // actually run (its rank_series length), so "shared X/Yd" reflects days elapsed.
    const eff = series&&series.length ? Math.min(e, s+(series.length-1)*DAY) : e;
    let sharedDays=0, runDays=0, maxN=1, rawTot=0, rawShared=0; const withMap=new Map();
    for(let i=0,t=s; t<=eff; t+=DAY,i++){
      if(!runsOn(b,t)) continue;                        // skip the paused gap of a split run
      runDays++;
      const raw = series ? rankValue(series[i]) : 1;    // weight by that day's reconstructed value
      rawTot += raw;
      const others=all.filter(o=>o!==b && runsOn(o,t));
      if(others.length){ sharedDays++; rawShared+=raw; maxN=Math.max(maxN,others.length+1);
        others.forEach(o=>withMap.set(o,(withMap.get(o)||0)+1)); }
    }
    const revFrac = rawTot ? rawShared/rawTot : 0;
    const sharedRev = b.rev*revFrac, soloRev = b.rev - sharedRev;
    b._share = { days:sharedDays, totalDays:runDays, maxN, revFrac, sharedRev, soloRev,
      on: sharedDays>=SHARE_MIN_DAYS,
      with:[...withMap.entries()].sort((a,c)=>c[1]-a[1])
              .map(([o,d])=>({name:(o.agents&&o.agents.length?o.agents.join(" & "):o.name), days:d})) };
  }
}

// ---- bar rows (timeline / ranking) with FLIP reordering ----
// value shown/ranked for a banner under the current data source (game-i yen vs Sensor Tower USD)
function srcVal(b){ return state.dataSource==="st" ? bannerST(b).total : b.rev; }
// Uma's gacha is generically named — every pickup shares the same "…プリティーダービーガチャ…"
// title — so when we know the actual character(s), show those as the banner's label instead
// of the useless gacha name. Games with a real per-banner name (HoYo etc.) are untouched.
const GENERIC_GACHA = /プリティーダービーガチャ|サポートカードガチャ/;
function bLabel(b){ return (GENERIC_GACHA.test(b.name||"") && b.agents && b.agents.length) ? b.agents.join(" & ") : (b.name||""); }
function rowHTML(b,rank,max){
  const stMode=state.dataSource==="st";
  const c=barColor(b), [bl,bd]=barShades(c);
  const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
  const rr=b.rerun?`<span class="rr" title="Rerun banner">↻ rerun</span>`:"";
  const sh=b._share;
  const shSeg = sh&&sh.on
    ? `<span class="shared" style="width:${Math.min(100,Math.round(sh.revFrac*100))}%" title="~${Math.round(sh.revFrac*100)}% split with a concurrent banner"></span>` : "";
  let val, valStr;
  if(b.pending){ val=0;
    valStr = `<span class="val pendingval" title="This banner isn't in game-i's data yet, so there's no daily revenue estimate — it'll fill in automatically once game-i lists it.">not on game-i yet</span>`;
  } else if(stMode){ const st=bannerST(b); val=st.total||0;
    valStr = b._synthetic ? `<span class="val muted">—</span>`
      : !st.hasData ? `<span class="val nodata" title="No Sensor Tower report covers this banner's run (before Oct 2021, or too low to chart)">no ST data</span>`
      : `<span class="val">≈${fmtUSD(val)}${st.partial?`<span class="partialbadge" title="Sensor Tower has data for only ${st.covered} of the ${st.covered+st.missing} months this banner ran — total is incomplete">partial</span>`:""}</span>`;
  } else { val=b.rev; valStr=`<span class="val">${G(val)}</span>`; }
  const w=Math.max(val>0?1.2:0,(val/max)*100), m=rank<=3?` m${rank}`:"";
  return `<div class="row${b._synthetic?" synrow":""}${b.pending?" pendrow":""}" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
    <div class="rk${m}">${rank}</div>
    <div class="av">${avatarHTML(b)}</div>
    <div class="meta">
      <div class="nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="en">${esc(en)}</span>`:""}${rr}</div>
      <div class="barline"><div class="track"><div class="barfill" style="width:${w}%">${shSeg}</div></div>
        ${valStr}</div>
    </div></div>`;
}
function axesHTML(max){
  const stMode=state.dataSource==="st";
  const tk=stMode?usdTicks(max):ticks(max,state.bracket), fmt=stMode?fmtUSD:G;
  return tk.map(t=>`<div class="axis" style="left:calc(87px + (100% - 87px - 74px) * ${t/max})"><span>${fmt(t)}</span></div>`).join("");}

function renderBars(){
  const stMode=state.dataSource==="st";
  const V = stMode ? srcVal : (b=>b.rev);
  const all=state.data.banners; all.forEach((x,i)=>x._i=i);
  const pool=poolBanners().filter(searchMatch);               // Year filter + character search
  if(!pool.length){ $("#stnote").hidden=true; $("#chart").innerHTML=noResultsHTML(); return; }
  [...pool].sort((a,c)=>V(c)-V(a)).forEach((x,i)=>x._rank=i+1);   // rank within the shown set
  // one axis (timeline gridlines are full-height, so they can't vary per year): match-highest
  // fits the axis tightly to the shown set's peak; otherwise leaves roomy headroom.
  const peak=Math.max(0,...pool.map(V));
  const max = stMode ? (usdTop(peak)||1) : roundTop(peak, state.matchHigh);
  // FLIP: capture current row positions before we replace the DOM
  const old={};
  document.querySelectorAll("#chart .row").forEach(r=>{ old[r.dataset.i]=r.getBoundingClientRect().top; });
  let list=[...pool], html="";
  if(state.mode==="rank"){ list.sort((x,y)=> state.reverse ? V(x)-V(y) : V(y)-V(x)); html+=axesHTML(max);
    list.forEach(x=>html+=rowHTML(x,x._rank,max)); }
  else { list.sort((x,y)=>y.start.localeCompare(x.start)); if(state.reverse) list.reverse(); let cy=null;  // newest first by default
    list.forEach(x=>{ const gk=groupKey(x); if(gk!==cy){cy=gk; html+=`<div class="yhead">${esc(gk)}</div>`+axesHTML(max);}
      html+=rowHTML(x,x._rank,max); }); }
  $("#stnote").hidden=!stMode;
  $("#chart").innerHTML=html;
  // FLIP: invert to old position, then play to new one (icons slide up/down)
  document.querySelectorAll("#chart .row").forEach(r=>{
    const o=old[r.dataset.i]; if(o==null) return;
    const dy=o-r.getBoundingClientRect().top;
    if(!dy) return;
    r.style.transform=`translateY(${dy}px)`; r.style.transition="none";
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      r.style.transition="transform .5s cubic-bezier(.2,.7,.2,1)"; r.style.transform="";
    }));
  });
}

// ---- grouping: the timeline/graph group (and its x-axis window) follow the
// Year/Version filter toggle, so switching to Version regroups by 1.X / 2.X … ----
function groupKey(b){
  if(state.graphDim==="version"){ const v=versionOf(b); if(v) return v; }
  return String(b.year);
}
// [x0ms, x1ms] the x-axis should span for a group: a calendar year, or a major
// version's window (its launch date to the next version's, or the run's end).
function groupRange(key, items){
  if(state.graphDim==="version" && VERSIONS[state.tag]){
    const v=VERSIONS[state.tag], i=v.findIndex(e=>e[0]===key);
    const x0=Date.parse(v[i][1]);
    const x1 = i>=0 && i+1<v.length ? Date.parse(v[i+1][1])
             : Math.max(...items.map(b=>Date.parse(b.end)))+7*864e5;   // open latest version
    return [x0, x1];
  }
  const y=+key; return [Date.parse(y+"-01-01"), Date.parse((y+1)+"-01-01")];
}
function xAxisTicks(x0, x1){
  if(state.graphDim!=="version") return [0,2,4,6,8,10].map(m=>({frac:m/12, t:MONTHS[m]}));
  const t=[], d=new Date(x0); if(d.getDate()!==1) d.setMonth(d.getMonth()+1,1);
  let g=0;
  while(d.getTime()<=x1 && g++<40){ t.push({frac:(d.getTime()-x0)/(x1-x0), t:MONTHS[d.getMonth()]}); d.setMonth(d.getMonth()+1); }
  const step=Math.max(1,Math.ceil(t.length/7));
  return t.filter((_,i)=>i%step===0);
}
// ---- graph view (one line chart per year OR per version) ----
function graphVal(b){ return state.dataSource==="st" ? bannerST(b).total : b.rev; }
function groupSVG(label, items, gmax, step, x0, x1){
  const st = state.dataSource==="st";
  const fmt = st ? fmtUSD : G;
  const W=760,H=470,ML=58,MR=16,MT=18,MB=28, pW=W-ML-MR, pH=H-MT-MB, base=MT+pH;
  const xOf=d=>ML+((Date.parse(d)-x0)/(x1-x0))*pW;
  const yOf=v=>MT+(1-v/gmax)*pH;
  const pts=[...items].sort((a,b)=>a.start.localeCompare(b.start)).map(b=>({x:xOf(b.start),y:yOf(graphVal(b)),b}));
  const grid=(st?usdTicks(gmax):ticks(gmax,step)).map(t=>{const y=yOf(t);
    return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/>`+
           `<text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">${fmt(t)}</text>`;}).join("");
  const xt=xAxisTicks(x0,x1).map(tk=>{const x=ML+tk.frac*pW;
    return `<text class="axislbl" x="${x.toFixed(1)}" y="${H-8}" text-anchor="middle">${tk.t||""}</text>`;}).join("");
  const line=pts.map((p,i)=>(i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ");
  const area=`M${pts[0].x.toFixed(1)} ${base} `+pts.map(p=>"L"+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ")+` L${pts[pts.length-1].x.toFixed(1)} ${base} Z`;
  const R=15, gid=String(label).replace(/\W/g,"");
  const marks=pts.map(p=>{
    const acc=barColor(p.b);
    const url=(p.b.icons&&p.b.icons[0])||p.b.banner_img;
    const cx=p.x.toFixed(1), cy=p.y.toFixed(1);
    if(url){
      const id=`clip_${gid}_${p.b._i}`;
      return `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>`+
        `<image href="${esc(url)}" x="${(p.x-R).toFixed(1)}" y="${(p.y-R).toFixed(1)}" width="${2*R}" height="${2*R}" `+
        `preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" data-i="${p.b._i}"/>`+
        `<circle class="gring" cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${acc}" data-i="${p.b._i}"/>`;
    }
    return `<circle class="dot${p.b._synthetic?" syndot":""}" data-i="${p.b._i}" cx="${cx}" cy="${cy}" r="6" fill="${acc}"/>`;
  }).join("");
  return `<svg class="gsvg" viewBox="0 0 ${W} ${H}" role="img">
    ${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${marks}${xt}</svg>`;
}
function renderGraph(){
  state.data.banners.forEach((x,i)=>x._i=i);
  const st = state.dataSource==="st";
  let pool = poolBanners();                     // graph ignores the character search entirely
  if(st) pool = pool.filter(b=>graphVal(b)>0);  // Sensor Tower mode: only banners the reports actually cover
  if(!pool.length){
    $("#chart").innerHTML = st
      ? `<div class="noresults">No Sensor&nbsp;Tower data to chart for <b>${esc(state.data.name)}</b> in this range.</div>`
      : `<div class="loading">No banners to chart.</div>`;
    return;
  }
  const sharedMax = st ? usdTop(Math.max(...pool.map(graphVal))) : roundTop(Math.max(...pool.map(x=>x.rev)), false);
  const groups={}; pool.forEach(x=>{ const k=groupKey(x); (groups[k]=groups[k]||[]).push(x); });
  let keys=Object.keys(groups).sort();
  if(!state.reverse) keys.reverse();           // newest group first by default
  $("#chart").innerHTML=keys.map(k=>{
    const items=groups[k];
    const peak=Math.max(...items.map(graphVal));
    const gmax=state.matchHigh ? (st?usdTop(peak):roundTop(peak,true)) : sharedMax;
    const [x0,x1]=groupRange(k, items);
    return `<div class="gyear"><div class="yhead">${esc(k)}</div>${groupSVG(k,items,gmax,state.bracket||0,x0,x1)}</div>`;
  }).join("");
}
function populateGraphYears(){
  if(state.graphDim==="version" && !hasVersions(state.tag)) state.graphDim="year";   // game has no versions
  // the Year/Version filter toggle only appears for version-based games
  const gd=$("#gdim");
  gd.hidden=!hasVersions(state.tag);
  gd.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.dim===state.graphDim));
  // the "by Version" view button is likewise game-specific
  $("#bVersion").hidden=!hasVersions(state.tag);
  if(state.mode==="version" && !hasVersions(state.tag)) setMode("time");
  const vals = state.graphDim==="version"
    ? [...new Set(state.data.banners.map(versionOf).filter(Boolean))].sort()
    : [...new Set(state.data.banners.map(b=>b.year))].sort().map(String);
  if(state.graphYear!=="all" && !vals.includes(state.graphYear)) state.graphYear="all";
  $("#gyears").innerHTML=`<button data-y="all"${state.graphYear==="all"?' class="on"':''}>All</button>`+
    vals.map(v=>`<button data-y="${esc(v)}"${state.graphYear===v?' class="on"':''}>${esc(v)}</button>`).join("");
  $("#gyears").querySelectorAll("button").forEach(btn=>btn.onclick=()=>{
    state.graphYear=btn.dataset.y;
    $("#gyears").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===btn));
    if(!state.table) render();
  });
}
$("#gdim").querySelectorAll("button").forEach(btn=>btn.onclick=()=>{
  state.graphDim=btn.dataset.dim; state.graphYear="all";
  populateGraphYears();
  if(!state.table) render();
});

function noResultsHTML(){
  return `<div class="noresults">No banners match <b>“${esc((state.search||"").trim())}”</b> for ${esc(state.data.name)}.<br><button class="linkbtn" id="clearSearch2">Clear search</button></div>`;
}
// visibility of the secondary controls row (graph filter / sort / direction / table).
// The row itself always shows (it carries the Chart/Table toggle); its inner controls
// switch by view. In table view only the "Chart view" button remains.
function updateControlVis(){
  const m=state.mode, period=isPeriodMode(m);
  $("#graphControls").hidden = false;
  $("#gfilter").hidden   = state.table || period;          // Year/Version graph filter: timeline/graph/ranking only
  $("#bSortWrap").hidden  = state.table || !period;        // period-card sort dropdown: by-Year/Month/Version only
  $("#bYearsWrap").hidden = state.table || state.mode!=="month";   // month year-filter: by-Month only
  $("#hintRow").hidden    = state.table || isPeriodMode(state.mode);   // hover hint: Timeline/Graph/Ranking only, under the right-side buttons
  $("#bDir").hidden       = state.table;                   // direction is meaningless in the table view
  $("#dataSrc").hidden    = state.table;                   // game-i/ST toggle in every chart view (incl. Graph) except Table
  $("#search").hidden     = m==="graph";                   // Graph has no per-character search — it charts every banner
}
function render(){
  document.body.dataset.view = state.table ? "table" : state.mode;   // lets CSS tailor per view (e.g. mobile graph)
  $("#chartwrap").hidden=state.table; $("#tablewrap").hidden=!state.table;
  updateControlVis();
  if(state.table){ buildTable(); return; }
  if(state.mode==="graph"){ renderGraph(); return; }
  if(state.mode==="year"){ renderYearly(); return; }
  if(state.mode==="month"){ renderMonthly(); return; }
  if(state.mode==="version"){ renderVersions(); return; }
  renderBars();
}

// ---- by-month view: game-i's published monthly revenue (月次売上予測) reconciled
// against the banners active that month. Our per-month figure attributes each
// banner's reconstructed daily revenue to the calendar month it fell in, so the
// two should line up closely — a big gap flags a month game-i's banner list is
// behind on (or days with no banner running). ----
function computeMonthly(){
  const byMonth={};
  // NB: this runs before selectGame assigns b._i, but real banners keep their array
  // position as their eventual _i (synthetics are appended after), so capture bi here.
  state.data.banners.forEach((b,bi)=>{
    if(b._synthetic) return;                 // reconciliation uses real banners only
    const s=b.rank_series; if(!s||!s.length) return;
    const raw=s.map(rankValue), tot=raw.reduce((a,c)=>a+c,0);
    // Attribute to EVERY month the run touches — not just months it earned in. A
    // banner whose rank sat below game-i's trackable top 200 all month earns ¥0
    // there, but it was still running, so it must show in that month's list (as ¥0)
    // rather than vanish and make a co-running banner look like the month's only one.
    const s0=new Date(b.start+"T00:00:00"), per={};
    raw.forEach((rw,i)=>{ const dt=new Date(s0); dt.setDate(dt.getDate()+i);
      const ym=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
      if(!(ym in per)) per[ym]=0;                       // mark the month as run-touched
      if(rw>0 && tot>0) per[ym]+=b.rev*rw/tot; });       // add its share on tracked days
    for(const ym in per){ const M=byMonth[ym]||(byMonth[ym]={ours:0,banners:[]});
      M.ours+=per[ym];
      M.banners.push({name:(b.agents&&b.agents.length?b.agents.join(" & "):b.name), rev:per[ym], total:b.rev, i:bi}); }
  });
  for(const ym in byMonth) byMonth[ym].banners.sort((a,c)=>c.rev-a.rev);
  state.monthly=byMonth;
}
// One banner's contribution inside a month: revenue + extrapolated global, plus a
// detail line (dates · days · below-#200 · shared) and a hatched share indicator.
function bannerContribHTML(x, base, st, ym){
  const b=state.data.banners[x.i]; if(!b) return "";
  const c=barColor(b), en=b.agents&&b.agents.length?b.agents.join(" & "):"";
  const zero = x.rev < 0.001;
  const share = base>0 ? x.rev/base : 0;                   // share of the month (game-i monthly or reconstruction, whichever is larger)
  const part = x.total && x.rev < x.total-1e-9;
  const giVal = zero
    ? `<span class="mcb-gi below" title="Ran this month but stayed below game-i's trackable top 200 — counted as ~¥0">¥0 · below&nbsp;#200</span>`
    : `<span class="mcb-gi">${G(x.rev)} <span class="mcb-pct">${base>0?(share*100).toFixed(0)+"% of month":""}</span>${part?`<span class="mcb-of">of ${G(x.total)} total</span>`:""}</span>`;
  let stVal="";
  if(st){
    const est = zero ? 0 : share*st.rev;
    const tip = zero ? "Below game-i's top 200 in JP — assumed ~0 globally"
      : `Extrapolated: this banner is ${(share*100).toFixed(0)}% of the month's JP revenue, so ~${(share*100).toFixed(0)}% of the $${(st.rev/1e6).toFixed(1)}M Sensor Tower combined monthly. No per-banner breakdown exists, so this assumes the combined total follows JP — an estimate.`;
    stVal=`<span class="mcb-st" title="${esc(tip)}">≈ ${fmtUSD(est)} <span class="mcb-tag">est. combined</span></span>`;
  }
  // detail line: run dates (in this month) · days · below-#200 · shared THIS month
  const [Y,Mo]=(ym||"").split("-").map(Number);
  const dd = Y ? bannerDays(b, Y, Mo) : null;
  const det=[];
  if(dd){ det.push(`<span class="mcb-dates">${fmtDayMs(dd.first)}–${fmtDayMs(dd.last)}</span>`);
    det.push(`${dd.days} day${dd.days!==1?"s":""}`);
    if(dd.below>0) det.push(`<span class="mcb-below">${dd.below}d below&nbsp;#200</span>`);
    if(dd.shared>0) det.push(`<span class="mcb-shr" title="Ran alongside ${esc(dd.withList.map(w=>w.name).join(", "))} on ${dd.shared} of its ${dd.days} days this month">▨ shared ${dd.shared}/${dd.days}d</span>`); }
  const detLine = det.length?`<div class="mcb-det">${det.join(" · ")}</div>`:"";
  return `<div class="mcb" data-i="${x.i}" style="--av-ring:${c}">
    <div class="mcb-av">${avatarHTML(b)}</div>
    <div class="mcb-meta">
      <div class="mcb-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="mcb-en">${esc(en)}</span>`:""}${b&&b.rerun?`<span class="rr">↻</span>`:""}</div>
      <div class="mcb-vals">${giVal}${stVal}</div>
      ${detLine}
    </div></div>`;
}
// A pending banner's row in a by-Month card: icon + name + "not on game-i yet" (no revenue).
function pendContribHTML(b){
  const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
  return `<div class="mcb pendmcb" data-i="${b._i}" style="--av-ring:${barColor(b)}">
    <div class="mcb-av">${avatarHTML(b)}</div>
    <div class="mcb-meta">
      <div class="mcb-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="mcb-en">${esc(en)}</span>`:""}</div>
      <div class="mcb-vals"><span class="mcb-pend" title="This banner isn't in game-i's data yet, so there's no daily revenue estimate — it'll fill in once game-i lists it.">not on game-i yet</span></div>
      <div class="mcb-det"><span class="mcb-dates">${fmtDayMs(Date.parse(b.start))}–${fmtDayMs(Date.parse(b.end))}</span></div>
    </div></div>`;
}
// Compact month-concurrency summary for the card (only when banners actually overlap).
function overlapCardHTML(bans, Y, Mo){
  const real=bans.filter(b=>b&&b.rank_series&&b.rank_series.length);
  if(real.length<2) return "";
  const ov=monthOverlap(real, Y, Mo);
  if(!ov.shared.length) return "";
  const nm=b=>esc(b.agents&&b.agents.length?b.agents.join(" & "):b.name);
  const chips=[...ov.solo.map(x=>({t:nm(x.b)+" alone", d:x.days, shr:false})),
               ...ov.shared.map(x=>({t:x.bs.map(nm).join(" + ")+" together", d:x.days, shr:true}))]
    .sort((a,b)=>b.d-a.d);
  const shown=chips.slice(0,6).map(c=>`<span class="mc-ovc${c.shr?" shr":""}">${c.t} <b>${c.d}d</b></span>`).join("");
  const more=chips.length>6?`<span class="mc-ovc more">+${chips.length-6}</span>`:"";
  return `<div class="mc-ov"><span class="mc-ov-h">▨ How the banners overlapped</span><div class="mc-ovc-row">${shown}${more}</div></div>`;
}
// pending banners (not on game-i) grouped by each calendar month they touch, so the
// by-Month view lists them even where game-i has no data for the month yet.
function pendingByMonth(){
  const by={};
  for(const b of state.data.banners){
    if(!b.pending) continue;
    for(const ym of new Set([String(b.start).slice(0,7), String(b.end).slice(0,7)]))
      (by[ym]=by[ym]||[]).push(b);
  }
  return by;
}
function renderMonthly(){
  const gi=state.data.monthly||{}, bm=state.monthly||{}, pend=pendingByMonth();
  const months=[...new Set([...Object.keys(gi),...Object.keys(bm),...Object.keys(pend)])].sort();
  if(!months.length){ $("#chart").innerHTML=`<div class="loading">No monthly data for this game.</div>`; return; }
  const allYears=[...new Set(months.map(m=>m.slice(0,4)))].sort().reverse();
  if(state.monthYear!=="all" && !allYears.includes(state.monthYear)) state.monthYear="all";  // reset on game switch
  // year filter now lives in the controls bar (#bYears), to the right of the Sort dropdown
  const yBtns=`<button data-my="all"${state.monthYear==="all"?' class="on"':''}>All</button>`
    + allYears.map(y=>`<button data-my="${y}"${state.monthYear===y?' class="on"':''}>${y}</button>`).join("");
  if($("#bYears")) $("#bYears").innerHTML=yBtns;
  const mval=ym=>{ const v=gi[ym]; return v!=null?v:((bm[ym]&&bm[ym].ours)||0); };
  const stM=ym=>(extMonth(ym)||{}).rev||0;
  const val = state.dataSource==="st" ? stM : mval;   // Ranking sorts by the toggled data source
  let order = state.periodSort==="ranking" ? [...months].sort((a,b)=>val(b)-val(a)) : [...months].reverse();
  if(state.reverse) order.reverse();
  if(state.monthYear!=="all") order=order.filter(ym=>ym.slice(0,4)===state.monthYear);
  if(searching()) order=order.filter(ym=>((bm[ym]&&bm[ym].banners)||[]).some(x=>searchMatch(state.data.banners[x.i])));
  if(searching() && !order.length){ $("#chart").innerHTML=noResultsHTML(); return; }
  let dtot=0,dnul=0;
  state.data.banners.forEach(b=>{const s=b.rank_series||[]; dtot+=s.length; dnul+=s.filter(x=>x==null).length;});
  const lowRank = dtot && dnul/dtot>=0.15;
  const hasST = Object.keys(extGameMonths(state.tag)).length>0;
  let html=`<div class="yr-note">Each month shows three estimates side by side: game-i's published <b>monthly total</b> (月次売上予測), the total we <b>reconstruct from daily ranks</b>, and`
    + (hasST?` the <b>Sensor Tower</b> combined figure (from gacharevenue's published monthly reports). <b>*</b> marks approximate values (region-summed older reports).`:` (no Sensor Tower coverage for this game).`)
    + ` The bar splits the month among the banners that ran; each banner lists its game-i share and an <b>extrapolated combined</b> figure (its JP share applied to the Sensor Tower total — a rough estimate, since no per-banner breakdown exists).</div>`
    + `<div class="mo-hint">Tap or hover any character for its daily-rank detail; each card shows the full monthly breakdown, run dates &amp; below-#200 days, and how the banners overlapped.</div>`;
  if(lowRank) html+=`<div class="mo-warn">⚠ Many of this game's banners fall <b>below game-i's trackable top&nbsp;200</b> within a few days. game-i counts those days as <b>¥0</b> even though the app is still selling, so its <b>monthly total undercounts</b> and the per-banner split is shaky — take everything here as ballpark.</div>`;
  let curY=null;
  order.forEach(ym=>{
    const y=ym.slice(0,4), mo=+ym.slice(5,7);
    if(state.periodSort==="timeline" && y!==curY){ curY=y; html+=`<div class="yhead">${y}</div>`; }
    const g=gi[ym], o=(bm[ym]&&bm[ym].ours)||0, bl=(bm[ym]&&bm[ym].banners)||[];
    const st=extMonth(ym);
    // composition denominator: normally split the reconstructed banner total exactly
    // (segments sum to 100%). Show an "unlisted revenue" slice ONLY when this month has a
    // synthetic ≈ banner — i.e. game-i's monthly genuinely exceeds its listed banners AND
    // the month has days with no listed banner running (computeUnlisted's test). A bare
    // revenue gap on a fully-covered month is reconstruction / month-split / partial-month
    // noise (e.g. a banner spanning into the ongoing month), not real unattributed revenue.
    const showUnlisted = state.data.banners.some(b=>b._synthetic && b.start.slice(0,7)===ym);
    const base = (showUnlisted && g!=null && g>0) ? g : o;
    // KPI scorecards
    const diff = (g!=null && g>0) ? (o-g)/g*100 : null;
    const kGi = g!=null ? `<div class="mck"><span class="mck-k">game-i monthly</span><span class="mck-v">${G(g)}</span><span class="mck-n">月次売上予測</span></div>` : "";
    const kRe = `<div class="mck"><span class="mck-k">from daily ranks</span><span class="mck-v">${G(o)}</span><span class="mck-n">${diff!=null?`${diff>=0?"+":""}${diff.toFixed(0)}% vs game-i`:"reconstruction"}</span></div>`;
    const stApprox = st && (st.method==="approx"||st.method==="reported_approx");
    const stSub = st ? (st.usonly ? `<span class="usonly-tag" title="Global (US) only — no China figure available for this month, so it's undercounted">global only</span>` : (st.method==="reported"||st.method==="reported_approx" ? "combined · reported" : "combined · reconstructed")) : "";
    const kSt = st ? `<div class="mck st${st.usonly?" usonly":""}"><span class="mck-k">Sensor Tower${stApprox?" *":""}</span><span class="mck-v">${fmtUSD(st.rev)}</span><span class="mck-n">${stSub}</span></div>` : "";
    // composition bar: one segment per banner (share of the base) + an "unlisted" remainder
    const segs = bl.filter(x=>x.rev>0.0005).map(x=>({x, share: base>0?x.rev/base:0}));
    let sumShare = segs.reduce((a,s)=>a+s.share,0);
    const scale = sumShare>1 ? 1/sumShare : 1;
    const unlisted = showUnlisted ? Math.max(0, 1-sumShare) : 0;
    const barSegs = segs.map(s=>{ const b=state.data.banners[s.x.i];
      const dd=bannerDays(b, +y, mo), shrFrac = dd&&dd.days ? dd.shared/dd.days : 0;   // sharing WITHIN this month
      const hatch = shrFrac>0 ? `<span class="mcs-shr" style="width:${Math.min(100,Math.round(shrFrac*100))}%"></span>`:"";
      return `<div class="mcs" style="width:${(s.share*scale*100).toFixed(2)}%;background:${barColor(b)}" title="${esc(s.x.name)} · ${(s.share*100).toFixed(0)}%${shrFrac>0?` · shared ${dd.shared}/${dd.days}d this month`:""}">${hatch}</div>`;
    }).join("") + (unlisted>0.01?`<div class="mcs unlisted" style="width:${(unlisted*100).toFixed(2)}%" title="Unlisted revenue (${Math.round(unlisted*100)}%) — game-i's monthly total is higher than its listed banners cover (an event/rate-up game-i hasn't logged, or off-banner sales)"></div>`:"");
    const bar = base>0 ? `<div class="mc-stack">${barSegs}</div>` : "";
    const pendHTML = (pend[ym]||[]).map(pendContribHTML).join("");
    const contribs = (bl.length || pendHTML)
      ? `<div class="mc-banners">${bl.map(x=>bannerContribHTML(x, base, st, ym)).join("")}${pendHTML}</div>`
      : `<div class="mc-empty">game-i lists no banner for this month.</div>`;
    const overlap = overlapCardHTML(bl.map(x=>state.data.banners[x.i]), +y, mo);
    // header + composition bar stay pinned to the top (bar spans the full card width);
    // only the banner list (.mc-body) centers vertically when the card is stretched to
    // match a taller row-mate.
    html+=`<div class="mc" data-period="month" data-key="${ym}">
      <div class="mc-hd"><div class="mc-month">${MONTHS[mo-1]||ym} <span class="mc-yr">${y}</span></div>
        <div class="mc-kpis">${kGi}${kRe}${kSt}</div></div>
      ${bar}<div class="mc-body">${contribs}${overlap}</div></div>`;
  });
  $("#chart").innerHTML=html;
}

// A year/version summary card: game-i total + Sensor Tower total as KPI scorecards,
// the change vs the previous period, and a magnitude bar. data-period/key wire the
// click-through dialog (banners of that period, ranked).
function periodCard(o){
  const giChgHTML = (o.chg!=null)
    ? ` · <span class="chg ${o.chg>=0?"up":"down"}">${o.chg>=0?"▲":"▼"}${Math.abs(o.chg).toFixed(0)}% vs ${esc(o.chgVs)}</span>` : "";
  const kGi=`<div class="mck"><span class="mck-k">game-i total</span><span class="mck-v">${G(o.rev)}</span>`
    +`<span class="mck-n">${o.cnt} banner${o.cnt!==1?"s":""} · ${o.pct.toFixed(0)}% of all-time${giChgHTML}</span></div>`;
  const stChgHTML = (o.st && o.stChg!=null)
    ? ` · <span class="chg ${o.stChg>=0?"up":"down"}">${o.stChg>=0?"▲":"▼"}${Math.abs(o.stChg).toFixed(0)}% vs ${esc(o.chgVs)}</span>` : "";
  const kSt=o.st?`<div class="mck st"><span class="mck-k">Sensor Tower${o.st.hasApprox?" *":""}</span><span class="mck-v">${fmtUSD(o.st.rev)}</span>`
    +`<span class="mck-n">${o.st.months} mo${o.st.hasApprox?" · approx":""}${stChgHTML}</span></div>`
    :`<div class="mck ghost"><span class="mck-k">Sensor Tower</span><span class="mck-v">—</span><span class="mck-n">no coverage</span></div>`;
  // magnitude bar (width = size vs the biggest period) whose fill is split into one
  // colored segment per banner — the same composition read as a by-Month card, so the
  // bar shows both how big the period was and which banners made it up.
  const bans=(o.bans||[]).filter(b=>b.rev>0.0005 && !b._synthetic);
  const realSum=bans.reduce((a,b)=>a+b.rev,0);
  const unlistedFrac = o.rev>0 ? Math.max(0,(o.rev-realSum)/o.rev) : 0;   // synthetic / not-attributed remainder
  let seg=bans.map(b=>{ const f=o.rev>0?b.rev/o.rev:0;
    return `<div class="mcs" style="width:${(f*100).toFixed(2)}%;background:${barColor(b)}" title="${esc(bnm(b))} · ${G(b.rev)} · ${(f*100).toFixed(0)}%"></div>`;
  }).join("");
  if(unlistedFrac>0.01) seg+=`<div class="mcs unlisted" style="width:${(unlistedFrac*100).toFixed(2)}%" title="Not attributed to a listed banner (${Math.round(unlistedFrac*100)}%) — ${G(o.rev-realSum)}"></div>`;
  const fill = seg
    ? `<div class="yc-fill comp" style="width:${o.w}%">${seg}</div>`
    : `<div class="yc-fill" style="width:${o.w}%"></div>`;
  const legend = bans.length ? `<div class="yc-legend">${bans.slice(0,6).map(b=>
      `<span class="yc-lg"><span class="yc-lg-dot" style="background:${barColor(b)}"></span>${esc(bnm(b))}</span>`).join("")}${bans.length>6?`<span class="yc-lg muted">+${bans.length-6} more</span>`:""}</div>` : "";
  return `<div class="yc" data-period="${o.kind}" data-key="${esc(String(o.key))}">
    <div class="yc-hd"><div class="yc-label">${esc(o.label)}${o.prog?`<span class="yc-prog">in progress</span>`:""}</div>
      <div class="mc-kpis yc-kpis">${kGi}${kSt}</div></div>
    <div class="yc-track">${fill}</div>${legend}</div>`;
}
// banner display name (agents joined, else banner name) — shared by cards & bars
function bnm(b){ return b.agents&&b.agents.length?b.agents.join(" & "):b.name; }

// ---- by-year breakdown: revenue per calendar year vs the previous year ----
function renderYearly(){
  const all=state.data.banners;
  const total=all.reduce((a,b)=>a+b.rev,0);
  const byYear={}, cnt={}, bansBy={};
  all.forEach(b=>{ byYear[b.year]=(byYear[b.year]||0)+b.rev; cnt[b.year]=(cnt[b.year]||0)+1;
    (bansBy[b.year]||(bansBy[b.year]=[])).push(b); });
  Object.values(bansBy).forEach(a=>a.sort((x,y)=>y.rev-x.rev));
  const years=Object.keys(byYear).map(Number).sort((a,b)=>a-b);
  const max=Math.max(...years.map(y=>byYear[y]));
  const nowYear=new Date(state.data.updated).getUTCFullYear();
  const stY=y=>(extSum(ym=>ym.slice(0,4)===String(y))||{}).rev||0;
  const vy = state.dataSource==="st" ? stY : (y=>byYear[y]);
  let order = state.periodSort==="ranking" ? [...years].sort((a,b)=>vy(b)-vy(a)) : [...years].sort((a,b)=>b-a);
  if(state.reverse) order.reverse();
  if(searching()){ order=order.filter(y=>(bansBy[y]||[]).some(searchMatch));
    if(!order.length){ $("#chart").innerHTML=noResultsHTML(); return; } }
  const head=`<div class="yr-head"><b>${esc(state.data.name)}</b> — ${G(total)} total across ${years.length} year${years.length>1?"s":""}</div>`
    + `<div class="yr-note">Each year shows game-i's tracked total and the Sensor Tower combined sum. Sensor Tower coverage runs from late 2021 (older, region-summed months are marked <b>*</b>), and the current year is in progress, so the first and latest years are partial. <b>Click a card</b> for that year's banners.</div>`;
  const rows=order.map(y=>{
    const rev=byYear[y], prev=byYear[y-1];
    const yoy = prev!=null ? (rev-prev)/prev*100 : null;
    const stCur=extSum(ym=>ym.slice(0,4)===String(y)), stPrev=extSum(ym=>ym.slice(0,4)===String(y-1));
    // only compare when the previous period has comparable coverage (avoids a full year vs a 1-month stub)
    const stChg = (stCur&&stPrev&&stPrev.rev>0&&stPrev.months>=stCur.months*0.6) ? (stCur.rev-stPrev.rev)/stPrev.rev*100 : null;
    return periodCard({label:String(y), prog:y===nowYear, rev, pct: total?rev/total*100:0, cnt:cnt[y],
      chg:yoy, chgVs:String(y-1), st:stCur, stChg, w:Math.max(2,rev/max*100), kind:"year", key:y, bans:bansBy[y]});
  }).join("");
  $("#chart").innerHTML=head+rows;
}

// ---- by-Version breakdown: revenue per major game version (1.X, 2.X, …) ----
function renderVersions(){
  const all=state.data.banners;
  const total=all.reduce((a,b)=>a+b.rev,0);
  const byV={}, cnt={}, bansBy={};
  all.forEach(b=>{ const v=versionOf(b)||"?"; byV[v]=(byV[v]||0)+b.rev; cnt[v]=(cnt[v]||0)+1;
    (bansBy[v]||(bansBy[v]=[])).push(b); });
  Object.values(bansBy).forEach(a=>a.sort((x,y)=>y.rev-x.rev));
  const vers=Object.keys(byV).sort();          // "1.X".."9.X" sort correctly (single-digit majors)
  const max=Math.max(...vers.map(v=>byV[v]),0.1);
  const cur=vers[vers.length-1];               // latest version = in progress
  const stV=v=>(extSum(ym=>versionOfYm(ym)===v)||{}).rev||0;
  const vv = state.dataSource==="st" ? stV : (v=>byV[v]);
  let order = state.periodSort==="ranking" ? [...vers].sort((a,b)=>vv(b)-vv(a)) : [...vers].reverse();
  if(state.reverse) order.reverse();
  if(searching()){ order=order.filter(v=>(bansBy[v]||[]).some(searchMatch));
    if(!order.length){ $("#chart").innerHTML=noResultsHTML(); return; } }
  const head=`<div class="yr-head"><b>${esc(state.data.name)}</b> — ${G(total)} across ${vers.length} version${vers.length>1?"s":""}</div>`
    + `<div class="yr-note">Grouped by major game version (1.X = all of v1.x, etc.). Sensor Tower months are mapped to versions by date (approximate). The first and latest versions may be partial. <b>Click a card</b> for that version's banners.</div>`;
  const rows=order.map(v=>{
    const i=vers.indexOf(v), rev=byV[v], prev=i>0?byV[vers[i-1]]:null;
    const chg = prev!=null ? (rev-prev)/prev*100 : null;
    const stCur=extSum(ym=>versionOfYm(ym)===v), stPrev=i>0?extSum(ym=>versionOfYm(ym)===vers[i-1]):null;
    const stChg = (stCur&&stPrev&&stPrev.rev>0&&stPrev.months>=stCur.months*0.6) ? (stCur.rev-stPrev.rev)/stPrev.rev*100 : null;
    return periodCard({label:v, prog:v===cur, rev, pct: total?rev/total*100:0, cnt:cnt[v],
      chg, chgVs:vers[i-1]||"", st:stCur, stChg, w:Math.max(2,rev/max*100), kind:"version", key:v, bans:bansBy[v]});
  }).join("");
  $("#chart").innerHTML=head+rows;
}
function buildTable(){
  state.data.banners.forEach((x,i)=>x._i=i);
  const rows=[...state.data.banners].filter(searchMatch).sort((a,b)=>b.rev-a.rev).map(b=>`<tr data-i="${b._i}" class="clk">
    <td>${b.cum!=null?"#"+b.cum:"—"}</td><td class="l">${esc(b.name)}</td>
    <td class="l" style="color:var(--muted)">${esc((b.agents||[]).join(", "))}</td>
    <td>${G(b.rev)}</td>
    <td class="l" style="color:var(--muted)">${per(b.start)} – ${per(b.end)}</td>
    <td class="l">${b.yrank!=null?`${b.year} · #${b.yrank}/${b.ytot}`:b.year}</td></tr>`).join("");
  $("#tablewrap").innerHTML=`<table><thead><tr><th>Rank</th><th class="l">Banner</th>
    <th class="l">Agent(s)</th><th>Revenue</th><th class="l">Period</th><th class="l">Yr rank</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
$("#tablewrap").addEventListener("click",e=>{
  const tr=e.target.closest("tr[data-i]"); if(!tr) return;
  openBanner(state.data.banners[+tr.dataset.i]);
});

// ---- tooltip (works over bar rows AND graph dots — both carry data-i) ----
const tip=$("#tip");
function place(el,e){ const pad=15,w=el.offsetWidth,h=el.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  el.style.left=Math.max(6,x)+"px"; el.style.top=Math.max(6,y)+"px"; }
function showTip(b,e){
  if(b._synthetic){
    tip.innerHTML=`<div class="body"><h4><span class="dot" style="background:var(--muted)"></span>${esc(b.name)}</h4>
      <div style="color:var(--muted);font-size:11.5px">${MONTHS[+b.start.slice(5,7)-1]} ${b.year}</div>
      <dl><dt>Est. revenue</dt><dd><b>${G(b.rev)}</b></dd></dl>
      <div class="tiphint" style="color:var(--muted);border-color:var(--border)">game-i's monthly total that no listed banner covers — likely an event game-i hasn't logged</div></div>`;
    tip.hidden=false; place(tip,e); return;
  }
  const en=b.agents&&b.agents.length?b.agents.join(" & "):(b.related||"");
  const art=b.banner_img?`<img class="art" src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="art" data-alt="${esc((b.icons&&b.icons[0])||"")}">`:"";
  const rr=b.rerun?` <span class="rr">↻ rerun</span>`:"";
  const hint=(b.rank_series&&b.rank_series.length)
    ? `<div class="tiphint">▸ Click to see daily rankings during the run</div>` : "";
  const sh=b._share;
  const shRow = sh&&sh.on
    ? `<dt>On its own</dt><dd>${G(sh.soloRev)}</dd>`
    + `<dt>While shared</dt><dd>${G(sh.sharedRev)}</dd>` : "";
  tip.innerHTML=`${art}<div class="body">
    <h4><span class="dot" style="background:${barColor(b)}"></span>${esc(b.name)}${rr}</h4>
    <div style="color:var(--muted);font-size:11.5px">${esc(en)}</div>
    <dl><dt>Period</dt><dd>${per(b.start)} – ${per(b.end)}</dd>
    <dt>Est. revenue</dt><dd><b>${G(b.rev)}</b></dd>
    <dt>All-time rank</dt><dd>#${b.cum} / ${b.cumtot}</dd>
    <dt>${b.year} rank</dt><dd>#${b.yrank} / ${b.ytot}</dd>${shRow}</dl>${hint}</div>`;
  tip.hidden=false;
  const pad=15,w=tip.offsetWidth,h=tip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  tip.style.left=x+"px"; tip.style.top=Math.max(6,y)+"px";
}
$("#chart").addEventListener("pointermove",e=>{
  if(e.pointerType==="touch"){ tip.hidden=true; return; }   // touch: a tap opens the full modal instead of a hover card
  const el=e.target.closest("[data-i]"); if(!el){tip.hidden=true;return;}
  showTip(state.data.banners[+el.dataset.i],e);
});
$("#chart").addEventListener("pointerleave",()=>tip.hidden=true);
$("#bYearsWrap").addEventListener("click",e=>{
  const my=e.target.closest("[data-my]"); if(my){ state.monthYear=my.dataset.my; renderMonthly(); }
});
// header tiles: Highest banner → that banner; Highest month → that month's dialog
$("#tiles").addEventListener("click",e=>{
  const bt=e.target.closest("[data-i]"); if(bt){ openBanner(state.data.banners[+bt.dataset.i]); return; }
  const pe=e.target.closest("[data-period]"); if(pe){ openPeriod(pe.dataset.period, pe.dataset.key); }
});
$("#chart").addEventListener("click",e=>{
  const el=e.target.closest("[data-i]"); if(el){ openBanner(state.data.banners[+el.dataset.i]); return; }
  const pe=e.target.closest("[data-period]"); if(pe){ openPeriod(pe.dataset.period, pe.dataset.key); }
});

// ---- period dialog: every banner of a chosen year / month / version, ranked,
// with per-banner run detail (days, dates, below-#200) and month concurrency ----
const periodModal=$("#periodModal");
const _mn=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// {days, below, first, last} for a banner's run, optionally restricted to (Y,Mo). Dates are ms.
// Per-banner run stats within (Y,Mo) — or the whole run when Y is null. `shared`
// and `withList` are scoped to the SAME window, so a July view never shows sharing
// that only happened in August (when a later banner released).
function bannerDays(b, Y, Mo){
  const s=b.rank_series; if(!s||!s.length) return null;
  const s0=Date.parse(b.start+"T00:00:00Z"), DAY=864e5, all=state.data.banners;
  let days=0, below=0, shared=0, first=null, last=null; const withMap=new Map();
  for(let i=0;i<s.length;i++){ const t=s0+i*DAY, d=new Date(t);
    if(b._runs && !runsOn(b,t)) continue;               // skip a split run's paused gap (those days belong to another banner)
    if(Y!=null && !(d.getUTCFullYear()===Y && d.getUTCMonth()===Mo-1)) continue;
    days++; if(s[i]==null) below++;                       // below-#200 days = while actually running
    const others=all.filter(o=>o!==b && !o._synthetic && o._runs && runsOn(o,t) && !handoff(b,o,t));
    if(others.length){ shared++; others.forEach(o=>withMap.set(o,(withMap.get(o)||0)+1)); }
    if(first==null) first=t; last=t;
  }
  if(!days) return null;
  const withList=[...withMap.entries()].sort((a,c)=>c[1]-a[1])
    .map(([o,dd])=>({name:(o.agents&&o.agents.length?o.agents.join(" & "):o.name), days:dd}));
  return {days,below,shared,first,last,withList};
}
const fmtDayMs=t=>{ const d=new Date(t); return `${_mn[d.getUTCMonth()]} ${d.getUTCDate()}`; };
// Concurrency across a calendar month: solo runs + multi-banner overlaps (by day).
function monthOverlap(bans, Y, Mo){
  const DAY=864e5, last=new Date(Date.UTC(Y,Mo,0)).getUTCDate();
  // each banner's last day with actual data (its rank_series extent) — so an ongoing
  // banner's not-yet-run scheduled days aren't counted as overlap.
  const eff=new Map(bans.map(b=>{ const s=Date.parse(b.start+"T00:00:00Z"), n=(b.rank_series||[]).length;
    return [b, n?s+(n-1)*DAY:Date.parse(b.end)]; }));
  const solo=new Map(), combos=new Map();
  for(let day=1; day<=last; day++){
    const t=Date.UTC(Y,Mo-1,day);
    // a banner that STARTS on t while another ENDS on t is a handoff — the changeover
    // day belongs to the outgoing banner, so drop the incoming one from this day.
    const on=bans.filter(b=>runsOn(b,t) && t<=eff.get(b) && !(startsOn(b,t) && bans.some(o=>o!==b && endsOn(o,t))));
    if(on.length===1) solo.set(on[0],(solo.get(on[0])||0)+1);
    else if(on.length>1){ const k=on.map(b=>b._i).sort((a,c)=>a-c).join("|");
      const c=combos.get(k)||{bs:on,days:0}; c.days++; combos.set(k,c); }
  }
  return {
    solo:[...solo.entries()].map(([b,d])=>({b,days:d})).sort((a,c)=>c.days-a.days),
    shared:[...combos.values()].sort((a,c)=>c.days-a.days),
  };
}
function openPeriod(kind, key){
  state.data.banners.forEach((x,i)=>x._i=i);
  const gname=esc(state.data.name), real=state.data.banners.filter(b=>!b._synthetic);
  let items=[], title="", sub="", extra="", stSection="", giHead="", Y=null, Mo=null;
  if(kind==="year"){
    const bs=real.filter(b=>String(b.year)===key).sort((a,b)=>b.rev-a.rev);
    items=bs.map(b=>({b, rev:b.rev}));
    title=`${gname} — ${esc(key)}`;
    const st=extSum(ym=>ym.slice(0,4)===key);
    sub=`<b>game-i</b> ${G(bs.reduce((a,b)=>a+b.rev,0))} · ${bs.length} banner${bs.length!==1?"s":""}`
      + (st?` &nbsp;·&nbsp; ${stChip(st.rev, st, `${st.months} month${st.months>1?"s":""} summed`)}`:"");
    extra=stMonthsHTML(ym=>ym.slice(0,4)===key);
  } else if(kind==="version"){
    const bs=real.filter(b=>versionOf(b)===key).sort((a,b)=>b.rev-a.rev);
    items=bs.map(b=>({b, rev:b.rev}));
    title=`${gname} — Version ${esc(key)}`;
    const st=extSum(ym=>versionOfYm(ym)===key);
    sub=`<b>game-i</b> ${G(bs.reduce((a,b)=>a+b.rev,0))} · ${bs.length} banner${bs.length!==1?"s":""}`
      + (st?` &nbsp;·&nbsp; ${stChip(st.rev, st, `${st.months} month${st.months>1?"s":""} summed, approximate`)}`:"");
    extra=stMonthsHTML(ym=>versionOfYm(ym)===key);
  } else {                                             // month — each banner's share of that calendar month
    [Y,Mo]=key.split("-").map(Number);
    real.forEach(b=>{
      const s=b.rank_series; if(!s||!s.length) return;
      const raw=s.map(rankValue), tot=raw.reduce((a,c)=>a+c,0);
      const s0=Date.parse(b.start+"T00:00:00Z"), DAY=864e5; let share=0, active=false;
      raw.forEach((rw,i)=>{ const d=new Date(s0+i*DAY);
        if(d.getUTCFullYear()===Y && d.getUTCMonth()===Mo-1){ active=true; if(rw>0 && tot>0) share+=b.rev*rw/tot; } });
      if(active) items.push({b, rev:share, total:b.rev});   // include ran-but-below-#200 banners (share ¥0)
    });
    items.sort((a,b)=>b.rev-a.rev);
    const gi=state.data.monthly&&state.data.monthly[key], o=(state.monthly[key]&&state.monthly[key].ours)||0, st=extMonth(key);
    title=`${gname} — ${MONTHS[Mo-1]||key} ${Y}`;
    // game-i section header + explanation (mirrors the Sensor Tower one below)
    giHead=`<div class="pd-hd pd-hd-gi">
      <div class="pd-hd-main">
        <h3 class="pd-h pd-h-gi">game-i — Japan revenue (this month)</h3>
        <div class="pd-subtitle">${items.length} banner${items.length!==1?"s":""} — ${esc(state.data.name)}'s estimated <b>Japan</b> revenue for ${MONTHS[Mo-1]} ${Y}, split among the banners that ran by each day's top-grossing rank${gi!=null?` (reconstructed from ranks: ${G(o)})`:""}.</div>
      </div>
      <div class="pd-tot pd-tot-gi"><span class="pd-tot-v">${gi!=null?G(gi):G(o)}</span><span class="pd-tot-l">${gi!=null?"月次売上予測 · monthly total":"reconstructed total"}</span></div>
    </div>`;
    // Sensor Tower section for the month: the game's global monthly total, then each
    // banner's assumed slice of it (its share of the game-i month × the global total).
    if(st){
      const base=(gi!=null && o>0 && (gi-o)/gi>=0.08) ? gi : o;   // same denominator as bannerST
      const ap = st.method==="approx"||st.method==="reported_approx";
      const stItems=items.map(it=>{ const share=base>0?it.rev/base:0; return {b:it.b, share, val:share*st.rev}; })
        .sort((a,b)=>b.val-a.val);
      const stMax=Math.max(...stItems.map(x=>x.val), 1);
      const stRows=stItems.map((it,i)=>{
        const b=it.b, c=barColor(b), [bl,bd]=barShades(c), zero=it.val<1e4;   // <$0.01M
        const w=zero?0:Math.max(2, it.val/stMax*100);
        const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
        const rr=b.rerun?`<span class="rr">↻</span>`:"";
        const val=zero ? `<span class="pd-val pd-below" title="Below game-i's top 200 this month, so no attributed share">$0</span>`
                       : `<span class="pd-val">≈${fmtUSD(it.val)}</span>`;
        return `<div class="pd-row" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
          <div class="pd-rk${i<3&&!zero?` m${i+1}`:""}">${i+1}</div>
          <div class="pd-av">${avatarHTML(b)}</div>
          <div class="pd-meta">
            <div class="pd-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="pd-en">${esc(en)}</span>`:""}${rr}</div>
            <div class="pd-bar"><div class="pd-track"><div class="pd-fill" style="width:${w}%"></div></div>${val}</div>
            <div class="pd-sub">${Math.round(it.share*100)}% of the month</div>
          </div></div>`;
      }).join("");
      stSection=`<div class="pd-hd pd-hd-st">
        <div class="pd-hd-main">
          <h3 class="pd-h pd-h-st">Sensor Tower — assumed combined (this month)</h3>
          <div class="pd-subtitle">${esc(state.data.name)}'s combined worldwide total for ${MONTHS[Mo-1]} ${Y}, split by each banner's share of the month.</div>
        </div>
        <div class="pd-tot pd-tot-st"><span class="pd-tot-v">${fmtUSD(st.rev)}${ap?" *":""}</span><span class="pd-tot-l">combined total</span></div>
      </div>
      <div class="pd-list">${stRows}</div>`;
    }
    extra=monthCalendarHTML(items, Y, Mo)+overlapHTML(items.map(it=>it.b), Y, Mo);
  }
  const max=Math.max(...items.map(x=>x.rev), 0.1);
  const rows=items.map((it,i)=>{
    const b=it.b, c=barColor(b), [bl,bd]=barShades(c);
    const zero = it.rev < 0.001;                          // ran the period but stayed below game-i's top 200
    const w=zero?0:Math.max(2, it.rev/max*100);
    const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
    const rr=b.rerun?`<span class="rr">↻</span>`:"";
    const part=it.total && it.rev<it.total-1e-9 ? ` <span class="pd-of">of ${G(it.total)}</span>`:"";
    // run detail: days & dates and SHARING, all scoped to this period (month view = that month)
    const dd = bannerDays(b, Y, Mo), shrFrac = dd&&dd.days ? dd.shared/dd.days : 0;
    const shSeg = (!zero && shrFrac>0) ? `<span class="pd-shared" style="width:${Math.min(100,Math.round(shrFrac*100))}%" title="Ran alongside ${esc(dd.withList.map(x=>x.name).join(", "))} on ${dd.shared}/${dd.days} days here"></span>`:"";
    const valHTML = zero
      ? `<span class="pd-val pd-below" title="Ran this period but stayed below game-i's trackable top 200, so game-i attributes ~¥0">¥0 · below&nbsp;#200</span>`
      : `<span class="pd-val">${G(it.rev)}${part}</span>`;
    const meta=[];
    if(dd){ meta.push(`${fmtDayMs(dd.first)}–${fmtDayMs(dd.last)}`); meta.push(`${dd.days} day${dd.days!==1?"s":""}`);
      if(dd.below>0) meta.push(`<span class="pd-below-d" title="Days below game-i's trackable top 200 (¥0)">${dd.below}d below #200</span>`);
      if(dd.shared>0) meta.push(`<span class="pd-shr-d" title="Ran alongside ${esc(dd.withList.map(x=>x.name).join(", "))}">shared ${dd.shared}/${dd.days}d</span>`); }
    else meta.push(`${per(b.start)} – ${per(b.end)}`);
    return `<div class="pd-row" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
      <div class="pd-rk${i<3&&!zero?` m${i+1}`:""}">${i+1}</div>
      <div class="pd-av">${avatarHTML(b)}</div>
      <div class="pd-meta">
        <div class="pd-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="pd-en">${esc(en)}</span>`:""}${rr}</div>
        <div class="pd-bar"><div class="pd-track"><div class="pd-fill" style="width:${w}%">${shSeg}</div></div>${valHTML}</div>
        <div class="pd-sub">${meta.join(" · ")}</div>
      </div></div>`;
  }).join("");
  $("#pdBody").innerHTML=`<h2 id="pdTitle" class="pd-title">${title}</h2>${sub?`<div class="pd-subtitle">${sub}</div>`:""}${giHead}`
    + (items.length?`<div class="pd-list">${rows}</div>`:`<p class="pd-empty">No banners in this period.</p>`)
    + stSection
    + extra;
  periodModal.querySelector(".modal-card").scrollTop=0;
  periodModal.hidden=false;
}
// Sensor-Tower monthly breakdown for a year/version dialog (one bar per covered month).
function stMonthsHTML(pred){
  const mm=extGameMonths(state.tag); const list=Object.keys(mm).filter(pred).sort();
  if(!list.length) return "";
  const max=Math.max(...list.map(m=>mm[m].rev),1);
  const rows=list.map(m=>{ const v=mm[m], ap=v.method==="approx"||v.method==="reported_approx";
    const [y,mo]=m.split("-"); const w=Math.max(2,v.rev/max*100);
    return `<div class="pd-mo"><span class="pd-mo-l">${_mn[+mo-1]} ${y}</span>
      <div class="pd-mo-track"><div class="pd-mo-fill" style="width:${w}%"></div></div>
      <span class="pd-mo-v">${fmtUSD(v.rev)}${ap?" *":""}</span></div>`;}).join("");
  return `<h3 class="pd-h">Sensor Tower — monthly (combined, USD)</h3><div class="pd-mos">${rows}</div>`;
}
// Stylized month calendar: a proper month grid (weeks × weekdays) where each banner is
// drawn as a continuous colored band spanning the days it ran, Google-Calendar style.
// Each banner keeps a consistent lane so overlapping runs stack cleanly; bands round off
// on the run's real start/end and carry the character avatar + name.
function monthCalendarHTML(items, Y, Mo){
  const dim=new Date(Date.UTC(Y,Mo,0)).getUTCDate();          // days in month
  const lead=new Date(Date.UTC(Y,Mo-1,1)).getUTCDay();        // weekday of the 1st (0=Sun)
  const monthStart=Date.UTC(Y,Mo-1,1), monthEnd=Date.UTC(Y,Mo-1,dim,23,59,59);
  const today=new Date(state.data.updated);
  const todayD=(today.getUTCFullYear()===Y && today.getUTCMonth()===Mo-1) ? today.getUTCDate() : 0;
  // each run clamped to day-of-month, remembering whether the true start/end falls inside
  const runs=items.map(it=>it.b).filter(b=>b.start&&b.end).map(b=>{
    const s=Date.parse(b.start+"T00:00:00Z"), e=Date.parse(b.end+"T00:00:00Z");
    return {b, sd:Math.max(1,Math.floor((s-monthStart)/864e5)+1), ed:Math.min(dim,Math.floor((e-monthStart)/864e5)+1),
            realStart:s>=monthStart, realEnd:e<=monthEnd};
  }).filter(r=>r.ed>=r.sd).sort((a,b)=>a.sd-b.sd || b.ed-a.ed);
  if(!runs.length) return "";
  // greedy lane assignment: reuse a lane once its previous run has ended (a stable row per banner)
  const laneEnd=[];
  runs.forEach(r=>{ let L=laneEnd.findIndex(end=>end<r.sd); if(L<0){ L=laneEnd.length; laneEnd.push(0); } laneEnd[L]=r.ed; r.lane=L; });
  const nLanes=Math.max(1, laneEnd.length);

  const WD=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const head=`<div class="calm-wd">${WD.map((w,i)=>`<div class="${(i===0||i===6)?"we":""}">${w}</div>`).join("")}</div>`;
  const totalCells=Math.ceil((lead+dim)/7)*7;
  let weeks="";
  for(let base=0; base<totalCells; base+=7){
    const wStart=base-lead+1;                                   // day-of-month at this week's Sunday (can be <1)
    let cells="";
    for(let c=0;c<7;c++){ const d=base+c-lead+1, valid=d>=1&&d<=dim, we=(c===0||c===6);
      cells+=`<div class="calm-day${valid?"":" pad"}${we?" we":""}${d===todayD?" today":""}">${valid?`<span class="calm-dn">${d}</span>`:""}</div>`;
    }
    let bands="";
    runs.forEach(r=>{
      const s=Math.max(r.sd, wStart), e=Math.min(r.ed, wStart+6);
      if(e<s || e<1 || s>dim) return;
      const cS=s-wStart, cE=e-wStart;                          // 0..6 columns within the week
      const roundL = r.sd>=wStart, roundR = r.ed<=wStart+6;    // real edge vs a week-wrap continuation
      const c2=barColor(r.b), wide=(cE-cS)>=1;
      bands+=`<div class="calm-band${roundL?" crl":""}${roundR?" crr":""}" data-i="${r.b._i}"
        style="left:calc(${(cS/7*100).toFixed(3)}% + 2px);width:calc(${((cE-cS+1)/7*100).toFixed(3)}% - 4px);top:${r.lane*20}px;background:${c2}"
        title="${esc(bnm(r.b))} · ${MONTHS[Mo-1]} ${r.sd}–${r.ed}">
        <span class="calm-b-av av" style="--av-ring:${c2}">${avatarHTML(r.b)}</span>${wide?`<span class="calm-b-nm">${esc(bnm(r.b))}</span>`:""}</div>`;
    });
    weeks+=`<div class="calm-wk" style="--lanes:${nLanes}"><div class="calm-days">${cells}</div><div class="calm-bands">${bands}</div></div>`;
  }
  return `<h3 class="pd-h">Banner calendar</h3><div class="calm">${head}${weeks}</div>`;
}
// Month concurrency: which banners ran solo vs together, in days.
function overlapHTML(bans, Y, Mo){
  const real=bans.filter(b=>b.rank_series&&b.rank_series.length);
  if(real.length<1) return "";
  const ov=monthOverlap(real, Y, Mo);
  if(!ov.solo.length && !ov.shared.length) return "";
  const nm=b=>esc(b.agents&&b.agents.length?b.agents.join(" & "):b.name);
  const solo=ov.solo.map(x=>`<li><span class="ov-dot" style="background:${barColor(x.b)}"></span>${nm(x.b)} <b>alone</b> — ${x.days} day${x.days!==1?"s":""}</li>`).join("");
  const shared=ov.shared.map(x=>`<li><span class="ov-dot ov-shr"></span>${x.bs.map(nm).join(" + ")} <b>together</b> — ${x.days} day${x.days!==1?"s":""}</li>`).join("");
  return `<h3 class="pd-h">How the month's banners overlapped</h3><ul class="pd-ov">${solo}${shared}</ul>`;
}
$("#pdClose").onclick=()=>{ periodModal.hidden=true; };
periodModal.onclick=e=>{ if(e.target===periodModal) periodModal.hidden=true; };
$("#pdBody").addEventListener("click",e=>{
  const el=e.target.closest("[data-i]"); if(el) openBanner(state.data.banners[+el.dataset.i]);
});

// ---- banner detail modal (daily rank curve + revenue build-up over the run) ----
const bannerModal=$("#bannerModal");
const dayLabel=i=>{const d=new Date(dayLabel.start); d.setDate(d.getDate()+i); return `${d.getMonth()+1}/${d.getDate()}`;};

// A banner's daily iOS top-grossing rank, drawn with #1 at the top. Gaps in the
// line are days the app sat below the trackable ~top 200 (game-i counts as ¥0).
function rankCurveSVG(b){
  const s=b.rank_series||[]; const n=s.length;
  const known=s.map((v,i)=>[i,v]).filter(([,v])=>v!=null);
  if(known.length<1) return "";
  const worst=Math.max(...known.map(([,v])=>v));
  const ymax = worst<=10?10 : worst<=20?20 : worst<=30?30 : worst<=50?50 : worst<=100?100 : 200;
  const W=680,H=230,ML=38,MR=14,MT=16,MB=26, pW=W-ML-MR, pH=H-MT-MB;
  const xOf=i=> n>1 ? ML+(i/(n-1))*pW : ML+pW/2;
  const yOf=r=> MT+((r-1)/(ymax-1))*pH;                 // rank 1 at top
  const gridR=[...new Set([1,Math.round(ymax/4),Math.round(ymax/2),Math.round(3*ymax/4),ymax])];
  const grid=gridR.map(r=>{const y=yOf(r);
    return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/>`+
      `<text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">#${r}</text>`;}).join("");
  const xIdx=[...new Set([0,Math.round((n-1)/3),Math.round(2*(n-1)/3),n-1])];
  const xt=xIdx.map(i=>`<text class="axislbl" x="${xOf(i).toFixed(1)}" y="${H-8}" text-anchor="middle">${dayLabel(i)}</text>`).join("");
  let d="",pen=false;
  s.forEach((v,i)=>{ if(v==null){pen=false;return;} const x=xOf(i),y=yOf(v);
    d+=`${pen?"L":"M"}${x.toFixed(1)} ${y.toFixed(1)}`; pen=true; });
  const dots=known.map(([i,v])=>`<circle class="rc-dot" cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="3"/>`).join("");
  const [pi,pv]=known.reduce((a,c)=>c[1]<a[1]?c:a);
  const peak=`<circle class="rc-peak" cx="${xOf(pi).toFixed(1)}" cy="${yOf(pv).toFixed(1)}" r="5"/>`+
    `<text class="rc-peaklbl" x="${xOf(pi).toFixed(1)}" y="${(yOf(pv)-9).toFixed(1)}" text-anchor="middle">peak #${pv}</text>`;
  const hits=known.map(([i,v])=>`<circle class="rc-hit" data-day="${i}" cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="9"/>`).join("");
  return `<svg class="rcsvg" viewBox="0 0 ${W} ${H}" role="img" style="--acc:${barColor(b)}">
    ${grid}<path class="rc-line" d="${d}"/>${dots}${peak}${hits}${xt}</svg>`;
}

// game-i's published rank → daily-revenue curve (億G, from its 日別加算値 table).
// Higher rank earns more that day; below ~200 earns nothing. We don't have the
// exact per-day yen (it shifts by date and splits across concurrent banners), so
// we use this curve only to *shape* the run, then scale it so the run's total
// equals game-i's own figure. It's a reconstruction, not a reported number.
const RANK_VAL=[[1,5.90],[2,3.47],[3,3.03],[4,2.61],[5,2.03],[10,.9034],[50,.2584],[100,.1640],[200,.10]];
function rankValue(r){
  if(r==null) return 0;
  if(r<=RANK_VAL[0][0]) return RANK_VAL[0][1];
  if(r>=200) return RANK_VAL[RANK_VAL.length-1][1];
  for(let i=0;i<RANK_VAL.length-1;i++){ const[r0,v0]=RANK_VAL[i],[r1,v1]=RANK_VAL[i+1];
    if(r>=r0&&r<=r1){ const t=(Math.log(r)-Math.log(r0))/(Math.log(r1)-Math.log(r0));
      return Math.exp(Math.log(v0)+t*(Math.log(v1)-Math.log(v0))); } }
  return 0;
}
function dailyBreakdown(b){
  const s=b.rank_series||[]; if(!s.length) return null;
  const raw=s.map(rankValue), sum=raw.reduce((a,c)=>a+c,0);
  if(sum<=0) return null;
  const all=state.data.banners, DAY=864e5, s0=Date.parse(b.start);
  let cum=0;
  const days=s.map((rank,i)=>{ const add=b.rev*raw[i]/sum; cum+=add;
    const t=s0+i*DAY;
    const shared=all.some(o=>o!==b && !o._synthetic && o._runs && runsOn(o,t) && runsOn(b,t));
    return {i,rank,add,cum,shared}; });
  return {days};
}
function buildupSVG(bd,b){
  const days=bd.days, n=days.length, total=b.rev;
  const W=680,H=180,ML=52,MR=14,MT=12,MB=26, pW=W-ML-MR, pH=H-MT-MB;
  const xOf=i=> n>1 ? ML+(i/(n-1))*pW : ML+pW/2;
  const yOf=v=> MT+(1-v/total)*pH;
  const grid=[0,.25,.5,.75,1].map(fr=>{const v=total*fr,y=yOf(v);
    return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/>`+
      `<text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">${G(v)}</text>`;}).join("");
  const bw=Math.min(16, pW/n*0.7);
  const bars=days.map(d=>{ if(d.add<=0) return ""; const x=xOf(d.i);
    const top=MT+(1-d.add/total)*pH, h=MT+pH-top;
    return `<rect class="bu-bar${d.shared?' shr':''}" x="${(x-bw/2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="2"/>`;}).join("");
  const line=days.map((d,i)=>(i?"L":"M")+xOf(i).toFixed(1)+" "+yOf(d.cum).toFixed(1)).join(" ");
  const cdots=days.map((d,i)=>`<circle class="rc-dot" cx="${xOf(i).toFixed(1)}" cy="${yOf(d.cum).toFixed(1)}" r="3"/>`).join("");
  const hits=days.map((d,i)=>`<circle class="rc-hit" data-day="${i}" cx="${xOf(i).toFixed(1)}" cy="${yOf(d.cum).toFixed(1)}" r="9"/>`).join("");
  const xIdx=[...new Set([0,Math.round((n-1)/2),n-1])];
  const xt=xIdx.map(i=>`<text class="axislbl" x="${xOf(i).toFixed(1)}" y="${H-8}" text-anchor="middle">${dayLabel(i)}</text>`).join("");
  return `<svg class="rcsvg buildup" viewBox="0 0 ${W} ${H}" role="img" style="--acc:${barColor(b)}">
    ${grid}${bars}<path class="bu-line" d="${line}"/>${cdots}${hits}${xt}</svg>`;
}
function dailyTable(bd){
  const rows=bd.days.map(d=>`<tr>
    <td class="l">${dayLabel(d.i)}</td>
    <td>${d.rank==null?'<span class="muted">200+</span>':'#'+d.rank}</td>
    <td>${d.add>=0.005?G(d.add):'<span class="muted">—</span>'}</td>
    <td>${G(d.cum)}</td></tr>`).join("");
  return `<div class="bm-tablewrap"><table class="bm-table">
    <thead><tr><th class="l">Date</th><th>iOS&nbsp;rank</th><th>+Est.</th><th>Cumulative</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// Sensor Tower detail for the banner modal: the assumption, every month the run
// touched (game-i share × real ST monthly total = assumed contribution), who else
// ran that month, and the summed total. Handles no-data / partial-run states.
function bannerSTBlock(b){
  if(b._synthetic) return "";
  const st=bannerST(b), bm=state.monthly||{};
  const head=`<h3>Sensor Tower — assumed combined revenue</h3>`;
  const how=`<p class="bm-note bm-recon">Sensor Tower publishes only <b>${esc(gameName())}</b>'s <b>monthly worldwide</b> total, not per-banner. We assume this banner took the same slice of that combined total as it did of game-i's JP revenue for the month, then add those slices across every month it ran.</p>`;
  if(!st.hasData){
    return head+how+`<p class="bm-note"><b>No Sensor Tower data yet.</b> This run is either before the reports began (Oct 2021) or entirely within months not yet published. A figure will appear here once a monthly report covers its run.</p>`;
  }
  const c=barColor(b);
  const rows=st.months.map(m=>{
    const ym=m.ym, lab=`${MONTHS[+ym.slice(5,7)-1]} ${ym.slice(0,4)}`;
    const co=((bm[ym]&&bm[ym].banners)||[]).filter(x=>x.i!==b._i && x.rev>0.001)
      .sort((a,d)=>d.rev-a.rev).map(x=>{ const ob=state.data.banners[x.i];
        return `<span class="bm-cochip" style="--av-ring:${barColor(ob)}"><span class="bm-coav">${avatarHTML(ob)}</span>${esc(x.name)}</span>`; });
    const coStr = co.length ? co.join("") : `<span class="muted">ran solo this month</span>`;
    const pct=Math.round(m.share*100);
    const barW=Math.max(2, m.share*100);
    if(m.contrib==null){
      return `<div class="bm-stm">
        <div class="bm-stm-top"><span class="mo">${lab}</span><span class="v muted" title="Sensor Tower hasn't published this month yet">not yet reported</span></div>
        <div class="bm-stm-math">Held <b>${pct}%</b> of game-i (${G(m.jp)} JP) — combined figure lands when the ${lab} report is out.</div>
        <div class="bm-stm-co"><span class="bm-co-l">Shared the month with</span> ${coStr}</div></div>`;
    }
    return `<div class="bm-stm">
      <div class="bm-stm-top"><span class="mo">${lab}</span><span class="v">≈${fmtUSD(m.contrib)}</span></div>
      <div class="bm-stm-mbar"><span class="bm-stm-mfill" style="width:${barW.toFixed(1)}%;background:${c}"></span></div>
      <div class="bm-stm-math"><b>${G(m.jp)}</b> JP = <b>${pct}%</b> of the month × <b>${fmtUSD(m.stMonth)}</b> combined ⟶ <b>≈${fmtUSD(m.contrib)}</b></div>
      <div class="bm-stm-co"><span class="bm-co-l">Shared the month with</span> ${coStr}</div></div>`;
  }).join("");
  const partial = st.partial
    ? `<p class="bm-note"><b>Partial run.</b> Sensor Tower covers <b>${st.covered}</b> of the <b>${st.covered+st.missing}</b> months this banner ran — the total below counts only the covered months and will grow as later reports land.</p>`
    : "";
  const span = `${per(b.start)} – ${per(b.end)}`;   // the banner's actual run, with day
  const summary=`<div class="bm-stats bm-stsum">
    <div class="bm-stat"><span class="l">Covered months</span><span class="v">${st.covered}${st.missing?` <span class="muted" style="font-size:12px">/ ${st.covered+st.missing}</span>`:""}</span></div>
    <div class="bm-stat"><span class="l">Run span</span><span class="v" style="font-size:12.5px">${span}</span></div>
    <div class="bm-stat sum"><span class="l">Assumed combined${st.partial?" (so far)":""}</span><span class="v">≈${fmtUSD(st.total)}</span></div></div>`;
  return head+how+partial+summary+`<div class="bm-stmlist">${rows}</div>`;
}
function gameName(){ const g=(state.games||[]).find(x=>x.game===state.tag); return g?g.name:state.tag; }
function openBanner(b){
  if(b._synthetic){
    const mo=`${MONTHS[+b.start.slice(5,7)-1]} ${b.year}`;
    $("#bmBody").innerHTML=`
      <div class="bm-head" style="--av-ring:var(--muted)">
        <span class="bm-art sq mono syn">≈</span>
        <div class="bm-htext"><h2 id="bmTitle">${esc(b.name)}</h2>
          <div class="bm-sub">${mo}</div></div></div>
      <div class="bm-stats">
        <div class="bm-stat"><span class="l">Unlisted revenue</span><span class="v">${G(b.rev)}</span></div>
        <div class="bm-stat"><span class="l">Month</span><span class="v" style="font-size:13px">${mo}</span></div></div>
      <p class="bm-note">This is <b>not a game-i banner</b>. game-i's monthly total for ${mo} is <b>${G(b.rev)}</b> higher than the banners it has listed — most likely a rate-up/event game-i hasn't logged yet (its banner list lags), or off-banner sales. We show it so the game's timeline and totals aren't left looking idle. The figure comes straight from game-i's monthly table (月次売上予測); there's no per-day rank detail because it isn't tied to a listed banner.</p>`;
    bannerModal.querySelector(".modal-card").scrollTop=0; tip.hidden=true; bannerModal.hidden=false; return;
  }
  if(b.pending){
    const en2=b.agents&&b.agents.length?b.agents.join(" & "):"";
    const scheduled=Math.round((Date.parse(b.end)-Date.parse(b.start))/864e5)+1;
    const icons=(b.icons||[]).slice(0,10).map(u=>`<img class="bm-pi" src="${esc(u)}" alt="" referrerpolicy="no-referrer" data-fb="remove">`).join("");
    const title=`<h2 id="bmTitle">${esc(bLabel(b))} <span class="bm-pendtag">pending</span></h2>
      ${en2&&en2!==bLabel(b)?`<div class="bm-sub">${esc(en2)}</div>`:""}
      <div class="bm-period">${per(b.start)} – ${per(b.end)}</div>`;
    const head=b.banner_img
      ? `<div class="bm-hero" style="--av-ring:${barColor(b)}"><img src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="art" data-alt="${esc((b.icons&&b.icons[0])||"")}"><div class="bm-herobar">${title}</div></div>`
      : `<div class="bm-head" style="--av-ring:${barColor(b)}">${(b.icons&&b.icons[0])?`<img class="bm-art sq" src="${esc(b.icons[0])}" alt="" referrerpolicy="no-referrer" data-fb="remove">`:""}<div class="bm-htext">${title}</div></div>`;
    $("#bmBody").innerHTML = head
      + `<div class="bm-stats"><div class="bm-stat"><span class="l">Run length</span><span class="v">${scheduled} days</span></div><div class="bm-stat"><span class="l">Source</span><span class="v" style="font-size:13px">JP game data</span></div></div>`
      + (icons?`<div class="bm-picons">${icons}</div>`:"")
      + `<p class="bm-note"><b>Not on game-i yet.</b> This is a real ${esc(gameName())} banner from the game's own <b>JP</b> data — game-i hasn't logged it, so there's <b>no daily revenue estimate</b> for it. It'll pick up its ¥ figure and rank curve automatically once game-i adds it. (A brand-new character may show its Japanese name until an official English one exists.)</p>`;
    bannerModal.querySelector(".modal-card").scrollTop=0; tip.hidden=true; bannerModal.hidden=false; return;
  }
  dayLabel.start=b.start+"T00:00:00";
  const en=b.agents&&b.agents.length?b.agents.join(" & "):(b.related||"");
  const rr=b.rerun?`<span class="rr">↻ rerun</span>`:"";
  const live=b.ongoing?`<span class="bm-live">● Running</span>`:"";
  const scheduled=Math.round((Date.parse(b.end)-Date.parse(b.start))/864e5)+1;
  const elapsed=b.rank_series?b.rank_series.length:Math.min(scheduled,Math.round((Date.now()-Date.parse(b.start))/864e5)+1);
  const stats=[
    [`Est. revenue${b.ongoing?" so far":""}`, G(b.rev)],
    ["All-time rank", `#${b.cum} / ${b.cumtot}`],
    [`${b.year} rank`, `#${b.yrank} / ${b.ytot}`],
    ["Run length", b.ongoing?`Day ${elapsed} of ${scheduled}`:`${scheduled} days`],
  ].map(([l,v])=>`<div class="bm-stat"><span class="l">${l}</span><span class="v">${v}</span></div>`).join("");

  // header: full-width hero art when we have banner art, else icon-left compact row
  const title=`<h2 id="bmTitle">${esc(bLabel(b))} ${rr}${live}</h2>
    ${en&&en!==bLabel(b)?`<div class="bm-sub">${esc(en)}</div>`:""}
    <div class="bm-period">${per(b.start)} – ${per(b.end)}</div>`;
  const head=b.banner_img
    ? `<div class="bm-hero" style="--av-ring:${barColor(b)}">
         <img src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="art" data-alt="${esc((b.icons&&b.icons[0])||"")}">
         <div class="bm-herobar">${title}</div></div>`
    : `<div class="bm-head" style="--av-ring:${barColor(b)}">
         ${b.icons&&b.icons[0]?`<img class="bm-art sq" src="${esc(b.icons[0])}" alt="" referrerpolicy="no-referrer" data-fb="remove">`:""}
         <div class="bm-htext">${title}</div></div>`;

  const s=b.rank_series||[]; const known=s.filter(v=>v!=null);
  let curve;
  if(known.length){
    const first=s.find(v=>v!=null), last=[...s].reverse().find(v=>v!=null), best=Math.min(...known);
    const cap=b.ongoing
      ? `Opened at <b>#${first}</b>, currently <b>#${last}</b> (peaked <b>#${best}</b>) — <b>still running</b>.`
      : `Opened at <b>#${first}</b>, peaked at <b>#${best}</b>, closed at <b>#${last}</b>.`;
    curve=`<h3>Daily iOS store rank during the run</h3>
      <div class="bm-cap">${cap}</div>
      ${rankCurveSVG(b)}
      <p class="bm-note">#1 is the top of Japan's App Store top-grossing chart. Breaks in the line are days the app sat below game-i's trackable ~top&nbsp;200 (counted as ¥0). Rank is snapshotted at midnight JST, so a launch day can read below-200 when the banner went live after the snapshot. iOS only — game-i keeps no daily Android history.</p>`;
  } else {
    curve=`<h3>Daily iOS store rank during the run</h3>
      <p class="bm-note">No daily rank data for this run — the app stayed below game-i's trackable ~top&nbsp;200 throughout (counted as ¥0), or the run predates game-i's rank history.</p>`;
  }

  const sh=b._share;
  let shareBlock="";
  if(sh&&sh.on){
    const names=sh.with.map(x=>`${esc(x.name)} <span class="muted">(${x.days}d)</span>`).join(", ");
    shareBlock=`<h3>Shared with concurrent banners</h3>
      <p class="bm-note">game-i splits each day's revenue equally among every banner running that day. This one overlapped <b>${sh.with.length}</b> other banner${sh.with.length>1?"s":""} on <b>${sh.days}</b> of its ${sh.totalDays} days — up to a <b>${sh.maxN}-way</b> split. The hatched part of its bar (and the hatched days below) mark that portion.</p>
      <div class="bm-stats bm-share3">
        <div class="bm-stat"><span class="l">On its own</span><span class="v">${G(sh.soloRev)}</span></div>
        <div class="bm-stat"><span class="l">While shared</span><span class="v">${G(sh.sharedRev)}</span></div>
        <div class="bm-stat sum"><span class="l">Total</span><span class="v">${G(b.rev)}</span></div>
      </div>
      <p class="bm-note bm-recon">Ran alongside: ${names}</p>`;
  }

  const bd=dailyBreakdown(b);
  // context for the shared hover tooltip on both charts (keyed by day index)
  _bmCtx={start:b.start, scheduled, days:(bd?bd.days:[]).map(x=>x)};
  let build="";
  if(bd){
    build=`<h3>Estimated revenue build-up${b.ongoing?" so far":""}</h3>
      <p class="bm-note bm-recon">game-i publishes only one total per banner. This splits that ${G(b.rev)} across the run by each day's rank (bars = that day's share, line = running total), using game-i's published rank→revenue curve. It's an illustration of how the total accumulated — not a separately reported daily figure.</p>
      ${buildupSVG(bd,b)}
      ${dailyTable(bd)}`;
  }

  $("#bmBody").innerHTML=head+`<div class="bm-stats">${stats}</div>${bannerSTBlock(b)}${curve}${shareBlock}${build}`;
  bannerModal.querySelector(".modal-card").scrollTop=0;
  tip.hidden=true;
  bannerModal.hidden=false;
}
$("#bmClose").onclick=()=>{ bannerModal.hidden=true; bmTip.hidden=true; };
bannerModal.onclick=e=>{ if(e.target===bannerModal){ bannerModal.hidden=true; bmTip.hidden=true; } };

// shared hover tooltip for both in-modal charts (rank curve + revenue build-up)
let _bmCtx=null;
const bmTip=$("#bmTip");
function showBmTip(dayIdx,e){
  const day=_bmCtx&&_bmCtx.days[dayIdx]; if(!day){ bmTip.hidden=true; return; }
  const d=new Date(_bmCtx.start+"T00:00:00"); d.setDate(d.getDate()+day.i);
  const dateStr=d.toLocaleDateString("en",{month:"short",day:"numeric",year:"numeric"});
  const rank = day.rank==null ? `<span style="color:var(--muted)">below top 200</span>` : `#${day.rank}`;
  const add  = day.rank==null ? "¥0" : (day.add>=0.005 ? "+"+G(day.add) : "≈¥0");
  bmTip.innerHTML=`<div class="body">
    <h4>${dateStr}</h4>
    <div style="color:var(--muted);font-size:11.5px">Day ${day.i+1} of ${_bmCtx.scheduled}</div>
    <dl><dt>iOS rank</dt><dd>${rank}</dd>
    <dt>Est. that day</dt><dd>${add}</dd>
    <dt>Cumulative</dt><dd><b>${G(day.cum)}</b></dd></dl></div>`;
  bmTip.hidden=false;
  const pad=14,w=bmTip.offsetWidth,h=bmTip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  bmTip.style.left=Math.max(6,x)+"px"; bmTip.style.top=Math.max(6,y)+"px";
}
$("#bmBody").addEventListener("pointermove",e=>{
  const el=e.target.closest("[data-day]"); if(!el){ bmTip.hidden=true; return; }
  showBmTip(+el.dataset.day,e);
});
$("#bmBody").addEventListener("pointerleave",()=>bmTip.hidden=true);

// ---- controls ----
const isPeriodMode = m => m==="year"||m==="month"||m==="version";
function updateDirLabel(){
  const byRev = state.mode==="rank" || (isPeriodMode(state.mode) && state.periodSort==="ranking");
  $("#bDir").textContent = byRev
    ? (state.reverse ? "Lowest first" : "Highest first")
    : (state.reverse ? "Oldest first" : "Newest first");
  const bs=$("#bSort"); if(bs) bs.value = state.periodSort;
}
function setMode(m){
  state.mode=m;
  [["bTime","time"],["bGraph","graph"],["bRank","rank"],["bYear","year"],["bMonth","month"],["bVersion","version"]].forEach(([id,mm])=>{
    const el=$("#"+id); el.classList.toggle("on",m===mm); el.setAttribute("aria-selected",m===mm);
  });
  updateControlVis();
  updateDirLabel();
  if(!state.table) render();
}
$("#bSort").onchange=function(){ state.periodSort = this.value; updateDirLabel(); if(!state.table) render(); };
$("#dataSrc").querySelectorAll("[data-src]").forEach(btn=>btn.onclick=()=>{
  state.dataSource=btn.dataset.src;
  $("#dataSrc").querySelectorAll("[data-src]").forEach(b=>b.classList.toggle("on",b===btn));
  renderStats();                       // header tiles follow the active data source too
  if(!state.table) render();
});
$("#bTime").onclick=()=>setMode("time");
$("#bRank").onclick=()=>setMode("rank");
$("#bGraph").onclick=()=>setMode("graph");
$("#bYear").onclick=()=>setMode("year");
$("#bMonth").onclick=()=>setMode("month");
$("#bVersion").onclick=()=>setMode("version");
$("#bDir").onclick=()=>{ state.reverse=!state.reverse; updateDirLabel(); if(!state.table) render(); };
$("#bTable").onclick=function(){state.table=!state.table;
  this.classList.toggle("on",state.table); this.textContent=state.table?"Chart view":"Table view";
  render();};   // render() -> updateControlVis() switches the rest of the row

// ---- character search + autocomplete (applies to every view) ----
const searchInput=$("#searchInput"), searchAC=$("#searchAC"), searchClear=$("#searchClear");
let _acItems=[], _acSel=-1;
// unique characters for this game (icon + display name + JP name), from real banners
function charIndex(){
  const seen=new Map();
  (state.data?state.data.banners:[]).forEach(b=>{ if(b._synthetic) return;
    const label=bnm(b), key=label.toLowerCase();
    const prev=seen.get(key);
    if(!prev) seen.set(key,{label, jp:b.name!==label?b.name:"", icon:(b.icons&&b.icons[0])||"", rev:b.rev, n:1});
    else { prev.rev+=b.rev; prev.n++; if(!prev.icon&&b.icons&&b.icons[0]) prev.icon=b.icons[0]; }
  });
  return [...seen.values()].sort((a,c)=>c.rev-a.rev);
}
function applySearch(v){
  state.search=v;
  searchClear.hidden=!v;
  if(!state.table) render(); else buildTable();
}
function renderAC(){
  const q=(searchInput.value||"").trim().toLowerCase();
  if(!q){ searchAC.hidden=true; searchAC.innerHTML=""; _acItems=[]; _acSel=-1; return; }
  _acItems=charIndex().filter(c=>c.label.toLowerCase().includes(q)||(c.jp&&c.jp.toLowerCase().includes(q))).slice(0,8);
  _acSel=-1;
  if(!_acItems.length){ searchAC.hidden=true; searchAC.innerHTML=""; return; }
  searchAC.innerHTML=_acItems.map((c,i)=>`<div class="search-ac-item" role="option" data-i="${i}">
    ${c.icon?`<img src="${esc(c.icon)}" alt="" referrerpolicy="no-referrer" data-fb="remove">`:`<span class="search-ac-ph"></span>`}
    <span class="search-ac-tx"><b>${esc(c.label)}</b>${c.jp?`<span class="search-ac-jp">${esc(c.jp)}</span>`:""}</span>
    <span class="search-ac-n">${c.n>1?c.n+" banners":G(c.rev)}</span></div>`).join("");
  searchAC.hidden=false;
}
function pickAC(i){ const c=_acItems[i]; if(!c) return; searchInput.value=c.label; applySearch(c.label); searchAC.hidden=true; searchInput.focus(); }
searchInput.addEventListener("input",()=>{ applySearch(searchInput.value); renderAC(); });
searchInput.addEventListener("focus",renderAC);
searchInput.addEventListener("keydown",e=>{
  if(e.key==="Escape"){ if(searchAC.hidden && searchInput.value){ searchInput.value=""; applySearch(""); } else { searchAC.hidden=true; } return; }
  if(searchAC.hidden||!_acItems.length) return;
  if(e.key==="ArrowDown"){ e.preventDefault(); _acSel=(_acSel+1)%_acItems.length; }
  else if(e.key==="ArrowUp"){ e.preventDefault(); _acSel=(_acSel-1+_acItems.length)%_acItems.length; }
  else if(e.key==="Enter"){ e.preventDefault(); pickAC(_acSel>=0?_acSel:0); return; }
  else return;
  searchAC.querySelectorAll(".search-ac-item").forEach((el,i)=>el.classList.toggle("sel",i===_acSel));
});
searchAC.addEventListener("mousedown",e=>{ const it=e.target.closest(".search-ac-item"); if(it){ e.preventDefault(); pickAC(+it.dataset.i); } });
searchInput.addEventListener("blur",()=>setTimeout(()=>{ searchAC.hidden=true; },120));
searchClear.onclick=()=>{ searchInput.value=""; applySearch(""); searchAC.hidden=true; searchInput.focus(); };
// "Clear search" link inside a no-results message
$("#chart").addEventListener("click",e=>{ if(e.target.id==="clearSearch2"){ searchInput.value=""; applySearch(""); } });
function resetSearch(){ if(searchInput){ searchInput.value=""; } state.search=""; if(searchClear) searchClear.hidden=true; if(searchAC){ searchAC.hidden=true; searchAC.innerHTML=""; } }

// ---- methodology modal ----
const infoModal=$("#infoModal");
function showInfoTab(which){
  $("#infoToggle").querySelectorAll("[data-info]").forEach(b=>b.classList.toggle("on",b.dataset.info===which));
  $("#infoGamei").hidden = which!=="gamei";
  $("#infoST").hidden    = which!=="st";
  const card=infoModal.querySelector(".modal-card"); if(card) card.scrollTop=0;
}
$("#infoToggle").querySelectorAll("[data-info]").forEach(btn=>btn.onclick=()=>showInfoTab(btn.dataset.info));
$("#infoBtn").onclick=()=>{ showInfoTab(state.dataSource==="st"?"st":"gamei"); infoModal.hidden=false; };
// click a worked-example source image to enlarge it in a lightbox
const lightbox=$("#lightbox"), lightboxImg=$("#lightboxImg");
$("#infoModal").addEventListener("click",e=>{ const im=e.target.closest(".info-ex-img");
  if(im){ lightboxImg.src=im.dataset.full||im.currentSrc||im.src; lightboxImg.alt=im.alt; lightbox.hidden=false; } });
lightbox.onclick=()=>{ lightbox.hidden=true; lightboxImg.src=""; };
$("#infoClose").onclick=()=>{ infoModal.hidden=true; };
infoModal.onclick=e=>{ if(e.target===infoModal) infoModal.hidden=true; };
addEventListener("keydown",e=>{ if(e.key==="Escape"){ if(!lightbox.hidden){ lightbox.hidden=true; lightboxImg.src=""; return; } infoModal.hidden=true; bannerModal.hidden=true; periodModal.hidden=true; } });

init().catch(e=>{$("#chart").innerHTML=`<div class="loading">Failed to load data: ${e}</div>`;});

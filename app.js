// Gacha Revenue Tracker — client logic. Data comes from data/*.json (built by scripts/).
const GAME_ACCENT = {          // per-game hue (used for bars/dots without a sampled color)
  zzz:"#e0a400", hsr:"#8a7bd8", wuwa:"#2fb6c0", genshin:"#d8a24a", endfield:"#e07b3a", nte:"#d94f8a",
  uma:"#3fb98f", fgo:"#c8a24a", bluearchive:"#4db6e8",
  arknights:"#e8b923",
};
const state = { games:[], tag:null, data:null, mode:"time", table:false, reverse:false, bracket:0, tabsExpanded:false, graphYear:"all", matchHigh:false };
// character accent wins (it's the true character/element colour); banner-dominant `bar`
// is the fallback for games with no accent (e.g. Endfield); then the per-game hue.
const barColor = b => b.accent || b.bar || GAME_ACCENT[state.tag];
const $ = s => document.querySelector(s);
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
  state.games = idx.games;
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
  [...state.data.banners].sort((a,b)=>b.rev-a.rev).forEach((b,i)=>b._rank=i+1);
  computeSharing();
  populateGraphYears();
  renderStats(); render();
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

function renderStats(){
  const b=state.data.banners, sum=b.reduce((a,x)=>a+x.rev,0), top=b.reduce((a,x)=>x.rev>a.rev?x:a);
  const topName = (top.agents&&top.agents.length) ? top.agents.join(" & ") : top.name;
  $("#tiles").innerHTML=[
    ["Total revenue", G(sum), `across ${b.length} banners`],
    ["Highest banner", G(top.rev), topName],
    ["Average / banner", G(sum/b.length), "mean estimate"],
    ["Blockbuster banners", `${b.filter(x=>x.rev>=10).length}`, "worth over ¥1B each"],
  ].map(([l,v,n])=>`<div class="tile"><span class="l">${l}</span><span class="v">${v}</span><span class="n">${esc(n)}</span></div>`).join("")
  + nowTile(state.data.now);
  $("#updated").textContent=`source: game-i.daa.jp · updated ${new Date(state.data.updated).toISOString().slice(0,10)}`;
}

function esc(s){return (s||"").replace(/[&<>"'`]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));}
function scaleMax(m){const nice=[5,10,15,20,25,30,40,50,75,100,150,200];return nice.find(n=>n>=m)||Math.ceil(m/50)*50;}
function ticks(max,step){
  if(!step) step = max<=1?0.2 : max<=2.5?0.5 : max<=6?1 : max<=12?2 : max<=25?5 : max<=50?10 : max<=100?25 : 50;
  const t=[]; for(let v=0;v<=max+1e-9;v+=step) t.push(+v.toFixed(2)); return t;
}
function niceCeil(oku){ return Math.max(1, Math.ceil(oku)); }   // round up to next 100M (1億)
// axis top for a peak: a chosen bracket rounds up to it (2.04B @¥200M -> 2.2B); else
// "match highest" fits tightly (next 100M), otherwise a roomy round number.
function roundTop(peak, tight){
  if(state.bracket) return Math.ceil(peak/state.bracket - 1e-9)*state.bracket;
  return tight ? niceCeil(peak) : scaleMax(peak);
}
function poolBanners(){ const b=state.data.banners; return state.graphYear==="all" ? b : b.filter(x=>String(x.year)===state.graphYear); }

// ---- avatars ----
// No inline onerror handlers: image fallbacks are handled by one delegated
// listener (below), so a strict CSP with no 'unsafe-inline' script can apply and
// scraped names never land in an executable context. src/name are escaped too.
function avatarHTML(b){
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
}, true);

// ---- concurrent-banner "shared revenue" detection ----
// game-i splits each day's revenue equally among every banner running that day
// (see the methodology dialog). For each banner we find which days overlapped
// another banner and what share of its reconstructed revenue that represents, so
// the chart can flag the split. HoYo games merge simultaneous characters into one
// "A&B" entry, so this mostly lights up on event games (FGO, Arknights, …) where
// separate banners genuinely run at once. Computed once per game load.
const SHARE_MIN_DAYS = 3;                         // ignore trivial 1-day changeovers
function computeSharing(){
  const all=state.data.banners, DAY=864e5;
  const spans=all.map(b=>({s:Date.parse(b.start), e:Date.parse(b.end), b}));
  for(const {s,e,b} of spans){
    const totalDays=Math.round((e-s)/DAY)+1, series=b.rank_series;
    let sharedDays=0, maxN=1, rawTot=0, rawShared=0; const withMap=new Map();
    for(let i=0,t=s; t<=e; t+=DAY,i++){
      const others=spans.filter(sp=>sp.b!==b && sp.s<=t && t<=sp.e).map(sp=>sp.b);
      const raw = series ? rankValue(series[i]) : 1;   // weight by that day's reconstructed value
      rawTot += raw;
      if(others.length){ sharedDays++; rawShared+=raw; maxN=Math.max(maxN,others.length+1);
        others.forEach(o=>withMap.set(o,(withMap.get(o)||0)+1)); }
    }
    b._share = { days:sharedDays, totalDays, maxN, revFrac: rawTot? rawShared/rawTot : 0,
      on: sharedDays>=SHARE_MIN_DAYS,
      with:[...withMap.entries()].sort((a,c)=>c[1]-a[1])
              .map(([o,d])=>({name:(o.agents&&o.agents.length?o.agents.join(" & "):o.name), days:d})) };
  }
}

// ---- bar rows (timeline / ranking) with FLIP reordering ----
function rowHTML(b,rank,max){
  const c=barColor(b), [bl,bd]=barShades(c);
  const w=Math.max(1.2,(b.rev/max)*100), m=rank<=3?` m${rank}`:"";
  const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
  const rr=b.rerun?`<span class="rr" title="Rerun banner">↻ rerun</span>`:"";
  const sh=b._share;
  // hatched right-hand segment = the share of revenue split with a concurrent
  // banner (detail lives in the hover tooltip + click-to-open modal, not a badge)
  const shSeg = sh&&sh.on
    ? `<span class="shared" style="width:${Math.min(100,Math.round(sh.revFrac*100))}%" title="~${Math.round(sh.revFrac*100)}% split with a concurrent banner"></span>` : "";
  return `<div class="row" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
    <div class="rk${m}">${rank}</div>
    <div class="av">${avatarHTML(b)}</div>
    <div class="meta">
      <div class="nm"><b>${esc(b.name)}</b>${en?`<span class="en">${esc(en)}</span>`:""}${rr}</div>
      <div class="barline"><div class="track"><div class="barfill" style="width:${w}%">${shSeg}</div></div>
        <span class="val">${G(b.rev)}</span></div>
    </div></div>`;
}
function axesHTML(max){return ticks(max,state.bracket).map(t=>
  `<div class="axis" style="left:calc(87px + (100% - 87px - 74px) * ${t/max})"><span>${G(t)}</span></div>`).join("");}

function renderBars(){
  const all=state.data.banners; all.forEach((x,i)=>x._i=i);
  const pool=poolBanners();                                   // Year filter applies here too
  [...pool].sort((a,c)=>c.rev-a.rev).forEach((x,i)=>x._rank=i+1);   // rank within the shown set
  // one axis (timeline gridlines are full-height, so they can't vary per year): match-highest
  // fits the axis tightly to the shown set's peak; otherwise leaves roomy headroom.
  const max = roundTop(Math.max(...pool.map(x=>x.rev)), state.matchHigh);
  // FLIP: capture current row positions before we replace the DOM
  const old={};
  document.querySelectorAll("#chart .row").forEach(r=>{ old[r.dataset.i]=r.getBoundingClientRect().top; });
  let list=[...pool], html="";
  if(state.mode==="rank"){ list.sort((x,y)=> state.reverse ? x.rev-y.rev : y.rev-x.rev); html+=axesHTML(max);
    list.forEach(x=>html+=rowHTML(x,x._rank,max)); }
  else { list.sort((x,y)=>y.start.localeCompare(x.start)); if(state.reverse) list.reverse(); let cy=null;  // newest first by default
    list.forEach(x=>{ if(x.year!==cy){cy=x.year; html+=`<div class="yhead">${cy}</div>`+axesHTML(max);}
      html+=rowHTML(x,x._rank,max); }); }
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

// ---- graph view (one line chart per year) ----
function yearSVG(year, items, gmax, step){
  const W=720,H=300,ML=52,MR=14,MT=14,MB=24, pW=W-ML-MR, pH=H-MT-MB, base=MT+pH;
  const y0=Date.parse(year+"-01-01"), y1=Date.parse((+year+1)+"-01-01");
  const xOf=d=>ML+((Date.parse(d)-y0)/(y1-y0))*pW;
  const yOf=v=>MT+(1-v/gmax)*pH;
  const pts=[...items].sort((a,b)=>a.start.localeCompare(b.start)).map(b=>({x:xOf(b.start),y:yOf(b.rev),b}));
  const grid=ticks(gmax,step).map(t=>{const y=yOf(t);
    return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/>`+
           `<text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">${G(t)}</text>`;}).join("");
  const xt=[0,2,4,6,8,10,12].map(m=>{const x=ML+(m/12)*pW;
    return `<text class="axislbl" x="${x.toFixed(1)}" y="${H-8}" text-anchor="middle">${MONTHS[m]||""}</text>`;}).join("");
  const line=pts.map((p,i)=>(i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ");
  const area=`M${pts[0].x.toFixed(1)} ${base} `+pts.map(p=>"L"+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ")+` L${pts[pts.length-1].x.toFixed(1)} ${base} Z`;
  const R=11;
  const marks=pts.map(p=>{
    const acc=barColor(p.b);
    const url=(p.b.icons&&p.b.icons[0])||p.b.banner_img;
    const cx=p.x.toFixed(1), cy=p.y.toFixed(1);
    if(url){
      const id=`clip_${year}_${p.b._i}`;
      return `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>`+
        `<image href="${esc(url)}" x="${(p.x-R).toFixed(1)}" y="${(p.y-R).toFixed(1)}" width="${2*R}" height="${2*R}" `+
        `preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" data-i="${p.b._i}"/>`+
        `<circle class="gring" cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${acc}" data-i="${p.b._i}"/>`;
    }
    return `<circle class="dot" data-i="${p.b._i}" cx="${cx}" cy="${cy}" r="5" fill="${acc}"/>`;
  }).join("");
  return `<svg class="gsvg" viewBox="0 0 ${W} ${H}" role="img">
    ${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${marks}${xt}</svg>`;
}
function renderGraph(){
  state.data.banners.forEach((x,i)=>x._i=i);
  const pool=poolBanners();
  const sharedMax=roundTop(Math.max(...pool.map(x=>x.rev)), false);
  const byYear={}; pool.forEach(x=>{(byYear[x.year]=byYear[x.year]||[]).push(x);});
  let years=Object.keys(byYear).sort();
  if(!state.reverse) years.reverse();          // newest year first by default
  $("#chart").innerHTML=years.map(y=>{
    const items=byYear[y];
    const gmax=state.matchHigh ? roundTop(Math.max(...items.map(x=>x.rev)), true) : sharedMax;
    return `<div class="gyear"><div class="yhead">${y}</div>${yearSVG(y,items,gmax,state.bracket||0)}</div>`;
  }).join("");
}
function populateGraphYears(){
  const years=[...new Set(state.data.banners.map(b=>b.year))].sort();
  if(state.graphYear!=="all" && !years.includes(+state.graphYear)) state.graphYear="all";
  $("#gyears").innerHTML=`<button data-y="all"${state.graphYear==="all"?' class="on"':''}>All</button>`+
    years.map(y=>`<button data-y="${y}"${state.graphYear==String(y)?' class="on"':''}>${y}</button>`).join("");
  $("#gyears").querySelectorAll("button").forEach(btn=>btn.onclick=()=>{
    state.graphYear=btn.dataset.y;
    $("#gyears").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===btn));
    if(!state.table) render();
  });
}

function render(){
  document.body.dataset.view = state.table ? "table" : state.mode;   // lets CSS tailor per view (e.g. mobile graph)
  $("#chartwrap").hidden=state.table; $("#tablewrap").hidden=!state.table;
  $("#graphControls").hidden=state.table || state.mode==="year";     // year/match/round don't apply to the yearly view
  if(state.table){ buildTable(); return; }
  if(state.mode==="graph"){ renderGraph(); return; }
  if(state.mode==="year"){ renderYearly(); return; }
  renderBars();
}

// ---- by-year breakdown: revenue per calendar year, its share of the game's
// tracked total, and the change vs the previous year ----
function renderYearly(){
  const all=state.data.banners;
  const total=all.reduce((a,b)=>a+b.rev,0);
  const byYear={}, cnt={};
  all.forEach(b=>{ byYear[b.year]=(byYear[b.year]||0)+b.rev; cnt[b.year]=(cnt[b.year]||0)+1; });
  const years=Object.keys(byYear).map(Number).sort((a,b)=>a-b);
  const max=Math.max(...years.map(y=>byYear[y]));
  const nowYear=new Date(state.data.updated).getUTCFullYear();
  const order=[...years].sort((a,b)=>b-a);
  if(state.reverse) order.reverse();
  const head=`<div class="yr-head"><b>${esc(state.data.name)}</b> — ${G(total)} total across ${years.length} year${years.length>1?"s":""}</div>`
    + `<div class="yr-note">Coverage generally starts around 2024, and the current year is still in progress — treat the first and latest years as partial.</div>`;
  const rows=order.map(y=>{
    const rev=byYear[y], prev=byYear[y-1];
    const yoy = prev!=null ? (rev-prev)/prev*100 : null;
    const pct = total ? rev/total*100 : 0;
    const w=Math.max(1.5, rev/max*100);
    const yoyHTML = yoy==null ? `<span class="yr-yoy flat">first tracked year</span>`
      : `<span class="yr-yoy ${yoy>=0?"up":"down"}">${yoy>=0?"▲":"▼"} ${Math.abs(yoy).toFixed(0)}% vs ${y-1}</span>`;
    return `<div class="yr-row">
      <div class="yr-y">${y}${y===nowYear?`<span class="yr-prog">in progress</span>`:""}</div>
      <div class="yr-body">
        <div class="yr-line"><span class="yr-v">${G(rev)}</span>
          <span class="yr-pct">${pct.toFixed(1)}% of total · ${cnt[y]} banner${cnt[y]>1?"s":""}</span>
          ${yoyHTML}</div>
        <div class="yr-track"><div class="yr-fill" style="width:${w}%"></div></div>
      </div></div>`;
  }).join("");
  $("#chart").innerHTML=head+rows;
}
function buildTable(){
  state.data.banners.forEach((x,i)=>x._i=i);
  const rows=[...state.data.banners].sort((a,b)=>b.rev-a.rev).map(b=>`<tr data-i="${b._i}"${b.rank_series&&b.rank_series.length?' class="clk"':''}>
    <td>#${b.cum}</td><td class="l">${esc(b.name)}</td>
    <td class="l" style="color:var(--muted)">${esc((b.agents||[]).join(", "))}</td>
    <td>${G(b.rev)}</td>
    <td class="l" style="color:var(--muted)">${per(b.start)} – ${per(b.end)}</td>
    <td class="l">${b.year} · #${b.yrank}/${b.ytot}</td></tr>`).join("");
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
function showTip(b,e){
  const en=b.agents&&b.agents.length?b.agents.join(" & "):(b.related||"");
  const art=b.banner_img?`<img class="art" src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="remove">`:"";
  const rr=b.rerun?` <span class="rr">↻ rerun</span>`:"";
  const hint=(b.rank_series&&b.rank_series.length)
    ? `<div class="tiphint">▸ Click to see daily rankings during the run</div>` : "";
  const sh=b._share;
  const shRow = sh&&sh.on
    ? `<dt>Shared run</dt><dd>${sh.days}d, ${sh.maxN}-way</dd>` : "";
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
$("#chart").addEventListener("click",e=>{
  const el=e.target.closest("[data-i]"); if(!el) return;
  openBanner(state.data.banners[+el.dataset.i]);
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
    const shared=all.some(o=>o!==b && Date.parse(o.start)<=t && t<=Date.parse(o.end));
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

function openBanner(b){
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
  const title=`<h2 id="bmTitle">${esc(b.name)} ${rr}${live}</h2>
    ${en?`<div class="bm-sub">${esc(en)}</div>`:""}
    <div class="bm-period">${per(b.start)} – ${per(b.end)}</div>`;
  const head=b.banner_img
    ? `<div class="bm-hero" style="--av-ring:${barColor(b)}">
         <img src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="remove">
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
      <p class="bm-note">game-i splits each day's revenue equally among every banner running that day. This one overlapped <b>${sh.with.length}</b> other banner${sh.with.length>1?"s":""} on <b>${sh.days}</b> of its ${sh.totalDays} days — up to a <b>${sh.maxN}-way</b> split — worth about <b>${Math.round(sh.revFrac*100)}%</b> of its estimated revenue. The hatched part of its bar and the hatched days below mark that shared portion.</p>
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

  $("#bmBody").innerHTML=head+`<div class="bm-stats">${stats}</div>${curve}${shareBlock}${build}`;
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
function updateDirLabel(){
  $("#bDir").textContent = state.mode==="rank"
    ? (state.reverse ? "Lowest first" : "Highest first")
    : (state.reverse ? "Oldest first" : "Newest first");
}
function setMode(m){
  state.mode=m;
  [["bTime","time"],["bGraph","graph"],["bRank","rank"],["bYear","year"]].forEach(([id,mm])=>{
    const el=$("#"+id); el.classList.toggle("on",m===mm); el.setAttribute("aria-selected",m===mm);
  });
  $("#graphControls").hidden = state.table || m==="year";   // Year / Match highest / Round-to apply to the chart views
  updateDirLabel();
  if(!state.table) render();
}
$("#bTime").onclick=()=>setMode("time");
$("#bRank").onclick=()=>setMode("rank");
$("#bGraph").onclick=()=>setMode("graph");
$("#bYear").onclick=()=>setMode("year");
$("#bDir").onclick=()=>{ state.reverse=!state.reverse; updateDirLabel(); if(!state.table) render(); };
$("#brk").onchange=function(){ state.bracket=+this.value; if(!state.table) render(); };
$("#matchHigh").onchange=function(){ state.matchHigh=this.checked; if(!state.table) render(); };
$("#bTable").onclick=function(){state.table=!state.table;
  this.classList.toggle("on",state.table); this.textContent=state.table?"Chart view":"Table view";
  $("#graphControls").hidden=state.table;
  render();};

// ---- methodology modal ----
const infoModal=$("#infoModal");
$("#infoBtn").onclick=()=>{ infoModal.hidden=false; };
$("#infoClose").onclick=()=>{ infoModal.hidden=true; };
infoModal.onclick=e=>{ if(e.target===infoModal) infoModal.hidden=true; };
addEventListener("keydown",e=>{ if(e.key==="Escape"){ infoModal.hidden=true; bannerModal.hidden=true; } });

init().catch(e=>{$("#chart").innerHTML=`<div class="loading">Failed to load data: ${e}</div>`;});

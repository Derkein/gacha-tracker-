// Gacha Revenue Tracker — client logic. Data comes from data/*.json (built by scripts/).
const GAME_ACCENT = {          // per-game hue (used for bars/dots without a sampled color)
  zzz:"#e0a400", hsr:"#8a7bd8", wuwa:"#2fb6c0", genshin:"#d8a24a", endfield:"#e07b3a", nte:"#d94f8a",
  uma:"#3fb98f", fgo:"#c8a24a", bluearchive:"#4db6e8", gbf:"#4a7fd0",
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
async function init(){
  const idx = await (await fetch("data/index.json")).json();
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
async function selectGame(tag){
  state.tag=tag; location.hash=tag;
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.dataset.tag===tag));
  document.documentElement.style.setProperty("--accent", GAME_ACCENT[tag]||"#e0a400");
  $("#chart").innerHTML=`<div class="loading">Loading ${tag.toUpperCase()}…</div>`;
  state.data = await (await fetch(`data/${tag}.json`)).json();
  // rank by revenue *within our dataset* — game-i's cum is against the game's full
  // history (often far larger than what we scrape), so it isn't 1..N here.
  [...state.data.banners].sort((a,b)=>b.rev-a.rev).forEach((b,i)=>b._rank=i+1);
  populateGraphYears();
  renderStats(); render();
}

function renderStats(){
  const b=state.data.banners, sum=b.reduce((a,x)=>a+x.rev,0), top=b.reduce((a,x)=>x.rev>a.rev?x:a);
  const topName = (top.agents&&top.agents.length) ? top.agents.join(" & ") : top.name;
  $("#tiles").innerHTML=[
    ["Total revenue", G(sum), `across ${b.length} banners`],
    ["Highest banner", G(top.rev), topName],
    ["Average / banner", G(sum/b.length), "mean estimate"],
    ["Blockbuster banners", `${b.filter(x=>x.rev>=10).length}`, "worth over ¥1B each"],
  ].map(([l,v,n])=>`<div class="tile"><span class="l">${l}</span><span class="v">${v}</span><span class="n">${esc(n)}</span></div>`).join("");
  $("#updated").textContent=`source: game-i.daa.jp · updated ${new Date(state.data.updated).toISOString().slice(0,10)}`;
}

function esc(s){return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
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
function avatarHTML(b){
  if(b.icons&&b.icons.length){
    let h=`<img src="${b.icons[0]}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(mono('${esc(b.name)}'))">`;
    if(b.icons[1]) h+=`<img class="extra" src="${b.icons[1]}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
    if(b.icons[2]) h+=`<img class="extra e2" src="${b.icons[2]}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
    return h;
  }
  if(b.banner_img) return `<img class="artav" src="${b.banner_img}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(mono('${esc(b.name)}'))">`;
  return monoStr(b.name);
}
function monoStr(name){return `<span class="mono">${esc((name||"?").trim()[0]||"?")}</span>`;}
window.mono=function(name){const d=document.createElement("span");d.className="mono";d.textContent=(name||"?").trim()[0]||"?";return d;};

// ---- bar rows (timeline / ranking) with FLIP reordering ----
function rowHTML(b,rank,max){
  const c=barColor(b), [bl,bd]=barShades(c);
  const w=Math.max(1.2,(b.rev/max)*100), m=rank<=3?` m${rank}`:"";
  const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
  const rr=b.rerun?`<span class="rr" title="Rerun banner">↻ rerun</span>`:"";
  return `<div class="row" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
    <div class="rk${m}">${rank}</div>
    <div class="av">${avatarHTML(b)}</div>
    <div class="meta">
      <div class="nm"><b>${esc(b.name)}</b>${en?`<span class="en">${esc(en)}</span>`:""}${rr}</div>
      <div class="barline"><div class="track"><div class="barfill" style="width:${w}%"></div></div>
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
  else { list.sort((x,y)=>x.start.localeCompare(y.start)); if(state.reverse) list.reverse(); let cy=null;
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
        `<image href="${url}" x="${(p.x-R).toFixed(1)}" y="${(p.y-R).toFixed(1)}" width="${2*R}" height="${2*R}" `+
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
  if(state.reverse) years.reverse();
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
  $("#chartwrap").hidden=state.table; $("#tablewrap").hidden=!state.table;
  $("#graphControls").hidden=state.table;
  if(state.table){ buildTable(); return; }
  if(state.mode==="graph"){ renderGraph(); return; }
  renderBars();
}
function buildTable(){
  const rows=[...state.data.banners].sort((a,b)=>b.rev-a.rev).map(b=>`<tr>
    <td>#${b.cum}</td><td class="l">${esc(b.name)}</td>
    <td class="l" style="color:var(--muted)">${esc((b.agents||[]).join(", "))}</td>
    <td>${G(b.rev)}</td>
    <td class="l" style="color:var(--muted)">${per(b.start)} – ${per(b.end)}</td>
    <td class="l">${b.year} · #${b.yrank}/${b.ytot}</td></tr>`).join("");
  $("#tablewrap").innerHTML=`<table><thead><tr><th>Rank</th><th class="l">Banner</th>
    <th class="l">Agent(s)</th><th>Revenue</th><th class="l">Period</th><th class="l">Yr rank</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// ---- tooltip (works over bar rows AND graph dots — both carry data-i) ----
const tip=$("#tip");
function showTip(b,e){
  const en=b.agents&&b.agents.length?b.agents.join(" & "):(b.related||"");
  const art=b.banner_img?`<img class="art" src="${b.banner_img}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`:"";
  const rr=b.rerun?` <span class="rr">↻ rerun</span>`:"";
  tip.innerHTML=`${art}<div class="body">
    <h4><span class="dot" style="background:${barColor(b)}"></span>${esc(b.name)}${rr}</h4>
    <div style="color:var(--muted);font-size:11.5px">${esc(en)}</div>
    <dl><dt>Period</dt><dd>${per(b.start)} – ${per(b.end)}</dd>
    <dt>Est. revenue</dt><dd><b>${G(b.rev)}</b></dd>
    <dt>All-time rank</dt><dd>#${b.cum} / ${b.cumtot}</dd>
    <dt>${b.year} rank</dt><dd>#${b.yrank} / ${b.ytot}</dd></dl></div>`;
  tip.hidden=false;
  const pad=15,w=tip.offsetWidth,h=tip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  tip.style.left=x+"px"; tip.style.top=Math.max(6,y)+"px";
}
$("#chart").addEventListener("pointermove",e=>{
  const el=e.target.closest("[data-i]"); if(!el){tip.hidden=true;return;}
  showTip(state.data.banners[+el.dataset.i],e);
});
$("#chart").addEventListener("pointerleave",()=>tip.hidden=true);

// ---- controls ----
function updateDirLabel(){
  $("#bDir").textContent = state.mode==="rank"
    ? (state.reverse ? "Lowest first" : "Highest first")
    : (state.reverse ? "Newest first" : "Oldest first");
}
function setMode(m){
  state.mode=m;
  [["bTime","time"],["bGraph","graph"],["bRank","rank"]].forEach(([id,mm])=>{
    const el=$("#"+id); el.classList.toggle("on",m===mm); el.setAttribute("aria-selected",m===mm);
  });
  $("#graphControls").hidden = state.table;      // Year / Match highest / Round-to apply to all chart views
  updateDirLabel();
  if(!state.table) render();
}
$("#bTime").onclick=()=>setMode("time");
$("#bRank").onclick=()=>setMode("rank");
$("#bGraph").onclick=()=>setMode("graph");
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
addEventListener("keydown",e=>{ if(e.key==="Escape") infoModal.hidden=true; });

init().catch(e=>{$("#chart").innerHTML=`<div class="loading">Failed to load data: ${e}</div>`;});

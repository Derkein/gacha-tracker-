// Gacha Revenue Tracker — client logic. Data comes from data/*.json (built by scripts/).
const GAME_ACCENT = {          // fallback hue when a banner has no character icon
  zzz:"#e0a400", hsr:"#8a7bd8", wuwa:"#2fb6c0", genshin:"#d8a24a", endfield:"#e07b3a", nte:"#d94f8a",
};
const state = { games:[], tag:null, data:null, mode:"time", table:false };
const $ = s => document.querySelector(s);
const fmtDate = new Intl.DateTimeFormat("en",{year:"numeric",month:"short",day:"numeric"});
const per = s => fmtDate.format(new Date(s+"T00:00:00"));

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
    b.innerHTML=`<span class="g">${g.name}</span><span class="t">${g.count} banners · ${g.total_oku} 億G</span>`;
    b.onclick=()=>selectGame(g.game); tabs.appendChild(b);
  });
  const start = (location.hash||"").replace("#","");
  selectGame(state.games.some(g=>g.game===start)?start:state.games[0].game);
}
async function selectGame(tag){
  state.tag=tag; location.hash=tag;
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.dataset.tag===tag));
  const acc = GAME_ACCENT[tag]||"#e0a400";
  document.documentElement.style.setProperty("--accent",acc);
  $("#chart").innerHTML=`<div class="loading">Loading ${tag.toUpperCase()}…</div>`;
  state.data = await (await fetch(`data/${tag}.json`)).json();
  renderStats(); render();
}

function renderStats(){
  const b=state.data.banners, sum=b.reduce((a,x)=>a+x.rev,0), top=b.reduce((a,x)=>x.rev>a.rev?x:a);
  const up=new Date(state.data.updated);
  $("#tiles").innerHTML=[
    ["Total revenue",`${sum.toFixed(1)} 億G`,`across ${b.length} banners`],
    ["Highest banner",`${top.rev.toFixed(2)} 億G`,`${top.name}`],
    ["Average / banner",`${(sum/b.length).toFixed(2)} 億G`,"mean estimate"],
    ["Banners over 10億",`${b.filter(x=>x.rev>=10).length}`,"blockbuster tier"],
  ].map(([l,v,n])=>`<div class="tile"><span class="l">${l}</span><span class="v">${v}</span><span class="n">${esc(n)}</span></div>`).join("");
  $("#updated").textContent=`source: game-i.daa.jp · updated ${up.toISOString().slice(0,10)}`;
}

function esc(s){return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function scaleMax(m){const nice=[5,10,15,20,25,30,40,50,75,100,150,200];return nice.find(n=>n>=m)||Math.ceil(m/50)*50;}
function ticks(max){const step=max<=25?5:max<=50?10:max<=100?25:50;const t=[];for(let v=0;v<=max;v+=step)t.push(v);return t;}

function avatarHTML(b){
  const ring = b.accent||GAME_ACCENT[state.tag];
  if(b.icons&&b.icons.length){
    let h=`<img src="${b.icons[0]}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(mono('${esc(b.name)}'))">`;
    if(b.icons[1]) h+=`<img class="extra" src="${b.icons[1]}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
    if(b.icons[2]) h+=`<img class="extra e2" src="${b.icons[2]}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
    return h;
  }
  if(b.banner_img) return `<img class="artav" src="${b.banner_img}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(mono('${esc(b.name)}'))">`;
  return monoStr(b.name);
}
function monoStr(name){const ch=(name||"?").trim()[0]||"?";return `<span class="mono">${esc(ch)}</span>`;}
window.mono=function(name){const d=document.createElement("span");d.className="mono";d.textContent=(name||"?").trim()[0]||"?";return d;};

function rowHTML(b,rank,max){
  const [bl,bd]=barShades(b.accent||GAME_ACCENT[state.tag]);
  const w=Math.max(1.2,(b.rev/max)*100), m=rank<=3?` m${rank}`:"";
  const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
  return `<div class="row" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${b.accent||GAME_ACCENT[state.tag]}">
    <div class="rk${m}">${rank}</div>
    <div class="av">${avatarHTML(b)}</div>
    <div class="meta">
      <div class="nm"><b>${esc(b.name)}</b>${en?`<span class="en">${esc(en)}</span>`:""}</div>
      <div class="barline"><div class="track"><div class="barfill" style="width:${w}%"></div></div>
        <span class="val">${b.rev.toFixed(2)}<small> 億G</small></span></div>
    </div></div>`;
}
function axesHTML(max){return ticks(max).map(t=>
  `<div class="axis" style="left:calc(87px + (100% - 87px - 74px) * ${t/max})"><span>${t}</span></div>`).join("");}

function render(){
  const b=state.data.banners; b.forEach((x,i)=>x._i=i);
  const max=scaleMax(Math.max(...b.map(x=>x.rev)));
  $("#chartwrap").hidden=state.table; $("#tablewrap").hidden=!state.table;
  if(state.table){ buildTable(); return; }
  let list=[...b], html="";
  if(state.mode==="rank"){ list.sort((x,y)=>y.rev-x.rev); html+=axesHTML(max);
    list.forEach(x=>html+=rowHTML(x,x.cum,max)); }
  else { list.sort((x,y)=>x.start.localeCompare(y.start)); let cy=null;
    list.forEach(x=>{ if(x.year!==cy){cy=x.year; html+=`<div class="yhead">${cy}</div>`+axesHTML(max);}
      html+=rowHTML(x,x.cum,max); }); }
  $("#chart").innerHTML=html;
}
function buildTable(){
  const rows=[...state.data.banners].sort((a,b)=>b.rev-a.rev).map(b=>`<tr>
    <td>#${b.cum}</td><td class="l">${esc(b.name)}</td>
    <td class="l" style="color:var(--muted)">${esc((b.agents||[]).join(", "))}</td>
    <td>${b.rev.toFixed(2)}</td>
    <td class="l" style="color:var(--muted)">${per(b.start)} – ${per(b.end)}</td>
    <td class="l">${b.year} · #${b.yrank}/${b.ytot}</td></tr>`).join("");
  $("#tablewrap").innerHTML=`<table><thead><tr><th>Rank</th><th class="l">Banner</th>
    <th class="l">Agent(s)</th><th>億G</th><th class="l">Period</th><th class="l">Yr rank</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// ---- tooltip ----
const tip=$("#tip");
function showTip(b,e){
  const en=b.agents&&b.agents.length?b.agents.join(" & "):(b.related||"");
  const art=b.banner_img?`<img class="art" src="${b.banner_img}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`:"";
  tip.innerHTML=`${art}<div class="body">
    <h4><span class="dot" style="background:${b.accent||GAME_ACCENT[state.tag]}"></span>${esc(b.name)}</h4>
    <div style="color:var(--muted);font-size:11.5px">${esc(en)}</div>
    <dl><dt>Period</dt><dd>${per(b.start)} – ${per(b.end)}</dd>
    <dt>Est. revenue</dt><dd><b>${b.rev.toFixed(2)} 億G</b></dd>
    <dt>All-time rank</dt><dd>#${b.cum} / ${b.cumtot}</dd>
    <dt>${b.year} rank</dt><dd>#${b.yrank} / ${b.ytot}</dd></dl></div>`;
  tip.hidden=false;
  const pad=15,w=tip.offsetWidth,h=tip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  tip.style.left=x+"px"; tip.style.top=Math.max(6,y)+"px";
}
$("#chart").addEventListener("pointermove",e=>{
  const row=e.target.closest(".row"); if(!row){tip.hidden=true;return;}
  showTip(state.data.banners[+row.dataset.i],e);
});
$("#chart").addEventListener("pointerleave",()=>tip.hidden=true);

// ---- controls ----
$("#bTime").onclick=()=>setMode("time");
$("#bRank").onclick=()=>setMode("rank");
function setMode(m){state.mode=m;
  $("#bTime").classList.toggle("on",m==="time"); $("#bRank").classList.toggle("on",m==="rank");
  if(!state.table) render();}
$("#bTable").onclick=function(){state.table=!state.table;
  this.classList.toggle("on",state.table); this.textContent=state.table?"Chart view":"Table view";
  render();};

init().catch(e=>{$("#chart").innerHTML=`<div class="loading">Failed to load data: ${e}</div>`;});

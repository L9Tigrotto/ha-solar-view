/* The stylesheet of the solar panel, as one string for its shadow root. Loaded by solar-view.js. */

/* A weather app: the sky is the page, a full-bleed gradient that follows the sun. One screen per
   page, swiped sideways or picked from the tab bar; a wide panel shows them side by side.
   One ink colour per theme, so contrast holds on every sky.
   Sizes follow the panel (container queries), not the window: the sidebar may be open. */
export const CSS = `
:host{
  display:flex;flex-direction:column;position:relative;height:100dvh;overflow:hidden;container-type:size;
  color-scheme:light;
  --ink:#0e2236; --ink-2:#27405a; --paper:#ffffff;
  --card:rgba(255,255,255,.5); --card-line:rgba(255,255,255,.8);
  --track:rgba(14,34,54,.13);
  /* Accents are Catppuccin: Latte here, Mocha when dark. Yellow, green, red, mauve, blue. */
  --sun:#df8e1d; --batt:#40a02b; --low:#d20f39; --grid:#8839ef; --home:#1e66f5;
  --sun-past:color-mix(in srgb,var(--sun) 45%,transparent); /* last month's sun: same colour, faded */
  --f:ui-rounded,"SF Pro Rounded","Segoe UI Variable Text","Segoe UI",system-ui,Roboto,"Helvetica Neue",Arial,sans-serif;
  --ease:cubic-bezier(.22,1,.36,1);
  /* Scales. Type: small numbers, secondary lines, lead lines (body is the 16px below).
     Radii: small (focus, skeleton bars), medium (hint, tile), pill (bars, tabs). */
  --t-s:12.5px; --t-m:14.5px; --t-l:20px;
  --r-s:8px; --r-m:13px; --pill:999px;
  background:var(--s3);color:var(--ink);font:16px/1.45 var(--f);
  -webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased;
}
:host([dark]){
  color-scheme:dark;
  --ink:#ffffff; --ink-2:#d3def0; --paper:#0b1626;
  --card:rgba(8,16,36,.34); --card-line:rgba(255,255,255,.13);
  --track:rgba(255,255,255,.17);
  --sun:#f9e2af; --batt:#a6e3a1; --low:#f38ba8; --grid:#cba6f7; --home:#89b4fa;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
/* Sky, stars for the dark night, and the veil (see _render). */
.sky,.stars,.veil{position:absolute;inset:0;pointer-events:none}
.veil{background:linear-gradient(180deg,var(--l1),var(--l2) 55%,var(--l3))}
:host([ready]) .veil{opacity:0}
.sky{background:linear-gradient(180deg,var(--s1),var(--s2) 55%,var(--s3))}
.stars{opacity:var(--stars,0);
  background:
    radial-gradient(1.2px 1.2px at 12% 9%,#fff 50%,transparent 51%),
    radial-gradient(1px 1px at 31% 22%,#fff 50%,transparent 51%),
    radial-gradient(1.4px 1.4px at 78% 7%,#fff 50%,transparent 51%),
    radial-gradient(1px 1px at 90% 27%,#fff 50%,transparent 51%),
    radial-gradient(1px 1px at 58% 15%,#fff 50%,transparent 51%),
    radial-gradient(1.2px 1.2px at 7% 38%,#fff 50%,transparent 51%),
    radial-gradient(1px 1px at 68% 41%,#fff 50%,transparent 51%),
    radial-gradient(1px 1px at 44% 5%,#fff 50%,transparent 51%)}
::selection{background:color-mix(in srgb,var(--ink) 22%,transparent)}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:var(--r-s)}
h1,h2,h3,p,ol{margin:0;padding:0}
.num{font-size:var(--t-s);font-weight:400;color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}

/* Pager: one snap page per tab. */
.pager{position:relative;flex:1;min-height:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;
  overscroll-behavior-x:contain;scrollbar-width:none}
.pager::-webkit-scrollbar{display:none}
.page{flex:0 0 100%;min-width:0;scroll-snap-align:start;overflow-y:auto;scrollbar-width:none;
  display:grid;grid-template-columns:minmax(0,460px);justify-content:center;align-content:start;gap:12px;
  padding:max(24px,env(safe-area-inset-top)) 16px 12px}
.title,.now h1{font-weight:500;line-height:1.15;letter-spacing:-.02em}
.title{font-size:30px;padding:0 4px 4px}

/* NOW: sentence and flow straight on the sky, battery and advice on cards at the bottom. */
.now{grid-template-rows:auto minmax(170px,1fr) auto auto;align-content:stretch}
.now header{padding:0 4px;text-align:center}
.now h1{font-size:clamp(28px,8cqw,36px);text-wrap:balance}
.now .sub{margin-top:8px;color:var(--ink-2);text-wrap:balance}
.flowbox{display:grid;place-items:center;min-height:0;padding:6px 0}
.flow{display:block;width:100%;max-width:400px;height:100%;max-height:236px;overflow:visible;color:var(--ink)}
.flow text{font-family:var(--f);fill:var(--ink)}
.flow .tl{font-size:13px;font-weight:600}
.flow .tv{font-size:11.5px;fill:var(--ink-2);font-variant-numeric:tabular-nums}
.flow .ln{fill:none;stroke:var(--ink);stroke-width:2;stroke-linecap:round;opacity:.15}
.flow .arrow{opacity:.5}
.flow .arrow .ln{opacity:1;stroke-width:2.5}
.flow .streak{fill:none;stroke:var(--ink);stroke-width:3.5;stroke-linecap:round;stroke-dasharray:22 78;stroke-dashoffset:100;display:none}
.flow .tip{fill:var(--ink)}
.flow .lit{opacity:0}
.flow .node{outline:0}
.flow .node:focus-visible .hit{stroke:var(--ink);stroke-width:2;rx:var(--r-s)}
.flow .ink{fill:var(--ink)}
/* Each source keeps its colour everywhere: icon, bars, rows. */
.flow .plug{fill:var(--grid)}
.flow .house{fill:var(--home);stroke:var(--home)}
.flow .off{opacity:.45}
.flow .ray{stroke:var(--sun);stroke-width:3;stroke-linecap:round}

/* Hint box: one sentence for whatever is hovered, tapped or focused (anything with data-hint). */
[data-hint]{cursor:help}
.hint{position:absolute;z-index:5;left:0;top:0;max-width:min(260px,calc(100% - 16px));padding:9px 13px;border-radius:var(--r-m);
  background:var(--ink);color:var(--paper);font-size:var(--t-m);font-weight:500;line-height:1.3;pointer-events:none;
  opacity:0;visibility:hidden}
.hint.on{opacity:1;visibility:visible}

/* Frosted cards: translucent fill plus one hairline, no shadow. */
.card{padding:16px 18px 18px;border-radius:18px;background:var(--card);border:1px solid var(--card-line);
  -webkit-backdrop-filter:blur(22px) saturate(1.5);backdrop-filter:blur(22px) saturate(1.5)}
.card h2,.card h3{font-size:13.5px;font-weight:600;color:var(--ink-2);margin-bottom:10px}

.big{font-weight:200;line-height:.9;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.big small{font-size:.42em;font-weight:300;letter-spacing:0;margin-left:3px}

/* Battery */
.battery{padding-top:14px}
.battery h2{margin-bottom:2px}
.batt-top{display:flex;align-items:flex-end;gap:16px}
.batt-top .big{font-size:80px}
.batt-say{padding-bottom:6px;min-width:0}
.batt-word{display:flex;align-items:center;gap:8px;font-size:24px;font-weight:600;letter-spacing:-.01em;line-height:1.2}
.batt-word i{flex:none;width:12px;height:12px;border-radius:50%;background:var(--c)}
.batt-say p{color:var(--ink-2);font-size:var(--t-m);text-wrap:pretty}
.gauge{height:14px;margin-top:14px;border-radius:var(--pill);background:var(--track);overflow:hidden}
.gauge i{display:block;height:100%;width:var(--w);min-width:6px;border-radius:var(--pill);background:var(--c)}

/* Advice. The tile is the same on both themes: the bright meaning colours with a dark mark. */
.advice{display:flex;align-items:center;gap:14px;padding:14px 16px;--tile:#a6e3a1}
.advice[data-kind="go"]{--tile:#f9e2af}
.advice[data-kind="low"]{--tile:#f38ba8}
.advice[data-kind="wait"]{--tile:#89b4fa}
.advice .tile{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:var(--r-m);background:var(--tile);color:#0b1626}
.advice .tile svg{width:26px;height:26px}
.advice p{font-size:17.5px;font-weight:500;line-height:1.3;letter-spacing:-.01em;text-wrap:balance}
/* Lead lines: the sentence under the big share, and the offline message. */
.share .big + p,.empty{font-size:var(--t-l);font-weight:500;line-height:1.3;letter-spacing:-.01em;text-wrap:balance}
.empty{align-self:center;text-align:center}

/* Skeleton: the real page with every text and mark turned into a grey bar.
   Page titles and the "Loading" headline stay readable.
   A bar hugs its text (fit-content), and must stay where that text sits when loaded. */
.skel :is(.sub,h2:not(.title),h3:not(:has(.num)),h3 > span,p,.lab,.num,.big,.batt-word,.yest span,.week li > span:not(.col),.kv > :not(:empty),.note){
  color:transparent!important;background:var(--track);border-radius:var(--r-s);width:fit-content}
.skel :is(.lab em,.big small){color:transparent!important}
.skel .lab em{width:fit-content}
.skel .big{display:inline-block}
/* The headline keeps the box of the sentence shown last time, with the loading word over it. */
.skel .now h1{position:relative;color:transparent}
.skel .now h1::before{content:attr(data-wait);position:absolute;inset:0 0 auto;color:var(--ink)}
.skel .now .sub{margin-inline:auto}
.skel .kv :is(b,.head){justify-self:end}
.skel :is(.bar i,.gauge i,.week .col i,.batt-word i,.advice .tile){background:var(--track)!important}
.skel .advice .tile svg,.skel .flow :is(.streak,.tip,.halo,text){visibility:hidden}
.skel .flow :is(circle,rect:not(.hit),.ink){fill:var(--track)!important;stroke:transparent!important}
.skel .flow .ray{stroke:var(--track)}
.skel .flow .arrow{opacity:1}
.skel .flow .ln{opacity:.15!important;stroke-width:2!important}
.skel .page{pointer-events:none}

/* TODAY */
.share{padding:14px 4px 10px}
.share .big{font-size:clamp(96px,30cqw,124px)}
.share .big + p{margin:12px 0 16px}
.bar{display:block;height:10px;border-radius:var(--pill);background:var(--track);overflow:hidden}
.bar i{display:block;height:100%;width:var(--w);min-width:4px;border-radius:var(--pill);background:var(--c)}
.share .bar{height:16px}
.share .money{margin-top:12px;color:var(--ink-2)}
.rows{display:grid;gap:16px}
.row{display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:6px 12px}
.row .lab{font-weight:500}
.row .lab em{display:block;font-style:normal;font-weight:400;font-size:var(--t-m);color:var(--ink-2)}
.card h3:has(.num){display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.row .bar{grid-column:1/-1}

/* PAST DAYS */
.yest{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.yest .big{font-size:48px}
.yest > span:not(.big){font-weight:500}
.yest + .num,.month > .num{display:block;margin-top:8px;white-space:normal}
.week{list-style:none;display:grid;grid-template-columns:repeat(7,1fr);gap:8px;height:132px}
.week li{display:grid;grid-template-rows:auto 1fr auto;gap:6px;justify-items:center;min-width:0;font-size:var(--t-s);font-weight:500}
.week .col{display:flex;align-items:flex-end;width:100%;max-width:26px}
.week .col i{display:block;width:100%;height:var(--h);min-height:4px;border-radius:var(--r-s) var(--r-s) 3px 3px;background:var(--sun)}
.month .row + .row{margin-top:16px}
.verdict{margin-top:14px;font-weight:500;text-wrap:balance}

/* INFO: the owner's page, plain label and value lines. */
.kv{display:grid;grid-template-columns:1fr auto auto;align-items:baseline;gap:8px 14px;font-size:var(--t-m)}
.kv b{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
.kv .wide{grid-column:2/-1}
.kv .head{font-size:var(--t-s);font-weight:400;color:var(--ink-2);text-align:right}
.note{font-size:var(--t-m);color:var(--ink-2)}

/* Tab bar, with Home Assistant's own menu button beside it when the sidebar is hidden. */
footer{position:relative;flex:none;display:flex;justify-content:center;align-items:center;gap:6px;padding:6px 8px max(8px,env(safe-area-inset-bottom))}
ha-menu-button{color:var(--ink)}
.tabs{display:flex;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:none;padding:4px;border-radius:var(--pill);background:var(--card);border:1px solid var(--card-line);
  -webkit-backdrop-filter:blur(22px) saturate(1.5);backdrop-filter:blur(22px) saturate(1.5)}
.tabs button{appearance:none;border:0;background:none;cursor:pointer;display:grid;place-items:center;min-height:40px;padding:0 13px;
  border-radius:var(--pill);color:var(--ink);font:500 var(--t-m) var(--f);white-space:nowrap}
.tabs button[aria-current]{background:var(--ink);color:var(--paper)}

/* Short panels (small phones, or the app with its own bars): tighten so a page still fits. */
@container (max-height:700px) and (max-width:999px){
  .page{gap:10px;padding-top:16px;padding-bottom:6px}
  .now h1{font-size:26px}
  .now .sub{margin-top:4px;font-size:var(--t-m)}
  .card{padding:12px 16px 14px}
  .card h2,.card h3{margin-bottom:6px}
  .batt-top .big{font-size:60px}
  .batt-word{font-size:21px}
  .gauge{margin-top:10px;height:12px}
  .advice{padding:10px 14px}
  .advice p{font-size:16px}
  .title{font-size:26px}
  .share{padding-top:4px}
  .share .big{font-size:88px}
  .yest .big{font-size:40px}
  .week{height:100px}
  .verdict{margin-top:10px}
  .tabs button{min-height:36px}
}

/* Wide panels: no paging, the pages stand side by side. */
@container (min-width:1000px){
  .pager{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0 28px;
    overflow:hidden auto;scroll-snap-type:none;width:100%;max-width:1812px;margin:0 auto;padding:0 24px}
  .page{overflow:visible;padding:56px 0 24px;gap:14px}
  .now{grid-template-rows:auto minmax(220px,auto) auto auto;align-content:start}
  .now header{text-align:left}
  .skel .now .sub{margin-inline:0}
  /* One size for the column heads, so their first lines share a baseline. */
  .title,.now h1{font-size:32px}
  .tabs{display:none}
  /* The menu button, when there is one, moves to the corner above the first column. */
  footer{position:absolute;top:4px;left:12px;padding:0}
}

@media (prefers-reduced-motion:no-preference){
  .tabs button{transition:background-color .2s var(--ease),color .2s var(--ease)}
  /* The one moving thing: light travelling along whichever paths are live. */
  .flow .streak{display:block;animation:run 2.8s linear infinite}
  .flow .halo{animation:breathe 6s ease-in-out infinite;transform-origin:170px 36px}
  @keyframes run{to{stroke-dashoffset:0}}
  /* Same clock as the streak, whose front reaches the end of the path at 78 % of each run. */
  .flow .lit{animation:tip 2.8s linear infinite}
  @keyframes tip{0%,74%{opacity:0}80%,95%{opacity:1}100%{opacity:0}}
  .hint{transition:opacity .2s var(--ease),visibility .2s}
  @keyframes breathe{50%{transform:scale(1.12);opacity:.75}}
  .veil{transition:opacity 1.4s var(--ease)}
  .skel .page{animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{50%{opacity:.55}}
  .pager.fresh .page > *{animation:rise .7s var(--ease) both}
  @keyframes rise{from{opacity:0;transform:translateY(8px)}}
}
`;

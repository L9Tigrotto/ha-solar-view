/* The stylesheet of the solar panel, as one string for its shadow root. Loaded by solar-view.js. */

/* A weather app: the sky is the page, a full-bleed gradient that follows the sun. One screen per
   page, swiped sideways or picked from the tab bar; a wide panel shows them side by side.
   One ink colour per theme, so contrast holds on every sky.
   Sizes follow the panel (container queries), not the window: the sidebar may be open. */
export const CSS = `
:host{
  display:flex;flex-direction:column;position:relative;overflow:hidden;container:panel / size;
  /* Big phone text (see textScale in shell.js): the phone enlarges text by --zf, and the whole panel zooms by
     --z, as a browser zooms a page. --z is 70 % of the phone's extra size (2 gives 1.7): the full size was still
     too big on the owner's parents' phones. Every text size in this sheet is divided by --zt, the part the app
     already enlarged (--zf; the preview, whose browser enlarges nothing, sets it to 1), so text ends at --z;
     --zs for chart text. */
  --z:calc(1 + (var(--zf,1) - 1) * .7);
  zoom:var(--z);height:calc(100dvh / var(--z));--zt:var(--zf,1);
  /* The tab bar and the gear grow with the text up to 1.3 times, no more: they zoom back by --cap. */
  --cap:calc(min(var(--z),1.3) / var(--z));
  color-scheme:light;
  --ink:#0e2236; --ink-2:#27405a; --paper:#ffffff;
  --card:rgba(255,255,255,.65); --card-line:rgba(255,255,255,.8);
  --track:rgba(14,34,54,.13);
  /* Accents: amber, teal green, rose, plum, blue. They double as the marks on charts and rings (see markOf),
     3:1 or more on the lightest sky and on white. Sent is the grid colour, faded; savings (the money
     page's marks) a teal of their own. */
  --range:#fe640b; --sun:#a3650c; --batt:#277c61; --low:#b64259; --grid:#7956a8; --home:#2f6eae;
  --sent-mark:#8965b3; --return-mark:#277b72;
  --f:ui-rounded,"SF Pro Rounded","Segoe UI Variable Text","Segoe UI",system-ui,Roboto,"Helvetica Neue",Arial,sans-serif;
  --ease:cubic-bezier(.22,1,.36,1);
  /* Scales. Type, the only text sizes: chart ticks and tab labels, small labels and numbers, secondary
     lines, lead lines, card titles, page titles (body is the 16px below; the big numbers stand apart).
     Weights: 400 text, 500 labels and lead lines, 600 values, 700 titles.
     Radii: small (focus, skeleton bars), medium (hint, tile), pill (bars, tabs). */
  --t-xs:calc(12px / var(--zt)); --t-s:calc(13px / var(--zt)); --t-m:calc(15px / var(--zt)); --t-l:calc(18px / var(--zt)); --t-h:calc(16px / var(--zt)); --t-title:calc(34px / var(--zt));
  --r-s:8px; --r-m:13px; --pill:999px;
  background:var(--sv-sky3);color:var(--ink);font:calc(16px / var(--zt))/1.45 var(--f);
  -webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased;
  /* No grey box flashing over a tap on phones: the round tabs and buttons show their own state. */
  -webkit-tap-highlight-color:transparent;
}
:host([dark]){
  color-scheme:dark;
  --ink:#ffffff; --ink-2:#d3def0; --paper:#0b1626;
  --card:rgba(8,16,36,.7); --card-line:rgba(255,255,255,.13);
  --track:rgba(255,255,255,.17);
  --range:#fe640b; --sun:#e9bf69; --batt:#72c6a4; --low:#ed9cad; --grid:#b4a0d7; --home:#87b5df;
  /* Marks: the plain colours where they reach 3:1 on the lightest night sky, lighter where not. */
  --home-mark:#94bde3; --grid-mark:#c2b1de; --low-mark:#efa5b4; --sent-mark:#d9ccec; --return-mark:#80cfbf;
}
#money,dialog.read:is([data-card=recent],[data-card=payback]){--sun-mark:var(--return-mark)}
*{box-sizing:border-box}
[hidden]{display:none!important}
.status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* Sky, stars for the dark night, and the veil (see _render). */
.sky,.stars,.rain,.snow,.veil{position:absolute;inset:0;pointer-events:none}
/* Rain: short slanted streaks in the ink colour, which reads on either theme's sky. Each drop is a full
   height column, tilted, with its streak at the top, so the fall is a translate by its own height along
   the tilt. They only show while they move (see the motion block at the end). */
.rain{overflow:hidden}
.rain i{position:absolute;top:0;width:3px;height:100%;display:none;rotate:12deg}
.rain i::before{content:"";display:block;height:28px;border-radius:2px;background:linear-gradient(transparent,color-mix(in srgb,var(--ink) 60%,transparent))}
/* Snow: soft round flakes of 3 to 6 px, drifting side to side as they fall, slower than rain. White, with a
   faint ink edge on the light sky so they still read there. Each is a full height column like a drop. */
.snow{overflow:hidden}
.snow i{position:absolute;top:0;width:var(--s);height:100%;display:none}
.snow i::before{content:"";display:block;width:var(--s);height:var(--s);border-radius:50%;background:#fff;box-shadow:0 0 0 .5px color-mix(in srgb,var(--ink) 50%,transparent)}
:host([dark]) .snow i::before{background:#eef3ff;box-shadow:none}
.veil{background:linear-gradient(180deg,var(--l1),var(--l2) 55%,var(--l3))}
:host([ready]) .veil{opacity:0}
/* The sky colours are set on the host but not inherited (see registerProperty): only .sky takes them, so their glide restyles one element. */
.sky{--sv-sky1:inherit;--sv-sky2:inherit;--sv-sky3:inherit;background:linear-gradient(180deg,var(--sv-sky1),var(--sv-sky2) 55%,var(--sv-sky3))}
/* Stars: big and small dots, the small ones fainter. */
.stars{opacity:var(--stars,0);
  background:
    radial-gradient(6px 6px at 12% 9%,#fff 50%,transparent 51%),
    radial-gradient(2.5px 2.5px at 31% 22%,rgba(255,255,255,0.6) 50%,transparent 51%),
    radial-gradient(4px 4px at 78% 7%,#fff 50%,transparent 51%),
    radial-gradient(2.5px 2.5px at 90% 27%,rgba(255,255,255,0.6) 50%,transparent 51%),
    radial-gradient(6px 6px at 58% 15%,#fff 50%,transparent 51%),
    radial-gradient(2.5px 2.5px at 7% 38%,rgba(255,255,255,0.6) 50%,transparent 51%),
    radial-gradient(4px 4px at 68% 41%,#fff 50%,transparent 51%),
    radial-gradient(2.5px 2.5px at 44% 5%,rgba(255,255,255,0.6) 50%,transparent 51%),
    radial-gradient(6px 6px at 22% 30%,#fff 50%,transparent 51%),
    radial-gradient(2.5px 2.5px at 84% 33%,rgba(255,255,255,0.6) 50%,transparent 51%),
    radial-gradient(4px 4px at 50% 35%,#fff 50%,transparent 51%),
    radial-gradient(2.5px 2.5px at 36% 23%,rgba(255,255,255,0.6) 50%,transparent 51%)}
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
.title,.now h1{font-weight:700;line-height:1.15;letter-spacing:-.02em}
/* Headings keep clear of the gear: the page edge plus this padding reaches past it. */
.title{font-size:var(--t-title);padding:0 32px 4px 4px}

/* NOW: sentence and flow straight on the sky, battery and advice on cards at the bottom. */
.now{grid-template-rows:auto minmax(170px,1fr) auto auto;align-content:stretch}
.now header{padding:0 32px;text-align:center}
.now h1{font-size:calc(clamp(28px,8cqw,36px) / var(--zt));text-wrap:balance}
.now .sub{margin-top:8px;color:var(--ink-2);text-wrap:balance}
/* A reading too old to be live: when it came, under the headline at any text size. */
.now .stale{margin-top:6px;color:var(--ink-2);font-size:var(--t-m)}
/* Offline: the message alone on Now, centred (Energy and Money still show their numbers). */
.now:has(> .empty){grid-template-rows:none;align-content:center}
.flowbox{display:grid;grid-template-rows:minmax(0,1fr);place-items:center;min-height:0;padding:6px 0}
/* The drawing's box: the size the SVG had alone (the ratio of its viewBox when the height is free). */
.flowfit{position:relative;width:100%;max-width:400px;height:100%;max-height:236px;min-width:0;min-height:0;aspect-ratio:340/198}
.flow{position:absolute;inset:0;display:block;width:100%;height:100%;overflow:visible;color:var(--ink)}
/* Names and powers over the drawing in HTML, so they keep their size when it scales: placed in viewBox
   units (u, the scale of the drawing centred in its box), the first baseline on y (about 1em under the top). */
.flowtext{position:absolute;inset:0;container-type:size;pointer-events:none}
.flowtext .fl{--u:min(100cqw / 340,100cqh / 198);position:absolute;left:calc(50cqw + (var(--x) - 170) * var(--u));top:calc(50cqh + (var(--y) - 99) * var(--u));
  translate:-50% -1em;font-size:var(--t-s);line-height:1.2;text-align:center;white-space:nowrap}
.flowtext .fl.start{translate:0 -1em;text-align:left}
.flowtext .tl{display:block;font-weight:600}
.flowtext .tv{display:block;width:fit-content;margin:1px auto 0;font-size:var(--t-xs);color:var(--ink-2);font-variant-numeric:tabular-nums}
.flowtext .start .tv{margin-left:0}
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
.flow .plug{stroke:var(--grid)}
.flow .house{stroke:var(--home)}
.flow .off{opacity:.45}
.flow .ray{stroke:var(--sun)}
/* The icon over the flow: the moon's dark side a faint disc, its lit side in ink; a cloud in the page
   colour with an ink outline (rain's open cloud unfilled), and rain as ink drops. Line widths sit on the svg. */
.flow .moon-dark{opacity:.14}
.flow .moon-lit{opacity:.8}
.flow .crater{fill:var(--paper);opacity:.3}
:is(.flow,.wx) .cloud{fill:var(--paper);stroke:var(--ink)}
:is(.flow,.wx) .cloud.rainy{fill:none}
:is(.flow,.wx) .drop{fill:none;stroke:var(--ink)}

/* Hint box: whatever is hovered, tapped or focused (anything with data-hint), its name small over its
   value, a dot in its colour, and a pointer to it. */
[data-hint]{cursor:help}
.hint{position:absolute;z-index:5;left:0;top:0;display:grid;gap:1px;max-width:min(260px,calc(100% - 16px));padding:8px 13px 9px;
  border-radius:var(--r-m);background:var(--paper);border:1px solid var(--card-line);color:var(--ink);box-shadow:0 4px 18px rgba(0,0,0,.18);line-height:1.3;
  pointer-events:none;opacity:0;visibility:hidden}
.hint small{font-size:var(--t-s);color:var(--ink-2)}
.hint b{font-size:var(--t-m);font-weight:600}
.hint.dot b::before{content:"";display:inline-block;width:9px;height:9px;margin-right:7px;border-radius:50%;background:var(--dot);vertical-align:1px}
.hint::after{content:"";position:absolute;left:var(--x,50%);bottom:-6px;width:10px;height:10px;margin-left:-6px;transform:rotate(45deg);
  background:inherit;border:inherit;border-top:0;border-left:0}
.hint.below::after{bottom:auto;top:-6px;border:inherit;border-bottom:0;border-right:0}
.hint.on{opacity:1;visibility:visible}

/* Cards: translucent fill plus one hairline, no shadow and no blur: a backdrop-filter here drew a blurred copy
   of the month columns over them in Chrome whenever a hint showed. The tab bar the same. */
.card{padding:16px 18px 18px;border-radius:18px;background:var(--card);border:1px solid var(--card-line)}
.card h2{font-size:var(--t-h);font-weight:700;margin-bottom:10px}
/* A card with a "?" in its top right corner: the heading keeps clear of it. */
.card:has(> .help){position:relative}
.card:has(> .help) > h2{padding-right:34px}

.big{font-weight:200;line-height:.9;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.big small{font-size:.42em;font-weight:300;letter-spacing:0;margin-left:3px}

/* Battery: the big ring centred on every screen height, the "?" in the top right corner. */
.battery{padding-top:14px}
.battery h2{margin-bottom:2px}
.help{position:absolute;top:2px;right:2px;display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;background:none;color:var(--ink);cursor:pointer}
.help svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
/* The ring and the numbers in its middle, which leave taps and hover to the ring's hint. */
.ring-box{position:relative;width:176px;max-width:100%;margin:0 auto 6px}
/* On the ring's centre (y 103 of 176), not the box's: every ring alike. */
.ring-mid{position:absolute;inset:auto 0;top:58.5%;translate:0 -50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;pointer-events:none}
.ring-mid .big{font-size:calc(52px / var(--zt))}
/* The digits are what the eye centres, so an unseen % on the left balances the one on the right. */
.ring-mid .big:has(small)::before{content:"%";visibility:hidden;font-size:.42em;font-weight:300;letter-spacing:0;margin-right:3px}
/* The battery's word and what it is doing centred under its ring. */
.batt-say{min-width:0;text-align:center}
.batt-word{display:flex;align-items:center;justify-content:center;gap:8px;font-size:calc(24px / var(--zt));font-weight:600;letter-spacing:-.01em;line-height:1.2}
.batt-word i{flex:none;width:12px;height:12px;border-radius:50%;background:var(--c)}
.batt-say p{color:var(--ink-2);font-size:var(--t-m);text-wrap:pretty}

/* Rings (see ring()): the track is decoration, the coloured marks carry the meaning. */
.ring{display:block;width:100%;height:auto;overflow:visible}
.ring path{fill:none;stroke:var(--c);stroke-width:16;stroke-linecap:round}
.ring .track{stroke:var(--track)}
.ring .range{stroke-width:3}
/* The battery in an hour: the faded piece of the track, and the battery size in the gap. */
.ring .soon{stroke:color-mix(in srgb,var(--c) 50%,transparent)}
.ring .size{font:400 calc(13px / var(--zs,1)) var(--f);fill:var(--ink-2);font-variant-numeric:tabular-nums}
.share .ring .size{font-size:calc(13px * 176 / 140 / var(--zs,1))} /* the same size on screen as on the battery's larger ring */

/* Advice. The tile is the same on both themes: the bright meaning colours with a dark mark. */
:is(.advice,.wear){display:flex;align-items:center;gap:14px;padding:14px 16px;--tile:#a6e3a1}
.advice[data-kind="go"]{--tile:#f9e2af}
.advice[data-kind="low"]:not(.rest),.wear{--tile:#f38ba8}
.advice:is([data-kind="wait"],[data-kind="soon"],[data-kind="later"],[data-kind="short"],[data-kind="fills"]){--tile:#89b4fa}
:is(.advice,.wear) .tile{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:var(--r-m);background:var(--tile);color:#0b1626}
:is(.advice,.wear) .tile svg{width:26px;height:26px}
:is(.advice,.wear) p{font-size:var(--t-l);font-weight:500;line-height:1.3;letter-spacing:-.01em;text-wrap:balance}
/* Lead lines: the sentence under the share ring, centred under it (beside the small rings too). */
:is(.share,.rings > div) > p:not(.money){text-align:center}
:is(.share,.payback,.rings > div) > p:not(.money,.ring-name){font-size:var(--t-l);font-weight:500;line-height:1.3;letter-spacing:-.01em;text-wrap:balance}
/* The whole-page message (not set up, offline): a card centred on the sky. An icon, a title, what is
   wrong; for setup the path in Home Assistant as chips, and for admins the sensors not found. */
.empty{align-self:center;width:100%;max-width:520px;padding:24px 20px;text-align:center;text-wrap:balance}
.empty > svg{width:40px;height:40px;margin-bottom:10px}
.empty h2{font-size:var(--t-l);letter-spacing:-.01em}
.empty p{margin-top:6px;color:var(--ink-2)}
.empty .lead{margin-top:18px;color:var(--ink);font-weight:600}
.empty .path{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 22px;margin:10px 0 4px;list-style:none}
.empty .path li{position:relative;padding:3px 11px;border-radius:var(--pill);background:var(--track);font-size:var(--t-s);font-weight:600}
.empty .path li + li::before{content:"›";position:absolute;left:-15px;color:var(--ink-2);font-weight:400}
.empty h3{margin:16px 0 10px;padding-top:14px;border-top:1px solid var(--card-line);font-size:var(--t-m);font-weight:600}
.empty .ids{margin:4px 0 0;padding:0;list-style:none;color:var(--ink-2);font-size:var(--t-s);overflow-wrap:anywhere}
/* Offline or setup: one full-width page that scrolls from the top, the message centred in it, no dashboard tracks. */
.pager.message{display:flex;overflow:hidden;padding:0;width:100%;max-width:none;margin:0;gap:0;scroll-snap-type:none}
.pager.message .now{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;overflow:auto;gap:0;padding:56px 16px 24px;scroll-snap-align:none}
.pager.message .empty{flex:none;margin-block:auto}

/* Skeleton: the real page with every number and sentence turned into a grey bar. What is known
   before the data (titles, headings, labels, units, weekdays) stays readable, as does the
   "Loading" headline. Every mark is one grey layer: a fill drawn over its track is hidden.
   A bar hugs its text (fit-content), and must stay where that text sits when loaded. */
.skel :is(.sub,.batt-say p,:is(.advice,.wear,.best) p > *,p.money,.day:not(:has(.readout)),.big,.readout dd,.amount,.side b,.price b,.batt-word > span,.card > .note,.flowtext .tv){
  color:transparent!important;background:var(--track);border-radius:var(--r-s);width:fit-content}
/* The advice and washer sentences grey as spans, a bar a line, so a tile floated beside them (big text) stays clear. */
.skel .big{display:inline-block}
.skel :is(.readout dd,.batt-say p){margin-inline:auto}
/* The headline keeps the box of the sentence shown last time, with the loading word over it. */
.skel .now h1{position:relative;color:transparent}
.skel .now h1::before{content:attr(data-wait);position:absolute;inset:0 0 auto;color:var(--ink)}
.skel .now .sub{margin-inline:auto}
.skel :is(.week .col i,.year i,.batt-word i,.advice .tile,.wear .tile,.best .tile,.days .track i){background:var(--track)!important;border-color:transparent!important;outline-color:transparent!important}
.skel :is(.socline :not(.floor),.now-label,.days .track :is(b,.use),.tick,.hours24 i,.ring :not(.track,.sk),.flow .lvl,.wx){visibility:hidden}
.skel .week li[aria-current] > .date{background:none;color:inherit}
.skel .step{visibility:hidden}
.skel .legend i{background:var(--track)}
/* The coming days' values get bars of one length, a typical value's, where their text ends.
   The bar is drawn over the box, which stays put. */
.skel :where(.days .num){position:relative;color:transparent!important}
.skel :where(.days .num)::after{content:"";position:absolute;inset-block:0;right:0;
  width:var(--sk-w);background:var(--track);border-radius:var(--r-s)}
.skel .days .num{--sk-w:2ch}
/* SVG text has no box to grey: a bar of about its size (sk) sits under it, drawn only here. */
.sk{display:none}
.skel .sk{display:inline;fill:var(--track)}
.skel :is(.advice,.wear,.best) .tile svg,.skel .flow :is(.streak,.tip,.halo){visibility:hidden}
.skel .flow :is(circle,rect:not(.hit):not(.sk),.ink,.cloud){fill:var(--track)!important;stroke:transparent!important}
.skel .flow :is(.ray,.drop){stroke:var(--track)}
.skel .flow .outline :is(path,rect:not(.lvl):not(.pole)){fill:none!important;stroke:var(--track)!important}
.skel .flow .arrow{opacity:1}
.skel .flow .ln{opacity:.15;stroke-width:2}
.skel .page{pointer-events:none}

/* ENERGY: Power origin's share ring, its text left aligned like every other card. NOW: the best time as a
   highlighted line, on the battery card or, without a charge reading, on a card of its own. MONEY: the
   payback ring, centred, its text left aligned the same way. */
.share .ring-mid .big{font-size:calc(44px / var(--zt))}
/* The split ring (see splitRing): a smaller ring, with room above for the top label. Each label sits where
   its line starts: 16 viewBox units (8 % of the width) beside the ring, at the height of the ring's centre,
   or above it (bottom is a share of the height, 176 units). */
.share .ring-box{width:140px;margin:40px auto 4px}
.share .ring-box:not(:has(.top)){margin-top:12px}
.ring .lead{fill:none;stroke:var(--ink-2);stroke-width:1.2;stroke-linecap:butt}
.ring circle{fill:var(--c)}
.part{position:absolute;font-size:var(--t-s);line-height:1.25;white-space:nowrap;color:var(--ink-2)}
.part.left{right:110%;top:58.5%;translate:0 -50%}
.part.right{left:110%;top:58.5%;translate:0 -50%}
.part.top{left:50%;bottom:106%;translate:-50% 0}
/* With a forecast (see ringsAhead): the same split in an hour and at the end of the day, small and
   without labels, under the big ring and its sentence; beside them once there is room for its side labels. */
.share{container:share / inline-size}
.rings{display:flex;flex-direction:column;align-items:center}
.rings-ahead{display:none;justify-content:center;gap:24px;margin:10px 0 4px;padding:0;list-style:none}
.rings-ahead li{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:var(--t-s);color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.share .rings-ahead .ring-box{width:100px;margin:0}
.rings-ahead .ring .lead{display:none}
.share .rings-ahead .ring-mid .big{font-size:calc(30px / var(--zt))}
@container share (min-width:420px){
  .rings{flex-direction:row;justify-content:center}
  .share .rings > div > .ring-box{margin-inline:66px 74px}
  .rings-ahead{flex-direction:column;gap:8px;margin:28px 0 0}
}
/* Too narrow for the side labels (a small phone, or big text): they drop under the ring's ends, next to
   their parts, without the lines. */
@container share (max-width:240px){
  .share .ring-box{margin-bottom:calc(30px / var(--zt) + 4px)}
  .share .ring .lead{display:none}
  .share .part.left{right:auto;left:-12px;top:100%;translate:0 0}
  .share .part.right{left:auto;right:-12px;top:100%;translate:0 0}
}
.payback .money{margin-top:8px;font-size:var(--t-m);color:var(--ink-2)}
:is(.share,.payback) > h2{text-align:left}
.best{display:flex;align-items:center;gap:12px;margin-top:12px;padding:10px 12px;border-radius:var(--r-m);font-weight:600;text-align:left;
  background:color-mix(in srgb,var(--ink) 6%,transparent);border:1px solid var(--card-line);--tile:#f9e2af}
.best[data-kind="wait"]{--tile:#89b4fa}
.best .tile{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:var(--r-m);background:var(--tile);color:#0b1626}
.best .tile svg{width:24px;height:24px}
.best p{text-wrap:balance}
.best small{display:block;margin-top:2px;font-size:var(--t-s);font-weight:400;color:var(--ink-2)}
.machines .best:first-child{margin-top:0}
.legend{list-style:none;display:flex;flex-wrap:wrap;justify-content:center;gap:6px 2px;margin:6px 0 0;padding:0;
  font-size:var(--t-s);line-height:1.25;color:var(--ink-2);text-align:center}
.legend li{flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:min(100%,min-content)}
.legend i{flex:none;width:10px;height:10px;border-radius:50%;background:var(--c)}
.card :is(h2,h3):has(.num){display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:0 12px}

/* The weather icons of the coming days. */
.wx{display:block;width:26px;height:24px;overflow:visible}
.wx circle{fill:var(--sun-mark,var(--sun))}
.wx .ray{stroke:var(--sun-mark,var(--sun))}
/* Coming days: a row per day, its pill from low to high on a track from 0 to the highest high. */
.days{list-style:none;display:grid;margin:0;padding:0}
.days li{display:grid;grid-template-columns:3.4em 26px minmax(0,1fr) 2.4em;align-items:center;gap:8px;min-height:36px;font-size:var(--t-m);font-weight:500}
.days .num{font-size:var(--t-m);color:var(--ink);text-align:right}
/* A bar from 0 to the likely sun, a thin line from low to high over it, and an upright line at the usual
   day's use through every row (rows are 36 px, the track 8: 14 px either side), named over the first. */
.days.with-use{margin-top:20px}
.days .track{position:relative;height:8px;border-radius:var(--pill);background:var(--track)}
.days .track i{position:absolute;inset-block:0;left:0;width:max(8px,var(--v));border-radius:var(--pill);background:var(--sun-mark,var(--sun))}
.days .track b{position:absolute;top:2.5px;height:3px;left:var(--a);width:calc(var(--b) - var(--a));border-radius:1.5px;background:var(--range)}
.days .track .use{position:absolute;top:-14px;bottom:-14px;left:var(--u);width:1.25px;translate:-50% 0;background:var(--ink);opacity:.55}
.days li:first-child .use{top:-4px}
.days li:last-child .use{bottom:-4px}
.days .now-label{top:-24px}
/* The first days: one plain line on a card of its own (see learn in nowView). */
.learn p{font-size:var(--t-m);color:var(--ink-2);text-wrap:pretty}
/* A card's own line under its chart (no numbers on record), read as the picked day's sentences. */
.card > .note{margin-top:8px;font-size:var(--t-m);text-wrap:pretty}
/* This month's days (see dayLine): a line over up to 31 narrow columns, a dot a day over its date, the
   figures only in the hint and the sentence. The line's box ends where the dates start (their row and gap). */
.dayline{position:relative;margin-top:18px;container-type:inline-size}
.dayline .area{position:absolute;inset:0 0 22px;pointer-events:none}
.week{position:relative;list-style:none;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));height:132px}
.week li{display:grid;grid-template-rows:1fr 18px;grid-template-columns:minmax(0,1fr);gap:4px;justify-items:center;min-width:0;font-size:var(--t-xs);font-weight:500;font-variant-numeric:tabular-nums}
.week .col{position:relative;width:100%}
.week .col i{position:absolute;left:50%;bottom:var(--v);width:6px;height:6px;margin:0 0 -3px -3px;border-radius:50%;background:var(--sun-mark,var(--sun))}
/* The picked day: a big dot, its date in ink, its figures under the chart. Dates every 3 days and on the
   picked day, whose neighbours give it room. */
.week li[aria-current] .col i{width:11px;height:11px;margin:0 0 -5.5px -5.5px;box-shadow:0 0 0 2px var(--paper)}
.week .date{padding:0 4px;border-radius:var(--pill);white-space:nowrap}
.week li[aria-current] > .date{background:var(--ink);color:var(--paper)}
.week li:is(.quiet:not([aria-current]),[aria-current] + li) > .date,.week li:has(+ li[aria-current]) > .date{visibility:hidden}
/* A month too narrow for every third day (a small phone, or big text): every sixth. */
@container (max-width:240px){.week:has(> li:nth-child(15)) li:not(:nth-child(6n+1),[aria-current]) > .date{visibility:hidden}}
/* Today, still arriving: a hollow dot. A day with no numbers on record, or still to come, keeps its place,
   with no dot. */
.week li.today .col i{background:var(--paper);outline:2px solid var(--c);outline-offset:-2px}
/* A day still to come, from the forecast: a faded dot on the dashed line. */
.week li.ahead .col i{background:color-mix(in srgb,var(--c) 35%,var(--paper));outline:1.5px solid var(--c);outline-offset:-1.5px}
.picked{margin-top:12px;font-size:var(--t-m);text-wrap:pretty}
.picked b{font-weight:600}
/* ‹ and › at the two ends of a picked hour's, day's or month's caption (see steps): 44 px to tap, centred on
   the caption's first line, which keeps room for them. --cap-top: how far under the box's top that line starts. */
.stepped{position:relative}
.step{position:absolute;top:calc(var(--cap-top,0px) - 13px);z-index:1;display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;background:none;color:var(--ink);cursor:pointer}
.step-prev{left:-10px}
.step-next{right:-10px}
.step svg{box-sizing:content-box;width:22px;height:22px;padding:4px;border-radius:50%;background:color-mix(in srgb,var(--ink) 10%,transparent);fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.step:is(:hover,:focus-visible) svg{background:color-mix(in srgb,var(--ink) 18%,transparent)}
.step[aria-disabled=true]{opacity:.3;cursor:default}
.step[aria-disabled=true] svg{background:color-mix(in srgb,var(--ink) 10%,transparent)}
.stepped :is(.period,.chart-title),.stepped .day:not(:has(.readout)){padding-inline:36px}
.stepped > .chart-title{text-align:center}
.stepped.total{--cap-top:12px}
/* ENERGY: Today by hour (see battDayCard): a chart of the charge, and under it one of each hour's energy,
   on one timeline, each under its own title and unit. They stretch with the card, their strokes keep their
   width; 24 hour cells over each take the taps and drags, the top ones the hints, and hold the picked hour's dots. */

.battday .legend{margin:8px 0 0}
.battday .plot{position:relative;height:120px;margin-top:22px}
.battday .plot.charge{height:72px}
/* Now: a thin line across both charts, named once over the top one, inside the card at either end. */
.socline .now-line{stroke:var(--ink);stroke-width:1.25;opacity:.55}
.battday .plot:has(> .now-label){margin-top:32px}
.now-label{position:absolute;top:-28px;left:var(--x);translate:-50% 0;font-size:var(--t-xs);font-weight:600;line-height:12px;white-space:nowrap;pointer-events:none}
.now-label.start{translate:0 0}
.now-label.end{translate:-100% 0}
/* A chart's own title, over it; a second one is set off from the chart above. */
.chart-title{margin:16px 0;font-size:var(--t-s);font-weight:600}
.plot + .chart-title{padding-top:12px;border-top:1px solid var(--track)}
.socline{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.socline :is(path,line,rect){fill:none;vector-effect:non-scaling-stroke}
.socline rect.later{fill:var(--ink);opacity:.05}
.socline .grid{stroke:var(--track)}
.socline .axis{stroke:var(--ink-2);opacity:.4}
.socline :is(.series,.past,.ahead){stroke:var(--c);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.socline :is(.past,.ahead){--c:var(--batt-mark,var(--batt))}
.socline :is(.series.later,.ahead){stroke-dasharray:5 5}
.socline .floor{stroke:var(--low-mark,var(--low));stroke-width:1.5;stroke-dasharray:4 4}
/* A chart's scale: each gridline's value over it, on the left; the floor named at its line. */
.tick{position:absolute;left:0;margin-bottom:1px;font-size:var(--t-xs);line-height:1.2;color:var(--ink-2);pointer-events:none}
.battday .floor-label{position:absolute;right:0;margin-bottom:2px;font-size:var(--t-xs);color:var(--low-mark,var(--low))}
.hours24{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--n,24),1fr);margin:0;padding:0;list-style:none}
.hours24 li{position:relative;border-radius:4px}
.hours24 i{display:none;position:absolute;left:calc(var(--x) * 100%);bottom:var(--v);width:11px;height:11px;margin:0 0 -5.5px -5.5px;border-radius:50%;background:var(--c);box-shadow:0 0 0 2px var(--paper)}
.hours24 li[aria-current] i{display:block}
/* The hour under the pointer or focus, on both charts (see _wireWeek): highlighted with its dots, which
   stand in for the picked hour's until the pointer leaves. */
.hours24 li.hover{background:color-mix(in srgb,var(--ink) 10%,transparent)}
.hours24 li.hover i{display:block}
.battday:has(li.hover) .hours24 li[aria-current]:not(.hover) i{display:none}
/* Twelve months to pick from (see monthPicker): a bar each, its short name and year under it. On Month
   balance (.both) the bars grow up or down from the zero line, --zero up from the bottom. Every bar in full colour, so each reads against the
   card; the picked month in ink, its column outlined (a shade behind it would lower the bar's contrast). */
.year{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:3px;margin:8px 0 0;padding:0;list-style:none}
.year button{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;min-width:0;padding:0;border:0;border-radius:4px;background:none;color:var(--ink-2);font:inherit;font-size:var(--t-xs);font-weight:500;cursor:pointer}
.year .bar{position:relative;display:block;width:100%;height:78px;border-bottom:1px solid var(--track)}
.year .bar i{position:absolute;left:20%;bottom:0;width:60%;height:var(--v);border-radius:6px 6px 1px 1px;background:var(--c)}
/* Where this month should end: a faded bar behind the solid one, outlined in its colour. */
/* The ghost's base stays open: it stands on the solid bar (or the zero line), and a short solid bar under a
   closed outline reads as two lines. */
.year .bar i.ghost{background:color-mix(in srgb,var(--c) 30%,transparent);border:1.5px solid var(--c);border-bottom:0}
.year .bar i.ghost.neg{border-bottom:1.5px solid var(--c);border-top:0}
.year.both .bar{border-bottom:0}
.year.both .bar::after{content:"";position:absolute;inset:calc(100% - var(--zero)) 0 auto;border-top:1px solid var(--track)}
.year.both .bar i{bottom:var(--zero)}
.year.both .bar i.neg{top:calc(100% - var(--zero));bottom:auto;border-radius:1px 1px 6px 6px}
.year button:is(:hover,:focus-visible) .bar{background:color-mix(in srgb,var(--ink) 10%,transparent)}
.year [aria-pressed=true]{color:var(--ink);font-weight:700}
.year button[aria-pressed=true] .bar{outline:1.5px solid var(--ink);outline-offset:-1.5px;border-radius:4px}
.year small{min-height:14px;font-size:calc(12px / var(--zt));line-height:14px;white-space:nowrap}
/* This month, the rightmost: its "so far" ends with the bar's column, so it stays on the card. */
.year li:last-child small{align-self:end}
.year{container-type:inline-size}
.year .narrow{display:none}
@container (max-width: 340px){.year .wide{display:none}.year .narrow{display:inline}}
/* Dragging across a chart's row picks (an hour's only with a finger); the page still scrolls up and down. */
:is(.week,.hours24){touch-action:pan-y;user-select:none;-webkit-user-select:none}
/* Figures under a chart (see readout): the picked hour, day or month over them, then a label with its
   chart's dot over each figure, all centred; three to a row (two when two or four, or three at big text, so
   no label takes more than two lines), a short row centred. A figure is never narrower than its longest word. */
.readout{margin-top:12px;text-align:center}
.readout .period{margin-bottom:10px;font-size:var(--t-s);font-weight:600;line-height:1.35;color:var(--ink-2)}
.readout dl{display:flex;flex-wrap:wrap;justify-content:center;gap:14px 10px;margin:0}
.readout dl > div{flex:0 1 calc((100% - 20px) / 3);min-width:min(100%,min-content);display:flex;flex-direction:column;justify-content:space-between;gap:4px}
.readout dl:is([data-n="2"],[data-n="4"]) > div,:host([big]) .readout dl[data-n="3"] > div{flex-basis:calc((100% - 10px) / 2)}
.readout dl[data-n="1"] > div{flex-basis:100%}
.readout dt{display:flex;justify-content:center;align-items:center;gap:5px;font-size:var(--t-xs);line-height:1.3;color:var(--ink-2)}
.readout dt i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--c)}
/* An estimate (where the month should end): its dot faded, outlined in the colour. */
.readout .est dt i{background:color-mix(in srgb,var(--c) 30%,transparent);outline:1.5px solid var(--c);outline-offset:-1.5px}
.readout dt span{min-width:0;overflow-wrap:break-word;text-align:center}
.readout dd{margin:0;font-size:calc(18px / var(--zt));font-weight:600;line-height:1.2;letter-spacing:-.025em;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.readout dd.neg{color:var(--low-mark,var(--low))}
.picked .readout{margin-top:0}
/* A month's total between its charts, set off from the one below. */
.month-total{margin:14px 0;padding:12px 0;border-bottom:1px solid var(--track)}
.month-total .readout{margin:0}
.month-total dd{font-size:calc(28px / var(--zt));font-weight:300;white-space:normal}
/* Where the month should end: an estimate, set smaller than the total on record beside it; under it at big
   text, so neither figure is cut from its unit. */
.month-total .est dd{font-size:var(--t-l);font-weight:400}
:host([big]) .month-total dl > div{flex-basis:100%}
.battday .ticks{position:relative;height:16px;margin-top:4px;font-size:var(--t-xs);color:var(--ink-2)}
.battday .ticks span{position:absolute}
/* Payback once paid: a check in the full ring. */
.payback .ring-mid .done{width:55px;height:55px;color:var(--sun-mark,var(--sun))}
/* Payback before it is paid: what came back in the middle, the cost in the gap and named under the ring. */
.payback .ring-mid .amount{font-size:calc(35px / var(--zt));font-weight:300;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
.payback .ring-name{margin-top:-2px;font-size:var(--t-s);color:var(--ink-2);text-align:center}
/* Month balance, the picked month: the grid cost to the left of the middle line, what was saved and
   earned to the right, on one scale; each figure under its bar, the figures (see readout) under both. */
.split{display:grid;grid-template-columns:1fr 1fr;margin-top:10px}
.side{display:grid;gap:4px;min-width:0;font-size:var(--t-s);color:var(--ink-2)}
.side.cost{padding-right:8px;border-right:1px solid var(--ink-2);text-align:right}
.side.back{padding-left:8px}
.side .track{display:flex;height:16px}
.side.cost .track{justify-content:flex-end}
.side .track{position:relative}
.side i{position:relative;width:var(--w);background:var(--c);border-radius:var(--pill)}
/* Where this month should end: a faded bar from the middle line, behind the solid one (see monthCard). */
.side i.ghost{position:absolute;inset-block:0;background:color-mix(in srgb,var(--c) 30%,transparent);border:1.5px solid var(--c)}
.side.cost i.ghost{right:0}
.side.back i.ghost{left:0}
.side b{justify-self:start;font-size:var(--t-m);font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
.side.cost b{justify-self:end}
.months .readout{padding-top:12px;border-top:1px solid var(--track)}
/* The prices now: each a large figure with which way the energy goes under it, Home left, Grid right. */
.price{margin-top:12px}
.price + .price{padding-top:12px;border-top:1px solid var(--track)}
.price > .rate{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px;font-size:var(--t-m);font-weight:500}
.price b{margin-inline-start:auto;font-size:calc(28px / var(--zt));font-weight:300;letter-spacing:-.02em;white-space:nowrap;font-variant-numeric:tabular-nums}
.price small{font-size:var(--t-s);font-weight:400;color:var(--ink-2)}
.route{display:flex;align-items:center;gap:20px;margin-top:6px;font-size:var(--t-s);color:var(--ink-2)}
.route svg{flex:none;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
.route .end{width:26px;height:26px;stroke-width:1.9}
.route .end:first-child{stroke-width:2.6} /* the house is on a 34 grid, the plug on 24: lines about 2 px wide */
/* Lucide's move-left head, fixed in size, on a rounded line that takes the width; its tip on the line's end. */
.route .arrow{flex:1;min-width:0;display:flex;align-items:center;color:var(--grid-mark,var(--grid))}
.route .arrow svg{width:9px;height:15px;stroke-width:1.33}
.route .arrow i{flex:1;height:2px;border-radius:1px;background:currentColor;margin-inline-start:-7.5px}
.price.out .arrow{color:var(--sent-mark,var(--grid))}
.price.out .arrow i{margin:0 -7.5px 0 0}
.band-now{padding:0 6px;border:1px solid var(--grid-mark,var(--grid));border-radius:6px;font-size:var(--t-s);font-weight:400;white-space:nowrap}
.bands{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(88px,100%),1fr));gap:8px;margin:10px 0 0;padding:0;list-style:none}
.bands li{display:flex;flex-direction:column;padding:6px 8px;border:1px solid var(--track);border-radius:8px;font-size:var(--t-s);color:var(--ink-2)}
.bands .name{display:flex;justify-content:space-between;gap:6px;font-weight:500;color:var(--ink)}
.bands .num{margin-top:auto;padding-top:2px;font-size:var(--t-m);font-weight:500;color:var(--ink);font-variant-numeric:tabular-nums}
.bands .band-pct{font-weight:400;color:var(--ink-2)}
.bands [aria-current]{border-color:var(--grid-mark,var(--grid));color:var(--ink)}

/* Tab bar, with Home Assistant's own menu button beside it when the sidebar is hidden. */
footer{position:relative;flex:none;zoom:var(--cap);display:flex;justify-content:center;align-items:center;gap:6px;padding:6px 8px max(8px,env(safe-area-inset-bottom))}
ha-menu-button{color:var(--ink)}
/* Each tab an icon above a short label. */
.tabs{display:flex;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:none;padding:4px;border-radius:26px;background:var(--card);border:1px solid var(--card-line)}
.tabs button{appearance:none;border:0;background:none;cursor:pointer;display:grid;justify-items:center;align-content:center;gap:2px;
  min-height:50px;min-width:60px;padding:5px 10px 4px;border-radius:22px;color:var(--ink);font:500 var(--t-xs)/1.2 var(--f);white-space:nowrap}
.tabs svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.tabs button[aria-current]{background:var(--ink);color:var(--paper)}

/* Display switches: the gear in the top right corner, the same on every page (it is not in the pager),
   and its dialog. Page headings keep clear of the gear (see .title and .now header). */
.gear{position:absolute;z-index:3;zoom:var(--cap);top:max(4px,env(safe-area-inset-top));right:max(4px,env(safe-area-inset-right));display:grid;place-items:center;
  width:44px;height:44px;padding:0;border:0;background:none;color:var(--ink);cursor:pointer}
.gear svg{width:22px;height:22px;fill:none;stroke:currentColor}
.gear.away:not(:focus-visible){opacity:0;visibility:hidden}
:is(.gear,.help,.step,.show input[role="switch"],dialog form > button,.tabs button):focus-visible{border-radius:var(--pill)}
dialog:is(.show,.read){width:min(360px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:20px 20px 16px;border:1px solid var(--track);border-radius:18px;
  background:var(--paper);color:var(--ink);font:calc(16px / var(--zt))/1.45 var(--f)}
dialog:is(.show,.read)::backdrop{background:rgba(4,6,15,.5)}
:is(.show,.read) h2{font-size:var(--t-l);font-weight:600;line-height:1.25;letter-spacing:-.01em}
.show p{margin-top:4px;font-size:var(--t-m);color:var(--ink-2)}
.show fieldset{min-width:0;margin:14px 0 0;padding:0;border:0}
.show legend{padding:0;font-size:var(--t-s);font-weight:600;color:var(--ink-2)}
.show label{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;cursor:pointer}
/* A switch: the knob's side says on or off, the fill only repeats it. */
.show input[role="switch"]{appearance:none;flex:none;position:relative;width:48px;height:28px;margin:0;border:2px solid var(--ink-2);border-radius:var(--pill);background:none;cursor:pointer}
.show input[role="switch"]::before{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--ink-2)}
.show input[role="switch"]:checked{border-color:var(--ink);background:var(--ink)}
.show input[role="switch"]:checked::before{left:23px;background:var(--paper)}
/* The language: a plain select, with each language's flag beside its name where the browser can draw options
   (appearance:base-select); elsewhere the names alone. */
.show .language select{width:100%;min-height:44px;margin-top:8px;padding:8px 12px;border:1px solid var(--ink-2);border-radius:var(--r-s);background:var(--paper);color:var(--ink);font:inherit}
@supports (appearance:base-select){
  .show .language select,.show .language select::picker(select){appearance:base-select}
  .show .language select::picker(select){border:1px solid var(--ink-2);border-radius:var(--r-s);background:var(--paper);color:var(--ink);max-height:min(400px,60dvh);overflow-y:auto}
  .show .language :is(select > button,selectedcontent,option){display:flex;align-items:center;gap:10px}
  .show .language select > button{width:100%;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:start}
  .show .language option{min-height:44px;padding:8px 12px}
  .show .language option:is(:hover,:focus,:checked){background:var(--track)}
  .show .language option::checkmark{order:2;margin-left:auto}
  .show .language svg{flex:none;width:24px;height:16px;border-radius:2px}
}
/* The setup check (admins): each feature over what it is set to, or what it needs. */
.show .check dl{display:grid;gap:8px;margin:8px 0 0}
.show .check dt{font-size:var(--t-m);font-weight:500}
.show .check dd{margin:0;font-size:var(--t-s);color:var(--ink-2);overflow-wrap:anywhere}
dialog form > button{display:block;min-height:44px;margin:16px 0 0 auto;padding:0 22px;border:0;border-radius:var(--pill);
  background:var(--ink);color:var(--paper);font:600 var(--t-m) var(--f);cursor:pointer}
/* How to read the battery ring: a rising and a falling example, then one line per mark with its swatch. */
.read .pair{display:flex;justify-content:center;gap:28px;margin:14px 0 6px}
.read figure{margin:0;width:104px;text-align:center;font-size:var(--t-s);color:var(--ink-2)}
.read figure .ring{margin-bottom:4px}
.read ul{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:8px}
.read li{display:flex;align-items:center;gap:12px;font-size:var(--t-m);line-height:1.3}
.read li i{flex:none;width:24px;height:10px;margin:0 3px;border-radius:5px;background:var(--batt-mark,var(--batt))}
.read li .gain{background:color-mix(in srgb,var(--batt-mark,var(--batt)) 50%,transparent)}
.read li .use{background:color-mix(in srgb,var(--low-mark,var(--low)) 50%,transparent)}
.read li .range{width:30px;height:3px;margin:0;background:var(--ink-2)}
.read li .low{background:var(--low-mark,var(--low))}
/* The other cards' marks, drawn small (see SW). */
.read .sw{flex:none;width:30px;height:16px;overflow:visible;fill:var(--c);stroke:var(--c);stroke-width:2;stroke-linecap:round}
.read .sw .faded{fill:color-mix(in srgb,var(--c) 30%,transparent);stroke-width:1.5}
.read .sw .track{fill:var(--track);stroke:var(--track)}
.read .sw .ink{fill:var(--ink)}
.read .sw .hollow{fill:var(--paper)}
.read .wx{flex:none;width:30px;height:28px}
.read .sw-num{flex:none;width:30px;text-align:center;font-weight:600}

/* Short panels (small phones, or the app with its own bars): tighten so a page still fits. */
@container (max-height:700px) and (max-width:1003px){
  .battday .plot{height:96px}
  .battday .plot.charge{height:60px}
  .page{gap:10px;padding-top:max(16px,env(safe-area-inset-top));padding-bottom:6px}
  .now h1{font-size:calc(26px / var(--zt))}
  .now .sub{margin-top:4px;font-size:var(--t-m)}
  .card{padding:12px 16px 14px}
  .card h2{margin-bottom:6px}
  .batt-word{font-size:calc(21px / var(--zt))}
  :is(.advice,.wear){padding:10px 14px}
  :is(.advice,.wear) p{font-size:calc(16px / var(--zt))}
  .title{font-size:calc(28px / var(--zt))}
  .share .ring-box{width:120px;margin-top:36px}
  .share .ring-mid .big{font-size:calc(36px / var(--zt))}
  .week{height:100px}
  .tabs button{min-height:46px;padding-block:3px 2px}
}

/* Big text (see BIG_TEXT in solar-view.js; the panel is then narrow and short): Now leads with the headline
   alone and the advice, then a smaller flow. The headline starts under the gear and takes the page's width. */
:host([big]) .now{grid-template-rows:none}
:host([big]) .now header{order:-2;padding:calc(52px * var(--cap) - 16px) 0 0}
:host([big]) .now .sub{display:none}
:host([big]) .now h1{font-size:calc(20px / var(--zt))}
:host([big]) .now :is(.wear,.advice){order:-1}
/* Bigger text still (about 1.8 and up on a phone): the battery card comes next, before the flow, with a
   smaller ring and its title for screen readers only, so the ring and its word show without a scroll. */
@container (max-height:560px) and (max-width:1003px){
  :host([big]) .now .battery{order:-1}
  :host([big]) .battery h2{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  :host([big]) .battery .ring-box{width:110px}
  :host([big]) .battery .ring-mid .big{font-size:calc(33px / var(--zt))}
}
/* The flow as tall as its width gives it, at most 150px: its row grows to it (min-height:auto). */
:host([big]) .flowbox{min-height:auto}
:host([big]) .flowfit{height:auto;max-height:150px}
/* A tile beside the start of its sentence, which runs on under it. The washer line's tile goes above it
   instead: its bold sentence and the line under it stay one block, at the card's full width. */
:host([big]) :is(.advice,.wear){display:flow-root}
:host([big]) :is(.advice,.wear) .tile{float:left;margin:2px 12px 2px 0}
:host([big]) .best{flex-direction:column;align-items:flex-start;gap:8px}
/* The coming days in narrower columns, without the usual use's name (the help names the line). */
:host([big]) .days li{grid-template-columns:2.4em 26px minmax(0,1fr) 2em;gap:4px}
:host([big]) .days .now-label{display:none}
:host([big]) .days.with-use{margin-top:4px}
/* Owner detail, for the wide screen only (see below): the battery's likely range in an hour, Power origin's
   small rings, and their help lines. */
.ring .range,.read li:has(> [data-t=helpRange],> [data-t^=helpShareAhead]){display:none}

/* The owner detail above, on the wide screen. By the panel's name: the small rings sit in Power origin's own
   container (see .share). */
@container panel (min-width:1004px){
  .rings-ahead{display:flex}
  .ring .range{display:inline}
  .read li:has(> [data-t=helpRange],> [data-t^=helpShareAhead]):not([hidden]){display:flex}
}

/* Wide panels: no paging, the pages stand side by side. */
@container (min-width:1004px){
  /* Full width, so the wheel scrolls it over the bands beside the columns too; the padding keeps the
     columns within 1764px, centred. */
  .pager{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0 28px;
    overflow:hidden auto;scroll-snap-type:none;width:100%;padding:0 max(24px,calc((100% - 1764px) / 2))}
  .page{overflow:visible;padding:56px 0 24px;gap:14px;grid-template-columns:minmax(0,1fr)}
  .now{grid-template-rows:auto minmax(220px,auto) auto auto;align-content:start}
  /* The gear sits above the columns here, mirroring the menu button. */
  .now header{padding:0 4px;text-align:left}
  .gear{right:12px}
  .skel .now .sub{margin-inline:0}
  /* One size for the column heads, so their first lines share a baseline. */
  .title,.now h1{font-size:var(--t-title)}
  .tabs{display:none}
  /* The menu button, when there is one, moves to the corner above the first column. */
  footer{position:absolute;top:4px;left:12px;padding:0}
}

@media (prefers-reduced-motion:no-preference){
  .tabs button{transition:background-color .2s var(--ease),color .2s var(--ease)}
  .gear{transition:opacity .2s var(--ease),visibility .2s}
  /* Light travelling along whichever paths are live. */
  .flow .streak{display:block;animation:run 2.8s linear infinite}
  .flow .halo{animation:breathe 6s ease-in-out infinite;transform-origin:170px 36px}
  .rain i{display:block;animation:fall 2.4s linear infinite}
  .snow i{display:block;animation:fall var(--t) linear infinite}
  .snow i::before{animation:sway calc(var(--t) / 3) ease-in-out infinite alternate}
  @keyframes sway{from{transform:translateX(-6px)}to{transform:translateX(6px)}}
  @keyframes fall{from{transform:translateY(-28px)}to{transform:translateY(100%)}}
  @keyframes run{to{stroke-dashoffset:0}}
  /* Same clock as the streak, whose front reaches the end of the path at 78 % of each run. */
  .flow .lit{animation:tip 2.8s linear infinite}
  @keyframes tip{0%,74%{opacity:0}80%,95%{opacity:1}100%{opacity:0}}
  /* Paused while their page is out of view; they go on from there when it comes back. */
  .page[data-out] .flow *{animation-play-state:paused}
  .hint{transition:opacity .2s var(--ease),visibility .2s}
  @keyframes breathe{50%{transform:scale(1.12);opacity:.75}}
  .veil{transition:opacity 1.4s var(--ease)}
  /* The sky glides from one update to the next (a new hour's clouds, the theme), not in a step. */
  :host([glide]) .sky{transition:--sv-sky1 2s var(--ease),--sv-sky2 2s var(--ease),--sv-sky3 2s var(--ease)}
  .skel .page{animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{50%{opacity:.55}}
  .pager.fresh .page > *{animation:rise .7s var(--ease) both}
  @keyframes rise{from{opacity:0;transform:translateY(8px)}}
}
`;

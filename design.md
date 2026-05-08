# Observatory Design Recipe

A portable guide to the DS Observatory's visual language — the tokens, typography, layout primitives, and interaction patterns — so you can build dashboards that feel like they belong to the same family.

It is **not** a component library. It is a copy-paste recipe. Zero build step, plain HTML/CSS/JS.

> Live example: <https://asundiev-devrev.github.io/ds-observatory/>
> Source: [src/dashboard/](src/dashboard/)

---

## Philosophy

- **Calm surfaces, assertive numbers.** Backgrounds stay white/near-white. Color earns its place by meaning (good/bad/warn), not decoration.
- **Typography as hierarchy, not size-only.** Three font families — a display face for numbers and titles, a body face for text, a mono face for small labels, counts, and ticks. The shift in *face* does as much work as the shift in *weight*.
- **Phi-based spacing.** Spacing tokens derive from 1rem multiplied by powers of ~1.41. Gives natural, non-arbitrary rhythm without a "pixel grid" feeling.
- **Canvas for charts, CSS for everything else.** Dashboards live and die by their charts. Don't reach for a charting library — 200 lines of Canvas 2D code gives you full control, sub-1ms renders, and zero dependencies. Pattern is in [src/dashboard/app.js](src/dashboard/app.js).
- **Show direction, not decoration.** Every metric that can trend should show a `↑` or `↓` plus a magnitude, colored by whether the change is *good* or *bad* for that metric (good = green, bad = red, orange for neutral). Arrow tracks raw sign, color tracks meaning — they're independent axes.

---

## 1. Tokens

Paste these into `:root` at the top of your stylesheet.

### Palette — HSL triplets

Stored as raw `H S% L%` triplets so you can compose opacity variants with `hsla(var(--token) / 0.5)`.

```css
:root {
  --day: 0 0% 100%;
  --night: 0 0% 6%;

  /* Husk — greyscale */
  --husk-100: 0 0% 100%;
  --husk-200: 0 0% 98%;
  --husk-300: 0 0% 96%;
  --husk-400: 0 0% 91%;
  --husk-500: 0 0% 81%;
  --husk-600: 320 2% 64%;
  --husk-700: 312 2% 47%;
  --husk-800: 324 3% 31%;
  --husk-900: 330 2% 24%;
  --husk-1000: 330 2% 18%;

  /* Accent families — named after fruits so you don't get attached to them */
  --banginapalli-400: 48 100% 51%;  /* yellow — warn / neutral */
  --banginapalli-500: 49 100% 38%;
  --banginapalli-600: 55 100% 25%;

  --hardy-500: 89 85% 46%;          /* green — good */
  --hardy-600: 89 89% 32%;

  --shuiguo-500: 198 94% 57%;       /* blue — info */
  --shuiguo-600: 197 91% 40%;

  --persimmon-500: 13 90% 54%;      /* red — bad */

  --jabuticaba-400: 259 94% 44%;    /* violet — local/untagged */
}
```

### Semantic aliases

Always reference these in CSS, not the raw hues. Makes theming a 10-minute job instead of a 3-hour find-and-replace.

```css
:root {
  --bg-layer-00: var(--day);
  --bg-layer-01: var(--day);
  --bg-outline-00: var(--husk-200);
  --bg-outline-01: var(--husk-400);
  --border-outline-00: var(--husk-400);
  --border-outline-01: var(--husk-400);
  --border-field-idle: var(--husk-700);
  --text-color-primary:   var(--husk-900);
  --text-color-secondary: var(--husk-700);
  --text-color-tertiary:  var(--husk-600);
  --text-color-muted:     var(--husk-500);
}
```

### Spacing — phi-based

```css
:root {
  --g: 1rem;
  --sp-5xs:  calc(var(--g) * 0.125);
  --sp-4xs:  calc(var(--g) * 0.17);
  --sp-3xs:  calc(var(--g) * 0.25);
  --sp-2xs:  calc(var(--g) * 0.35);
  --sp-xs:   calc(var(--g) * 0.5);
  --sp-sm:   calc(var(--g) * 0.7);
  --sp-base: var(--g);
  --sp-lg:   calc(var(--g) * 1.41);
  --sp-xl:   calc(var(--g) * 2);
  --sp-2xl:  calc(var(--g) * 2.83);
  --sp-3xl:  calc(var(--g) * 4);
}
```

Rule of thumb: `sp-sm`/`sp-base` for internal card padding, `sp-lg`/`sp-xl` for vertical rhythm between cards, `sp-2xl` for the main content horizontal padding.

### Shadows — almost invisible

```css
:root {
  --shadow-depth-01: 0 1px 3px hsla(var(--night) / 0.04), 0 1px 2px hsla(var(--night) / 0.06);
  --shadow-depth-02: 0 4px 16px hsla(var(--night) / 0.07), 0 1px 3px hsla(var(--night) / 0.04);
}
```

Use sparingly. Most of our cards use a 1px border instead of a shadow. Shadows go on things that are meant to float above the plane — modals, tooltips, maybe a hero card.

### Typography

Three families plus a small-text alternate:

```css
:root {
  --font-text:    'Chip Text Variable',    -apple-system, system-ui, sans-serif;
  --font-display: 'Chip Display Variable', -apple-system, system-ui, sans-serif;
  --font-mono:    'Chip Mono',             'SF Mono', monospace;
  --font-small:   'Roboto Mono',           'SF Mono', monospace;
}
```

| Token          | Used for                                                          |
| -------------- | ----------------------------------------------------------------- |
| `--font-text`  | Body copy, card titles under 18px                                 |
| `--font-display` | Hero numbers (32–64px), card titles, headlines                  |
| `--font-mono`  | Code snippets, token names (`bg-surface-01`), filter inputs        |
| `--font-small` | 10–12px labels, chart ticks, table metadata, meta text            |

`Chip` is DevRev's proprietary variable font (weight axis 100–900). Outside DevRev, substitute with Inter, IBM Plex, or Söhne. For `--font-small`, Roboto Mono ships on Google Fonts and sets the "monospace-for-labels" vibe for free.

If you can't use Chip, here's a clean fallback:

```css
--font-text:    'Inter', system-ui, sans-serif;
--font-display: 'Inter Display', 'Inter', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', 'SF Mono', monospace;
--font-small:   'Roboto Mono', 'SF Mono', monospace;
```

### The weight trick

Our body face is a variable font, so we use `font-variation-settings: 'wght' N` instead of `font-weight`. This gives finer-grained control than the `100/200/…/900` ladder:

```css
body       { font-variation-settings: 'wght' 440; }  /* slightly heavier than regular */
.card-title { font-variation-settings: 'wght' 700; } /* bold */
.kpi-label  { font-variation-settings: 'wght' 600; text-transform: uppercase; letter-spacing: 0.06em; }
```

For non-variable fonts, fall back to `font-weight: 500/600/700`.

### Numbers

*Every* numeric value in a dashboard should use:

```css
font-variant-numeric: tabular-nums;
```

Without this, numbers wiggle horizontally as they change between frames — instant amateur-hour tell.

---

## 2. Layout primitives

### App shell

```html
<body>
  <div class="app">
    <header class="header">
      <div class="header-content">
        <h1 class="header-title">Your Dashboard</h1>
        <div class="header-meta" id="header-meta"><!-- selector / timestamp lives here --></div>
      </div>
    </header>

    <nav class="tab-bar" role="tablist" aria-label="Sections">
      <!-- tabs here -->
    </nav>

    <main class="main">
      <section class="panel" role="tabpanel" id="panel-foo">
        <!-- your content -->
      </section>
    </main>
  </div>
</body>
```

```css
body { height: 100vh; overflow: hidden; background: hsl(var(--bg-layer-01)); }

.app { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

.header { padding: var(--sp-xl) 0 var(--sp-lg); flex-shrink: 0; }
.header-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--sp-xl);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-lg);
}
.header-title {
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 32px;
  font-variation-settings: 'wght' 700;
}
.header-meta {
  font-family: var(--font-small);
  font-size: 12px;
  color: hsl(var(--text-color-tertiary));
}

.main { flex: 1; overflow-y: auto; }
.main > [role="tabpanel"] {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--sp-xl);
}
```

The `height: 100vh; overflow: hidden` on body plus the flex-column app gives you a **scrollable main with a fixed header and tab bar**. This is the single most important structural choice — it makes long pages pleasant to scan.

### Tab bar

```html
<nav class="tab-bar" role="tablist">
  <span class="tab-group-label">Group A</span>
  <button class="tab" role="tab" aria-selected="true">Tab 1</button>
  <button class="tab" role="tab" aria-selected="false">Tab 2</button>

  <span class="tab-group-spacer" aria-hidden="true"></span>

  <span class="tab-group-label">Group B</span>
  <button class="tab" role="tab" aria-selected="false">Tab 3</button>
</nav>
```

```css
.tab-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-3xs);
  padding: var(--sp-3xs) calc(max(var(--sp-xl), (100% - 1200px) / 2 + var(--sp-xl)));
  flex-shrink: 0;
}

.tab-group-label {
  font-family: var(--font-small);
  font-size: 10px;
  font-variation-settings: 'wght' 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: hsl(var(--text-color-tertiary));
  padding: 0 var(--sp-2xs) 0 var(--sp-xs);
}
.tab-group-spacer { flex: 1; min-width: var(--sp-lg); }

.tab {
  padding: var(--sp-xs) var(--sp-base);
  font-size: 14px;
  line-height: 20px;
  font-variation-settings: 'wght' 480;
  color: hsl(var(--text-color-secondary));
  border: none;
  border-radius: 20px;
  background: none;
  cursor: pointer;
}
.tab:hover { color: hsl(var(--text-color-primary)); background: hsla(0, 0%, 6%, 0.05); }
.tab[aria-selected="true"] {
  color: hsl(var(--day));
  background: hsl(var(--night));
  font-variation-settings: 'wght' 540;
}
```

**Key moves:**
- Pills, not underlines. Underlines feel cramped; pills breathe.
- Active pill flips to black background + white text. Single, unambiguous signal.
- Group labels in tiny caps (10px, uppercase, `--font-small`). The label disappears into the layout when you're not looking for it, but makes scanning instant when you are.
- A flex spacer between groups is how you right-align the second group without absolute positioning.

The clever `padding` calc on `.tab-bar` keeps tabs aligned with the content column (1200px max-width) at any viewport size.

### Card

Everything lives in cards. Padding and radius are non-negotiable:

```css
.card {
  background: hsl(var(--bg-layer-01));
  border: 1px solid hsl(var(--border-outline-00));
  border-radius: 16px;
  padding: var(--sp-xl) var(--sp-2xl);
  margin-bottom: var(--sp-lg);
}
.card-title {
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 20px;
  font-variation-settings: 'wght' 660;
  margin-bottom: var(--sp-sm);
}
.card-desc {
  font-size: 13px;
  color: hsl(var(--text-color-tertiary));
  margin-bottom: var(--sp-sm);
}
```

**Radius 16px, not 8 or 12.** The 16px radius is a load-bearing part of the aesthetic — smaller radii read as "form", bigger reads as "app card", 16 hits the sweet spot.

### KPI row

The KPI row is the most stealable pattern. Four equal columns, each a card with a label / value / trend:

```html
<div class="kpi-row">
  <div class="kpi">
    <div class="kpi-label">Adoption</div>
    <div class="kpi-value">77.6%</div>
    <div class="kpi-trend">
      <span class="trend-up">↑ 11.2pp</span>
      <span class="kpi-trend-note">over 14 weeks</span>
    </div>
  </div>
  <!-- x4 -->
</div>
```

```css
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-sm);
  margin-bottom: var(--sp-lg);
}
.kpi {
  background: hsl(var(--bg-layer-01));
  border: 1px solid hsl(var(--border-outline-00));
  border-radius: 16px;
  padding: var(--sp-lg) var(--sp-xl);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2xs);
}
.kpi-label {
  font-family: var(--font-small);
  font-size: 11px;
  font-variation-settings: 'wght' 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: hsl(var(--text-color-tertiary));
}
.kpi-value {
  font-family: var(--font-display);
  font-size: 40px;
  line-height: 44px;
  font-variation-settings: 'wght' 700;
  font-variant-numeric: tabular-nums;
}
.kpi-trend {
  font-family: var(--font-small);
  font-size: 11px;
  color: hsl(var(--text-color-tertiary));
}
.kpi-trend-note { color: hsl(var(--text-color-muted)); }

.trend-up   { color: hsl(var(--hardy-600)); }
.trend-down { color: hsl(var(--persimmon-500)); }
```

The trick that makes it look "designed": `kpi-label` and `kpi-trend` both use `--font-small` (mono), while the number uses the display face at 40px. The contrast between mono-tiny and serif-huge does the heavy lifting.

### Arrow-direction-vs-color

For metrics where a *drop* is good (detachment rate, bug count, latency):

```js
function trendCell(curr, prev, opts) {
  opts = opts || {};
  var diff = curr - prev;
  if (Math.abs(diff) <= 0.5) return '';
  var goodDirection = opts.invert ? diff < 0 : diff > 0;
  var cls   = goodDirection ? 'trend-up' : 'trend-down';   // color = good/bad
  var arrow = diff > 0 ? '↑' : '↓';                        // arrow = raw sign
  return '<span class="' + cls + '">' + arrow + ' ' + Math.abs(diff).toFixed(1) + '</span>';
}
```

Arrow tracks the *raw sign* of the change. Color tracks *meaning*. They're independent — a ↓ can be green (good news for detachment), a ↑ can be red (bad news for DLS22 usage). This catches readers off guard the first time but clicks on the second.

---

## 3. Charts (Canvas 2D)

Two patterns cover 90% of dashboard charts: **line charts over time** and **bar/track lists**.

### The setup helper — the trap you'll fall into once

This is the subtle one. You'll write something like:

```js
function setupCanvas(canvas) {
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.parentElement.clientWidth;
  var h = canvas.getAttribute('height');  // ❌ THIS IS THE BUG
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ...
}
```

…and on every re-render the chart doubles in height. The `canvas.height = h * dpr` line mutates the HTML attribute, so the next call reads back the inflated value. Fix: cache the intrinsic height once:

```js
function setupCanvas(canvas) {
  var dpr = window.devicePixelRatio || 1;
  if (!canvas.dataset.baseHeight) {
    canvas.dataset.baseHeight = canvas.getAttribute('height') || '240';
  }
  var h = parseInt(canvas.dataset.baseHeight, 10) || 240;
  var w = canvas.parentElement.clientWidth || 800;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  var ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  return { ctx: ctx, w: w, h: h };
}
```

### Line chart template

```js
function drawTrend(canvas, points, labels, opts) {
  opts = opts || {};
  var setup = setupCanvas(canvas);
  var ctx = setup.ctx;
  var padL = 48, padR = 64, padT = 20, padB = 44;
  var cw = setup.w - padL - padR;
  var ch = setup.h - padT - padB;

  // Y axis — 5 ticks, 0–max
  ctx.font = '11px Roboto Mono, monospace';
  ctx.fillStyle = 'hsl(320, 2%, 64%)';  // --text-color-tertiary
  ctx.textAlign = 'right';
  for (var i = 0; i <= 4; i++) {
    var val = (opts.max || 100) * i / 4;
    var py = padT + ch - (i / 4) * ch;
    ctx.fillText(val + (opts.suffix || '%'), padL - 8, py + 4);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(setup.w - padR, py);
    ctx.strokeStyle = 'hsl(0, 0%, 91%)';  // --husk-400
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // X labels — every Nth point
  ctx.textAlign = 'center';
  var step = Math.max(1, Math.floor(labels.length / 5));
  labels.forEach(function (lbl, i) {
    if (i % step === 0 || i === labels.length - 1) {
      var px = padL + (i / (labels.length - 1)) * cw;
      ctx.fillText(lbl, px, setup.h - padB + 20);
    }
  });

  // Area fill
  if (opts.area) {
    ctx.beginPath();
    ctx.moveTo(padL, padT + ch);
    points.forEach(function (p, i) {
      var px = padL + (i / (points.length - 1)) * cw;
      var py = padT + ch - (p / (opts.max || 100)) * ch;
      ctx.lineTo(px, py);
    });
    ctx.lineTo(padL + cw, padT + ch);
    ctx.closePath();
    ctx.fillStyle = opts.area;
    ctx.fill();
  }

  // Line
  ctx.beginPath();
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  points.forEach(function (p, i) {
    var px = padL + (i / (points.length - 1)) * cw;
    var py = padT + ch - (p / (opts.max || 100)) * ch;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // End dot + label
  var last = points[points.length - 1];
  var lx = padL + cw;
  var ly = padT + ch - (last / (opts.max || 100)) * ch;
  ctx.beginPath();
  ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = opts.color;
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillText(last.toFixed(1) + (opts.suffix || '%'), lx + 8, ly + 4);
}
```

Usage:

```js
drawTrend(canvas, [66.4, 67.2, 70.0, 77.6], ['Feb 6', 'Mar 6', 'Apr 3', 'May 7'], {
  max: 100,
  color: 'hsl(89, 89%, 32%)',              // --hardy-600
  area: 'hsla(89, 85%, 46%, 0.12)',        // --hardy-500 at 12%
});
```

**Design choices baked in:**
- Y-axis labels *outside* the plot area, right-aligned in mono font
- Horizontal gridlines *only* (never vertical — they add noise)
- Grid lines use `--husk-400`, which is almost invisible against white but guides the eye
- Line + end-dot + in-line value label. The value at the end is essential — otherwise readers squint at the Y-axis
- 2.5px line width with rounded joins. Thinner reads as fragile, thicker as cartoonish.

### Bar list row

Used in the "Top N" lists across the dashboard — a name, a horizontal bar, a count:

```html
<div class="bar-row">
  <div class="bar-row-name">Button</div>
  <div class="bar-row-track"><div style="width: 78%; background: var(--c-dls)"></div></div>
  <div class="bar-row-count">568</div>
  <div class="bar-row-share">32.1%</div>
</div>
```

```css
.bar-row {
  display: grid;
  grid-template-columns: 1fr 160px 64px 52px;
  gap: var(--sp-sm);
  align-items: center;
}
.bar-row-name {
  font-size: 12px;
  font-variation-settings: 'wght' 480;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bar-row-track {
  height: 8px;
  border-radius: 4px;
  background: hsl(var(--husk-300));
  overflow: hidden;
}
.bar-row-track > div { height: 100%; }
.bar-row-count, .bar-row-share {
  font-family: var(--font-small);
  font-size: 11px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: hsl(var(--text-color-tertiary));
}
```

Fixed widths on the right columns make the bars align vertically, which makes the list scannable as a bar chart.

---

## 4. Data table

```css
.data-table { border-collapse: collapse; width: 100%; }
.data-table th, .data-table td { padding: 0 16px; text-align: left; font-size: 13px; }
.data-table thead th {
  height: 44px;
  font-family: var(--font-small);
  font-size: 11px;
  font-variation-settings: 'wght' 660;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: hsl(var(--text-color-secondary));
  border-bottom: 1px solid hsl(var(--border-outline-00));
  position: sticky; top: 0;
  background: hsl(var(--bg-layer-01));
}
.data-table th.num, .data-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.data-table tbody tr {
  height: 44px;
  border-bottom: 1px solid hsl(var(--husk-400));
}
.data-table tbody tr:hover { background: hsla(0, 0%, 6%, 0.02); }
```

Details:
- Headers in mono uppercase, slightly darker than body. This separates them from data without needing a bold weight or a background fill.
- **Every** row is 44px. Consistent height is what makes tables feel like spreadsheets in the best way.
- Numeric columns right-aligned with tabular-nums. Non-negotiable.
- Hover is a 2% tint of black. Barely visible but sufficient.

---

## 5. Badges and chips

Pill shapes, tiny text, never a heavy background:

```css
.badge {
  display: inline-flex;
  align-items: center;
  font-family: var(--font-small);
  font-size: 10px;
  font-variation-settings: 'wght' 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.badge.good { background: hsla(89, 85%, 46%, 0.15); color: hsl(89, 89%, 22%); }
.badge.warn { background: hsla(48, 100%, 51%, 0.2); color: hsl(55, 100%, 25%); }
.badge.bad  { background: hsla(13, 90%, 54%, 0.15); color: hsl(13, 90%, 38%); }
```

For tagging components, libraries, modules — anything categorical. The 15-20% alpha background + saturated text color is the pattern — it keeps the badge visible without shouting.

---

## 6. Filter pills

For "show X of type Y" filters:

```css
.pill {
  height: 32px;
  padding: 0 var(--sp-sm);
  border-radius: 20px;
  font-size: 13px;
  line-height: 32px;
  color: hsl(var(--text-color-primary));
  border: 1px solid hsl(var(--border-outline-00));
  background: transparent;
  cursor: pointer;
}
.pill:hover {
  border-color: hsl(var(--border-outline-01));
  background: hsla(0, 0%, 6%, 0.04);
}
.pill.active {
  background: hsl(var(--night));
  border-color: hsl(var(--night));
  color: hsl(var(--day));
  font-variation-settings: 'wght' 540;
}
```

Same mental model as tabs — outlined resting state, inverted active state.

---

## 7. Do / don't

**Do**
- Use `hsla(var(--token) / 0.12)` for tinted backgrounds. 8–15% alpha.
- Start with 4-column grids for KPI rows. Drop to 2 below 800px.
- Max-width your content column (1200px) even on large screens.
- Put the current value at the end of every trend chart line.
- Use mono for anything that could be a number or a key-ish label.

**Don't**
- Don't use pure `#000` anywhere. `hsl(var(--night))` is `hsl(0 0% 6%)` — the 6% lightness keeps it from vibrating against white.
- Don't draw vertical gridlines. Horizontals only.
- Don't use drop shadows on resting-state cards. 1px borders look more modern.
- Don't add icons to stat cards. The number is the point.
- Don't animate card entry. It feels cute once, annoying on every tab switch.

---

## 8. Tech stack

Zero-build, on purpose:

- **Plain HTML + CSS + vanilla JS.** No React, no bundler, no npm. The whole dashboard is three files served with a 60-line Node HTTP server. File changes are instant — just refresh.
- **Variable font + font-variation-settings** for weight. If you're stuck with static fonts, drop `--font-small: 'Roboto Mono'` and use `font-weight: 500/600/700` as a substitute.
- **Canvas 2D for charts.** Every chart is ~200 lines of code. No Chart.js, no D3, no nothing. Renders in sub-1ms, zero dep updates.
- **Data in JSON files.** The dashboard reads flat JSON from a `/data/` directory. No API. No state management. If you need freshness, a cron job overwrites the JSON — the dashboard picks it up on reload.

---

## 9. Sources

- [src/dashboard/index.html](src/dashboard/index.html) — layout markup
- [src/dashboard/styles.css](src/dashboard/styles.css) — full stylesheet (~1,400 lines — most of the tokens and patterns above are pulled from here)
- [src/dashboard/app.js](src/dashboard/app.js) — all rendering logic, including the Canvas chart code
- [src/cli/serve.ts](src/cli/serve.ts) — the 60-line HTTP server

Feel free to copy anything. No attribution needed — the ideas are all stolen from other good dashboards anyway.

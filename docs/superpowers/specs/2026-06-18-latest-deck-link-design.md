# Latest deck link in the Observatory header

**Date:** 2026-06-18
**Status:** Approved

## Goal

Add a way to open the latest published monthly report ("the deck") directly
from the DS Observatory dashboard UI.

## Context

- The deck is a separate artifact deployed to the `gh-pages` branch at
  `reports/ads-monthly-report-latest.html` (title: "Arcade Design System —
  Monthly Report"). The filename is stable, so it always points at the latest
  report.
- Published via GitHub Pages on repo `asundiev-devrev/ds-observatory`. No CNAME
  on `gh-pages`, so the live URL is:
  `https://asundiev-devrev.github.io/ds-observatory/reports/ads-monthly-report-latest.html`
  (verified live, 2026-06-18).
- `src/dashboard/index.html` is shared by two consumers:
  - `ds-observatory serve` — local dashboard at `localhost:3333`.
  - `ds-observatory report` — inlines this same `index.html` into the
    self-contained `index.html` deployed to `gh-pages`.
  - One edit therefore appears in both the local dashboard and the deployed
    report.

## Design

A single static link ("Latest deck ↗") in the dashboard header, styled as a
pill, opening the deck in a new tab.

### Markup (`src/dashboard/index.html`)

Wrap the right side of `.header-content` so the deck link sits beside the
existing meta slot:

```html
<div class="header-content">
  <h1 class="header-title">Design System Observatory</h1>
  <div class="header-right">
    <a class="deck-link"
       href="https://asundiev-devrev.github.io/ds-observatory/reports/ads-monthly-report-latest.html"
       target="_blank" rel="noopener">Latest deck ↗</a>
    <div class="header-meta" id="header-meta"></div>
  </div>
</div>
```

`#header-meta` is left untouched — `app.js` overwrites its contents at runtime
(snapshot selector / code metrics), so the pill is a sibling, not a child.

### CSS (`src/dashboard/styles.css`)

- `.header-right`: flex, `align-items: center`, gap, so the pill and meta align
  on one row on the right.
- `.deck-link`: mirror the existing `.header-meta .snapshot-select` pill —
  `font-text`, 12px, border `border-outline-01`, `border-radius: 20px`,
  `padding: 6px 14px`, hover border change, focus-visible ring. Plus
  `text-decoration: none` and primary text color.

### No JavaScript

Stable filename = always the latest deck. Absolute Pages URL so the link works
both in local `serve` (which does not serve the `reports/` path) and in the
deployed report.

## Rejected alternatives

- **Relative URL (`reports/...`)** — 404s under local `serve`, which only
  serves the dashboard dir and `data/`.
- **Host detection (relative on github.io, absolute elsewhere)** — needless JS
  for a static link.
- **Reusing `#header-meta`** — that slot is rewritten by `app.js`; a link placed
  inside would be clobbered.

## Testing

- `npm run dev -- serve`, open `localhost:3333`: pill renders in header, points
  at the absolute Pages URL, opens deck in a new tab.
- Confirm the snapshot selector / code metrics still render in `#header-meta`
  (pill is a sibling, not replacing it).

# 0053 — What the web guidance found

## Problem

A review of the pages against current web platform guidance found them sound in structure (a semantic token layer,
a correct combobox for jump, reduced motion handled part by part, hashed assets served immutable) and short in four
places.

- **Text that does not scale.** Every font size is in `px`, 109 of them, so a person who sets a larger default text
  size in their browser or OS gets the same 14px page. Breakpoints and scroller heights are in `px` too, so text
  enlarged by zoom is clipped in the log panels and the trace bars.
- **State lost in Forced Colors.** Status dots, the pressed trace bar, the picked log line and the map's rings show
  their state by `background` or `box-shadow` alone, which Windows High Contrast removes.
- **Things a keyboard or a screen reader cannot use.** Enter in jump picks a hit mid-IME-composition; the live log
  list and Ask AI's ticking seconds are live regions, so a screen reader reads every line and every second; the
  environment menu has no Escape or light dismiss; debug's confirm moves no focus; health reasons and the shift-click
  hint live only in `title`; wide tables scroll but take no focus; every page is titled "Estate".
- **Work done again for nothing.** Every heartbeat reconciles the whole snapshot; the log filter builds a `RegExp`
  per line per read; the map lays itself out again on every health change; off-screen lanes are rendered in full.

## Not doing

- **A light theme.** The pages are dark on purpose; `color-scheme: dark` stays.
- **Temporal.** It is not in Safari, and its polyfill costs more than the hand-rolled formatting it would replace.
- **Converting spacing to `rem`.** Padding and gaps stay in `px`; only text, and the boxes text must fit, follow the
  text size.
- **Self-hosting the fonts.** Worth doing, with the CSP entry; not here.

## Shape

```text
browser default text 20px      body 17.5px, log text 15px, nothing clipped
forced-colors: active          dots keep their colour, a picked line or pressed bar has a Highlight outline
Enter while composing in jump  nothing chosen
/services/checkout             <title>checkout · Estate</title>
```

- **Text sizes** are `rem` (or `em` where they already follow their parent), breakpoints `em`, scroller heights
  `lh` or `em`, and the kiosk's fluid size `clamp()` between `rem` bounds. `<meta name="text-scale" content="scale">`
  opts into the OS text size where the browser supports it.
- **Forced Colors** gets one `@media (forced-colors: active)` block per stylesheet that needs it.
- **Browser UI** (scrollbars, `accent-color`, `::selection`) takes the page's tokens.

## Why this shape

The text could be scaled by setting `font-size` on `:root` and leaving the rest in `px`, but that overrides the
person's setting instead of following it. `rem` everywhere text is sized follows it with no override. Recommended:
`rem`.

## Depends on

Nothing.

## Stack

- [x] **`text-that-scales`** — text sizes in `rem`, breakpoints in `em`, scrollers in `lh`, dynamic viewport units,
      the text-scale meta.
      Done when: with the browser's text at 20px, the body's text is 17.5px and a log line's is 15px.
- [x] **`forced-colors-and-browser-ui`** — state kept in Forced Colors; scrollbars, accent and selection themed;
      `font-size-adjust` against the swap; gstatic preconnected.
      Done when: in forced colors a status dot keeps its colour and a picked log line is outlined.
- [x] **`keyboard-and-readers`** — IME-safe Enter in jump, no live region on streaming lines or ticking seconds,
      focusable wide tables, a title per page and a skip link.
      Done when: Enter mid-composition chooses nothing, and a keyboard skips the header to the page.
- [x] **`inline-text-that-scales`** — the 40 text sizes set inline in the pages' parts in `rem`, as the stylesheets'
      are.
      Done when: no part sets a `px` font size inline.
- [x] **`menus-and-dialogs`** — the environment menu a popover, debug's confirm a `<dialog>`, health reasons and
      the shift-click hint out of `title`.
      Done when: Escape closes the environment menu, and a health reason is read without a pointer.
- [x] **`heartbeat-path-set`** — the store told what changed: a beat or a lost stream sets two fields, an event
      reconciles only itself.
      Done when: a beat, a lost stream and one new event do not copy the rest of what the server sent, and
      `bun run perf` holds its budgets.
- [ ] **`log-search-memo`** — the log filter's pattern built once a search, and the shown lines worked out once a
      change, not on every read.
      Done when: a search over the held lines builds its pattern once.
- [ ] **`map-layout-memo`** — the map laid out again only when its nodes or edges change, with nodes found by id.
      Done when: a health change on the map does not lay it out again.
- [ ] **`off-screen-rendering`** — `content-visibility: auto` on lanes, kiosk tiles and log lines, and the map's flow
      paused while it is off screen.
      Done when: an off-screen lane is skipped by the browser and keeps a size to scroll by.

## Acceptance

```bash
bun run gate
bunx playwright test e2e/pages.pw.ts
```

## Open questions

- Should the shell send a CSP? Recommended: yes, `script-src 'self'` in Report-Only first, as its own spec with
  self-hosted fonts, since it changes what the server sends.

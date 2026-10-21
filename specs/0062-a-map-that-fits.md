# 0062 — A map that fits

## Problem

*The estate, live* draws the catalog's map as boxes placed by percentage on a canvas at least 720 pixels wide, with
its rates floating between them. Past a dozen nodes, spec 0020 folds each category into one node, and the picture is
five dashed boxes with summed lines between them: it says an area is amber, not which part, and opening the area
brings the tangle back. On a phone the canvas is wider than the screen, so the map scrolls sideways inside a page that
also scrolls, and its labels and nodes are too small to tap.

## Not doing

- **Removing the drawing.** The lines between nodes stay, as *Lines*, for a small estate on a wide screen and for a
  journey's route (spec 0046).
- **Search on the map.** The header's *Jump to* (spec 0027) already opens any part by name.
- **Panning and zooming,** as spec 0020 said.
- **A new catalog key.** Areas are the categories the catalog already names; `map.collapse` still says what is large.

## Shape

```text
The estate, live              [Areas | Lines]          traffic over the last minute · amber is what needs you

WHERE TRAFFIC MEETS TROUBLE                            only when something on the map needs someone
storefront 109/s ── 46.5/s ─▶ orders ● ── 8.7/s ─▶ payments
indexer ── ─▶ search-index ●

PAYMENTS   1 of 6 need you   ▬▬▬▬▬▬       SHOP   10 healthy   ▬▬▬▬▬▬▬▬▬▬     …one card an area
● orders     46.5/s   ● payments  8.7/s ● storefront  109/s ● basket 41/s
● refunds     0.4/s   ● invoices  1.2/s …
                                         + 4 more, all healthy

orders: called by storefront 46.5/s, web-bff 3.1/s · calls payments 8.7/s, orders-db  [Open orders]
```

- **Areas** are the map's nodes grouped by the category of the service or store each names, in the order the catalog
  first names them; nodes with none are *Everything else*, and a catalog with no categories is one area. An area's
  card says how many of its parts need someone, with a bar of one segment a part in its health's colour.
- **A part** is a button with its health, its name and what the lines view would say under it: its requests, or its
  version, or a store's first reason. What needs someone comes first in its area. Past six, the healthy rest fold
  behind *+ n more, all healthy*, which opens in place; what needs someone is never folded.
- **Picking** a part marks what it talks to in its areas and shows, under the cards, what calls it and what it calls,
  with each edge's rate and a link to open it. Picking it again, or *Close*, puts it down.
- **Where traffic meets trouble**: for each part that needs someone, at most three, the busiest edge into it and the
  busiest out of it, as a row; a part already in a row starts none of its own.
- **Which view**: what the viewer chose last, kept in this browser. Otherwise *Areas* when the map has more nodes
  than `map.collapse`, or the screen is narrower than 720 pixels; *Lines* when not.
- **On a phone** the cards, the rows and the picked part each take the width, and nothing scrolls sideways.

## Why this shape

The question the map answers is *where is it hurting, and what is it touching*. Area cards answer the first for fifty
parts in the height of one screen, every part still named; picking a part and the trouble rows answer the second
without drawing every line. The alternative was to keep the drawing and fix its layout for many nodes and for a
phone: a better layout still draws fifty boxes and their lines in a phone's 360 pixels. Recommended: areas when the
map is large or the screen narrow, and the drawing when it reads.

## Depends on

Spec 0018's categories and spec 0020's `map.collapse`.

## Stack

- [x] **`map-areas`** — the areas view, the trouble rows, picking a part, and the choice of view kept per browser.
      Done when: a 54-node estate on the overview is its areas, nothing folded that needs someone, and picking a part
      lists what calls it and what it calls with their rates.

## Acceptance

```bash
bun run gate
bunx playwright test e2e/journeys.pw.ts
```

## Open questions

- **Should a narrow screen ever start on Lines?** Recommended: no; a viewer who wants it chooses it, and the choice is
  kept.

# 0065 — What each view starts as

## Problem

Spec 0062 starts the map as areas past `map.collapse` nodes, a count of the map's boxes, not of the estate. An
estate of forty services whose map lists eight draws them; one with a long map and few services gets areas. And once a
viewer presses *Areas* or *Lines*, that choice holds for good, so a viewer who chose *Lines* on a small environment
gets the drawing on a large one.

*Needs you now* starts on *Auto*, cards up to three firing. Three cards fill the top of the page, the map and the
lanes go below the fold, and the person who opens the overview during an incident scrolls past cards to see the
estate.

## Not doing

- **A setting for the alerts' default.** Rows is the default for everyone; a viewer chooses Cards or Auto.
- **Changing `map.collapse`.** It still says when the drawing folds a category into one node.
- **Moving what a viewer chose before.** The map's choice is kept under a new key, so everyone starts on *Auto* once.

## Shape

```yaml
map:
  areas: 12        # past this many services, the map's Auto is areas; `never` keeps it drawn. 12 unless set.
  collapse: 12     # as now
  nodes: [ … ]
```

```text
The estate, live      [Auto | Areas | Lines]
Needs you now · 2 firing   [Auto | Cards | Rows]    Rows unless chosen
```

- The map's choice is *Auto*, *Areas* or *Lines*, *Auto* unless chosen, kept in this browser. *Auto* is areas when
  the environment has more services than `map.areas`, or the screen is narrower than 720 pixels; the drawing when not.
- *Needs you now*, a service's and a store's alerts start as rows, one an alert, each opening its card in place as
  spec 0044 does. *Auto* keeps its meaning: cards up to three, rows past.

## Why this shape

Services are what a person counts when they say an estate is large; the map's boxes are a drawing choice. *Auto* as a
choice lets a viewer go back to what fits the environment, as the alerts layout already does. Rows first keeps what
is firing to a line each, so the top of the page is the headline, what fires and the map. The alternative was rows
past a configurable count; a count is a setting someone has to find, and one row an alert reads at any count.
Recommended: these defaults.

## Depends on

Specs 0044 and 0062.

## Stack

- [x] **`view-defaults`** — `map.areas`, the map's *Auto*, and rows first for what is firing.
      Done when: a 14-service overview starts on *Auto* as areas, two firing start as rows, and the page tests that act
      on cards choose them first.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

- **Should `map.areas` default to `map.collapse` when only that is set?** Recommended: no; one counts services, the
  other boxes, and each defaults to 12.

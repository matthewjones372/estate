# 0063 — Charts picked once

## Problem

Spec 0051 put *Include…* under every chart while an incident is open: three under Load, one under each stat, and
three more on a past firing's page. A service with six stats carries nine buttons that say the same thing, and the
panel reads as a row of buttons with charts between them. Including two charts is two trips through the picker and
two lines on why.

## Not doing

- **Lines, error groups and traces.** Each already has one *Include* for what is picked or opened.
- **Collecting across pages.** What is picked is the panel's, and goes from it.
- **What is kept.** Each chart is still its own inclusion, read again on the server as spec 0051 says.

## Shape

```text
LOAD                                   [Include charts…]  1h  6h  24h  7d

LOAD                                                      1h  6h  24h  7d
  Tick the charts to include.
  Why, if you want to say [___________________]
  [Include 2 in Orders slow]  [Cancel]
  [x] Requests ...       [ ] Errors ...       [x] p99 ...
```

- *Include charts…* sits once in the panel's head, offered as *Include…* was: to a writer, while an incident is open.
- Pressing it puts a box on each chart; a ticked chart is outlined. The picker's buttons say how many go
  (*Include 2 in Orders slow*) and wait for at least one.
- One press includes each ticked chart over the range on screen, with the one line on why, in the order ticked; the
  first the server refuses stops the rest and is said. Done or cancelled, the boxes go.

## Why this shape

The question is which charts matter, asked once per panel instead of once per chart. A page-wide collecting mode with
a tray was the alternative; it would gather lines, errors and charts together, but those already have one button
each, and a mode that outlives the panel is more to explain than the clutter it removes. Recommended: one button a
panel.

## Depends on

Spec 0051's *Include in incident*.

## Stack

- [x] **`charts-picked-once`** — *Include charts…* a panel, boxes on its charts, and the ticked ones included at once.
      Done when: Load with three charts and a stat has no button under any chart, and two ticked go as two
      inclusions over the range on screen.

## Acceptance

```bash
bun run gate
```

## Open questions

- **Should a past firing's page tick Errors by default?** Recommended: no; nothing goes that a person did not pick.

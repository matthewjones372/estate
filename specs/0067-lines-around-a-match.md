# 0067 — Lines around a match

## Problem

Spec 0036 made the Live view's levels toggles, so someone chasing a failure turns everything off but Error. What
they see then is the error alone: the request that came in before it, the retry or warning that led to it and what
the service did next are hidden with every other line. To read them they turn the levels back on and scroll to the
error by its time, in a list that keeps moving, and lose it again when they filter. A search for `order 41` has the
same gap.

People reach for `grep -B`, `-A` and `-C` here, and the page has no way to say them.

## Not doing

- **Lines the page does not hold.** As spec 0007 and 0036: no query to Loki for lines before or after. Lines around
  come from the last 500 held in the browser, so an error near the start of them has fewer before it.
- **The Errors view.** Its examples are read as errors only (spec 0054), so it has no lines around them to show.
- **Any number.** None, 2, 5 or 10; more than 10 is most of a screen, and turning the levels on reads better.

## Shape

**Before** and **After**, beside the search:

```text
Before [None ▾]  After [None ▾]     each None, 2 lines, 5 lines, 10 lines; None to start, each kept in this browser
```

With levels hidden or a search typed, each line that is shown (it matches) brings up to the number chosen of the
lines held ahead of it, and up to the other number behind it, whatever their level and whatever the search; the same
number in both is `grep -C`. Runs that overlap join; where lines were
skipped between runs, a dashed rule marks the gap. With nothing filtered it changes nothing.

```text
11:02:01  orders-7f9c  INFO   took order 41               ← around, dimmed
11:02:01  orders-7f9c  WARN   payment slow                ← around, dimmed
11:02:02  orders-7f9c  ERROR  order 41 lost               ← matches, as now
11:02:02  orders-7f9c  INFO   retrying order 41           ← around, dimmed
- - - - - - - - - - - - - - - - - - - - - - - - - - - - -
11:07:40  orders-7f9c  ERROR  disk full                   ← matches
```

A line around keeps its level's badge and edge, in `--ink-3`, with no search marks; a screen reader hears "around a
match" with it. The foot says so: `2 of the last 500 lines match, with 2 lines around each`, or `with 2 lines
before and 5 after each`, `with 5 lines after each`.

Copy, Save, *Include…* and picking act on every line shown, those around included, as `grep -C`'s output does.

**Code**: `src/web/log-around.ts` takes the held lines, which ones match and the numbers before and after, and gives the lines to show,
each marked as a match or around and whether a gap comes before it; a plain function with its own tests.
`parts/Logs.tsx` uses it.

## Why this shape

The question is "what happened near this error", and the lines that answer it are already in the browser, so this
is a choice over them, instant, with no change on the server. A fixed few numbers in two selects keep the controls one
row and need no typing; before and after apart answer both "what led to it" and "what it did next", and one number in
both is the common case. The alternative, clicking an error to jump to it with every level back on, answers one error
at a time and loses the filter; recommended against. Dimming the lines around, rather than hiding their colour,
keeps the errors standing out while the context still reads by level.

## Depends on

Nothing.

## Stack

- [x] **`logs-around`** — `log-around.ts`, the Before and After selects kept in this browser, the dimmed lines and
      gaps, and the foot.
      Done when: tests show runs joining, gaps marked, before and after apart and the edges of the held lines cut short;
      a suite shows Error alone with 2 lines before and after bringing in the Info and Warn beside it, the gap between
      runs, Copy taking them, and After at None leaving only the lines before.

## Acceptance

```bash
bun run gate
```

## Open questions

1. **Before and after apart, as `-B` and `-A`?** Settled: apart, two selects, the same number in both as `-C`.
2. **Keep the choice in the address, as the view and range are?** Recommended not: it is a way of reading, not a
   place to link to, so it is kept per browser as the alerts' layout is (spec 0065).

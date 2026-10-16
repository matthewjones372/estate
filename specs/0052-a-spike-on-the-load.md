# 0052 — A spike on the load

## Problem

A service's request rate can jump by orders of magnitude, and the only place that shows it is the number on the load
chart. Alerts are for things that need someone. A spike is not one of those: the page should stay quiet, and the chart
should say where the rate jumped.

## Not doing

- **An alert, a health change, or a new page.** Needs you now, What's happening, the map and the nav stay as they are.
- **Recolouring the number or the line.** The highlight is a band behind the ordinary line.
- **A threshold drawn across the chart.** On a jump from under one a second to tens of thousands, that line sits on the floor.
- **Highlighting errors, p99, or a store's stats.** Only request rate.
- **A spike that began before the points in view.** With no earlier rate to compare, a high plateau is not a jump.

## Shape

```ts
spikes(points, span) // fractions of the span, each { from, to }
// a point joins a band when it is above 100/s and more than ten times the rate about five minutes earlier.
// When that minute was not scraped, the latest known rate in those five minutes is the comparison.
// A missing stretch is not read as zero. The band continues while later points stay above 100/s.
```

The Requests spark and the Requests chart draw each band with `.plot-spike`, behind the line. Other charts do not.
The overview names each service whose rate jumped, with that spark, and leaves All quiet and Needs you now unchanged.

## Why this shape

The band is the same idea as the shade a firing already draws, kept off `.plot-firing` so a spike is not an alert.
Ten times an earlier rate, with a floor of 100/s, leaves ordinary demo traffic unmarked and still catches a jump into
the thousands. Carrying the band forward while the rate stays up matches the eye: the highlight covers the spike, not
only the minute it started.

## Depends on

Nothing. The points are the request series the load charts already draw.

## Stack

- [x] **`spike-highlight`** — `spikes`, `.plot-spike` on the Requests spark and the Requests chart.
      Done when: a jump above 100/s to more than ten times five minutes earlier shades that stretch and what follows
      while it stays above 100/s; a rate under 100/s, and a high rate with no jump in view, shade nothing; the line
      stays its ordinary colour; `bun test ./src/web/spike.test.ts` passes.

## Acceptance

```bash
bun test ./src/web/spike.test.ts
```

## Open questions

- **Does the band continue through a sustained high rate?** Recommended: yes, until the rate falls to 100/s or below.
  Stopping at five minutes would mark the start and hide the rest of the spike.

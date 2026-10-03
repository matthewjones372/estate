# 0005 — Charts you can read

## Problem

Every chart on the page is a picture. Someone who sees p99 climb on a service's page can't tell when the climb
started, or what the value was then, without opening Grafana. On a 7-day chart the interesting hour is a few pixels
wide. The alert card's chart shows its threshold, but not when the metric crossed it.

## Not doing

- **A chart library.** The charts stay hand-drawn SVG from `chart.ts`; reading a point is a little code over geometry
  Estate already has.
- **Reading the data again for a zoomed span.** Zooming shows the points already loaded for the range, closer up; a
  finer look is the next range down, or Grafana.
- **Tab stops on the overview's sparklines.** Twelve of them would sit between a person and the lanes. They answer
  to a pointer; the service page's charts answer to the keyboard as well.

## Shape

- **Point at a chart** (mouse, pen or a finger) and it marks the nearest point with a line and a dot. The value in
  its caption becomes that point's value and time, `14:32 · 45.3/s`, and goes back to now when the pointer leaves.
- **On a service's page**, the load and stats charts share that mark: pointing at 14:32 on p99 marks 14:32 on
  requests, errors, heap and the rest, so a cause and its effect can be read side by side.
- **Drag across** a service's chart to zoom every chart on the page to that span. "Show all 24h" goes back. Changing
  the range also goes back.
- **The keyboard**: a service's chart takes focus. The arrow keys step a point at a time, Home and End go to the
  ends, and Escape lets go. The caption is announced as it changes.
- **The alert card's chart** reads the same way, against its threshold, so the time it crossed is a point away.

```tsx
<Plot points={series.points} end={now} span={hours(24)} unit="s" limit={0.15}
      mark={mark} onMark={setMark} zoom={zoom} onZoom={setZoom} />
```

## Why this shape

The caption already shows the value now, so it is the natural place for the value at a point. That avoids a tooltip
that covers the line, or runs off the edge on a phone. Sharing one mark across a service's charts is the part
Grafana makes you build; here it comes free, because the charts already share a range. The alternative was a
charting library such as uPlot or Recharts. It would bring this and more, but at the cost of the hand-drawn look and
another dependency to keep up to date. Recommended: our own.

## Depends on

Nothing.

## Stack

- [ ] **`plot`** — `Plot`, used by the service's charts, the alert card and the sparklines: the mark by pointer and
      keyboard, shared across a service's charts, and zooming by dragging.
      Done when: stepping with the arrow keys on p99 shows each point's time and value in every chart's caption;
      dragging zooms them all; "Show all" and a new range go back.

## Acceptance

```bash
bun run gate
bunx playwright test   # hovers a chart and reads its caption
```

## Open questions

1. **Mark on the overview's sparklines too, shared across a lane?** Recommended no: a lane's three sparklines are
   small enough to read together by eye, and its page has the shared mark.

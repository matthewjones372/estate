# 0030 — Follow frame budget

## Problem

A clustered Estate (spec 0026) sends every follower the whole estate as it starts, then each part that changed. How
large that was had been an open question of 0026, and nothing held it to a size. Each read of the metrics rebuilds
every service's hour of points, so sending a changed part whole sent every series again on every read: at a thousand
services, 5 MB a minute to each follower, its largest frame over a megabyte.

## Not doing

- **Compression.** A smaller change is cheaper than a compressed large one; compress only if the change is still large.
- **The page's own stream.** `/events` has its budgets in spec 0011 and is not this.
- **Sharding by environment.** Spec 0026's later entry; it splits the readers, not the frames.

## Shape

A part that changed is sent as a patch: an object by the keys that changed and those it lost, a series of numbers by
the points it gained when it only moved along (at most four off the front, four new or revised at the end, as the
page's stream finds them), and anything else whole. The follower applies the patches, keeping keys in the owner's
order so its pages render the same text, and checks each patched environment and part with its schema; a patch that
does not apply to what it has, or patches to something that does not check, makes it follow again and be sent the
whole.

```bash
bun bench/frames.ts 1000    # {"services":1000,"wholeKB":…,"largestChangeKB":…,"perMinuteKB":…}
bun run perf                # also fails when a follower's frames break their budgets at fifty services
```

`bench/frames.ts` runs Estate's readers in-process against the bench's tools, turns its state into frames with the
owner's own `framesOf`, and sizes them as the runners' NDJSON carries them, over a minute once the first reads are
done.

| Measured | 50 services | Budget at 50 | 1,000 services |
|---|---|---|---|
| Whole estate, as a follower starts | 186 KB | 250 KB | 3.7 MB |
| Largest change | 12 KB | 20 KB | 241 KB |
| Changes a minute, to each follower | 27 KB | 40 KB | 485 KB |

Sending each changed part whole, as before, is 374 KB a minute at fifty services and 5 MB at a thousand.

## Why this shape

A patch on any part, rather than a format for metrics alone, keeps one rule for every part and lets a part that
changed a little (a note added, an alert's state) be sent as little too; series are where the bytes were, and moving
along is how they change. Measuring through the owner's own `framesOf`, rather than through two runners and Postgres,
keeps the measurement in `bun run perf` without a database, and measures what a follower is sent but its framing.

## Depends on

Nothing.

## Stack

- [x] **`frames-bench`** — `bench/frames.ts`, measuring the frames a follower is sent.
      Done when: it prints the whole, the largest change and the bytes a minute for any number of services.
- [x] **`metrics-changes`** — each changed part sent as a patch, series by the points they gained; the follower
      checks what it patched and follows again when it cannot.
      Done when: at a thousand services, a minute to each follower is under 1 MB (485 KB).
- [x] **`frames-budget`** — `bun run perf` runs the frame bench at fifty services against budgets.
      Done when: sending each changed part whole (374 KB a minute) breaks the 40 KB budget.

## Acceptance

```bash
bun bench/frames.ts 1000
CHROMIUM=/opt/pw-browsers/chromium bun run perf
bun run integration     # the two-runner case, its follower patched frame by frame
```

## Open questions

None. Decided: the whole a follower starts with stays whole; at a thousand services it is 3.7 MB once per follower
start, which a patch cannot shrink.

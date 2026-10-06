# 0030 — Follow frame budget

## Problem

A clustered Estate (spec 0026) sends every follower the whole estate as it starts, then each part that changed. How
large that is was an open question of 0026. `bun bench/frames.ts [services]` now measures it: Estate's readers run
in-process against the bench's tools, and their state is turned into frames by the owner's own `framesOf` and sized
as the runners' NDJSON carries them, over a minute once the first reads are done.

| Services | Whole, as a follower starts | Largest change | A minute, to each follower | Frames a minute |
|---|---|---|---|---|
| 50 | 186 KB | 58 KB | 374 KB | 28 |
| 1000 | 3.65 MB | 1.16 MB | 5.0 MB | 26 |

At fifty services this is nothing. At a thousand, each follower is sent 5 MB a minute, nearly all of it metrics that
changed by a little, and the largest frame is a megabyte. Nothing checks that it does not grow.

## Not doing

- **Compression.** A smaller change is cheaper than a compressed large one; compress only if the change is still large.
- **The page's own stream.** `/events` has its budgets in spec 0011 and is not this.
- **Sharding by environment.** Spec 0026's later entry; it splits the readers, not the frames.

## Shape

```bash
bun bench/frames.ts 50      # {"services":50,"wholeKB":…,"largestChangeKB":…,"perMinuteKB":…}
bun run perf                # also fails when a frame budget at fifty services is broken
```

A change to an environment's metrics sends only the services, agents and stores whose numbers changed, and the vitals,
edges and charts that did, rather than the whole metrics part.

## Why this shape

Measuring through the owner's own `framesOf`, rather than through two runners and Postgres, keeps the measurement in
`bun run perf` without a database, and measures exactly what a follower is sent: the transport adds only its framing.
Recommended: a budget at fifty services in the build, as spec 0011's are, and a thousand by hand.

## Depends on

Nothing.

## Stack

- [x] **`frames-bench`** — `bench/frames.ts`, measuring the frames a follower is sent.
      Done when: it prints the whole, the largest change and the bytes a minute for any number of services.
- [ ] **`frames-budget`** — `bun run perf` runs the frame bench at fifty services against budgets.
      Done when: a frame that sends the whole metrics part on every change breaks the budget.
- [ ] **`metrics-changes`** — a metrics change sends only what changed within it.
      Done when: at a thousand services, a minute to each follower is under 1 MB.

## Acceptance

```bash
bun bench/frames.ts 1000
bun run perf
```

## Open questions

- **Budgets at fifty services?** Recommended: the whole under 250 KB, the largest change under 80 KB, a minute under
  500 KB, set once `metrics-changes` has landed and been measured.

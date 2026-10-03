# 0011 — Staying fast

## Problem

Spec 0010 made a thousand services cheap. Nothing keeps them cheap. The measurement it used lives outside the
repository, run by hand. A change that makes every lane search every service again, the mistake that held 880 MB in
the page, would pass the gate and be found by whoever next ran the bench, if anyone did.

Each source is also read on a fixed schedule: alerts every 20 s, the cluster every 15 s, metrics and deploys every
30 s, builds every minute. That suits Prometheus in the same cluster. It does not suit a tool that charges per call,
such as CloudWatch's GetMetricData, or one that limits calls an hour, such as Datadog. A team has no way to read those
less often.

Fifty services is the most a team is likely to put on one page. A thousand is a useful stress test, not a target.

## Not doing

- **Budgets at a thousand services.** The gate measures fifty, where a team will be. A thousand stays a run by hand,
  with its numbers in the README.
- **Timing budgets tight enough to catch a 10% change.** CI machines vary. The budgets catch the large regressions
  this spec is for: something quadratic, or something read every second.
- **Choosing intervals per service.** An interval is per environment and per source, which is where the cost is set.

## Shape

```bash
bun bench/run.ts               # fifty services, five pages, a table of what it measured
bun bench/run.ts 1000 20       # a thousand services, twenty pages
bun run perf                   # fifty services against the budgets; fails the build when one is broken
```

`bench/` starts tools that answer for any number of services, in two environments, each service with three load
queries, a Deployment and a Flux image policy, the tools answering in 20 ms. It then starts Estate against them and
measures, over a minute once the first reads are done:

| Measured | Budget at 50 services |
|---|---|
| Calls to the tools a second | 15 |
| First data to a page | 0.2 MB |
| Data to a page a minute, once loaded | 0.05 MB |
| Estate's CPU, with five pages open | 15% of a core |
| Estate's memory | 200 MB |
| Page drawn | 3 s |
| Page's heap after a collection | 15 MB |
| Page's heap at 200 services over its heap at 50 | 4 times |

Calls and bytes are exact for a given Estate, so their budgets are close to what is measured. CPU, memory and time
have room for a slow machine. A page that reads every service for each lane is barely heavier at fifty services
(9.7 MB against 8) but grows with the square of them, so the page is drawn again at four times the services and its
heap may grow at most four times: it grows 2.6 times now, and 4.8 times with that mistake put back.

Each environment's sources may say how often each part is read:

```yaml
sources:
  production:
    aws: { region: eu-west-2 }
    every: { metrics: 2m, alerts: 1m }
builds:
  github: { token: "${GITHUB_TOKEN}" }
  every: 5m
```

Parts are `alerts`, `metrics`, `cluster` and `deploys`. Durations are written `30s`, `2m` or `1h`, and none may be
less than 5 s. A part left out keeps its usual interval. `estate doctor` prints each environment's intervals.

## Why this shape

Budgets in the build are what stop regressions; a bench run by hand only reports them afterwards. Measuring through
a real browser and a real Estate process costs about ninety seconds of CI, and catches what a unit test would not:
the 880 MB came from how Solid tracked reads, not from any one function. The alternative, counting renders or
signals in a unit test, would be faster but tied to Solid's internals. Recommended: measure the running thing.

## Depends on

Chromium in CI, installed by Playwright in the workflow.

## Stack

- [x] **`bench`** — `bench/` in the repository: the fake tools, the catalog it writes, and `bench/run.ts`; the
      README's table re-measured.
      Done when: `bun bench/run.ts 1000 20` prints the table the README shows.
- [x] **`budgets`** — `bun run perf`, run by the workflow after the gate, failing when a budget is broken.
      Done when: putting back the lane's search through every service fails `bun run perf`.
- [x] **`intervals`** — `every:` per environment's sources and for builds; `estate doctor` prints them.
      Done when: a test with `every: { metrics: 2m }` reads metrics once in two minutes, and settings with `1s` are
      refused with a message naming the part.

## Acceptance

```bash
bun run gate
bun run perf
```

## Open questions

- Should five pages be the CPU budget's case, or one? Recommended: five, since sharing views is what keeps that
  cheap, and one page would not catch it breaking.

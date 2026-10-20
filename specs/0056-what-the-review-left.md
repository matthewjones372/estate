# 0056 — What the review left

## Problem

Specs 0053 and 0055 took the web review's findings that mattered most. A few were left, and the work turned up one
more.

- **A benchmark that hangs.** `bun run perf` waits for Estate to be ready, for the tools to go quiet and, measuring a
  follower, for every part to be answered, each with no deadline. On CI it hung four times in a day, until the gate's
  ten-minute step timeout, and printed nothing, since it prints only when it finishes.
- **No way to frame Estate on a wall screen.** Spec 0055's `frame-ancestors 'self'` refuses every other origin, so a
  dashboard that shows Estate in a frame (a Grafana text panel, a TV app) cannot.
- **Colours outside the tokens.** About twenty hex colours are written into the stylesheets beside the `:root`
  tokens, so a colour changed in one place is missed in another.
- **Physical sides.** `margin-left: auto` and `padding-left`/`padding-right` name a side where the start or the end
  of the line is meant.
- **A search that runs on every key.** Each key typed in the log search filters every held line again.
- **Pages that jump.** Moving between pages swaps one for the next at once.

## Not doing

- **`Intl.DurationFormat`.** It would say "1 hr, 52 min" where Estate says "1 h 52 min": a change to words people
  read, which is a person's to choose.
- **Changing the benchmark's measurements or budgets.** Only how it waits changes.

## Shape

```text
bench: Estate with 50 services (0 s)
bench: a minute with 5 pages watching (4 s)
error: Estate to be ready did not happen within 120 s; last seen: waiting for production metrics
```

```yaml
web:
  frameAncestors: [https://grafana.example.com]   # added to 'self'; none by default
```

- **The bench's waits** each have a deadline, and fail saying what they waited for and what they last saw. Each
  phase writes a line to stderr as it starts.
- **`web.frameAncestors`** is a list of origins, each checked as one, added to `frame-ancestors 'self'`.
- **Colours** are tokens on `:root`, each named for what it is used for.
- **Sides** are logical: `margin-inline-start`, `padding-inline`.
- **The log search** filters once typing has paused for 150 ms; clearing it is at once.
- **Moving between pages** cross-fades through `document.startViewTransition` where there is one, and not at all
  under `prefers-reduced-motion`; focus moves to the new page.

## Why this shape

The bench could print everything it does, but a minute of numbers would hide where it stopped; a line a phase and
a deadline a wait say it in one place. Recommended: as above.

## Depends on

Nothing.

## Stack

- [x] **`bench-deadlines`** — the bench's waits with deadlines that say what stalled, and a line a phase.
      Done when: a wait that runs out fails within its deadline naming what it waited for, and `bun run perf` passes.
- [x] **`frame-ancestors-setting`** — `web.frameAncestors` in the settings, checked at start, added to the policy.
      Done when: a page on a listed origin can frame Estate, and one on any other cannot.
- [x] **`colour-tokens`** — the stylesheets' hex colours as `:root` tokens.
      Done when: no stylesheet but the tokens names a colour by hex, and the pages compute the same colours.
- [ ] **`logical-sides`** — the physical sides as logical ones.
      Done when: no stylesheet sets a left or right margin or padding, and the pages lay out as before.
- [ ] **`log-search-debounce`** — the log search filters once typing pauses.
      Done when: typing a word filters the lines once, and clearing the search shows them at once.
- [ ] **`page-transitions`** — a cross-fade between pages where the browser has view transitions.
      Done when: moving to a page starts a view transition, none under reduced motion, and focus is on the new page.

## Acceptance

```bash
bun run gate
bun run perf
bunx playwright test
```

## Open questions

None open: `web.frameAncestors` is spec 0055's open question, answered with its recommendation (a list, empty by
default).

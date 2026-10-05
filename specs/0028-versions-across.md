# 0028 — Versions across environments

## Problem

On a service page, Estate shows only the version running in the *chosen* environment (`running v2` in the lede). To
see whether staging and production match, an operator leaves for Deploys and finds the row. During ALERT → CONTEXT the
question "is this the version we think?" is answered next to the service, not on another page — and Estate already has
every environment's running and chosen versions in the `deploys` event.

## Not doing

- **Changing the Deploys page.** Its across-environments table stays the place for every service side by side.
- **A new event or server read.** The strip reads `events.deploys` already on the page.
- **Builds, pipelines, or Flux rails on the service page.** Those stay on Deploys / the overview lane.
- **Health dots per environment.** The strip is versions; the header switcher already shows each environment's worst.
- **Stores, jobs or agents.** Only services carry deploy versions today.

## Shape

```text
Service page (header already chosen-env)
  Overview / storefront
  storefront
  ● Degraded · OrdersSlow…
  The shop's pages · running v2
  [ staging · ● v2 ]  [ production · ● v2 ]   ← strip: every env this service is in
  links · Owned by…
  …
```

```ts
// from the deploys row already on the page — no fetch
Versions({ name })  // environments from deploys.services.find(name).environments
// each cell: env name, running (or "not running" / "not read"), tone like Deploys cells,
// stalled or "moving to …" as a note; current env marked; other cells call actions.choose(env)
```

- **Same data as Deploys.** Running image, chosen version, stalled reason, `seen` — the strip is the service's row of
  that table, not a second truth.
- **Switch in place.** Clicking another environment chooses it (header switcher); the page stays on the service so
  load, logs and pods follow. The current cell is marked, not a dead control.
- **Hidden when empty.** No deploys row, or no environments on it → no strip (same as a missing source turning a part
  off).

## Why this shape

The Deploys page already answers "every service × every env". Repeating that table on the service page would be a
second product. A one-service strip reuses the event and matches how the lede already names the current version —
just for every env. Linking out to `/deploys` would still cost a round trip of attention; `choose` keeps CONTEXT on
the same address.

## Depends on

Nothing. `deploys` and `actions.choose` are already on the page.

## Stack

One entry per pull request, in build order.

- [x] **`feat/cross-env-versions`** — spec 0028; `Versions` on the service page from `deploys`; CSS; suite coverage
      for storefront across staging/production, orders stalled, and choose-on-click; `bun run gate`.
      Done when: the storefront page names staging and production versions; clicking staging records `choose`;
      gate passes.

## Acceptance

```bash
bun run gate
```

## Open questions

- **Show chosen when running is missing?** Recommended: yes — prefer running, else "not running" / "not read"; stalled
  still shows its reason. Matches Deploys cells.
- **Include environments the service is not catalogued for?** Recommended: no. The deploys view already filters to
  `service.environments`.
- **E2E / Playwright?** Recommended: not for this stack. Unit/suite coverage of the strip and choose is enough; Deploys
  already has the across-env table under e2e elsewhere if needed.

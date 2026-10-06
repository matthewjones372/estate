# 0032 — Shard by environment

## Problem

A clustered Estate (spec 0026) has one owner: the runner holding the `"estate"` entity reads every environment's
tools, records every firing and sweeps every table, while the other runners only serve pages. An estate of a dozen
environments puts all its reading, and all its calls to the tools, on one process however many replicas run, and a
runner going away stops every environment's reads until the entity moves.

## Not doing

- **Splitting an environment.** One environment's sources stay read by one runner, together.
- **Placing environments by hand.** Effect's sharding puts each entity on a runner by its shard; Estate does not choose.
- **The one process.** Without `cluster:` Estate reads every environment itself, as now.
- **New settings.** Sharding by environment is how a cluster runs; there is nothing to turn on.

## Shape

```text
entity "estate"            the estate's own work: the catalog's reload and discovery, builds, notes and firings
                           loaded and swept; notes, impacts and threads applied
entity "env:<name>"        one per environment in the catalog: its readers, its debug reverts, its past firings
                           backfilled and its firings recorded; held silences and debug shown applied
each environment entity    keeps the catalog, firings and threads it needs from the runner's own followed state,
                           and sends the firings it records to "estate" (FiringsKept)
every runner               follows "estate" and each environment's entity into its own state, the environments
                           followed changing with the catalog; a write goes to the entity that owns what it changes
```

```text
GET /readyz   ready, reading estate, staging; following 10.0.7.3:34431 for production
estate doctor
  cluster  ok   2 runners (10.0.4.12:34431, 10.0.7.3:34431); estate read by 10.0.4.12:34431, beat 2 s ago;
                production by 10.0.7.3:34431, beat 4 s ago; staging by 10.0.4.12:34431, beat 1 s ago
```

The `estate_cluster_owner` gauge counts the entities a runner reads, and the `estate_cluster_owners` table holds a
beat per entity, which the doctor reads.

## Why this shape

An environment is the unit Estate already reads as one: its sources start, stop and restart together in
`startSources`, and its part of the state is its own. Keying entities by environment spreads exactly that, and leaves
what is the estate's alone on one owner, since notes, firings and the catalog are one table or one file each. Firings
are recorded where the alerts are read and kept where the firings are, through the same `Apply` writes already use.
The alternative, an entity per source kind, would split one environment's reads that share a cluster's listing.
Recommended: environment and estate.

## Depends on

Spec 0026's entity, `Follow` and `Apply`, and spec 0030's patched frames.

## Stack

- [x] **`estate-split`** — the background work split into the estate's and one environment's, with the one process
      running both as now.
      Done when: `bun run gate` passes unchanged and an environment's work reads and writes only its own part.
- [x] **`env-entities`** — an entity per environment, and `"estate"` doing only the estate's work; firings recorded
      by an environment sent to `"estate"`.
      Done when: under `TestRunner`, each environment's readers start once on its own entity, and a firing recorded
      by one reaches the estate's firings.
- [x] **`follow-each`** — every runner follows `"estate"` and each environment's entity, following the catalog's
      environments as it changes; writes go to the entity that owns what they change.
      Done when: a follower's state has each environment from its own owner and the rest from `"estate"`, and a held
      silence reaches the environment's owner.
- [x] **`roles-each`** — `/readyz`, the gauge, the owner's beat and the doctor's line per entity.
      Done when: against two runners, the doctor names an owner for the estate and for each environment.
- [x] **`spread-e2e`** — `bun run integration`: two runners, two environments.
      Done when: both runners read something, the stub sources are called as often as by one, and killing one has the
      other read everything within 60 s. The test's catalog has four environments: Effect places entities on runners
      by a hash ring, so with few entities all may land on one runner, and four give the five room to spread.

## Acceptance

```bash
bun run gate
bun run integration
```

## Open questions

- **An environment entity's catalog before the runner has followed `"estate"`?** Recommended: the catalog read at
  start, then the followed one as it arrives; an environment's readers already read the catalog each time.
- **Firings recorded twice while an environment moves?** Recommended: accept it, as spec 0026 does for two owners;
  firings are kept by environment, alert and start, so a second keep of one is the same row.

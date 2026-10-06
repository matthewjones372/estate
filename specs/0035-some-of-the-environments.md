# 0035 — Some of the catalog's environments

## Problem

One catalog describes an estate in every place it runs, but not every Estate can see every place. A developer's
cluster on their laptop runs its own Estate beside its own Prometheus, with the same catalog as production's; a
production Estate cannot reach the laptop, nor the laptop production. Today each Estate must configure sources for
every environment in the catalog or refuse to start, so the estate keeps a catalog per place, copied and drifting.

## Not doing

- **Hiding entries.** A service, store, job or agent stays in the catalog; it is shown wherever its environments are.
- **Choosing per person.** Which environments an Estate shows is its settings', not a viewer's filter.
- **Checking the catalog differently.** `estate check` checks the whole catalog, every environment in it.

## Shape

```yaml
# estate.yaml on a developer's cluster
environments: [ kind ]      # of the catalog's; every one unless set
sources:
  kind: { prometheus: { url: http://prometheus:9090 }, kubernetes: { inCluster: true } }
```

```text
starting, and on each catalog reload:
  the catalog is checked whole, as before
  a name in environments that the catalog does not have         environments[0]: "kidn" is not one of the catalog's
  the environments named are kept, in the catalog's order; the others are dropped before anything reads them
  each kept environment needs its sources, as before; a dropped one needs none
```

## Why this shape

The catalog says what the estate is; the settings say what this Estate can reach, as they already do for each
environment's sources. Choosing in the settings keeps one catalog for every place, which is what lets a change to a
service and to its entry be one commit. The alternative, an environment marked optional in the catalog and shown
only where its sources are set, makes a missing source in production quietly hide an environment instead of failing
the start; recommended against.

## Depends on

Nothing.

## Stack

- [x] **`chosen-environments`** — `environments:` in the settings, checked against the catalog, applied at start and on
      each reload.
      Done when: an Estate with `environments: [ staging ]` and only staging's sources starts and shows staging alone,
      and one naming an environment the catalog lacks refuses to start, naming it.

## Acceptance

```bash
bun run gate
```

## Open questions

None.

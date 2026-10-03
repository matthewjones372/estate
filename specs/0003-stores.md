# 0003 — Stores: databases, queues and caches

## Problem

An estate's trouble often starts in what its services keep things in: a database running out of connections, a
replica falling behind, a queue's consumers lagging, a cache evicting. Estate draws stores as boxes on the map and
says nothing else about them, so the person looking opens Grafana, if someone built a board for that database.

## Not doing

- **Running queries against the stores.** Estate reads what the exporters already put in Prometheus (or, after spec
  0002, CloudWatch); it never connects to a database itself.
- **Administering them**: no failover, vacuum or reindex buttons. Those stay with the operator and the tool.
- **Every engine's every metric.** A preset is the four or five numbers that say whether the store is well; anything
  else is a query of the estate's own, as for services.

## Shape

The catalog names stores beside services, each with the preset for its engine:

```yaml
stores:
  - name: orders-db
    description: The orders database
    environments: [ production, staging ]
    engine: cnpg                          # postgres, cnpg, mysql, redis, kafka
    selector: 'database="orders-db"'      # the labels its exporter's series carry
    links: { dashboard: https://grafana.{env}.example/d/cnpg }
    extra:
      - { title: Outbox lag, query: 'max(orders_outbox_lag{database="orders-db"})' }
```

Each preset gives a store's stats, and its health from them:

| Engine | Stats | Needs attention when |
|---|---|---|
| `postgres` (postgres_exporter) | connections used of max, transactions/s, replication lag, database size, deadlocks | connections over 80% of max, replication lag over 30 s |
| `cnpg` (CloudNativePG) | the same, from `cnpg_*`, and instances ready, the primary, the last backup | an instance not ready, no backup in a day, as above |
| `mysql` (mysqld_exporter) | connections of max, queries/s, replica lag, slow queries | as for Postgres |
| `redis` (redis_exporter) | memory used of max, hit rate, evictions/s, clients | memory over 90%, evictions above zero |
| `kafka` (kafka_exporter) | messages in/s, consumer group lag per group, under-replicated partitions | lag growing for 10 minutes, any partition under-replicated |

On the page, the overview gets a **Stores** section after the services, one lane each: health and why, its stats as
sparklines, its links. A store has a page of its own like a service's, with its stats over a range. A map node names a
store with `store:` as it names a service with `service:`, and is coloured by its health. Alerts about a store
(labelled `store`, `database` or `instance` with its name) go to it.

## Why this shape

Stores are not services: they have no build, no pipeline and no debug switch, and what makes one unwell is a handful
of numbers particular to its engine. A preset per engine, read like a service's stats (spec 0001's `stats`), keeps
Estate reading what exporters already publish. Health from thresholds in the preset, rather than only from alerts,
means a team without alert rules for its database still sees it go amber.

The alternative was services of a kind `store`, which would bring pipeline rails and debug switches that mean nothing
for a database. Recommended: stores of their own.

## Depends on

Nothing. The exporters (postgres_exporter, CloudNativePG's own metrics, mysqld_exporter, redis_exporter,
kafka_exporter) are the estate's; Estate names the series they publish.

## Stack

- [x] **`stores-catalog`** — `stores` in the catalog with engines, selectors, links and their own queries; checked
      like the rest; map nodes may name a store.
      Done when: a broken store query or an unknown engine is a named mistake.
- [x] **`store-presets`** — the five presets, their stats read with the load, and health from their thresholds.
      Done when: a CloudNativePG store with an instance not ready shows as needing attention, saying which.
- [ ] **`store-pages`** — the Stores section on the overview, the store page, map nodes coloured by health, alerts
      about a store.
      Done when: Playwright opens a store from the overview and sees its stats over 24 h.

## Acceptance

```bash
bun run gate
bunx playwright test   # e2e/tools.ts answers the exporters' series for a Postgres, a Redis and a Kafka
```

## Open questions

1. **Thresholds in the preset, or the catalog's?** Recommended the preset's defaults, each overridable per store
   (`attention: { connections: 0.9 }`), since a store sized close to its limit on purpose would otherwise be amber
   all day.
2. **Backups for engines other than CloudNativePG?** Recommended later: only CloudNativePG publishes its last backup
   as a metric; for the others it would need each backup tool's own, which is spec 0002 territory.

# 0060 — A demo with nothing but Estate

## Problem

To see Estate today someone either points it at their own tools or runs petshop's demo: Docker Compose, a Kotlin
service, Prometheus, Alertmanager and Kafka. The example settings in `examples/` start Estate against sources that are
not there, so every part says why it is empty. The pages' tests have a fake estate, `e2e/tools.ts`, but it is shaped
for assertions: one small shop, a cluster that never changes, nothing happening.

Nobody can try Estate in a minute and see what it is for: an estate with a problem in it, the page that shows where,
a Kafka cluster losing a broker, a message followed through it, an incident people are writing in, and Ask AI.

## Not doing

- **A hosted demo.** It runs where `bun` runs, on the person's machine.
- **Real tools.** No containers, no Kafka, no Prometheus. Every source is played by one process that answers in each
  tool's own shapes, as the pages' tests' fakes do.
- **A real model.** Ask AI answers from a canned answer, and says so.
- **Changing Estate for it.** The demo is settings, a catalog and a fake world; Estate runs as it would anywhere.
  Its incident and comments are written through Estate's own API, as a person would.

## Shape

```bash
bun install
bun examples/demo/run.ts          # Estate on http://localhost:8080, the world it reads on 8484
```

`examples/demo/` holds:

- **`catalog.yaml`**: Larder, an online grocer that never was. Two environments: staging, well, and production, with
  a problem. Five teams, sixteen services in five categories (one found in Kubernetes), Postgres and Redis stores,
  two Kafka clusters found by a `kafka:` rule, jobs, an agent, vitals, a journey and the map.
- **`estate.yaml`**: Estate's settings, every source of both environments pointing at the world, signed in as an
  operator called `demo`, with Ask AI, a kiosk token and Estate's notes in memory.
- **`world.ts`** and the files beside it: one process on port 8484 playing Prometheus (with kafka_exporter,
  postgres_exporter and redis_exporter series), Alertmanager, Kubernetes with Flux, GitHub Actions, Tempo and an
  OpenAI-compatible model, for whatever the catalog names. Each environment is a path under it, so staging and
  production answer differently from one port.
- **`run.ts`**: starts the world and Estate, waits until Estate has read every source, writes the incident through
  Estate's API, and prints where to look.

Production's story, the same each time it starts:

```text
bus, six brokers on three racks: broker 4 is gone; the partitions it led have moved, short of a replica
picking falls behind on orders, partition 7 far behind the rest, its lag growing; KafkaBrokerDown and
  ConsumerLagGrowing fire
checkout's p99 is up since its latest version rolled out, and CheckoutSlow has a note on it
inventory's image policy cannot list tags, so its deploy is stalled
an incident, "Orders reach the warehouse late", holds KafkaBrokerDown and ConsumerLagGrowing, four comments and
  what was done by hand
an order placed every few seconds, traced from the web through checkout to bus and on to each group that reads it
```

Staging has the same services, a few a version ahead,, every check well, and a three-broker cluster in sync.

- **A message followed** in production goes *not yet* for picking and turns *read it* as the group's
  offset passes it, since the world moves each group's offsets at its rate and writes a consumer span when it does.
- **Ask AI** on an alert or on the cluster answers with a likely cause, evidence and next steps fitting the story,
  starting *Demo answer, canned: no model was asked.*
- Everything else (logs, builds, versions across environments, the map, the kiosk) works as it does against real tools, from the
  same world.

## Why this shape

Putting the fakes in Estate (a `demo: true` setting) would put a name from one estate in the code and a second way
to read every source. A separate process answering in the tools' own shapes tests Estate's readers the way a real
estate does, and the catalog is a real catalog someone can copy from. Deriving the world's answers from the catalog
means a service added to the catalog shows up with pods, versions and load, without touching the world.

## Depends on

- Bun's YAML import, for the world to read the catalog it plays for.
- Spec 0057's follow, for the message followed.

## Stack

- [x] **`demo`** — `examples/demo/` and its section in the README.
      Done when: `bun examples/demo/run.ts` starts both, a test checks the demo's catalog clean and has the world
      answer each source the settings name, and production shows the gone broker, the lagging group, both alerts, the
      incident with its comments, a followed message turning *read it*, and Ask AI's canned answer.

## Acceptance

```bash
bun run gate
bun examples/demo/run.ts
```

Open http://localhost:8080: production is unwell and says where; staging is well. The `bus` store's page shows six
brokers with one gone and a group behind. Follow the trace ID `run.ts` prints, and watch the group read it.

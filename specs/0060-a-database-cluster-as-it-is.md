# 0060 — A database cluster as it is, found, and a request's queries through it

## Problem

A Postgres store's page shows five sums: connections used, transactions, replication lag, size and deadlocks (spec
0003). A cnpg store adds instances not ready and the time since the last backup. When one of them moves, the next
question is always where. Which instance is the primary now, and did it change? Which replica is behind, by how many
seconds and how many bytes, and is it still falling? Is a replication slot holding WAL for a replica that has gone? Who
is holding the connections, and is one of them idle in a transaction? Today the person looking opens Grafana, or runs
`psql` against the primary and reads `pg_stat_replication` and `pg_stat_activity` by hand, or runs `kubectl cnpg
status`.

The other question is about one request. Someone says *I adopted the pet but the page still shows it on the shelf*.
Did the write commit, on which instance, and did the read that followed go to a replica that had not replayed it yet?
The spans that answer this are already in Tempo, because the estate's services trace their database calls. But
nothing puts a query's span next to the instance it ran on and how far behind that instance was at the time.

And before any of this, the cluster has to be in the catalog. Each Postgres store is written by hand, though
Prometheus already knows every cluster postgres_exporter or cnpg is scraped for. A cluster nobody wrote an entry for
is not on the page at all.

Spec 0057 draws a Kafka cluster as people think of one: writes coming in on the left, the cluster's brokers in the
middle, readers on the right. A database cluster has the same shape: clients connected on the left, instances in the
middle with the primary first, and where its WAL goes on the right (replicas, the archive, logical slots). Estate
should draw the real cluster that way, from what the exporters already put in Prometheus, and show one real
request's queries over it from its trace.

## Not doing

- **Engines other than Postgres and cnpg.** MySQL and Redis stores keep their four sums. Postgres is next after Kafka
  because its replication is what people ask about most. The same panel can take MySQL's replicas later.
- **Talking to the database.** Estate reads exporters' series and Tempo's spans. It never connects to Postgres, runs a
  query, reads `pg_stat_statements` itself, or sees a row.
- **Administering it.** No failovers, switchovers, fencing, killing backends, dropping slots or starting backups.
- **Schemas and query plans.** No tables drawn as an entity diagram, no `EXPLAIN`. The busiest tables are named, from
  the exporter's table statistics, and nothing more.
- **History on the cluster view.** It shows now. The stats over a range stay on the charts beside it. A followed
  request shows its own past, from its trace.
- **Requests without traced database calls.** A service whose database client is not traced cannot be followed.
- **A simulator.** What happens if the primary goes, before it does, is for a later spec, as spec 0058 is to 0057.

## Shape

### Found, not written

A `postgres:` discover rule, beside spec 0057's `kafka:`, finds every cluster its exporter is scraped for and makes
each an ordinary store:

```yaml
discover:
  - postgres:
      engine: cnpg                             # or postgres: which preset, and which series tell instances apart
      by: [ namespace, cnpg_io_cluster ]       # the labels that tell one cluster from another
      selector: 'job=~"cnpg.*"'                # optional: only these exporters' series
    store:
      name: "{label:cnpg_io_cluster}"
      category: Data
      links: { dashboard: "https://grafana.{env}.example/d/cnpg?var-cluster={label:cnpg_io_cluster}" }
```

```text
each environment whose sources read Prometheus, every minute, for each postgres rule:
  cnpg:      count by (<by>) (cnpg_collector_up{<selector>})     one series per cluster
  postgres:  count by (<by>) (pg_up{<selector>})
  then as spec 0057's kafka rule: a store per cluster, checked, written stores win by name,
  a Prometheus that does not answer keeps what it last found
```

A found store is marked *found in Prometheus* on its lane and page, offers *Copy as YAML*, and the doctor names it,
as spec 0057's do. The catalog check names a `postgres:` rule with no `by`, with no `engine`, or with an `engine`
other than `postgres` or `cnpg`.

### The cluster

**On a Postgres or cnpg store's page**, under its health line and above its stats, a panel *The cluster* draws it:

```text
petshop-db-3 is 42 s behind the primary and falling further. It is async, so writes go on; reads sent to it are stale.
3 instances · 2 databases · read 14:26

CONNECTED FROM          ┌ POSTGRES 17 · 3 INSTANCES ────────────────────────────┐   WAL GOES TO
┌───────────────────┐   │ ┌ petshop-db-1 ┐ ┌ petshop-db-2 ┐ ┌ petshop-db-3   ┐ │   ┌──────────────────────┐
│ petshop           │══▶│ │ primary      │ │ replica      │ │ replica        │ │══▶│ petshop-db-2         │
│ 18 conns · 5 busy │   │ │ 22 / 100     │ │ sync · 0 B   │ │ async · 42 s ▲ │ │   │ streaming · sync     │
└───────────────────┘   │ │ petshop 212MB│ │              │ │ 1.3 GB to      │ │   └──────────────────────┘
┌───────────────────┐   │ │ postgres 8MB │ │              │ │ replay         │ │──▶ petshop-db-3 · 1.3 GB
│ postgres_exporter │──▶│ └──────────────┘ └──────────────┘ └────────────────┘ │──▶ WAL archive · 20 s ago
└───────────────────┘   └──────────────────────────────────────────────────────┘    Base backup · 6 h ago
[primary]  [replica]  [behind or near a limit]  [gone]
```

From the exporter every Postgres or cnpg store already has:

- **Instances** are columns in the cluster, one per value of the label that names an instance (`pod` for cnpg,
  `instance` for postgres_exporter). The primary is first, then replicas by how far behind they are. An instance seen
  in the last hour that is not there now stays as a dashed column marked *gone*, with how long ago, as spec 0057's
  gone broker does. A change of primary within the hour is said on the new primary, *promoted in the last hour*,
  from its role over the hour. Neither exporter's default series carry the timeline, so it is left out until one is
  checked; nor do they say when in the hour the promotion was.
- **Role** from `cnpg_pg_replication_in_recovery`, or `pg_replication_is_replica`. **Lag** from
  `cnpg_pg_replication_lag`, or `pg_replication_lag_seconds`, and the bytes still to replay from the primary's
  `pg_stat_replication` series, per replica. A replica past the store's `lag` threshold is amber, and growing lag over
  ten minutes is said.
- **Connections** per instance against `max_connections`, as a bar, amber past the store's `connections` threshold.
- **Databases** sit in the primary's column with their sizes. Choosing one names its busiest tables by live and dead
  rows and scans, from the exporter's table statistics where they are collected.
- **Clients** are cards on the left, one per `application_name` with its connections and how many are busy, waiting
  on a lock, or idle in a transaction. Idle in a transaction for longer than a minute is called out in words.
- **WAL goes to** cards on the right: each replica streaming from the primary, sync or async, with the bytes it has
  not replayed; each replication slot, active or not, with the WAL it retains; the WAL archive, with the time since its
  last segment and any failed; and the last base backup. An inactive slot holding WAL is amber, since it fills the
  primary's disk.
- **Flows** join each client to the cluster and the cluster to each target. As in spec 0057 they move faster on a
  thicker line for each tenfold of their rate (transactions a second in, WAL bytes a second out), are still with
  nothing moving, amber when behind, and still under reduced motion.
- **Choosing** an instance opens its detail below the view: role, timeline, uptime, current or replayed LSN, lag,
  connections by state, locks waiting, deadlocks, its slot and its node. Choosing a client marks the instances it is
  connected to.
- **Ask AI**, where it is set, reads the cluster as Estate read it and answers in one round, at
  `POST /api/stores/:name/ask?env=`, as spec 0057's does.
- **Words first**: the panel's first line says what is wrong in a sentence, and each mark has its text for a screen
  reader. In a narrow panel the diagram reads top to bottom, by the same container query as Kafka's.

A store with one instance and no replicas draws one column, no lag and only the archive and backup on the right.

### Every cluster at a glance

On the overview, a Postgres or cnpg store's lane gains a row of dots after its health line, one per instance: the
primary filled, a replica as a ring, amber past the lag threshold, dashed when gone. The dots come from two counts
added to the preset (instances by role, instances not ready), read with the lane's other stats, so the overview reads
no per-instance detail.

### A request's queries through it

**Follow a request**, from a trace's page (spec 0046) or by pasting a trace ID on the store's page, finds the trace's
database spans for this store and lists them over the cluster:

```text
FOLLOWING 4bf92f35…  POST /pets/17/adoption                                            Open its trace
  09:41:02.104  petshop          SELECT pets … FOR UPDATE              primary          1.2 ms
  09:41:02.121  petshop          COMMIT                                primary          4.9 ms
  09:41:02.390  petshop claimer  SELECT outbox … FOR UPDATE SKIP …     primary          2.3 ms
  09:41:02.480  petshop          SELECT pets WHERE id = $1             replicas (ro)    0.9 ms
                                 a replica was up to 42 s behind then; the commit 359 ms before may not have been seen
```

- A database span is one with `db.system.name = postgresql` (or the older `db.system`), whose `server.address` and
  `db.namespace` match one of the store's addresses, given in the catalog or, for cnpg, its `-rw`, `-ro` and `-r`
  services.
- **Where it ran** is read from the address: the primary through `-rw`, the replicas through `-ro`, either through
  `-r`, or one instance when the client connected to a pod's address. Estate does not guess past that.
- **What it was** is `db.query.summary`, else `db.operation.name` with `db.collection.name`, else the query text cut
  to its first line. Parameters are never shown.
- **Stale reads**: a read that went to the replicas after a write in the same trace committed on the primary is
  marked, with the largest replica lag Prometheus held at that moment.
- A follow has an address, `/stores/:name/requests/:traceId`, so it can be pasted into a chat or an incident.

**Attribute names** follow OpenTelemetry's current database conventions. A store may name others, where the estate's
instrumentation is older or its own:

```yaml
stores:
  - name: petshop-db
    engine: cnpg
    selector: 'cnpg_io_cluster="petshop-db"'
    addresses: [ petshop-db-rw, petshop-db-ro, petshop-db-r ]   # optional for cnpg: these are the defaults
    queries:                                                    # optional: where the estate's spans keep these
      system: db.system
      summary: db.statement
```

The catalog check names `addresses:` or `queries:` on a store whose engine is not `postgres` or `cnpg`.

### Reads

```text
GET /api/store-cluster?env=&store=              for a Postgres or cnpg store: instances, roles, lag, connections by
                                                client, databases, slots, archive and backup; when it was read
GET /api/store-requests?env=&store=&trace=      a trace's database spans for the store, where each ran, and the
                                                replicas' lag at each read
```

`/api/store-cluster` answers by the store's engine, so the Kafka panel's reader, its 15-second refresh while the tab
is seen, and its `instant` queries are reused. Series an exporter does not have (slots and archive without the
collectors that publish them, table statistics without `stat_user_tables`) leave those parts out and say which
collector would add them. A missing Tempo turns *Follow a request* off and says why.

## Why this shape

Everything an operator asks of a Postgres cluster in the first minute is already in its exporter: who is primary,
who is behind and by how much, who holds the connections, whether WAL is leaving the primary and whether a slot is
pinning it. Drawing those series in spec 0057's layout means one way of reading a store in Estate, whatever its engine,
and the person who learned the Kafka view can read this one. What a request did is already in its trace. Putting a
read's span beside the replicas' lag at that moment answers *did it see my write*, which neither Tempo nor the
exporter can answer alone.

The alternative was connecting to each cluster and reading `pg_stat_replication`, `pg_stat_activity` and
`pg_replication_slots` directly. That would name the exact replica a read went to and each backend's query. It would
also mean credentials to every database, a Postgres client in Bun, query text with values in it, and a second way to
read a store. Recommended: exporters and traces only, as spec 0057 chose.

## Depends on

- postgres_exporter or cnpg's own exporter, scraped by the environment's Prometheus, with a label that names each
  instance (`pod` or `instance`) and one that tells clusters apart. postgres_exporter needs one scrape target per
  instance, not one for the cluster, for the columns to be drawn; one target draws one column and says so.
- For clients by `application_name`, slots and the archive: postgres_exporter's `stat_activity`, `replication_slot`
  and `stat_archiver` collectors, or cnpg's default monitoring queries. Until then those cards say which collector
  is missing.
- For following a request: Tempo, as spec 0046 reads it, and database clients traced with OpenTelemetry's database
  attributes. petshop's demo runs one Postgres with no replicas, so it shows one column and its queries on the
  primary; replicas need the e2e estate's stub or a cnpg cluster.
- `instant` on the metrics source, and the cluster reader and panel's frame, from spec 0057.

## Stack

- [ ] **`discover-postgres-rule`** — `postgres:` with `engine:` and `store:` in a discover rule, and its checks.
      Done when: a rule with no `by`, no `engine`, or an engine other than `postgres` or `cnpg` is a catalog mistake
      that says so.
- [ ] **`discover-postgres`** — every minute, each environment's clusters found from `cnpg_collector_up` or
      `pg_up`, checked, and put after the written stores, which win by name.
      Done when: against the Prometheus stub, a cnpg and a postgres_exporter cluster are two stores with their
      engines and selectors, a written store of the same name replaces one, and a failing Prometheus keeps what was
      found.
- [x] **`postgres-cluster-read`** — a Postgres or cnpg cluster into one shape in `shared`, at
      `GET /api/store-cluster`.
      Done when: against the stub, three instances with one gone, a promoted primary, a replica
      past the lag threshold, an inactive slot retaining WAL and a client idle in a transaction all read as such,
      and a single-instance store reads as one primary.
- [ ] **`postgres-cluster-panel`** — *The cluster* on a Postgres or cnpg store's page: clients, instance columns,
      WAL targets, the sentence and the key.
      Done when: a suite draws the stub's cluster, marks the gone instance, the amber replica and slot, says the
      sentence, and stacks top to bottom in a narrow panel.
- [ ] **`postgres-cluster-detail`** — an instance's detail, a database's busiest tables, and choosing a client
      marking its instances.
      Done when: a suite opens an instance and a database, and choosing a client marks the instances it is on.
- [ ] **`postgres-cluster-flow`** — flows by transactions and WAL bytes a second, amber when behind, still under
      reduced motion, read only while the tab is seen.
      Done when: a suite shows a faster flow for a higher rate, none under reduced motion, and no reads in a hidden
      tab.
- [ ] **`postgres-cluster-ask`** — Ask AI on a Postgres or cnpg cluster: the cluster as a brief, one round.
      Done when: against the exporter and model stubs, the brief names the gone instance, the lagging replica and the
      inactive slot, and no button shows without Ask AI.
- [ ] **`postgres-lane-instances`** — the instance dots on a Postgres or cnpg store's lane, from two counts in the
      preset.
      Done when: a suite shows a lane with a primary, a replica past its threshold and a gone instance as dots, each
      with its words.
- [ ] **`span-db-attributes`** — a trace's spans keep their database attributes, under the current names or a
      store's `queries:`.
      Done when: against the Tempo stub, a span reads its system, address, namespace, summary and operation, and one
      with only `db.statement` reads its first line.
- [ ] **`request-follow`** — `GET /api/store-requests` and *Follow a request*: the trace's spans for the store,
      where each ran, stale reads marked, and its address.
      Done when: against both stubs, a write on `-rw` reads as the primary, a later read on `-ro` is marked stale with
      the replicas' lag then, and a span for another database is left out.
- [ ] **`postgres-cluster-e2e`** — `e2e/tools.ts` answers cnpg's series and the database spans. Playwright opens a
      found cnpg store, sees its instances, a lagging replica and a slot, and follows a request, with axe clean.
      Done when: `bunx playwright test` passes with the walk.

## Acceptance

```bash
bun run gate
bunx playwright test
```

With a `postgres:` discover rule and no written store, the e2e estate's cnpg cluster appears on the overview as a
store marked found, with its instance dots. Against a real cnpg cluster, deleting the primary's pod turns its column
to *gone* within a scrape and 15 seconds, and the promoted replica moves first with *promoted* and the new timeline.
Pausing replay on a replica (`SELECT pg_wal_replay_pause()`) turns it amber once it passes the lag threshold. In
the petshop demo, the trace of an adoption shows its writes and the claimer's `SKIP LOCKED` on the one instance.

## Open questions

1. **The series names.** Recommended cnpg's default monitoring queries and postgres_exporter v0.20's default
   collectors, checked against both before `postgres-cluster-read`, each overridable on the store if an estate's
   queries differ. Timeline and slot series in particular vary between versions, and are left out with a reason
   rather than guessed.
2. **Discover from Prometheus, or from cnpg's `Cluster` resources in Kubernetes?** Recommended Prometheus first, as
   spec 0057 chose: it finds RDS with an exporter, Patroni and bare VMs too. cnpg's resources could add the cluster's
   intended instance count and its switchover state later, through spec 0031's reader.
3. **Which replica did a read hit?** Recommended *the replicas (ro)* and no closer. A pod-level `server.address` names
   one, but most clients connect through the `-ro` service, and naming a replica Estate cannot see would be a guess.
   The stale-read mark uses the largest lag among them, and says so.
4. **Instance dots on the overview, or only on the page?** Recommended on the lane, from two counts. Spec 0057 kept
   its view off the overview because it is wide; dots are not, and a gone instance is the thing most worth seeing
   from the overview.
5. **MySQL in the same panel?** Recommended not in this spec. Its replica series are thinner in mysqld_exporter
   (no slots, no archive), and the panel should prove itself on Postgres first.

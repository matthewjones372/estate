# 0026 — One read, many pages

## Problem

Estate is one process, many browsers. Each process runs every environment's readers on its own schedule, `forEver`,
into its own `SubscriptionRef`, and spec 0010's shared views share that state with every page watching *that
process*. Run two replicas, for a rollout that keeps the page up or a node that can drain, and there are two Estates:
each reads Prometheus, Alertmanager, the cluster, Flux and the CI tools in full, so N replicas are N times the calls,
N times against a Datadog or GitHub rate limit, and N writers of the same firings, sweeps and debug reverts. They do
not even agree. A note or impact written through one replica reaches its database and its own page, but another
replica loads notes only as it starts, so its pages never show it; a silence held on one is not held on the other.
`deploy/deployment.yaml` says `replicas: 1` for these reasons, and whoever wants more than one has nothing to set.

What is wanted is one read of each source, however many replicas serve the pages, and every replica showing the same
estate. Effect already ships what that takes: `effect/cluster` (entities, `Sharding`, `Singleton`, `ClusterCron`, SQL
storage for runners, shard locks and messages) and, in `@effect/platform-bun`, `BunClusterSocket` and
`BunClusterHttp`, at the 4.0.0 Estate pins.

## Not doing

- **A mesh or service discovery.** Runners find each other through the runner and lock tables in Estate's own
  database, as Effect's cluster does; Estate does not become a product for that.
- **Prometheus, Alertmanager or any source made highly available.** Estate reads one address per source, as now.
  Their HA is theirs.
- **Redis, NATS or another broker.** Effect's SQL storage on the Postgres that notes already use is enough; nothing
  new to run.
- **The catalog, the pages or their UX.** Same pages, same events, same frames; a page cannot tell which replica it
  is attached to.
- **Reads a viewer asks for.** A service's live logs (the log hub), `/api/load` ranges, *Around this alert* and Ask AI
  are read by the replica serving that viewer, on demand, as now. They cost per viewer, not per replica.
- **Changing the default.** Without a `cluster:` section Estate is the one process it is today: no Sharding layer, no
  SQL client for it, no extra port.
- **Sharding by environment, yet.** One owner reads every environment first; spreading environments across runners is
  a later entry, the same code with a different key.

## Shape

```yaml
# estate.yaml: absent means one process, exactly as today
cluster:
  runner: ${POD_IP}:34431          # this runner's address as the others reach it
  listen: 0.0.0.0:34431            # optional; defaults to the runner's port on every interface
  health: ping                     # or k8s: runners judged by their pods (needs get/list pods)
notes:
  postgres: ${ESTATE_POSTGRES}     # required with cluster: shard locks and runners live beside the notes
```

```mermaid
flowchart LR
  subgraph owner["runner A — owns the estate entity"]
    readers["readers: alerts, metrics, cluster,<br/>deploys, builds; firings, sweeps"]
    stateA["Estate SubscriptionRef"]
    readers --> stateA
  end
  subgraph follower["runner B — follows"]
    stateB["Estate SubscriptionRef"]
  end
  stateA -- "Follow: whole state, then changed parts" --> stateB
  follower -- "Apply: note, impact, held silence" --> owner
  pg[("Postgres: estate_notes …<br/>estate_cluster_runners, _locks, _messages")]
  owner --- pg
  follower --- pg
  pagesA["pages · /events · /mcp"] --> stateA
  pagesB["pages · /events · /mcp"] --> stateB
```

```text
Estate entity (effect/cluster Entity, one fixed id "estate" for now)
  on start   runs what `background` runs today: startSources, builds, recordFirings + backfill,
             sweepNotes, sweepHistory, debug reverts; Entity.keepAlive(true) so it never passivates
  Follow     streaming, volatile: the whole EstateState once, then each changed part
             (an environment's metrics | alerts | cluster | deploys | held; builds; notes; firings; impacts;
             catalog) as JSON, compared by reference as stream.ts already compares
  Apply      volatile: a write another runner has made to its tool or database
             (NoteAdded | NoteRemoved | ImpactSet | ImpactCleared | Held | Unheld), applied to the owner's state

Every runner, owner included
  settings read from its own file (sign-in and on-demand reads need them); the catalog comes with the state,
  so every runner shows the owner's, even while a ConfigMap change reaches the pods one by one
  Follow("estate") into its own Estate SubscriptionRef, retried with backOff when the owner moves
  shared views, /events, /readyz, kiosk, /mcp read that SubscriptionRef, unchanged
  /readyz: ready once the first whole state has arrived; its body names the role

Without cluster:
  background runs in-process, as today; no effect/cluster module is loaded
```

```bash
estate doctor
#   cluster      2 runners (10.0.4.12:34431, 10.0.7.3:34431); estate read by 10.0.4.12:34431, lock renewed 4 s ago
```

## Why this shape

The owner is an entity with one fixed id rather than a bare `Singleton.make`. Both give exactly one live instance
across the runners, held by a shard lock in SQL and moved when its runner goes; but a singleton has no address, and
the followers need to ask the owner for the state and hand it their writes. An entity is a singleton you can send to:
`Follow` and `Apply` are its RPCs, and `Entity.keepAlive` stops it passivating. Keying it `"estate"` puts every
environment on one owner, which matches today's process and keeps the first change small; keying it by environment
later spreads the readers across runners with no other change, when an estate has enough environments to want it.

The followers receive the *state*, not the frames. Frames are per viewer (whether they may silence, which
environment) and are only some of what is served: `/api/around`, the kiosk, notes, `/readyz` and the MCP tools all
read the `Estate` `SubscriptionRef`. Feeding each runner's `SubscriptionRef` from the owner keeps every route and spec
0010's shared views exactly as they are, so the change is at the edge of the state and nowhere else. Sending frames
over pub/sub was weighed and would need every route rewritten to read frames; recommended: state, changed parts only.

Writes stay where they are taken: a note goes to Postgres, a silence to Alertmanager, from whichever runner the person
reached. What changes is that the runner then tells the owner (`Apply`) rather than its own state, so every runner
sees it on the next `Follow` frame, which fixes the notes that one replica never shows another today.

Storage is the Postgres already holding notes, with `SqlRunnerStorage` and `SqlMessageStorage` under the prefix
`estate_cluster`; its advisory locks are what make the owner single. Runners talk over `BunClusterSocket` on their own
port, which keeps runner RPCs off the ingress that serves the pages; `BunClusterHttp` would share the port and is not
needed. Bun over Node because Estate is Bun throughout.

The cost is real, and one replica is still the right answer for most estates. Clustering needs Postgres (DynamoDB
notes cannot hold the locks), a second port open between pods with a network policy that allows it, a pod address
each runner knows, and a failover that takes up to the shard lock's expiry (35 s by default) plus one read, during
which pages show the last state with its age, as they do when a source is slow. A single replica restarts in about
the same time. Recommended: stay on one replica unless the tools' rate limits are being met by N replicas, a node loss
must not blank the page, or the viewers (a wall of kiosks) outgrow one process.

## Depends on

- **`effect/cluster` and `BunClusterSocket`** at 4.0.0: in the tree now, marked `@stability unstable` (see Open
  questions).
- **An Effect `SqlClient` for Postgres.** Estate's notes use Bun's `SQL` through a small `Query`, not Effect's
  `SqlClient`, and 4.0.0 ships no Postgres client in `effect/sql`. `@effect/sql-pg` is published at 4.0.0; adding it
  is a `package.json` change in `cluster-opt-in`, not here. Until then nothing changes: no `cluster:`, no client.
- **Spec 0024's `/mcp`** for the MCP tools to be served by every runner; they read the same `SubscriptionRef`, so they
  follow for free when that server lands.

## Stack

One entry per pull request, in build order.

- [x] **`spec-0026`** — this spec, and its row in `specs/README.md` as proposed.
      Done when: `specs/0026-one-read-many-pages.md` is committed and the README lists 0026 as proposed.
- [ ] **`cluster-opt-in`** — `cluster:` in the settings; `@effect/sql-pg` on `notes.postgres`;
      `BunClusterSocket.layer` with SQL storage under `estate_cluster`; the cluster modules loaded only when
      `cluster:` is set.
      Done when: settings tests name `cluster:` without `notes.postgres` as a mistake; a test serves with no
      `cluster:` and no database and builds no `Sharding`; `bun run gate` passes unchanged.
- [ ] **`scrape-singleton`** — the `Estate` entity, id `"estate"`, running what `background` runs today and kept
      alive; a runner that does not own it runs no readers, sweeps or firing records.
      Done when: under `TestRunner`, the readers start once however many runners follow, and stop when the owning
      shard is released.
- [ ] **`view-fanout`** — `Follow`: the whole state, then changed parts; every runner's `Estate` fed from it, retried
      with `backOff`; `/readyz` ready on the first whole state.
      Done when: under `TestRunner`, a follower's `/events` for an environment sends the same frame ids as the
      owner's, and a follower is not ready before its first frame.
- [ ] **`writes-to-owner`** — `Apply` for notes, impacts and held silences; the routes tell the owner, not their own
      state, when clustered.
      Done when: a note posted to one runner and a silence held on it are on the other runner's page within one
      frame, without a restart.
- [ ] **`doctor-ha`** — `estate doctor` prints a `cluster` line from the runner and lock tables; `/readyz` names the
      role (`reading` or `following <address>`); `estate_cluster_owner` gauge; a log line when the role changes.
      Done when: against two runners, doctor names both and exactly one owner.
- [ ] **`cluster-e2e`** — `bun run integration`: Postgres in a container, two Estate processes as runners against
      stub sources that count their calls; the owner killed.
      Done when: two runners make as many calls a read interval as one; after the owner is killed the other reads
      within 60 s, and its pages keep their frames meanwhile.
- [ ] **`deploy-ha`** — `deploy/cluster/`: a patch for two replicas, `POD_IP`, port 34431, a network policy between
      Estate's pods and a disruption budget; `examples/cluster/` settings for two local runners; the README's section
      on when to bother.
      Done when: `kubectl kustomize deploy/cluster` renders, and the base `deploy/` still says `replicas: 1`.

Later, not in this stack: **`shard-by-environment`**, the entity keyed by environment so each runner reads some.

## Acceptance

```bash
bun run gate
bun run integration     # includes the two-runner case against Postgres
```

```bash
# two runners on one machine, the same database
ESTATE_SETTINGS=examples/cluster/a.yaml bun src/server/main.ts &
ESTATE_SETTINGS=examples/cluster/b.yaml bun src/server/main.ts &
bun src/server/main.ts doctor     # cluster: 2 runners, estate read by one
```

## Open questions

- **Adopt now, or wait for Cluster to leave `unstable`?** Every cluster module in 4.0.0 is marked
  `@stability unstable`. Recommended: adopt now, behind `cluster:` only. The default path never loads the cluster
  modules, Effect is pinned exactly, and a breaking 4.x change then costs the opt-in path one PR, not every deploy.
  If the opt-in has no user by the time it is built, park `scrape-singleton` onward rather than carry it.
- **`@effect/sql-pg` or a `SqlClient` over Bun's `SQL`?** Recommended: `@effect/sql-pg`. It is maintained beside
  cluster, and the advisory locks need its Postgres dialect; a hand-written client over Bun's `SQL` is less to
  install but more to keep. Notes stay on Bun's `SQL` either way; the two share a database, not a client.
- **A `Singleton.make` as well as the entity?** Recommended: no. Every serving runner follows, so the entity is always
  woken; a singleton would only matter for a runner that serves nothing, which Estate does not have.
- **How large is a `Follow` frame at a thousand services?** The metrics part changes every read and is most of the
  state. Recommended: changed parts only, numbers to four figures as the services event already sends them; measure
  in `bench` before compressing, and set a budget in spec 0011's style once measured.
- **Two owners for a moment?** A runner cut off from Postgres keeps reading until it notices its lock is gone (up to
  35 s). Reads are harmless twice; firings are upserted by environment, alert and start, sweeps and debug reverts are
  idempotent. Recommended: accept it, rather than fencing every write with the lock.
- **`readOnly: true` with `cluster:`?** Today read-only ignores `notes.postgres`. Recommended: allow the cluster tables
  in read-only, since they are Estate's own and change nothing in the estate's tools; notes stay in memory.
- **Runner health: `ping` or `k8s`?** Recommended: `ping` by default, since it works wherever Estate runs (ECS, a VM,
  a laptop). `k8s` judges runners by their pods and notices a lost one sooner; `deploy/rbac.yaml` already lets Estate
  get and list pods, so it costs nothing extra in Kubernetes.

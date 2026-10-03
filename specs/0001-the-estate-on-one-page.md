# 0001 — The estate on one page

## Problem

A team that runs its own services answers the same questions every morning and every time something breaks, in five
tools that each know one part:

- **Is anything wrong?** The alerts are in Prometheus or Alertmanager, each with a runbook link nobody sees until they
  go looking.
- **What is running where?** Kubernetes and the deploy tool (Flux, Argo) know what is deployed in each environment;
  the CI system knows which build made it, and whether the next one is green.
- **How is it doing?** Grafana, if someone made a dashboard for that service.
- **What did it say?** The logs and traces, each in its own tool, each needing the right query.
- **Why is it doing that?** Turning on debug logging means a change, a build and a deploy, so nobody does it while it
  would help.

The first question they need answered, "is the estate well, and if not, where do I look?", has no page; across
several environments it has none at all.

## Not doing

- **A store of what other tools keep.** Every number, version, alert and log line stays where it is; Estate reads
  them and links to them. If it is down, nothing else is. The two things it keeps are its own: notes on alerts, and
  who switched what.
- **Replacing Grafana, Headlamp, Tempo or the logs.** A panel here is a summary with a link to the tool that goes
  deeper.
- **Backstage.** It answers the same question with a database, Node, and a plugin per source, and is heavier than the
  estates it would describe on small machines.
- **Deploys, restarts or rollbacks.** Those stay with the deploy tool and the cluster, where RBAC already decides them.
  Estate changes two things: silences, and a service's log level.
- **Paging.** Alerts are shown, not sent; Alertmanager pages, if it is set to.
- **Writing a plugin system.** Sources are a small interface in the code, added here; not loaded at run time.

## Shape

**One service, one container, any estate.** Estate is configured by two files and nothing else:

- `estate.yaml`: where it listens, its sign-in, its database for notes, and each environment's sources, with
  `${NAME}` read from the environment so secrets stay out of it;
- `catalog.yaml`: the estate itself, kept in the estate owner's repository and mounted (a ConfigMap), so changing it
  is a commit there.

It ships as an image and a Kubernetes base (`deploy/`: Deployment, Service, ServiceAccount, the RBAC it reads with)
that an estate owner overlays with their catalog, their ingress and their secrets.

**The catalog** names the environments, the services, and the picture of the estate:

```yaml
environments:
  - name: home
    title: Home, 3 machines
    sources: home                      # a section of estate.conf: which Prometheus, cluster, CI
  - name: staging
    sources: staging

services:
  - name: lark-bank
    description: Accounts, money and transfers
    owner: bank
    repository: github:matthewjones372/lark-bank
    build: { workflow: build.yml }
    runbook: https://github.com/matthewjones372/lark-bank/blob/main/docs/runbook.md
    environments: [ home, staging ]
    kubernetes: { namespace: lark-bank, workloads: [ { kind: StatefulSet, name: lark-bank } ] }
    deploy: { flux: { kustomization: apps, imagePolicy: lark-bank } }
    load:                               # PromQL, asked of each environment's own Prometheus
      requests: sum(rate(http_server_requests_total{app="lark-bank"}[1m]))
      errors: sum(rate(http_server_requests_total{app="lark-bank",status=~"5.."}[1m]))
      p99: histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{app="lark-bank"}[5m])))
    links:                              # templates; {env}, {namespace}, {service} filled in
      logs: https://grafana.{env}.example/explore?logs={service}
      traces: https://grafana.{env}.example/explore?traces={service}
      dashboard: https://grafana.{env}.example/d/lark-bank
      api: https://lark-bank.{env}.example/swagger-ui   # its OpenAPI page, if it has one
      app: https://bank.{env}.example                   # its front end, if it has one
    debug: { configMap: lark-bank-logging, key: level, levels: [ INFO, DEBUG ] }
    jobs:                               # Kubernetes Jobs and CronJobs that belong to it
      - { kind: CronJob, name: lark-bank-backup }
    stats:                              # how the process is doing, beside how its traffic is
      preset: jvm                       # jvm, process or container: the usual queries for that kind
      selector: 'app="lark-bank"'       # the labels the preset's queries are narrowed by
      extra:
        - { title: Mailbox depth, query: 'max(lark_mailbox_depth{app="lark-bank"})' }

vitals:                                 # the overview's tiles, per environment
  - title: Transfers
    query: sum(rate(bank_transfers_total[1m]))
    unit: /s

map:                                    # the estate drawn live: nodes are services or stores, edges are rates
  nodes:
    - { id: bank, service: lark-bank }
    - { id: checks, service: bank-checks }
    - { id: kafka, title: Kafka, kind: store }
  edges:
    - { from: bank, to: checks, label: screen, rate: sum(rate(screening_calls_total[1m])), alert: ScreeningSlow }
```

The catalog is checked as Estate starts: an unknown environment, a duplicate service, a map edge to a node that is not
there, or a malformed query stops it with every mistake listed, rather than a page that is quietly wrong.

**Sources**, configured per environment in `estate.yaml`, each optional:

| Source | Gives | First kinds |
|---|---|---|
| Metrics | each service's load, the vitals, the map's rates | Prometheus |
| Alerts | firing, pending, silenced; silences written | Alertmanager, or Prometheus alone (read-only, no silences) |
| Cluster | pods, readiness, restarts, the image each runs; jobs and their runs; debug ConfigMaps written | Kubernetes |
| Deploys | what the deploy tool chose and applied, and why it stalled | Flux |
| Builds | the last runs on the main branch | GitHub Actions |

A section that is missing turns its part of the page off, with a line saying so; a source that does not answer shows
its parts greyed with their age, and the rest carries on.

**The pages**: an overview, a page per service, deploys and alerts, each for the environment chosen in the header,
which remembers the choice. The deploys page shows every environment side by side, so a version moving from staging
to home is one row. Notes and silences, debug, and the states are as in the Design notes below.

**Sign-in** with any OIDC provider (Pocket ID, Keycloak, Dex, Google): the authorization code flow with PKCE, the ID
token checked against the provider's keys, and the session a sealed cookie, so Estate keeps no sessions. Roles come
from the provider's groups, named in `estate.yaml`:

```yaml
auth:
  roles:
    viewer:   [ ops, support, risk, auditor, admins ]   # see everything, add notes
    operator: [ ops, admins ]                           # silence alerts, switch debug
```

For trying Estate out, `auth.anonymous` names one person and role for everyone instead of a provider.

Someone signed in with neither sees the no-access page. Estate writes debug ConfigMaps with its service account,
recording who asked; with `kubernetes.impersonate` it writes them as the person (Kubernetes impersonation, user and
groups), so the cluster's RBAC decides and its audit names them.

**How it is built.** TypeScript on Bun, server and pages alike, so the catalog's schema, the events the server sends
and the pages' props are one set of types. The server is written in [Effect](https://effect.website): every failure a
caller can meet is a tagged error in the type, every dependency a service provided by a layer, so a source is swapped
for its stub in a test by providing a different layer.

- *The server* (`src/server`) keeps a snapshot per environment in a `SubscriptionRef`, filled by its sources, each a
  service with a live layer and a stub, each on its own `Schedule`: Kubernetes, Flux, Prometheus and Alertmanager read
  every 15 to 30 s, GitHub every 60 s with ETags. A source that fails is retried with backoff and
  its parts marked unknown; it never takes the snapshot down. HTTP is `effect/http` served by `@effect/platform-bun`; configuration is
  Effect's `Config`.
- *Server-sent events* carry it to the pages: one stream per environment, `GET /events?env=home`, a `Stream` of the
  snapshot's changes sent as named events (`catalog`, `services`, `alerts`, `deploys`, `feed`) with ids, so a
  reconnect resumes from `Last-Event-ID` or is sent the whole snapshot; a heartbeat every 15 s keeps proxies from
  closing it. Changes (notes, silences, debug) are plain `POST`s, and their effect arrives on the stream like anything
  else.
- *The pages* (`src/web`) are React, bundled by Bun: the stream feeds one small store read with
  `useSyncExternalStore`, each event decoded with the same schema the server encoded it with; charts are SVG drawn by
  hand to the design, with no chart library; the design's tokens are CSS variables.
- *The catalog's and the events' schemas* (`src/shared`) are Effect `Schema`; `estate check catalog.yaml` runs the
  catalog's check from the command line, for an estate's own CI.

**The harness.** The code is written by agents, and the repository keeps them honest; nothing is done until
`bun run gate` passes, and an agent's turn cannot end while it fails (a Claude Code `Stop` hook in
`.claude/settings.json`). The gate is, in order:

| Check | Refuses |
|---|---|
| `tsc` | anything short of `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Biome | format drift; `any`, `console`, non-null assertions, unused imports and variables, a rule switched off inline |
| knip | a file, export or dependency nothing uses |
| dependency-cruiser | a layer reaching where it may not: `shared` imports nothing of ours; `server` never imports `web`, nor `web` `server` |
| the slop check | TODO and FIXME, commented-out code, placeholder text, `.skip` and `.only`, files over 300 lines; in `server` and `shared`, `throw`, `try`, `async` and `new Promise`, which Effect replaces, and `Effect.run*` outside the entry |
| `bun test` | a failing test, or coverage under 90% of lines |

The gate's own configuration is guarded: a `PreToolUse` hook refuses an agent's edit to it, so loosening a rule is
a person's commit. Pages are checked in Playwright against the design (screenshots, and axe for accessibility) from
the entry that first draws one.

**Notes** are kept in Estate's own Postgres, by environment, alert name and labels, with who and when. **Silences**
are Alertmanager's, written through its API with the person's name and reason.

**Debug mode**: the catalog names a service's ConfigMap and the key its level is read from. Estate writes the higher
level with a `debug-until` annotation beside it, and puts it back when that passes, so a restart of Estate loses
nothing. How
a service rereads its level is the service's own concern; a service that cannot is shown as "takes effect on restart".

## Why this shape

Read, don't store: every source keeps its own history, so Estate holds almost nothing and cannot drift. A catalog in
the estate owner's Git rather than labels discovered at run time: what a service's load query is, or which ConfigMap
holds its log level, is a decision someone made, and Git records who and why; discovery from labels is a later
convenience, not the source of truth. Sources compiled in rather than loaded as plugins: five kinds cover most small
estates, and a sixth is one module and a test. TypeScript end to end rather than a JVM or Go server: one language and
one set of types between the sources, the stream and the pages, and a small process, at the cost of the Kubernetes
client being less mature than Go's. Effect rather than plain promises: a dashboard is mostly sources failing,
retrying and timing out, and Effect makes those failures part of each function's type and their handling
`Schedule`s, `timeout`s and fibers rather than code an agent writes again each time.

## Depends on

Nothing. Its first estate, lark-bank, adopts it in its own spec 0026.

## Stack

- [x] **`harness`** — Bun, TypeScript, Effect 4, the gate and its checks, the hooks that hold an agent to it, CI running it.
      Done when: `bun run gate` passes on the repository, fails on each thing the table above refuses (one test each),
      and an agent's edit to the gate's configuration is refused.
      *Notes:* each refusal is tested by running the real tool, with this repository's configuration, on a small
      clean project with one bad file added (`tools/gate/refuses.test.ts`); the clean project passing every check is a
      test too, so a check that silently cruises nothing fails. TypeScript is 6, the last with the compiler API that
      dependency-cruiser reads. Bun prints nothing when coverage is under its threshold, only exits 1, and applies it
      to each file's functions as well as its lines.
- [x] **`skeleton`** — the server on Bun with `effect/http`, OIDC sign-in with roles from groups, the catalog read and checked at start
      and reloaded when it changes, the event stream, the overview listing services per environment with their links,
      the image and `deploy/`.
      Done when: started with a catalog of two environments and four services, a viewer sees them all, switching
      environment changes what is listed, someone in no role sees the no-access page, and a broken catalog stops it
      with every mistake named.
      *Notes:* the routes are tested as a web handler with every source a stub layer, sign-in end to end against a stub
      provider with real keys (PKCE, state, nonce and audience each refused when wrong). The pages are drawn whole now,
      for every entry: each fills in as its part of the stream arrives. Playwright runs them in Chromium with axe
      (`bunx playwright test`, `CHROMIUM` naming the browser where Playwright's own is not installed); it is not yet a
      step of the gate. Bun's coverage threshold holds for functions as well as lines, per file, and counts a class
      as a function it never sees called, so service keys are `Context.Service<Shape>(key)` values and errors are
      `Data.TaggedError` values, not classes. Effect's Bun server listens on `::` unless told otherwise; Estate
      listens on `0.0.0.0` (`host` in `estate.yaml`).
- [x] **`health`** — alerts from Alertmanager or Prometheus, pods from Kubernetes, the deploy tool's state; a health per
      service per environment.
      *Notes:* an alert is known by a hash of its labels, the same from Alertmanager or Prometheus, so its notes follow
      it; Alertmanager gives firing and silenced, Prometheus pending (or all, without Alertmanager); an alert that stops
      firing is kept a day as resolved. An alert belongs to the service its `service`, `app`, `job` or `container`
      label names, or to the only service in its namespace. Pods are found by each workload's own selector. Flux's
      ImagePolicy is read at `v1` then `v1beta2`. Sources start for the environments in the catalog Estate started
      with; one a reloaded catalog adds is read from the next start.
- [x] **`deploys`** — builds from GitHub Actions, Flux's choice, the running image; the deploys page across environments.
      *Notes:* builds are read for every service with a `repository` and `build.workflow`, eight runs on its branch,
      every minute with the last ETag (a 304 costs nothing of GitHub's rate limit); `builds.github` in `estate.yaml`
      holds the token and, for GitHub Enterprise, the API's URL. The running version is the tag of the image a ready
      pod runs, or its digest's start.
- [x] **`load`** — the vitals, sparklines, the service page's charts, the map's rates.
      *Notes:* each environment's Prometheus is asked every 30 s for the last hour, a point a minute; the service page's
      longer ranges are `GET /api/load` (6 h at 5 min, 24 h at 15 min, 7 d at an hour). A firing alert's card draws the
      measure its alerting rule compares (`measure > threshold`, read from `/api/v1/rules`), for the alert's own labels.
      A query that fails leaves its line empty; Prometheus not answering marks the part failing.
- [x] **`stats`** — a service's stats from its preset (`jvm`, `process`, `container`) and its own queries, as charts on
      its page. Done when: a JVM service shows heap, GC pauses, threads and CPU from Micrometer's metrics, and a query
      of its own beside them.
      *Notes:* a preset is narrowed by `selector`, or by `app="<service>"` (a container's by its namespace and pods
      named after it). Stats are read with the load, every 30 s and over the service page's ranges; their queries are
      checked with the rest of the catalog. Units the page knows: `bytes`, `cores`, `s`, `%`, and rates as `/s`.
- [x] **`jobs`** — Jobs and CronJobs from Kubernetes: schedule, last run, its outcome and duration, whether one runs
      now; a failed or missed run in the service's health and the feed. Done when: a CronJob whose last Job failed
      makes its service need attention, naming the job.
      *Notes:* read with the cluster every 15 s: a CronJob's schedule and its last five Jobs (found by their owner),
      a Job by name. A run is missed when the schedule's next time after the last scheduled run is more than five
      minutes past; schedules are read in the CronJob's `timeZone`, or UTC.
- [x] **`notes`** — notes on alerts, kept in Postgres.
      *Notes:* `notes.postgres` in `estate.yaml` (a URL, usually `${DATABASE_URL}`); Estate makes its one table,
      `estate_notes`, if it is not there. Without it notes are kept in memory, for trying Estate out. A note is 1 to
      2,000 characters, under the name of whoever is signed in; the last 500 are on the stream. A database that does
      not answer as Estate starts stops it, named; one that stops answering later refuses new notes with its words.
- [x] **`silences`** — silences through Alertmanager, with a reason.
      *Notes:* for operators, in an environment with an Alertmanager: a silence matches the alert's every label,
      lasts a minute to a week, and carries the person's name and reason; the page shows it at once, and lifting it
      expires it in Alertmanager. What Alertmanager answers when it refuses is shown in its words.
- [x] **`debug`** — the debug switch and its revert.
      *Notes:* an operator turns it on for a minute to a day: the catalog's last level is written to the key it names,
      with `estate.dev/debug-until`, `-since` and `-by` annotations beside it (a merge patch); every minute Estate puts
      the first level back wherever `debug-until` has passed. With `kubernetes.impersonate`, the patch is made as the
      person and their groups, so the cluster's RBAC decides and its audit names them; `deploy/rbac.yaml` gives Estate
      `patch` on ConfigMaps for the rest.
- [ ] **`feed`** — what changed today, from the sources and Estate's own records.

## Acceptance

```bash
bun run gate
docker run -v ./examples:/etc/estate -p 8080:8080 estate   # the example catalog, against nothing: every part says why
```

## Open questions

1. **Its name?** Estate, for now.
2. **Helm chart or a Kubernetes base?** Recommended a base (`deploy/`) to overlay with Kustomize first; a chart when
   someone outside asks.
3. **One Estate per environment, or one for all?** Recommended one for all, reading each environment's sources, so the
   deploys page can put them side by side; one per environment works too, with a single entry in its catalog.

## Design notes

The design is a canvas: https://claude.ai/artifact/CH96MB3RQrsthLVtWKNi4p, drawn for lark-bank's estate with its real
services, alerts and commits. Where this section and the canvas disagree, the canvas wins.

**The look: a control room at night.** Dark and calm when all is well; amber is the only colour that asks for
attention, spent on exactly what needs someone. Healthy is a small green dot beside the word, never a fill. Red is for
down or critical, always with the word. Debug is violet, so it never reads as a problem.

| Token | Value |
|---|---|
| Ground | `#0B0D12` |
| Panel, raised | `#11141B`, `#161A23` |
| Line, strong | `#1E2330`, `#2A3040` |
| Ink, secondary, muted | `#E9ECF2`, `#A9B0BE`, `#8C93A3` |
| Link | `#8FB0FF` |
| Attention | `#F5A524`; text `#F5B54A`; panel `#16130C`; border `#4A3510` |
| Critical | `#FF5D5D` |
| Healthy dot | `#3DD68C` |
| Debug | `#A98BFF` on `#221A3D` |
| Type | Instrument Sans for the UI; JetBrains Mono for numbers, versions and shas |

**The environment** is chosen in the header: a switcher that shows each environment with a dot for its worst state,
so trouble in staging is visible from home. Every page is for the chosen one, except Deploys, which shows them all.

**Overview**: a headline written from the state ("All quiet." / "Two things need you."); the vitals; the map, live;
the alerts that need someone as cards that draw the metric that fired against its threshold, with notes and Silence;
a lane per service (health, its pipeline as a rail, sparklines, links (its front end and its API page when it has them,
logs, traces, dashboard, repository, runbook), debug badge); what changed today.

**Service**: its load over a chosen range with the alert's threshold drawn in, its stats (for a JVM: heap, GC pauses,
threads, CPU), its pods as cards, its jobs with their schedule and last runs, its alerts over the day, the debug
switch, and its builds.

**Jobs**: a job's last run that failed makes its service need attention, with the job's name and the words the
cluster used; a CronJob that has not run when its schedule says it should have counts the same. A running job shows
as running, with how long it has been.

**Deploys**: a row per service, its versions across the environments, and each environment's pipeline (commit,
build, chosen, running); a stalled step says why in the words the tool used.

**Alerts**: firing, pending and silenced together, filtered by state and service, each with its latest note, its
runbook and Silence or Unsilence; what resolved today below.

**States**: all quiet; a source that did not answer; signed in with no role; first load, each source ticked off as it
answers. Never a blank page.

**Behaviour**: refreshes every 30 s in place; every link opens the deeper tool already filtered; all motion stops
under reduced motion; works at phone width; plain words.

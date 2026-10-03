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

- `estate.conf`: where it listens, its sign-in, its database for notes, and each environment's sources;
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
    load:                               # PromQL; {env} labels are added per environment's source
      requests: sum(rate(http_server_requests_total{app="lark-bank"}[1m]))
      errors: sum(rate(http_server_requests_total{app="lark-bank",status=~"5.."}[1m]))
      p99: histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{app="lark-bank"}[5m])))
    links:                              # templates; {env}, {namespace}, {service} filled in
      logs: https://grafana.{env}.example/explore?logs={service}
      traces: https://grafana.{env}.example/explore?traces={service}
      dashboard: https://grafana.{env}.example/d/lark-bank
    debug: { configMap: lark-bank-logging, key: level, levels: [ INFO, DEBUG ] }

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

**Sources**, configured per environment in `estate.conf`, each optional:

| Source | Gives | First kinds |
|---|---|---|
| Metrics | each service's load, the vitals, the map's rates | Prometheus |
| Alerts | firing, pending, silenced; silences written | Alertmanager, or Prometheus alone (read-only, no silences) |
| Cluster | pods, readiness, restarts, the image each runs; debug ConfigMaps written | Kubernetes |
| Deploys | what the deploy tool chose and applied, and why it stalled | Flux |
| Builds | the last runs on the main branch | GitHub Actions |

A section that is missing turns its part of the page off, with a line saying so; a source that does not answer shows
its parts greyed with their age, and the rest carries on.

**The pages**: an overview, a page per service, deploys and alerts, each for the environment chosen in the header,
which remembers the choice. The deploys page shows every environment side by side, so a version moving from staging
to home is one row. Notes and silences, debug, and the states are as in the Design notes below.

**Sign-in** with any OIDC provider (Pocket ID, Keycloak, Dex, Google). Roles come from the provider's groups, named in
`estate.conf`:

```hocon
estate.roles {
  viewer   = [ ops, support, risk, auditor, admins ]   # see everything, add notes
  operator = [ ops, admins ]                           # silence alerts, switch debug
}
```

Someone signed in with neither sees the no-access page. Where the cluster takes the provider's tokens (as Headlamp
needs), Estate writes debug ConfigMaps with the person's own token, so RBAC decides and the audit names them;
otherwise with its service account, recording who asked.

**Notes** are kept in Estate's own Postgres, by environment, alert name and labels, with who and when. **Silences**
are Alertmanager's, written through its API with the person's name and reason.

**Debug mode**: the catalog names a service's ConfigMap and the key its level is read from. Estate writes the higher
level with a `debug-until` time beside it, and puts it back when that passes, so a restart of Estate loses nothing. How
a service rereads its level is the service's own concern; a service that cannot is shown as "takes effect on restart".

## Why this shape

Read, don't store: every source keeps its own history, so Estate holds almost nothing and cannot drift. A catalog in
the estate owner's Git rather than labels discovered at run time: what a service's load query is, or which ConfigMap
holds its log level, is a decision someone made, and Git records who and why; discovery from labels is a later
convenience, not the source of truth. Sources compiled in rather than loaded as plugins: five kinds cover most small
estates, and a sixth is one class and a test. Built on Lark and Pelican, as its first estate is, but nothing in it
knows about any one estate.

## Depends on

Nothing. Its first estate, lark-bank, adopts it in its own spec 0026.

## Stack

- [ ] **`skeleton`** — the service on Lark and Pelican, OIDC sign-in with roles from groups, the catalog read and
      checked at start, the overview listing services per environment with their links, the image and `deploy/`.
      Done when: started with a catalog of two environments and four services, a viewer sees them all, switching
      environment changes what is listed, someone in no role sees the no-access page, and a broken catalog stops it
      with every mistake named.
- [ ] **`health`** — alerts from Alertmanager or Prometheus, pods from Kubernetes, the deploy tool's state; a health per
      service per environment.
- [ ] **`deploys`** — builds from GitHub Actions, Flux's choice, the running image; the deploys page across environments.
- [ ] **`load`** — the vitals, sparklines, the service page's charts, the map's rates.
- [ ] **`notes`** — notes on alerts, kept in Postgres.
- [ ] **`silences`** — silences through Alertmanager, with a reason.
- [ ] **`debug`** — the debug switch and its revert.
- [ ] **`feed`** — what changed today, from the sources and Estate's own records.

## Acceptance

```bash
./gradlew build
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
a lane per service (health, its pipeline as a rail, sparklines, links, debug badge); what changed today.

**Service**: its load over a chosen range with the alert's threshold drawn in, its pods as cards, its alerts over the
day, the debug switch, and its builds.

**Deploys**: a row per service, its versions across the environments, and each environment's pipeline (commit,
build, chosen, running); a stalled step says why in the words the tool used.

**Alerts**: firing, pending and silenced together, filtered by state and service, each with its latest note, its
runbook and Silence or Unsilence; what resolved today below.

**States**: all quiet; a source that did not answer; signed in with no role; first load, each source ticked off as it
answers. Never a blank page.

**Behaviour**: refreshes every 30 s in place; every link opens the deeper tool already filtered; all motion stops
under reduced motion; works at phone width; plain words.

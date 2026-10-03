# Estate

[![gate](https://github.com/matthewjones372/estate/actions/workflows/gate.yml/badge.svg)](https://github.com/matthewjones372/estate/actions/workflows/gate.yml)
[![image](https://github.com/matthewjones372/estate/actions/workflows/image.yml/badge.svg)](https://github.com/matthewjones372/estate/pkgs/container/estate)
![Bun](https://img.shields.io/badge/Bun-1.3-14151a?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Effect](https://img.shields.io/badge/Effect-4-0b0d12)
![Solid](https://img.shields.io/badge/Solid-1.9-2c4f7c?logo=solid&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-3dd68c)](LICENSE)

**A control room for your engineering estate.**

Estate is designed to answer one question in five seconds: **how is our stack doing right now?**

It brings together the signals you already have (alerts, deploys, builds, Kubernetes, load, jobs) into one live
page per environment. It doesn't replace Prometheus, Grafana, Alertmanager, Datadog, Flux or GitHub Actions. **It
sits above them**, and everything on the page links back to the tool that owns it, so the place to dig in is one
click away.

![The overview: what needs you now, each service's lane, and what changed today](docs/overview.png)

## Why Estate?

Teams rarely lack operational data. What they lack is knowing **what matters right now**. A deploy has just rolled
out, an alert has fired, a build has failed, a pod is restarting, and each of those is in a different tool. Someone
opens six tabs to put the picture together, and the next person does it again.

Estate puts the picture together once, keeps it live, and shows it to everyone. It answers:

- **Is anything wrong?** What's firing, drawn against its threshold, with its runbook, what it means for the people
  using the product, and whether it has happened before.
- **What changed?** Deploys, builds, alerts, silences and notes from today, in one feed.
- **What's deployed where?** Each service's path from commit to build to the version running, in every environment,
  and a deploy that stalled says why in the deploy tool's own words.
- **How busy is it?** The last hour of requests, errors and p99 for every service, and stats for its databases,
  queues and caches.
- **Who do I ask?** Each service's team, with its Slack or Teams channel, its Confluence or Notion pages and its
  on-call.
- **Where do I look next?** Its logs, traces, dashboards and API docs, one click away.

## What it brings together

| | |
|---|---|
| Alerts | Alertmanager, Grafana alerting, CloudWatch alarms, Datadog monitors |
| Metrics | Prometheus (or anything with its query API), Datadog, CloudWatch |
| Runtime | Kubernetes, ECS |
| Deploys | Flux, Argo CD, Harness CD, ECS deployments |
| Builds | GitHub Actions, GitLab CI, Jenkins, TeamCity, Harness CI |
| Logs | Loki, Datadog, Elasticsearch/OpenSearch, or pod logs straight from the cluster |
| AI agents | Runs, failures, tokens against a budget and the model in use, from the GenAI metrics they already send |
| Notes, impact and alert history | Postgres, DynamoDB, or memory |

Where Grafana sits in front of Prometheus and Loki, Estate reaches them through Grafana with one service account
token, rather than with addresses and credentials of their own. The same page works on other stacks: EKS with
Grafana's alerting, Argo CD and Elasticsearch, or an environment read wholly from Datadog and built by Jenkins.

![An environment on Grafana, Argo CD and Elasticsearch](docs/eks.png)
![An environment on Datadog](docs/datadog.png)

> **Read, don't store.** Your tools own their data. Estate reads it live each time it shows it. It keeps only what
> it adds: notes, what an alert means, and each alert's past firings.

## What you can do from the page

- add a note to an alert so the next person knows someone's on it
- say what an alert means for the people using the product, kept for every time it fires
- see whether an alert has fired before, for how long, and what was written about it then
- silence an alert for a while, with a reason everyone can see
- turn on debug logging for a service for 15 minutes; it switches itself back off
- watch a service's logs live, or see its errors grouped by message
- compare what's deployed in each environment

Viewers see everything and add notes. Operators can also silence, switch debug, and write what an alert means.

![A service page: load, logs, pods, jobs, alerts today, debug and builds](docs/service.png)

Services, stores and jobs can be grouped by **category**, such as Payments or Data, so a page of forty services
reads as five areas. The map at the top draws a node per category once there are more than a dozen, and opens one
in place when you click it. Anything that needs someone is always drawn on its own.

### On a screen

`/kiosk` is for the screen on the wall: the headline, what's firing and every service worst first, in type you can
read across a room, with nothing to press. Open `/kiosk?token=…` once on the screen; it signs in for 30 days and can
read but never change anything. Environments take turns; `?team=payments` or `?category=Payments` narrows it; and
if the screen stops hearing from Estate, it says so in red.

![The kiosk on a 1080p screen](docs/kiosk.png)

## Try it

```bash
docker run -v ./examples:/etc/estate -p 8080:8080 ghcr.io/matthewjones372/estate:main
```

Then open <http://localhost:8080>. The example points at tools that don't exist, so each part of the page tells you
what it couldn't reach. Edit `examples/estate.yaml` to point it at your own.

To try it against your team's real tools, set `readOnly: true` in `estate.yaml` so Estate writes nothing (no
silences, no debug switching, notes only in memory), then ask the doctor:

```bash
docker run -v ./my-estate:/etc/estate --env-file my-estate/.env ghcr.io/matthewjones372/estate:main doctor
```

It asks each tool once and prints a line per part: what answered, how many alerts matched a service, which services
have no running pods or no log lines, and which setting would fix it. [docs/real-tools.md](docs/real-tools.md) has the
settings for each tool, and what each line should say when it's right.

## Configure it

Estate reads two files from `/etc/estate`. `catalog.yaml` says what your estate is, and lives in Git, so adding a
service is a pull request:

```yaml
environments:
  - { name: production, sources: production }   # sources: which section of estate.yaml has its tools

teams:
  - name: payments
    title: Payments
    links: { slack: "https://example.slack.com/archives/C0PAY", oncall: "https://example.pagerduty.com/schedules/PPAY" }

services:
  - name: payments
    owner: payments
    category: Payments
    environments: [ production ]
    kubernetes: { namespace: shop, workloads: [ { kind: Deployment, name: payments } ] }
    deploy: { flux: { kustomization: shop, imagePolicy: payments } }
    build: { github: { workflow: payments.yml, branch: main } }
    load:
      requests: sum(rate(http_requests_total{app="payments"}[1m]))
      p99: histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{app="payments"}[5m])))
    links:
      logs: "https://grafana.example.com/explore?var-env={env}&var-service={service}"
      traces: "https://grafana.example.com/explore?var-service={service}"

alerts:
  PaymentsFailing: { impact: "Customers cannot pay; orders wait in their baskets." }
```

`estate.yaml` holds the settings: sign-in, roles, where each environment's tools are, and where to keep notes.
Secrets are written as `${NAME}` and read from the environment.

`estate check catalog.yaml` reports every mistake in one go, with where it is, so it fits in CI. Estate reloads the
catalog when it changes. There is deliberately no automatic discovery: the catalog is explicit and reviewed.
[`examples/catalog.yaml`](examples/catalog.yaml) uses every option, including stores, jobs no service owns, the map
and vitals.

## How it compares

Estate sits beside these tools, not instead of them, and links into each.

- **Backstage, Port, Cortex** catalog what you own. Estate shows how it's doing right now.
- **Grafana** can chart anything, but someone has to build and maintain the boards. Estate needs none.
- **k9s, Lens, Headlamp** go deep on one cluster. Estate covers several environments and links into them.
- **Argo CD's UI, Weave GitOps** show the deploy tool. Estate puts that next to the build and what's running.
- **Karma, Keep** handle alerts on their own. Estate shows each one next to the service it's about.

## Technical details

### Deployment

Images for amd64 and arm64 are published to `ghcr.io/matthewjones372/estate` from `main`. [`deploy/`](deploy) has a
Kubernetes base to overlay with your two files, an ingress and your secrets. It runs as one container in about
120 MB.

- **Sign-in** is OIDC with PKCE, groups mapped to viewer and operator. Anonymous sign-in is there for trying it out.
- **Health**: `/healthz` says the process is up, and `/readyz` says every source has been read at least once.
- **Its own telemetry**: metrics on `:9464/metrics`, JSON logs, and traces over OTLP if you set a collector.

### Architecture

```mermaid
flowchart LR
  tools["Your tools<br/>Prometheus · Alertmanager · Kubernetes<br/>Flux · GitHub Actions · Datadog · …"]
  sources["Sources<br/>one reader per tool, each on its own interval"]
  state["Estate's state<br/>the current estate, in one place"]
  web["Pages<br/>Solid"]
  tools --> sources --> state -- "server-sent events" --> web
```

Each tool is a **source** behind a typed port, with a fake for tests. Sources do the talking, retries and timeouts.
Estate holds the current state, and each environment's views are built once and shared by every page watching it.
A new page receives a snapshot, then only what changes; a page that reconnects resumes from its `Last-Event-ID`.

The server is [Effect](https://effect.website), because the work is remote calls that fail, retries, timeouts,
schedules, concurrency and long-lived streams. With Effect, a tool being down is part of the typed error model, not
an exception somewhere in a request. The pages are [Solid](https://www.solidjs.com), redrawing only what changed.

```mermaid
flowchart LR
  web["src/web"] --> shared["src/shared<br/>schemas both sides decode with"]
  server["src/server"] --> shared
```

The server and the pages never import each other, and `shared` imports nothing of ours. Those boundaries are
checked on every build.

### Performance

Fifty is about the most a team puts on one page, and the build fails if Estate gets slower there. A thousand is a
stress test. Both are measured by [`bench/`](bench) against fake tools that answer in 20 ms:

| | 50 services, 5 pages | 1,000 services, 20 pages |
|---|---|---|
| Calls to the tools a second | 11 | 101 |
| First data to a page | 0.1 MB | 2 MB |
| Estate's CPU | 3% of a core | 52% |
| Estate's memory | 136 MB | 174 MB |
| Page drawn | 0.5 s | 2.2 s |

Every page watching an environment shares one stream, so more pages cost little. Each source is read on its own
interval, which `every:` lengthens for tools that limit or bill each call.

### Testing

```bash
bun install
bun run gate          # typecheck, lint, unused code, layering, slop, tests with coverage
bunx playwright test  # the pages in a browser against fake tools, with axe accessibility checks
bun run perf          # fifty services against the budgets
bun run integration   # Estate's readers against the real tools in containers: needs Docker
```

**If it isn't passing the gate, it isn't finished.** The gate runs strict TypeScript, Biome, Knip,
dependency-cruiser, and the tests, which must cover 90% of the lines in every file. It also refuses `any`, non-null assertions,
`console`, TODOs, commented-out code, skipped tests, files over 300 lines, rules switched off inline, and running an
Effect inside application code. The same gate is the agent's stop hook. `bun run integration` runs the readers
against real Prometheus, Alertmanager, Grafana, Loki, Elasticsearch, Postgres, DynamoDB, Jenkins, LocalStack and
Kubernetes.

[AGENTS.md](AGENTS.md) covers code conventions. Every change starts as a spec in [specs/](specs).

### Design principles

- **One operational view.** The state of the estate should be obvious without opening six dashboards.
- **Not another system of record.** Prometheus owns metrics, Alertmanager owns alerts, Kubernetes owns workloads,
  Git owns configuration. Estate combines them.
- **Configuration over discovery.** The catalog is explicit and reviewable in Git.
- **Fail explicitly.** Tools go down, tokens expire, APIs change. When a source stops answering, the page says which
  and since when, rather than showing stale data as if it were current.
- **Keep the browser simple.** The integration work happens on the server, once, for every page.
- **Make changes obvious.** Reading and changing are separate, and every change says who made it and why.

## License

[MIT](LICENSE)

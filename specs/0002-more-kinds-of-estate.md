# 0002 — More kinds of estate

## Problem

Estate reads Prometheus, Alertmanager, Kubernetes, Flux and GitHub Actions. That covers more than it sounds:

- EKS, GKE, AKS, k3s, OpenShift and Talos all speak the Kubernetes API.
- Thanos, Mimir, Cortex, VictoriaMetrics and Grafana Cloud's metrics all answer Prometheus's query API.
- Mimir's ruler answers Alertmanager's API.

A team outside that set gets an empty lane where its deploys, builds, alerts or logs should be. The ones most teams
run instead are:

- **Grafana alerting** in place of Alertmanager. Grafana answers Alertmanager's API under its own path, but only to a
  service account's token, and its rules, which give an alert's threshold, are behind another path.
- **Elasticsearch** (or OpenSearch) in place of Loki for logs.
- **Argo CD** in place of Flux.
- **AWS ECS** in place of Kubernetes, with CloudWatch for its alarms.
- **GitLab CI** or **Buildkite** in place of GitHub Actions.

Further out are Nomad, Cloud Run and Datadog.

## Not doing

- **Every tool.** A kind is added when a team using Estate runs it, not to fill a matrix. Further out is listed so
  the shape allows it, not as a promise.
- **Plugins loaded at run time.** A kind is a module and a test in this repository, as in spec 0001.
- **Writing to a new kind** beyond what Estate already writes: silences where the alerts tool has them, debug where
  the runtime has a place for a level. Elsewhere those parts are read-only and say so.
- **Logs from every store.** Loki and the cluster (spec 0007), then Elasticsearch; CloudWatch Logs and Datadog's
  logs still link out.

## Shape

Each source kind becomes one implementation of a port per part, chosen by the key in `estate.yaml`.

| Part | Port gives | Kinds now | Kinds added, in order |
|---|---|---|---|
| Runtime | each service's instances: ready, restarts, the version each runs; jobs; debug written | Kubernetes | ECS (tasks of a service, its deployments, scheduled tasks), then Nomad |
| Deploys | what the deploy tool chose, whether it applied, why it stalled | Flux | Argo CD (an Application's sync and health, in Argo's words), ECS deployments |
| Alerts | firing, pending, silenced; silences written | Alertmanager, Prometheus | Grafana alerting (silences written through its Alertmanager API), CloudWatch alarms (read-only: `ALARM` is firing, `INSUFFICIENT_DATA` is pending) |
| Logs | a service's lines over a range, newest first | Loki, Kubernetes | Elasticsearch and OpenSearch (`_search` over an index pattern) |
| Metrics | a query over a range | Prometheus's API | CloudWatch metrics (`GetMetricData`), then Datadog |
| Builds | the last runs on a branch | GitHub Actions | GitLab CI pipelines, then Buildkite |
| Notes | Estate's own notes, kept | Postgres, memory | DynamoDB, for an estate on AWS with no database of its own |

The catalog names a service the same way whatever the kind, by what that kind calls it:

```yaml
services:
  - name: orders
    runtime: { ecs: { cluster: shop, service: orders } }       # or kubernetes: { namespace, workloads }
    deploy: { argo: { application: orders } }                  # or flux: { kustomization, imagePolicy }
    build: { gitlab: { project: shop/orders, ref: main } }     # or github: { workflow, branch }
```

```yaml
# estate.yaml, an environment's sources
production:
  aws: { region: eu-west-2 }               # ECS and CloudWatch, through the task's role or the usual AWS variables
  grafana: { url: https://grafana.example, token: ${GRAFANA_TOKEN} }   # its alerting, in place of alertmanager:
  elasticsearch:                           # logs, in place of loki:
    url: https://logs.example:9200
    index: "logs-*"
    apiKey: ${ELASTIC_API_KEY}             # or username and password
  argo: { url: https://argocd.example, token: ${ARGO_TOKEN} }
  gitlab: { url: https://gitlab.example, token: ${GITLAB_TOKEN} }
```

`kubernetes:`, `flux:` and `build: { workflow }` keep working as now; the new keys sit beside them.

Elasticsearch finds a service's lines by fields, not a label selector. The defaults are the ones Filebeat, Elastic
Agent and the OpenTelemetry collector write (`kubernetes.namespace`, `kubernetes.labels.app`, `message`,
`@timestamp`, `log.level`); a service whose lines are shipped otherwise names its own:

```yaml
services:
  - name: orders
    logs:
      elastic: { match: { "service.name": orders }, message: message }
```

The page does not change: a lane, a pipeline rail, the deploys row and the feed read the same whichever kinds filled
them. A part a kind cannot give says so in a line, as a source that is not set up does today.

## Why this shape

The views already work from Estate's own state, not from any tool's shapes, so a new kind is a reader and its test
against a stub of that tool's API, as each source is now. Adding kinds one by one, in the order teams ask, keeps each
entry small and tested against the real tool's answers.

Two alternatives were considered:

- **OpenTelemetry or a generic webhook**, where tools push into Estate: Estate would have to store what it is sent,
  which spec 0001's "read, don't store" rules out.
- **Discovering services from tags** (ECS tags, Kubernetes labels) instead of a catalog: still a later convenience,
  for the reasons spec 0001 gives.

## Depends on

Nothing. ECS and CloudWatch need AWS's request signing (SigV4), done here with WebCrypto rather than the AWS SDK, so
the image stays small.

## Stack

- [x] **`grafana-alerts`** — `grafana:` as an environment's alerts: firing and pending from
      `/api/alertmanager/grafana/api/v2/alerts`, silences listed and written there, each alert's threshold from
      `/api/prometheus/grafana/api/v1/rules`, with a service account's token.
      Done when: a firing Grafana alert shows on the page with its chart, and a silence written on the page is in
      Grafana.
- [x] **`elastic-logs`** — `elasticsearch:` as an environment's logs: live lines and errors over a range from
      `_search`, sorted by `@timestamp`, filtered by the service's fields and the time; an API key or a user.
      Done when: the logs panel shows a service's live lines and grouped errors from Elasticsearch, as it does from
      Loki.
- [x] **`ports`** — the runtime, deploys and builds parts as ports, with today's kinds behind them, and the catalog
      keys above beside today's.
      Done when: every existing test passes through the ports, and a catalog using the new keys for today's kinds
      is the same page.
- [ ] **`argo`** — Argo CD Applications: sync status, health, the revision chosen, why a sync failed.
      Done when: an Application out of sync shows its rail stalled with Argo's message.
- [ ] **`gitlab`** — GitLab CI pipelines on a ref, with ETags.
      Done when: a running pipeline shows the build step in progress, and a failed one names its job.
- [ ] **`aws-signing`** — SigV4 for AWS's JSON APIs, from the task role, instance role or environment.
      Done when: signed against AWS's published test suite.
- [ ] **`dynamodb-notes`** — notes kept in a DynamoDB table (`notes: { dynamodb: { table, region } }`), beside
      Postgres and memory: the environment and alert as the key, the time as the sort key, made on demand if the role
      may create it.
      Done when: notes added on the page survive Estate restarting, against DynamoDB Local.
- [ ] **`ecs`** — ECS services: running and desired tasks, each task's image and health, deployments rolling or
      failed, scheduled tasks as jobs.
      Done when: a service whose deployment is failing shows it stalled with ECS's reason.
- [ ] **`cloudwatch`** — CloudWatch alarms as alerts (read-only) and `GetMetricData` as a metrics source.
      Done when: an ECS service's estate shows its alarms, load and vitals with no Prometheus.
- [ ] **`buildkite`**, **`nomad`**, **`datadog`**, **`cloud-run`** — each when someone running Estate asks.

## Acceptance

```bash
bun run gate
bunx playwright test   # e2e/tools.ts gains Grafana, Elasticsearch, Argo CD, GitLab, ECS and CloudWatch, in their shapes
```

## Open questions

1. **Which first?** Grafana alerting and Elasticsearch first, since a team asked for them; each is a reader beside
   one that exists, needing no ports. Then Argo CD, then GitLab CI: each is one reader against a well-documented API, and
   between them they cover most Kubernetes teams not on Flux or GitHub. ECS and CloudWatch next, as one step that
   gives a whole AWS estate without Kubernetes.
4. **OpenSearch?** Recommended the same reader: its `_search` takes the same query for what Estate asks, and it
   differs in signing (AWS's) only when hosted by AWS, which `aws-signing` gives.
2. **The AWS SDK or our own signing?** Recommended our own: SigV4 is one documented algorithm, and the SDK would
   double the image for four API calls.
3. **Silences on CloudWatch?** Recommended not: alarms can be disabled, but that is a change to the alarm, not a
   silence with a reason and an end. A CloudWatch estate's alerts are read-only, and the page says so.

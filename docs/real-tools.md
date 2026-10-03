# Checking Estate against real tools

Estate's unit tests run every integration against fakes that answer in each tool's documented shape.
`bun run integration` runs Estate's readers and writers against the real Prometheus, Alertmanager, Grafana, Loki,
Elasticsearch, Postgres, DynamoDB Local, Jenkins and Kubernetes (k3s, with Flux's resources) in containers, in about
three minutes. The tools that only run as
a service (Datadog, Harness, GitHub), and TeamCity, whose server and build agent are too heavy for the suite, are
checked against a real account the way below, in a few minutes, without Estate changing anything.

## Before you start

Make a directory with an `estate.yaml`, a `catalog.yaml` and a `.env` holding the tokens:

```yaml
# my-estate/estate.yaml
readOnly: true            # no silences, no debug switching, notes in memory: nothing is written to any tool
catalog: /etc/estate/catalog.yaml
auth:
  sessionSecret: a-secret-for-trying-estate-out-only-32
  roles: { viewer: [ ], operator: [ ] }
  anonymous: { name: me, role: operator }
sources:
  production:
    # one of the sections below
```

```yaml
# my-estate/catalog.yaml
environments:
  - { name: production, sources: production }
services:
  - name: checkout          # a real service, by the name its tools use
    environments: [ production ]
```

Then run the doctor, which asks each tool once and prints a line a part:

```bash
docker run -v ./my-estate:/etc/estate --env-file my-estate/.env ghcr.io/matthewjones372/estate:main doctor
# or, from a checkout:
ESTATE_SETTINGS=my-estate/estate.yaml bun src/server/main.ts doctor
```

Each line is `part ok|fail what it found`. If a line is not what the tool shows for the same service, the line
itself, with names changed if you like, is what is needed to fix it.

## Datadog

```yaml
    datadog: { site: datadoghq.eu, apiKey: "${DD_API_KEY}", appKey: "${DD_APP_KEY}", tags: [ "env:production" ] }
```

```yaml
  - name: checkout
    load:
      requests: sum:trace.http.request.hits{service:checkout,env:production}.as_rate()
      p99: p99:trace.http.request{service:checkout,env:production}
```

The application key needs the scopes `monitors_read`, `timeseries_query` and `logs_read_data`, and
`monitors_downtime` once silencing is wanted.

| Line | Right when |
|---|---|
| `alerts` | It counts the monitor groups in Alert, Warn or No Data that Datadog's Monitors page shows for `env:production`, and those tagged `service:checkout` are "about a service". |
| `charts` | A firing monitor with a `> threshold` in its query has a threshold to chart against. |
| `metrics` | `datadog: checkout requests …` is near what a Datadog dashboard shows for the same query now. "no data" means the query, not Estate. |
| `logs` | `Datadog: checkout N lines in 15 min`, about what Log Explorer shows for `service:checkout env:production`. |

What the fakes cannot prove: the shape of `/api/v2/query/timeseries` answers, and the `x-ratelimit-reset` header
on a 429. A failing `metrics` line saying "a shape Estate does not know" is the first; the second only shows under
load.

## Grafana in front of Prometheus and Loki

```yaml
    grafana: { url: https://grafana.example.com, token: "${GRAFANA_TOKEN}", prometheus: <uid>, loki: <uid> }
    alertmanager: { url: … }   # leave out: Grafana's alerting is read when grafana is set
```

A data source's uid is the last part of its URL under Connections → Data sources. The service account needs the
Viewer role, and query permission on both data sources, to read; to silence from Estate it needs Editor, since
Grafana refuses a viewer's silence with 403. `bun run integration` checks both against a real Grafana.

| Line | Right when |
|---|---|
| `alerts` | It counts what Grafana's Alerting page shows as firing and pending. |
| `charts` | Each firing Grafana rule has a threshold. For about a minute after a new service account's first request Grafana shows it no rules, so run the doctor twice if this line says none have. |
| `metrics` | Values match Explore for the same queries. |
| `logs` | `Loki: checkout N lines in 15 min`. |

## Harness

```yaml
    harness: { account: "${HARNESS_ACCOUNT}", apiKey: "${HARNESS_API_KEY}" }
```

```yaml
  - name: payments
    build: { harness: { org: default, project: shop, pipeline: payments_ci } }
    deploy: { harness: { org: default, project: shop, pipeline: payments_cd, service: payments, environment: prod } }
```

`service` and `environment` are Harness's identifiers, where they differ from the catalog's names. The API key
needs to view pipelines in the project. For builds, put the same `harness:` under `builds:` too.

| Line | Right when |
|---|---|
| `deploys` | `harness: payments v… ` names the tag Harness's last successful deployment to that environment used, and `stalled: …` appears only if its newest one failed. |
| `builds` | `payments N`, the CI pipeline's recent executions. |

This is the integration least proven: the environment and artifact are read from `moduleInfo.cd` of the
execution summaries. If `deploys` does not name payments at all, those fields are named differently in your
account, and the raw answer of `POST /pipeline/api/pipelines/execution/summary` for one execution is what is needed.

## TeamCity and Jenkins

```yaml
builds:
  teamcity: { url: https://teamcity.example.com, token: "${TEAMCITY_TOKEN}" }
  jenkins: { url: https://jenkins.example.com, user: estate, token: "${JENKINS_TOKEN}" }
```

```yaml
    build: { teamcity: { buildType: Shop_Checkout, branch: main } }
    build: { jenkins: { job: shop/checkout, branch: main } }
```

The `builds` line names each service with its count of builds, and says which last failed. A build type or job
that does not exist is named in a `fail` line.

## The performance check

```bash
bunx playwright install chromium
bun run perf
```

It prints a table of what it measured against the budgets at fifty services, and exits non-zero if one is broken.

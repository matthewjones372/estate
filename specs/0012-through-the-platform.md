# 0012 — Through the platform

## Problem

Many teams pay for one observability platform and send everything to it: Datadog, or Grafana in front of their
Prometheus, Loki and alerting. Estate reads Prometheus, Loki and Alertmanager directly. A Grafana team has to give
Estate the address and credentials of every store behind Grafana, which is often not allowed, and is a second path
to the same data. A Datadog team cannot use Estate at all for alerts, load or logs.

Estate should not duplicate the platform. Its job is the join no platform shows on one screen: what each service runs
in each environment, whether its pipeline stalled, its alerts with who silenced them and why, and its debug switch.
The load, the alerts and the lines should come from wherever the team already looks.

## Not doing

- **Writing monitors, dashboards or alert rules.** Estate reads alerts and silences them. It does not define them.
- **Datadog's APM, traces or service map.** Links to them, from the catalog, as for any tool.
- **Datadog's service catalog as Estate's catalog.** Worth doing once someone uses both; the catalog file stays the
  one source for now.
- **Grafana dashboards as charts.** Estate draws its own charts from the queries in the catalog.

## Shape

Grafana in front of the data:

```yaml
sources:
  production:
    grafana:
      url: https://grafana.example
      token: "${GRAFANA_TOKEN}"
      prometheus: prom-prod        # a data source's uid: Prometheus queries go through Grafana
      loki: loki-prod              # and Loki's
```

With `prometheus` or `loki` named, Estate reaches them through Grafana's data source proxy
(`/api/datasources/proxy/uid/<uid>/...`) with the service account's token. It needs no address or credentials of
its own for them. Alerts and silences already go through Grafana when `grafana` is set.

Datadog:

```yaml
sources:
  production:
    datadog:
      site: datadoghq.eu
      apiKey: "${DD_API_KEY}"
      appKey: "${DD_APP_KEY}"
      tags: [ "env:production" ]
    every: { metrics: 1m }
```

```yaml
# catalog: a service's load as Datadog queries, its monitors and lines found by its tag
services:
  - name: checkout
    datadog: { service: checkout }
    load:
      requests: sum:trace.http.request.hits{service:checkout}.as_rate()
      errors: sum:trace.http.request.errors{service:checkout}.as_rate()
      p99: p99:trace.http.request{service:checkout}
```

- **Alerts** are Datadog's monitors in Alert, Warn or No Data, each of their groups an alert, matched to a service by
  its `service` tag.
- **Silences** are Datadog downtimes scoped to the monitor and group, ended early by cancelling them.
- **Load** is read with one query per series kind for the whole environment, grouped by `service`, wherever the
  catalog's queries share a shape. Otherwise it is read query by query.
- **Logs** come from Datadog's log search, filtered by `service:<name>` and the environment's tags.

A call Datadog refuses with 429 waits for the time its rate-limit headers give, and the part is marked failing with
that reason until it answers again.

## Why this shape

The platform as intended means asking it, not what is behind it. Grafana's data source proxy keeps one credential
and Grafana's own permissions. For Datadog, the hard limit is its rate limit on metric queries, counted per
organisation. Three queries a service every 30 s, as Estate makes of Prometheus, would spend a team's whole hourly
allowance in minutes at fifty services. Grouping by `service` turns that into three queries an environment, and
spec 0011's `every:` lets a team read less often still. The alternative, Datadog's dashboards embedded in the page,
would show load but not join it to anything. Recommended: read through the API, grouped.

## Depends on

Spec 0011's `every:`, so a Datadog environment can be read once a minute or less.

## Stack

- [ ] **`grafana-proxy`** — Prometheus and Loki reached through Grafana's data source proxy when `grafana` names
      their uids.
      Done when: the e2e cloud estate's Prometheus is only reachable through a fake Grafana, and its lanes draw.
- [ ] **`datadog-alerts`** — monitors as alerts, downtimes as silences.
      Done when: a firing monitor group appears with its service, and silencing it creates a downtime that the next
      read shows.
- [ ] **`datadog-metrics`** — load, stats and alert charts from Datadog's metric queries, grouped by service.
      Done when: fifty services' load is read in three calls an environment, and a 429 marks metrics failing with
      the wait.
- [ ] **`datadog-logs`** — a service's lines and error groups from Datadog's log search.
      Done when: the logs panel shows a fake Datadog's lines, masked, live.
- [ ] **`datadog-e2e`** — an estate in Playwright read wholly from a fake Datadog; the README's kinds list Datadog.
      Done when: `bunx playwright test` passes with it.

## Acceptance

```bash
bun run gate
bunx playwright test
bun run perf
```

## Open questions

- Does a team name a Datadog service's queries in the catalog, or should Estate assume APM's `trace.*` metrics
  when none are named? Recommended: name them, as for Prometheus. A default can follow once a real team's metrics
  are seen.

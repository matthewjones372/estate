# 0007 — Logs on the page

## Problem

When a service is unwell, the next question after "since when?" is "what is it saying?". Estate links to the logs,
already filtered, but that means another tool, another sign-in, and a query language, just to see the last few errors
or to watch a service's lines as a deploy rolls out.

## Not doing

- **Storing logs.** Estate reads them from Loki, or from Kubernetes, as they are asked for, and keeps none.
- **A log explorer.** No arbitrary queries, saved searches or long histories. The panel has a link that opens the same
  view in Grafana's Explore.
- **Shipping logs.** Promtail, Alloy or Fluent Bit are the estate's; Estate reads what they deliver.
- **Other log stores**: CloudWatch Logs, Elastic and Datadog are spec 0002's kinds, when someone asks.

## Shape

**Sources**, per environment in `estate.yaml`, beside its Prometheus:

```yaml
sources:
  production:
    loki: { url: http://loki.monitoring:3100, tenant: estate }   # history and live
    # or no loki: the cluster's own pod logs, live and as far back as each pod's log goes
```

**The catalog** says how to find a service's lines and its errors, with defaults that fit most services:

```yaml
services:
  - name: orders
    logs:
      selector: '{namespace="shop", app="orders"}'   # Loki's; the default is the workloads' namespace and app label
      errors: 'ERROR|FATAL'                            # matched against a line's level, or its text if it has none;
                                                       # case aside, the default is error, fatal, panic, exception
      mask: [ '\b\d{16}\b', 'Bearer [A-Za-z0-9._-]+' ] # replaced with ••• before a line leaves Estate
```

**On the service's page**, a Logs panel has two views:

- **Live**: the service's lines as they arrive, newest at the bottom, with the pod and level of each. A filter by
  level and by text, and Pause. Scrolling up pauses it, and "N new lines" resumes it. The browser keeps the last 500
  lines.
- **Errors**: the last hour, 6 hours or day of error lines, grouped by message, with numbers, ids and times masked so
  that one fault is one row. Each row has its count, first and last seen, the pods, and its newest example. Opening
  a row shows its last ten lines in full.

**On an alert's card**, "Lines from then": the service's errors from ten minutes before the alert started until now.

**Server**: `GET /logs?env=&service=` is an event stream of lines. One reader per service, shared by everyone
watching it and stopped a little after the last of them leaves, asks for what is new every two seconds: Loki's
`query_range` from the last line it saw, or, without Loki, each pod's `log?sinceTime=`. It sends at most the newest
200 lines a read, saying when it skipped older ones. Polling rather than Loki's WebSocket tail or a follow per pod keeps every source
behind the one HTTP client, answered by the same stubs in tests, at the cost of up to two seconds' delay.
`GET /api/logs/errors?env=&service=&range=` returns the groups, from Loki's `query_range` or, without Loki, the pods'
last 2,000 lines.

**Who may read them**: viewers by default; `auth.logs: operator` keeps them to operators, since logs can carry
customers' data. Masking is applied on the server.

## Why this shape

Live and Errors are the two things people open the logs tool for during an incident: is it still happening, and what
is it. Grouping errors by their message with the variable parts masked turns 4,000 lines into the three faults behind
them. Loki is the store most estates that run Prometheus already have. Without Loki, the cluster's pod logs give the
live view, and errors from the pods' recent lines, with nothing extra to run. The alternative was to embed Grafana's
log panel, which would need Grafana's sign-in inside Estate's page and still show raw lines. Recommended: our own.

## Depends on

Nothing. Services that log JSON lines with a level field are read exactly; for the rest, the default
error pattern finds them.

## Stack

- [x] **`logs-sources`** — Loki (`query_range`) and Kubernetes (pod logs since a time), the catalog's `logs`,
      levels, masking, grouping errors, and the role setting.
      Done when: against stubs of both, a service's lines arrive masked and in order, and errors group by message.
- [x] **`logs-stream`** — `/logs` and `/api/logs/errors`: one upstream per service shared by its watchers, the rate
      cap, and closing when the last watcher leaves.
      Done when: two watchers share one upstream, and it closes a moment after both leave.
- [x] **`logs-pages`** — the Logs panel (Live and Errors), and "Lines from then" on an alert's card.
      Done when: Playwright watches a line arrive, pauses, filters to errors, and opens a group.

## Acceptance

```bash
bun run gate
bunx playwright test   # e2e/tools.ts answers as Loki, and as the cluster's pod logs
```

## Open questions

1. **Viewers or operators by default?** Recommended viewers, with the role setting for estates whose logs carry
   customer data, plus masking.
2. **Grouping by message: masking only, or Loki's `pattern` detection?** Recommended masking numbers, ids, times and
   quoted values. It works the same with and without Loki, and it is easy to explain.

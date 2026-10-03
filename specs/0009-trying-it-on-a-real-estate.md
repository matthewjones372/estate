# 0009 — Trying it on a real estate

## Problem

Every source Estate reads has been tested against stubs written from the tool's documentation, and against fakes in
the browser tests. None has met a real Grafana, Elasticsearch, Argo CD or AWS account. The first person to point
Estate at their team's tools finds out what does not fit by staring at an empty page: a lane with no pods, alerts
that land on no service, a logs panel that says nothing because their shipper writes `service.name` and not
`kubernetes.labels.app`.

They also have reason not to try. Estate can write: silences go to the alert manager, the debug switch patches a
ConfigMap, notes go to a database. Pointing it at a team's real tools to "just have a look" should not be able to
change anything.

## Not doing

- **Fixing the mismatches for them.** The report says what does not fit and what the catalog could say instead; it
  does not rewrite the catalog.
- **A setup wizard or discovery.** Spec 0001's reasons for a catalog in Git still hold.
- **Reading anything the page does not.** The report asks the same questions the readers ask, once each.

## Shape

`estate doctor` reads the same `estate.yaml` and catalog as the server, asks each environment's sources once, and
prints what it found, in plain lines, exiting non-zero if any source failed:

```text
$ ESTATE_SETTINGS=estate.yaml estate doctor
production
  alerts     ok    grafana: 4 firing, 1 pending; 3 about a service, 1 about none (labels: alertname, team, cluster)
  charts     ok    3 of 4 firing alerts have a threshold to chart against
  metrics    ok    prometheus: storefront requests 118/s, errors 0.4/s, p99 —(no data)
  cluster    ok    storefront 3/3 ready, orders 2/2 ready, search 0 pods: no Deployment search in shop
  deploys    fail  argo: Argo CD answered 403: permission denied
  logs       ok    elasticsearch: storefront 200 lines in 15 min; orders 0 lines: nothing matches
                   kubernetes.labels.app=orders; set logs.elastic.match for orders
  builds     ok    gitlab: storefront 8, orders 8
```

`readOnly: true` in `estate.yaml` makes Estate write nothing anywhere: no silence or debug buttons on the page, the
write endpoints refuse with 403 and say why, and notes are kept in memory whatever `notes:` says. The page says
"read-only" in its header so nobody wonders where the buttons went.

## Why this shape

The report reuses the readers the server runs, so what it says is what the page would show, and it needs nothing
beyond the image. The alternative, a page of diagnostics inside Estate, would only be seen once someone had already
deployed it; a command can be run from a laptop with the team's tokens before anything is deployed. Recommended: the
command.

Read-only is a setting rather than a role, because the point is that nobody, operators included, can write while
someone is trying it out.

## Depends on

Nothing.

## Stack

- [ ] **`read-only`** — `readOnly: true`: writes refused with 403, silences and debug off on the page, notes in
      memory, "read-only" in the header.
      Done when: with `readOnly: true`, every write endpoint answers 403 and no call that writes leaves Estate.
- [ ] **`doctor`** — `estate doctor`: each environment's sources asked once, a line per part with counts and what
      does not fit, non-zero exit on a failure.
      Done when: run against the e2e tools, it reports every part ok, and names a service whose logs match nothing
      and an alert about no service.

## Acceptance

```bash
bun run gate
bun e2e/tools.ts & bun e2e/cloud-tools.ts & ESTATE_SETTINGS=e2e/cloud.yaml bun src/server/main.ts doctor
```

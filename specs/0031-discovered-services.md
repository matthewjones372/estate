# 0031 — Discovered services

## Problem

Every service on the page is written in `catalog.yaml` by hand: its name, environments, namespace and workloads, owner,
category, deploy and load queries. Most of that is in the cluster already. An estate of eighty services has eighty
entries to write and keep in step, and a service someone ships without one is not on the page at all, so the page is
only as complete as whoever last edited the catalog.

This breaks, deliberately and only where asked, the rule that the catalog alone says what the estate is. The catalog
stays in charge: it says where to look and what an entry found there becomes, and anything it writes itself wins.

## Not doing

- **Discovery from anything but Kubernetes, yet.** Backstage, Datadog's service catalog and ECS tags are later
  entries, each a reader of its own behind the same rule.
- **The map, stores, jobs, agents, alerts' impacts or budgets.** What a person decides stays written.
- **Merging a written entry into a discovered one.** A written entry with a discovered service's name replaces it
  whole; a workload's annotations add a runbook or repository without writing an entry.
- **Approving what is found.** Found services are shown at once, marked as found, as the user asked.
- **Writing to Git.** The page offers a discovered entry's YAML to copy; Estate commits nothing.

## Shape

```yaml
# catalog.yaml
discover:
  - kubernetes:
      selector: estate.dev/show=true          # only workloads labelled so
      namespaces: [ shop, payments ]          # or every namespace, when left out
    # What each workload found becomes, before its own labels and annotations add to it. Values may name
    # {name}, {namespace}, {label:KEY} and {annotation:KEY}; one whose label or annotation is missing is left out.
    service:
      category: "{label:app.kubernetes.io/part-of}"
      owner: "{label:team}"
      load:
        requests: sum(rate(http_requests_total{app="{name}"}[1m]))
        errors: sum(rate(http_requests_total{app="{name}",code=~"5.."}[1m]))
        p99: histogram_quantile(0.99, sum by (le) (rate(duration_bucket{app="{name}"}[5m])))
      links: { logs: "https://logs.example/{env}/{namespace}/{service}" }   # {env} and the rest, as written links
services:
  - name: orders            # written: replaces a discovered orders whole
    ...
```

```text
each environment whose sources read Kubernetes, every minute, for each rule:
  list Deployments and StatefulSets matching the selector, in its namespaces or all
  a workload is a service named by its app.kubernetes.io/name label, or else its own name;
  the same name in several environments is one service in each of them
  the entry: { name, environments, kubernetes: { namespace, workloads }, ...the rule's service filled in,
               description | repository | runbook | owner from estate.dev/<field> annotations }
  checked as a written entry is; one with a mistake is left out, named in the log and the doctor
written entries win by name; the catalog shown is the written one with the rest discovered after it
a cluster that does not answer keeps what it last discovered
```

```text
the page: a discovered service's lane and page say "found in Kubernetes", and its page offers "Copy as YAML"
estate doctor
  discover  ok    production: 14 services found, 2 written over, 1 left out (svc-x: …)
```

## Why this shape

Discovery fills in the entries a person would write the same way every time, and nothing they would decide. Making
each found workload an ordinary catalog entry, checked as one, keeps every view, the cluster's frames and `/mcp`
unchanged: they read `catalog.services` and cannot tell one from the other but by its mark. Replacing a discovered
entry whole, rather than merging the written fields into it, keeps the rule one sentence long; annotations cover the
common additions. Recommended: opt-in by label selector, never every workload, so a sidecar or a one-off Deployment
does not become a lane.

## Depends on

- **The cluster's read access to Deployments and StatefulSets**, which `deploy/rbac.yaml` already grants cluster-wide.

## Stack

- [x] **`discover-catalog`** — `discover:` in the catalog: its shape, and checks that a rule names a selector and only
      placeholders it can fill.
      Done when: a rule with no selector, or with `{lable:x}`, is a catalog mistake that says so.
- [x] **`discover-kubernetes`** — from a rule and the workloads a cluster lists, the entries found.
      Done when: against a stub cluster, labelled workloads in two environments are one service in both, with the
      rule's fields filled from their labels and their annotations' runbook and repository, and an unlabelled one is
      not found.
- [x] **`discover-merge`** — every minute, the found entries checked and put after the written ones; written wins by
      name; a reload of the file keeps what was found; a cluster that fails keeps what it found last.
      Done when: a written orders replaces a discovered one, an entry with a mistake is left out and logged, and a
      catalog reload keeps the discovered services.
- [x] **`discover-page`** — "found in Kubernetes" on a discovered lane and page, and "Copy as YAML" on its page.
      Done when: the page suite shows the mark and copies an entry that parses as a catalog service.
- [x] **`discover-doctor`** — the doctor's `discover` line per environment.
      Done when: it names the services found, those written over and those left out with why.
- [x] **`discover-e2e`** — the e2e cluster labels one Deployment that the catalog does not name.
      Done when: Playwright sees it on the overview, marked as found, with its load.

## Acceptance

```bash
bun run gate
CHROMIUM=/opt/pw-browsers/chromium bunx playwright test
```

## Open questions

- **A discovered service's name when two namespaces hold the same app?** Recommended: one service with both
  workloads, as a written entry can only name one namespace, the first found is kept and the other is named in the
  doctor's line.
- **How often?** Recommended: once a minute, the catalog file's reload being every ten seconds; workloads come and go
  far less often than they change.

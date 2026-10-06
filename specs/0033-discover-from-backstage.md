# 0033 — Discover from Backstage

## Problem

Spec 0031 finds services in Kubernetes. Many estates already keep a service catalog in Backstage: each service a
Component with its owner, its system, its description, its links and its repository, written by the team that owns it.
Such an estate writes the same facts twice, once in Backstage and once in Estate's catalog, and the two drift.

## Not doing

- **Backstage's other kinds.** Systems, Resources and APIs are not services; a Resource that is a database is not a
  store, yet.
- **Writing to Backstage.** Estate reads its catalog; it registers nothing.
- **Backstage's plugins.** Its Kubernetes or TechDocs plugins are not read; the annotations they use are.
- **Secrets in the catalog.** Backstage's address and token are settings, as every tool's are.

## Shape

```yaml
# estate.yaml
backstage: { url: https://backstage.example.com, token: ${BACKSTAGE_TOKEN} }   # a static token, read access
```

```yaml
# catalog.yaml
discover:
  - backstage: { filter: "kind=component,spec.type=service" }   # this filter unless set
    service:
      environments: [ production, staging ]   # every environment unless set: Backstage does not say
      load:
        requests: sum(rate(http_requests_total{app="{name}"}[1m]))
```

```text
every minute, beside Kubernetes' rules, for each Backstage rule:
  GET {url}/api/catalog/entities/by-query?filter=…, each page by its cursor
  a Component is a service named by its metadata.name, with
    description   metadata.description
    owner         spec.owner, without its kind and namespace (group:default/payments → payments)
    category      spec.system
    repository    github:owner/name, from the github.com/project-slug annotation
    runbook       the link titled "Runbook", else estate.dev/runbook
    links         its other links, by title
    kubernetes    { namespace, workloads: [ Deployment ] } from backstage.io/kubernetes-namespace and
                  backstage.io/kubernetes-id, when it has the namespace
  then the rule's service filled in from it, {annotation:KEY} and {label:KEY} as for Kubernetes, {namespace} the
  kubernetes namespace
  checked, written over and left out as spec 0031's are; a Backstage that does not answer keeps what it found
two rules finding one name: one service, the first rule's entry, in the environments of both
```

```text
the page: "found in Backstage"
estate doctor
  every environment
    discover  ok    Backstage: 23 services found, 4 written over, 1 left out (legacy-billing: …)
```

A Backstage rule in a catalog whose settings name no Backstage is a mistake: `discover[0].backstage: needs
backstage in estate.yaml`.

## Why this shape

A Component already says, in fields its owners keep, most of what a catalog entry says, and the
`github.com/project-slug` and `backstage.io/kubernetes-*` annotations Backstage's own plugins use say where its code
and pods are. Mapping those, and filling the rest from the same template a Kubernetes rule uses, keeps one rule shape
and one check for both. The token stays in settings because the catalog is in Git. Recommended: environments from the
rule, since a Component names none and guessing from its lifecycle would be wrong as often as right.

## Depends on

- **A Backstage static token** with read access to the catalog (`backend.auth.externalAccess`).

## Stack

- [ ] **`backstage-rule`** — `backstage:` in the settings, a Backstage rule in the catalog, `environments` in a
      rule's template, and the cross-check.
      Done when: a Backstage rule without `backstage` in the settings is the mistake above, and a rule naming both
      `kubernetes` and `backstage` is a mistake.
- [ ] **`backstage-reader`** — from a rule and the Components Backstage lists, page by page, the entries found.
      Done when: against a stub Backstage of two pages, Components become entries with their owner, system,
      repository, runbook, links and namespace, in the rule's environments.
- [ ] **`backstage-merge`** — Backstage rules run beside Kubernetes' every minute, marked `backstage`; two rules
      finding one name are one service.
      Done when: a service found by both kinds is one entry in both rules' environments, and a Backstage that fails
      keeps what it found.
- [ ] **`backstage-page-doctor`** — "found in Backstage", and the doctor's Backstage line.
      Done when: the doctor names the services found, written over and left out.
- [ ] **`backstage-e2e`** — the e2e tools answer as Backstage with a Component the catalog does not write.
      Done when: Playwright sees it on the overview, found in Backstage, with its owner's links.

## Acceptance

```bash
bun run gate
CHROMIUM=/opt/pw-browsers/chromium bunx playwright test
```

## Open questions

- **Backstage's newer `/api/catalog/entities/by-query` or the older `/api/catalog/entities`?** Recommended: by-query,
  which pages by cursor and is in every Backstage since 1.13; the older one returns the whole catalog at once.

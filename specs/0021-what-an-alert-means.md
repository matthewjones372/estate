# 0021 — What an alert means

## Problem

An alert says what is wrong in the words of whoever wrote the rule: "Search has not indexed for 40 minutes". It does
not say what that means for the people using the product: new products cannot be found. The person who sees it first
has to work that out, or ask, before they can judge how much it matters, tell support, or decide whether to wake
someone. The answer is the same every time the alert fires, but there is nowhere to keep it. Today's notes belong to
one firing and end with it.

## Not doing

- **Severity from impact.** The alert's severity stays what its rule says. Impact is words, for people.
- **Incident management.** No status pages, timelines or paging. Estate shows the impact; incident tools can link to
  it.
- **Impact per environment.** What an alert means for users is the same wherever it fires. Staging's alerts show it
  too, which is fine.

## Shape

An alert's impact can come from three places, and the first found is shown:

```text
1. Written on the page    by an operator, kept for every later firing: who wrote it, and when
2. catalog.yaml           alerts: { SearchIndexStale: { impact: "New products can't be found in search." } }
3. The rule itself        an `impact` annotation on the Prometheus or Grafana rule, or `impact:` in a Datadog
                          monitor's message
```

```text
┌ WARNING  SearchIndexStale                                    firing 41 min ┐
│ Search has not indexed for 40 minutes                                        │
│ Impact  New products can't be found in search. Existing ones still are.      │
│         — ada, 3 days ago · Edit                                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **On the page**, an operator writes or edits an alert's impact from its card. It is kept by the alert's name,
  across firings and environments, until someone changes it. It is never ended by `notes.keepDays`. Clearing it
  falls back to the catalog's or the rule's.
- **Where it shows**: on the alert's card in Needs you now, on the alerts page, on the service page, and on the
  kiosk's firing cards, under the alert's own summary. An alert without an impact shows nothing extra. Operators
  see "Add impact" instead.
- **Where it is kept**: beside the notes, in the same Postgres or DynamoDB, or in memory when Estate has no store or
  is read-only.
- **`estate check`** names an impact in the catalog for an alert that no rule Estate has read defines, as a
  warning, since the rule may be in an environment not yet read.

## Why this shape

The impact belongs with the alert, not a firing, so it is kept by the alert's name. The rule annotation and the
catalog let a team keep it in code, reviewed. The page lets the person who just worked it out write it down while it
is fresh, which is when it gets written at all. The page wins because it is the newest, and it says who wrote it, so
a stale one can be challenged. The alternative is only the rule annotation. It is the most correct place, but it
needs a change to the alerting repository for every sentence, so in practice it stays empty. Recommended: all three,
the page first.

## Depends on

Nothing. Stores keep a second kind of record beside notes.

## Stack

- [ ] **`impact-read`** — impact from the rule's annotation, Datadog's message and the catalog, on every card.
      Done when: a Prometheus rule with an `impact` annotation shows it on its card and on the kiosk.
- [ ] **`impact-written`** — written and edited on the page by operators, kept in memory, Postgres and DynamoDB.
      Done when: an impact written on a firing alert is on its next firing, with who wrote it, after a restart.
- [ ] **`impact-e2e`** — the example estate's SearchIndexStale with an impact; Playwright writes and edits one.
      Done when: `bunx playwright test` passes with it.

## Acceptance

```bash
bun run gate
bunx playwright test
bun run integration -t "Notes"
```

## Open questions

- **Can viewers write impact, or only operators?** Recommended: operators, since it is shown to everyone as what the
  alert means. Viewers keep notes on a firing.

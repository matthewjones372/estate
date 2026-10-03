# 0021 — What an alert means, and has meant

## Problem

An alert says what is wrong in the words of whoever wrote the rule: "Search has not indexed for 40 minutes". It does
not say what that means for the people using the product: new products cannot be found. The person who sees it first
has to work that out, or ask, before they can judge how much it matters, tell support, or decide whether to wake
someone. The answer is the same every time the alert fires, but there is nowhere to keep it. Today's notes belong to
one firing and end with it.

Nor does it say whether it has happened before. "Fired four times this month; last time ada restarted the indexer
and it cleared in ten minutes" is the most useful thing the person who sees it could know. Estate keeps only the last
day's resolved alerts, in memory, so a restart forgets them, and a note is gone from the page once its firing ends.

## Not doing

- **Severity from impact.** The alert's severity stays what its rule says. Impact is words, for people.
- **Incident management.** No status pages, timelines or paging. Estate shows the impact; incident tools can link to
  it.
- **Impact per environment.** What an alert means for users is the same wherever it fires. Staging's alerts show it
  too, which is fine.

## Shape

### Impact

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
### History

```text
┌ WARNING  SearchIndexStale                                    firing 41 min ┐
│ …                                                                            │
│ Before  4 times in 30 days, last 6 days ago for 22 min · History             │
│         “Indexer stuck on a bad product feed; restarted it.” — ada, then     │
└──────────────────────────────────────────────────────────────────────────────┘

History of SearchIndexStale in production
  3 Oct 11:46   firing now, 41 min       2 notes
  27 Sep 09:10  22 min                   silenced by gil: "indexer redeploy" · “Indexer stuck…; restarted it.” — ada
  19 Sep 14:02  3 min
```

- **Each firing is kept**: when it started and ended, who silenced it and why, and the notes written while it fired.
  They are kept by the alert's name and environment, in the same store as notes, for `alerts.historyDays` (90 by
  default).
- **On the card**, an alert that has fired before says how often in the last 30 days, when last, and for how long.
  It also quotes the last note written about it. "History" opens the alert's past firings, newest first, each with
  its silences and notes.
- **The resolved list** on the alerts page reads from the same record, so it survives a restart.
- **Before Estate kept them**, where the alerts come from Prometheus, the firings of the last 30 days are read once
  from its `ALERTS` series, without notes.

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

- [x] **`impact-read`** — impact from the rule's annotation, Datadog's message and the catalog, on every card.
      Done when: a Prometheus rule with an `impact` annotation shows it on its card and on the kiosk.
- [x] **`impact-written`** — written and edited on the page by operators, kept in memory, Postgres and DynamoDB.
      Done when: an impact written on a firing alert is on its next firing, with who wrote it, after a restart.
- [ ] **`alert-history`** — each firing kept with its silences and notes, in memory, Postgres and DynamoDB.
      Done when: an alert that fired, resolved and fired again shows its first firing's note, after a restart.
- [ ] **`history-shown`** — "before" on the card, the alert's history, and the resolved list from the record.
      Done when: a card says how often its alert fired in 30 days, and History lists each firing with its notes.
- [ ] **`history-backfill`** — the last 30 days' firings read once from Prometheus's `ALERTS`.
      Done when: a test against Prometheus's range answer gives an alert's earlier firings.
- [ ] **`impact-e2e`** — the example estate's SearchIndexStale with an impact and a past firing with a note;
      Playwright writes an impact and opens a history.
      Done when: `bunx playwright test` passes with it.

## Acceptance

```bash
bun run gate
bunx playwright test
bun run integration -t "Notes"
```

## Open questions

- **How long is history kept?** Recommended: 90 days by default, as `alerts.historyDays`.
- **Grafana's and Datadog's own history?** Both keep alert state history Estate could read for the time before it
  ran. Recommended: Prometheus's first, since it needs no extra permission. The others are added when someone asks.
- **Can viewers write impact, or only operators?** Recommended: operators, since it is shown to everyone as what the
  alert means. Viewers keep notes on a firing.

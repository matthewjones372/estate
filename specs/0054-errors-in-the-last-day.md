# 0054 — Errors in the last day

## Problem

Whether a service has been throwing errors is one of the first things asked of it, and the service page does not say.
The answer is three clicks away and below the fold: down to Logs, Errors, then 24h. Nothing at the top of the page
says whether that trip is worth making.

The answer is also wrong for a busy service. The errors endpoint reads the newest 2000 lines of every level in the
window and picks the errors out of them, so on a service that writes a few lines a second, "24h" is the last ten
minutes. The Errors view does not say so.

## Not doing

- **Counts on the overview or the kiosk.** One 24-hour read per service on every overview is a different cost; its
  own spec if asked.
- **A range on the button.** It is always the last 24 hours; the Errors view keeps 1h, 6h and 24h.
- **A trend**, "up 40% on yesterday". That is a second day's read.
- **A count from the source's own counting API.** Loki's `count_over_time`, Datadog's aggregate and Elasticsearch's
  `_count` would be exact, but each needs Estate's notion of an error written in that tool's language. The lines
  are read and Estate decides, as now.
- **New permissions.** The button needs what the Errors view needs.

## Shape

**The button**, on the service page under the health line, linking to the Logs panel:

| State | Shows |
|---|---|
| reading | `Errors in 24h …`, muted, and it can still be followed |
| some | `37 errors · 4 groups in 24h`, in `--critical` |
| at the cap | `2,000+ errors · 4 groups in 24h` |
| none | `No errors in 24h`, in `--healthy` |
| the read failed | `Errors in 24h: the logs did not answer`, muted; following it, the Errors view says the same |
| no logs read for it | no button, as there is no Logs panel |
| from the cluster | `12 errors · 3 groups since the pods started`, and `+` at the cap |

It is read when the page opens, and again every 5 minutes while the tab is visible.

**The address**: following the button goes to the Logs panel with Errors and 24h chosen, and says so in the
address, so the link can be pasted and Back returns to where the page was:

```text
/services/checkout?env=production&logs=errors&range=24h
```

`logs=` is `live` (the default) or `errors`; `range=` is `1h` (the default), `6h` or `24h`. Choosing in the panel
changes the address without adding to the history. The button adds to the history and tells the page it moved, as
Back does, so the page reads its logs from the address in one way, however it got there.

**Errors only, from the source**: each source is asked for the lines that may be errors rather than every line,
so the cap applies to errors. What it returns is a sieve: Estate's rule still decides, by the line's level, or else
the catalog's `logs.errors` pattern against its text, as now. The button and the Errors view always agree.

| Source | Asked for |
|---|---|
| Loki | the selector with a line filter, `\|~ "(?i)<the pattern>"` |
| Datadog | the query with `status:(…)`, the statuses the pattern matches |
| Elasticsearch | the match, without a `log.level` the pattern does not match |
| the cluster | every line, as now; the pods' API cannot filter |

**Server**:

```text
GET /api/logs/errors?env=&service=&range=24h    as now, and capped: true when the read reached its limit;
                                                one answer per environment, service and range for a minute,
                                                however many pages ask
```

## Why this shape

The count is the errors endpoint's own answer, so the button and the view one click below it can never disagree, and
fixing the cap fixes both. Asking the source for likely errors and keeping Estate's rule as the judge keeps one
definition of an error across four sources whose own notions differ: Datadog's `status`, Elasticsearch's
`log.level`, and text for Loki and the pods. The alternative, trusting each source's own filter, is simpler, but
the same service would count differently by where its lines live; recommended against. A minute's shared answer
means an incident's crowd on one page sends one read, not one each.

## Depends on

Nothing.

## Stack

- [ ] **`errors-sieved`** — the errors endpoint asks each source for likely errors, with `capped` in its answer.
      Done when: against each source's stub, a window of 3000 info lines and 5 errors answers 5 errors, the stub is
      asked with the source's filter, and a read that reaches its limit answers `capped: true`.
- [ ] **`errors-shared`** — one answer per environment, service and range for a minute.
      Done when: two asks within the minute make one read of the stub, and one after it makes another.
- [ ] **`logs-addressed`** — `logs=` and `range=` on the service page's address open the Logs panel so.
      Done when: a suite opens `/services/storefront?logs=errors&range=24h` on Errors over 24h, and a choice in the
      panel replaces the address.
- [ ] **`errors-button`** — the button, in every state, read again every 5 minutes while visible.
      Done when: a suite shows each state's text, following it opens Errors over 24h with the address pushed, and a
      hidden tab does not read again.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

1. **A catalog's `logs.errors` that Loki's RE2 cannot read**, such as a lookbehind? Recommended: Loki answers 400,
   and the button and the view say the read failed; checking the pattern against RE2 when the catalog is read is
   left until someone writes one.

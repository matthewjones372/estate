# 0037 — An alert after it ends

## Problem

Estate keeps every firing for `alerts.historyDays`, but nothing opens one. An alert's page, `/alerts/:id`, says
"not firing now" the moment it resolves. The History on its card, Resolved today, the service page's timeline and the
feed's "resolved" items list past firings without a link. The morning after an incident, or in its review, the
question is what happened then, what was around it and what the service said, and today that means rebuilding it
by hand from Grafana, the logs tool and the deploy history.

## Not doing

- **Keeping deploys.** Estate holds each service's latest deploy only, and stays a reader: a firing's page shows the
  builds and deploys Estate still holds from before it, and says when one it cannot see may be missing. Querying each
  deploy source by time is its own spec if asked.
- **Dependencies' health then.** A past firing's page names the services and stores around it; reading each one's
  state at the time is a range query per neighbour, left until someone asks.
- **Ask AI on a past firing.** The brief it reads is shaped for a live alert.
- **Writing on a past firing.** Notes and impact are written on a live alert, as now; a past firing shows them.
- **Firings older than `alerts.historyDays`.** Swept as now.

## Shape

**A firing's address**: the alert's id and when the firing started, in the environment chosen as for every page.

```text
/alerts/:id/:startedAt          /alerts/1x9k2b/2026-10-07T10:31:00Z?env=production
/alerts/:id                     as now while it fires; once it does not, "SearchIndexStale is not firing in
                                production now" links to its last firing and its others in this environment
```

**The page**, read once from `GET /api/firings/:id?env=&at=`; nothing on it is live:

```text
Overview / Alerts / SearchIndexStale · 7 Oct 10:31

What happened
  WARNING · fired 7 Oct 10:31 for 22 min, ended 10:53 · storefront · production
  Search has not indexed for 40 minutes                      ← the summary, kept with the firing
  Impact   New products can't be found in search.            ← as the alert's impact reads now
  Silenced by gil: "indexer redeploy"
  Notes    “Indexer stuck on a bad product feed; restarted it.” — ada, 10:44
  Runbook  ↗                                                 ← kept with the firing
  Fired 4 times in 30 days · the others ›

Around it then
  Changed  storefront main-212 deployed 40 min before it fired · build #212 passed
           Deploys before main-212 are not kept here.         ← when the latest held is newer than the firing
  Around   search-indexer, products-db                       ← by name, from the catalog's map

Errors then                                                  ← 10 min before it fired until it ended
  14× payment provider timed out after ‹n› ms …             ← grouped and opening as on the Logs panel

Load then                                                    ← 1 h before it fired until 1 h after it ended
  Requests  Errors  p99                                      ← the firing shaded; point at, step and drag as 0005
```

**Kept with each firing from now on**: its severity, summary, runbook and store, beside what 0021 keeps. A firing
kept before this shows without them, and its page says so.

**The links in**:

| Where | Opens |
|---|---|
| a card's History, each row | that firing |
| the alerts page, Resolved today, each row | that firing |
| the service page, Alerts today, each mark | that firing, or the alert's page while it fires |
| the feed, each "resolved" item | that firing |
| an alert's page while it fires | "Fired 4 times in 30 days · the others ›", its History opened |

**Server**:

```text
GET /api/firings/:id?env=&at=                       the firing, its notes and impact, its others' starts;
                                                    404 once swept, or for an id or time never seen
GET /api/alerts/:id/around?env=&at=                 at= anchors the brief to that firing: changes up to its
                                                    start, errors to its end
GET /api/logs/errors?env=&service=&since=&until=    until= ends the window; now when absent
GET /api/load?env=&service=&from=&to=               from=/to= in place of range=; about 120 points
```

The readers already take a window (`ServiceLogs.read(from, to)`, `Ranges.range(query, span, end)`); these endpoints
stop hard-wiring now. A firing is found in the firings held in memory, which are the store's for
`alerts.historyDays`, by environment, alert id and start. Without Loki, pod logs reach only as far back as the pods
running now kept, and the page says so when they cannot cover the window.

## Why this shape

A firing is what people look back at, and Estate already keeps it keyed by environment, alert and start, so that is
its address: the same alert's other firings are a click away, and a link shared in a review opens the same page for
everyone. Showing only what Estate holds keeps "read, don't store": the page says plainly what it cannot see rather
than looking complete. The alternative, a page per alert name with every firing on one long page, mixes firings
with different labels and makes a review's link drift as new firings arrive; recommended against.

## Depends on

Nothing. Errors then needs a log source that keeps history, Loki, Elasticsearch or Datadog, to reach past the pods
running now; Load then needs a metrics source, as the service page does.

## Stack

- [ ] **`firing-kept`** — severity, summary, runbook and store kept with each firing, in Postgres, DynamoDB and
      memory; `GET /api/firings/:id`.
      Done when: against each store, a firing kept with its summary is read back with it, one kept before reads back
      without, and the endpoint answers a firing, and 404 for one swept.
- [ ] **`firing-page`** — `/alerts/:id/:startedAt`, What happened, and the links in from History, Resolved today,
      Alerts today, the feed and the not-firing page.
      Done when: a suite opens a firing from each link and shows its summary, silence, notes and the others; Playwright
      resolves an alert, opens it from Resolved today, and is accessible.
- [ ] **`firing-logs`** — `until=` on the errors endpoint, and Errors then.
      Done when: against the Loki stub, the errors of a firing's window are read and lines after its end are not.
- [ ] **`firing-charts`** — `from=`/`to=` on the load endpoint, and Load then with the firing shaded.
      Done when: against the Prometheus stub, `query_range` is asked for the firing's window, and a suite shows the
      shading over it.
- [ ] **`firing-around`** — `at=` on the brief, Around it then, and "not kept here".
      Done when: a firing after a deploy Estate holds shows it, and one before the latest held deploy says deploys
      before it are not kept.

## Acceptance

```bash
bun run gate
bunx playwright test
bun run integration   # Postgres and DynamoDB Local keep the new fields
```

## Open questions

1. **`startedAt` in the address as ISO time or epoch seconds?** Recommended ISO, `2026-10-07T10:31:00Z`: readable in
   a link pasted into a review, and what the firings are keyed by.
2. **Charts 1 h either side of the firing, or the firing alone?** Recommended 1 h before and after, so the change into
   and out of the fault shows.
3. **Ask AI on a past firing?** Recommended not yet; a later spec can give it a brief made for looking back.

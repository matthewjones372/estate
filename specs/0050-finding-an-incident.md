# 0050 — Finding an incident

## Problem

An incident has a page (spec 0039) and a record worth coming back to (spec 0047), but nothing in Estate leads to it.
The way in is a firing alert's card that says "Part of" it, which is gone once the alert resolves, or a link someone
kept. The morning after, or a month later for the review, a closed incident cannot be found from Estate at all: the
person asks in Slack for the link.

## Not doing

- **Search across incidents.** A list, filtered by open or closed, is enough while an estate has tens of incidents.
  Finding one in the ⌘K palette (spec 0027) is a later entry if asked.
- **A count in the header.** Incidents are not in the live state, so a count would mean reading them on every page.
  Firing alerts that are part of one already show it on their cards.
- **Paging.** Incidents are kept for `incidents.keepDays` and read whole, as the incident tool's list would be.

## Shape

**Incidents** in the header, after Alerts, on every page, marked current on the list and on an incident's page.

```text
/incidents                                   Incidents
                                             2 open, 1 closed.                    [All 3] [Open 2] [Closed 1]

  Incident        State                                    Firings                             Opened
  Orders slow     open 10 min                              Two firings · production, staging   gil, 3 Oct 11:50
  Checkout down   open 30 min                              No firings                          ada, 3 Oct 11:30
  Search slow     closed after 1 h: the index was rebuilt  One firing · production             ada, 3 Oct 09:00
```

Open ones first, then closed, newest first within each; each row opens the incident. With none: "No incidents yet.
An operator opens one from a firing alert's card with Link to incident."

An incident's page leads back to it: its breadcrumb is *Overview / Incidents / title*, and an incident that is not
there links to *All incidents*.

**The list** is `GET /api/incidents?closed=true`. Without `closed`, the route answers as now, the open ones only, for a
card's *Link to incident…*. Viewers read it, as they read an incident.

## Why this shape

A page beside Alerts and Deploys is where people already look for the estate's other lists, and it works for a closed
incident with no live alert left to lead to it. The alternative is a section on the overview, which keeps the header
short but buries closed incidents, which are the ones a review looks for. Recommended: the page.

## Depends on

Nothing. Incidents and their read route are spec 0039's.

## Stack

- [x] **`incidents-list`** — this spec, `?closed=true` on the list route, `/incidents`, and the header's link.
      Done when: `incidents.suite.tsx` lists open then closed incidents, filters them and links each to its page, the
      header's link is current on the list and an incident, and `incidents.test.ts` on the server lists closed ones
      with `?closed=true` and only open ones without.

## Acceptance

```bash
bun run gate
```

Then, in the petshop's demo, open and close an incident, and *Incidents* in the header lists it as closed and opens it.

## Open questions

- **Incidents in ⌘K?** Recommended: yes, as a later entry: open ones by title, from the same list.

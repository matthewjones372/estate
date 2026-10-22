# 0068 — What needs you, counted once

## Problem

The overview of an estate in trouble disagrees with itself. The demo's production says "Five things need you" in the
headline, "3 firing" beside *Needs you now*, 3 on the Alerts tab, two rows under it, and an *Alerts firing* tile that
names two alerts. Each is right by its own unit (troubled entries, firing alerts, incident groups), and none says
which. The headline's lede is the first reason of each troubled entry joined by semicolons, so it carries the
registry's raw error (`GET registry…/tags/list: 401 Unauthorized`) and ends "and 2 more", hiding the very things
it counts. The stalled inventory deploy is counted and never shown.

The first screen also asks the viewer to choose how to see it: *Auto/Cards/Rows* for alerts, *Auto/Areas/Lines* for
the map, *List/Grid* for services, before it has said what is wrong. Healthy services get a full lane each, in the
catalog's order, so a person scrolls past eleven well services to the one that is not. *What changed today* is a
line per build and per applied version, so a morning's three batches of eight builds push the alert that fired off
the panel. The header wraps to two rows at 1440 pixels.

On a service page the load charts do not say when the version changed or the alert fired, so "it started with the
deploy" is a guess made by lining up the deploy's time with the chart's axis by eye. And the version strip's chip
for the environment being looked at is green while the service in it is degraded.

## Not doing

- **A baseline for a vital.** Orders and Baskets get a sparkline of the hour the stream sends; "below usual" needs a
  usual that no source gives, so none is shown.
- **The trouble map as a path with the cause on it** (stores and brokers between orders and picking). The map stays
  as spec 0062 and 0065 draw it, its choice moved into the overview's *View* menu; the path is a follow-up.
- **Parsing who wrote a note out of its text.** "Who's on it" is the latest note's author as Estate kept it.
- **The service page's diagnosis sentence and runtime stats folded to one line.** Follow-ups; this change adds the
  deploy and firing marks to its charts, fixes the version chip and says error groups plainly.
- **Names on the map.** A map node keeps the title the catalog's `map:` gives it ("Postgres" for orders-db); naming it
  by the catalog entry with its kind beside it is a follow-up. The things list already says `orders-db (Postgres)`.
- **Removing a layout.** Cards, rows, areas, lines, list and grid all stay; only where they are chosen moves.

## Shape

**One unit: a thing that needs you.** `src/web/needs.ts` turns the events into the things, worst first:

```ts
export interface Thing {
  readonly kind: "incident" | "alert" | "deploy" | "degraded"
  readonly tone: "critical" | "attention"
  readonly title: string        // "Orders reach the warehouse late", "Checkout's p99 is over 800 ms"
  readonly what: string         // one line in Estate's words; never a tool's raw error
  readonly owners: ReadonlyArray<string>   // team titles
  readonly since?: string       // when it started, for its age
  readonly to: string           // where it opens
  readonly alerts: ReadonlyArray<Alert>    // the firing it holds, for its cards
}
export const thingsOf = (events: Partial<Events>): ReadonlyArray<Thing>
```

- An open **incident** is one thing, holding every firing alert linked to it.
- A firing **alert** in no incident is one thing.
- A **deploy stuck** in this environment is one thing, its tool's message left to its service's page.
- A service, store, job or agent that is **degraded** or down and is not already the subject of one of the above is
  one thing, its reasons as the line.

Every count on the overview is this count: the headline, the list's heading and the healthy tile's "N affected".
The header's Alerts badge stays a count of alerts, as the Alerts page lists them, and Incidents gains a count of
open incidents.

**The hero.** With an incident open:

```text
INCIDENT OPEN · 2 ALERTS
Orders reach the warehouse late; slots may be missed.         ← an alert's impact, else the incident's title
Likely cause: bus (Kafka), Broker 4 of bus is not reporting.   ← its store alert, else the first to fire
[DE] demo, 1 min ago: Told the warehouse that orders for the 10:00 to 11:00 slots may be picked late.
[Open the incident]  [All alerts]
```

The cause is said only when the incident holds more than one alert, from an alert about a store (what services
share) or else the one that fired first. Without an incident the headline is the count, as now, and the lede the
first thing's title.

**The list.** `Four things need you`, an ordered list, one row a thing: its number, kind (*Incident*, *Alert*,
*Deploy stuck*, *Degraded*), title linking to where it opens, the line, its owners and its age. An incident's or an
alert's row has a button that opens its cards in place, as spec 0044's rows do.

**Tiles.** The catalog's vitals as small tiles, each with its value and a sparkline of the hour, then *Healthy*
(`17 of 22`, `5 in the things above`). No *Alerts firing* tile; it was a second count.

**One View menu.** The overview's layout choices, the map's *Auto/Areas/Lines* and the services' *List/Grid*, move
into one *View* disclosure beside the services' heading, each still kept in this browser. The overview's own
*Auto/Cards/Rows* goes: what fires is in the list. A service's and a store's page keep theirs.

**Areas, worst first.** Categories are ordered down, then degraded, then the rest in the catalog's order. In each,
what is not healthy has its lane; the healthy are one line of links, `11 healthy: web, mobile-api, …`, with
*Show their lanes*. A catalog with no categories is one area, and the same.

**What changed today, in batches.** Builds that passed within five minutes of each other are one line,
`8 builds passed`, `New substitutions rules, and 7 more`; versions applied together likewise, `8 versions applied`,
`includes checkout main-154-199fdaf · inventory stuck`. A failed build, an alert, a note, a silence, debug and a job
stay a line each. An alert that fired within half an hour of a version applied to its service says so:
`22 min after checkout main-154-199fdaf applied`.

**How it unfolded.** With an incident open, its firing alerts and its notes, oldest first, then the note box.

**The header** fits one row at 1440 pixels: the account is its initials, a button opening who you are and *Sign out*.
Under 40em it is three rows in the order Tab meets them: the brand and switcher, the pages as a row of tabs, then
the search beside the live dot and account. Nothing is moved out of its source order, so what is seen and what is
focused agree in every browser.

**The service page's charts** draw a solid line where a version was applied to the service and a dashed one where
one of its alerts fired, in the window shown, with a legend above them: `main-154-199fdaf applied 10:31`,
`CheckoutSlow fired 10:53`. The version strip's chip for the environment shown takes the service's health when it is
worse than the deploy's. The day's errors under its health line say how many different messages they are, `12 errors,
3 different messages, in 24h`, rather than "12 errors · 3 groups".

## Why this shape

The count people act on is "how many separate things do I have to deal with", which groups an incident's alerts and
counts a stuck deploy, so that is the unit, and every number on the page is it or is labelled as something else. The
alternative, counting alerts everywhere, leaves a stuck deploy and a slow replica uncounted although they need
someone. A list of things, a row each, holds the raw error out of the headline without hiding anything: the row says
what in Estate's words, and its page has the tool's message. Choosing a layout is a preference for later, so it is
one menu, not three rows of buttons above the fold. Marks on the charts answer "did it start with the deploy" by
looking, which the review found the most useful single change.

## Depends on

Specs 0039, 0044, 0062 and 0065.

## Stack

- [x] **`things-once`** — `needs.ts`, the hero, the list of things with cards in place, the tiles.
      Done when: the demo's production says four things in the headline, the list and the tile, with a row for the
      stuck inventory deploy and none of its raw error on the overview; tests cover each kind and the hero's cause.
- [x] **`view-menu`** — the View menu, areas worst first, healthy as a line.
      Done when: no layout buttons are on the overview outside the menu, and the Fulfilment area comes before Shop.
- [x] **`header-one-row`** — the account as a menu; tabs on a phone.
      Done when: the header is one row at 1440 pixels, and four tabs under 40em, nothing in it reordered.
- [x] **`changes-in-batches`** — the feed's batches and the firing that follows a version.
      Done when: the demo's eight builds at one time are one line, and CheckoutSlow says the version before it.
- [x] **`how-it-unfolded`** — the incident's thread on the overview.
      Done when: alerts and notes interleave oldest first, and a note added there is the incident's.
- [x] **`marks-on-charts`** — deploy and firing marks on a service's charts, the version chip's health, and error
      groups said as different messages.
      Done when: checkout's charts in the demo show main-154's line and CheckoutSlow's, and production's chip is amber.

## Acceptance

```bash
bun run gate
CHROMIUM=/path/to/chromium bunx playwright test
```

## Left for later

- The trouble map as the path an order takes, with the stores and brokers on it and the one at the root marked, drawn
  down the page on a phone.
- The map's nodes named by their catalog entry, the kind beside it.
- A service page that leads with one sentence of diagnosis (state, threshold, how long, the version before it) and its
  runbook as an action.
- A service's runtime stats as one "in range" line with *Show charts*, open by itself when one is out of range.
- A "usual" beside a vital, once a source can say what usual is.

## Open questions

1. **Is a stuck deploy a thing when its old version still serves?** Recommended: yes; it needs someone, and nothing
   else will move it.
2. **Should the Alerts badge be the things count?** Recommended: no; it labels the Alerts page, which lists alerts.
   The overview's counts are all things, and the badge sits beside the word Alerts.
3. **Collapse healthy lanes for good, or only while something needs you?** Recommended: always; a healthy lane is a
   name and a link until it is opened.

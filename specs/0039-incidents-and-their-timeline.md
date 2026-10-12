# 0039 — Incidents, and their timeline to export

## Problem

When alerts turn into an incident, the review asks what happened and who did what, in order. Estate sees most of it
happen and keeps little of it as a record:

- **Notes** say who and when, but a removed note is gone, so the record is what was left, not what was written.
- **A silence** keeps who and why, but not when, and lifting it leaves nothing.
- **The impact**, written on the page, keeps no author or time.
- **Ask AI** and **Tell the team** leave no trace of who asked or posted, or when, beyond a note if someone kept one.
- **Firing and resolving** are kept as two times on the firing, not as events beside the rest.

And an incident is rarely one alert. A slow chip registry fires `ChipRegistryUnreachable`, then `AdoptionsNotRecorded`,
then a latency alert on another service. Each has its own card and notes, so the story is split across them, the same
thing is written on three cards, and nothing says they are one problem.

The card shows notes with a clock time (`14:02`), not a date or seconds; a card with twenty notes is mostly notes; and
nothing can be taken away from the page. The person writing the review rebuilds the order by hand from Slack, the
notes and memory.

## Not doing

- **Running incidents.** Paging, roles, status pages and postmortem templates stay in an incident tool (PagerDuty,
  incident.io, Jira); spec 0025's *Raise an incident* still links to one, and an incident here can hold that link.
- **What other tools saw.** Deploys, pages and Slack replies are linked where Estate already knows them, not read back.
- **Editing the record.** Events are added, never changed or removed. A removed note is an event of its own.
- **Grouping by itself.** Estate does not decide which alerts belong together; a person links them. Suggesting
  candidates (same service, fired within minutes) is a later spec if asked.
- **Anything older than `alerts.historyDays`.** Swept with its firings, as now.

## Shape

**Every action on a firing is an event**, kept in the notes database (Postgres, DynamoDB or memory, as notes are now),
appended only:

```text
at (UTC, to the second)   who      firing                      what
2026-10-12T16:47:58Z      Estate   ChipRegistryUnreachable     fired, warning, petshop
2026-10-12T16:49:10Z      matt     ChipRegistryUnreachable     asked AI (claude-opus-5-5)
2026-10-12T16:49:52Z      Estate   ChipRegistryUnreachable     AI answered: the chip registry is slow or stopped (low)
2026-10-12T16:50:30Z      matt     ChipRegistryUnreachable     opened incident "Chip registry slow" with this firing
2026-10-12T16:51:02Z      Estate   AdoptionsNotRecorded        fired, warning, petshop
2026-10-12T16:51:40Z      gil      AdoptionsNotRecorded        linked to incident "Chip registry slow"
2026-10-12T16:52:04Z      gil      (incident)                  noted: "registry container restarted"
2026-10-12T16:53:00Z      gil      ChipRegistryUnreachable     silenced for 1 hour: "restart in progress"
2026-10-12T16:58:40Z      gil      ChipRegistryUnreachable     removed a note by matt
2026-10-12T17:01:12Z      Estate   ChipRegistryUnreachable     resolved after 13 min
2026-10-12T17:03:30Z      matt     (incident)                  closed: "registry restarted, adoptions recovering"
```

The kinds: fired, resolved, noted, note removed (with the text it had), silenced (span and reason), unsilenced,
impact written, team told (the thread's link), AI asked, AI answered or failed, AI answer kept, linked to or unlinked
from an incident, and an incident opened, renamed or closed. *Who* is the signed-in person's name, or Estate for what
it saw.

**Incidents.** An operator links firing alerts into one incident from a card: *Link to incident…* offers the incidents
open now in that environment, or *New incident* with a title. An incident has a title, who opened it and when,
its firings, its own notes, an optional link to the incident tool, and is open until someone closes it with a line on
how it ended. It has a page:

```text
/incidents/:id        Chip registry slow · open 15 min · opened by matt
                      Firings     ChipRegistryUnreachable (resolved 17:01) · AdoptionsNotRecorded (firing)
                      Notes       written on the incident, shown on each of its firings' cards
                      Timeline    every event of the incident and of its firings, merged in order
                      [Copy as Markdown] [Download ▾] [Close incident…]
```

Each linked card says "Part of *Chip registry slow*" and links to it. Unlinking is an event, not a deletion.

**Timeline.** A firing's page (live and past, spec 0037) and an incident's page gain *Timeline*: the events in order,
each with its date and time to the second in the reader's zone (UTC on hover) and the person.

**Notes fold.** A card shows its newest three notes and *Show all 20 notes*; the choice is kept per card while Estate
is open. A note keeps its lines as written, so a kept AI
answer reads as its cause, evidence and next steps rather than one run-on paragraph. A long note shows its first two
lines and *more*, which opens it in place, on the card and in *What changed
today* alike, so one long note (a kept AI answer) does not push the card's buttons, or the day's other changes, off
the screen. Notes show their date as well as the time once a firing crosses midnight.

**Export.** *Copy as Markdown* and *Download* (Markdown or JSON) on any timeline, from:

```text
GET /api/firings/:id/timeline?env=&at=&format=md|json
GET /api/incidents/:id/timeline?format=md|json
```

The Markdown is a review's starting point: the title, the firings with their services and environment, when each
fired and resolved, the impact, then the table above with times in UTC, then the notes in full. Viewers can read and
export; only what they could see on the page is in it, as for Ask AI.

## Why this shape

An append-only list of events is what an audit trail is, and it makes the export a rendering of what is stored, not a
reconstruction. The alternative is building the timeline at read time from what is kept now (notes, the firing's
times, the latest silence); it needs no new storage but cannot show removed notes, lifted silences, Ask AI or who told
the team, which are the gaps.

For grouping, the alternative is leaving incidents to the incident tool and only linking out. That keeps Estate
smaller, but the record of who did what on which alert is here, not there, and splitting it across cards is the
problem. Incidents here are a grouping and a record, not a process. Recommended: events, and person-made incidents
that hold them.

## Depends on

Nothing. The notes database gains events and incidents (a table each in Postgres, item kinds in DynamoDB).

## Stack

- [x] **`spec-0039-events`** — events kept per firing in each notes store, read in order, swept with the firing;
      Estate's own: fired and resolved, as it sees them.
      Done when: each store's test appends and reads a firing's events in order and sweeps them with it; a firing
      Estate sees begin and end has its fired and resolved events.
- [x] **`spec-0039-events-written`** — events written by notes (a removed note keeping its text), silences, impact,
      Tell the team and Ask AI.
      Done when: every writing route's test sees its event, with its person and time; a removed note leaves its
      noted event and a removal event.
- [x] **`spec-0039-timeline`** — *Timeline* on a firing's page, live and past, with dates, seconds and people.
      Done when: `firing-timeline.suite.tsx` shows the events in order with each person and time, on the alert's
      page and a past firing's; `GET /api/firings/:id/events` reads them for viewers, however the start is written.
- [x] **`spec-0039-notes-fold`** — a card shows its newest three notes and *Show all*; a note's lines kept, a long
      one folded to two; dates across midnight.
      Done when: a note's text keeps its line breaks; a card with five notes shows three and *Show all 5 notes*,
      which shows them all and is kept on moving away and back; a long note shows two lines and *more*, which opens
      it, on the card and in the feed; a note from yesterday shows its date.
- [x] **`spec-0039-incidents`** — incidents kept in each notes store and shown in state; routes to open, link,
      unlink, close and read them; their events on each firing; "part of" on the alert.
      Done when: each store keeps, reads and sweeps an incident; opening, linking, moving, unlinking and closing
      leave each record and each firing's events in order with their people; `GET /api/incidents/:id` merges its
      firings' events in order; the alert says which incident it is part of; a viewer cannot open, link, unlink or
      close.
- [ ] **`spec-0039-incidents-page`** — *Link to incident…* and *New incident* on a card; `/incidents/:id` with its
      firings, notes and merged timeline.
      Done when: linking two firings from their cards shows both on the incident's page with their events merged in
      order; each card says "Part of" its incident and links to it; a viewer sees neither *Link to incident…* nor
      *New incident*.
- [x] **`spec-0039-export`** — the timeline routes as Markdown or JSON; *Copy as Markdown* and *Download* on both
      pages.
      Done when: a firing's and an incident's Markdown carry the header, the UTC table and the notes; the JSON
      decodes as the shared schema; a viewer's export leaves out what a viewer cannot see.

## Acceptance

```bash
bun run gate
```

Then, in the petshop's demo: `./chaos.sh registry-slow`; ask AI, open an incident from ChipRegistryUnreachable, link
AdoptionsNotRecorded to it, add and remove a note, silence one; `./chaos.sh restore`; close the incident, and its page
shows all of it in order and copies it as Markdown.

## Open questions

- **Can a firing be in more than one incident?** Recommended: no; linking it elsewhere moves it, as an event.
- **Do incidents span environments?** An outage can fire in staging and production. Recommended: yes; the incident
  is estate-wide and each firing names its environment.
- **Is Ask AI's answer itself in the timeline, or only that it was asked?** Recommended: its likely cause and
  confidence as the event, the full answer only when kept as a note.
- **Does an incident close itself when its last firing resolves?** Recommended: no; a person closes it with how it
  ended, and the page says when everything in it has resolved.
- **Events before this ships?** Firings kept before it have their notes and times. Recommended: show them as events
  marked as rebuilt, so last week's firings are not blank.

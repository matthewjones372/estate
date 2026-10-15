# 0051 — What an incident holds, and its summary

## Problem

Spec 0047 keeps an incident's evidence, but Estate chooses it: each service's Load and stats, its errors and some of
its lines, and its journeys' slowest and failed traces, read when an operator presses *Keep evidence now* or the
incident closes. The person working the incident chooses nothing. The chart where they saw the queue climb, the five
log lines that showed the cause, the trace that took nine seconds: none of these can be put on the incident from where
they are found. They end up as screenshots in Slack, or as a note that describes them.

On the incident's page, the evidence that is kept sits below the firings, services and versions, and an incident on a
store shows charts only. It reads as an appendix, not as what the incident was worked from.

And the first thing a review, a status update or a hand-over needs is a short account of what happened. Estate has
everything to write one, and the model Ask AI already uses, but a person still writes it by hand from the timeline.

## Not doing

- **Including from other tools.** Grafana panels, Kibana searches and Slack messages are linked in a note, as now.
  *Include* is for what Estate shows.
- **Editing what was included.** An included chart is the range that was on the screen; picking a different range is
  including it again.
- **Asking the model questions about an incident.** *Summarise* writes one account in a fixed shape. A conversation
  about an incident is a later spec if asked.
- **Tools for the summary.** The brief is the incident's record and what it holds, so the model needs no tools, and a
  summary costs one round.
- **Writing the summary into the incident tool** (spec 0043). A kept summary is a note; raising carries notes as now.
- **Summaries for a lone firing.** Ask AI covers an alert.

## Shape

### Include in incident

An *Include in incident* button sits on each thing worth keeping, for any signed-in writer while at least one incident
is open:

| Where | What is included |
|---|---|
| A chart on a service's or store's page | the chart's series over the range on screen (1 h to 7 d), read again on the server from the catalog's query for that service and panel, at a step that keeps it under 600 points |
| Lines picked on the Logs panel (spec 0036) | the picked lines, as shown, masked, up to 500 |
| A group on *Errors* | the group: its shape, count, first and last seen, pods and examples |
| A trace's page (spec 0046) | the trace read whole from Tempo, as 0047 keeps one, marked `included` |

The button opens a picker of the incidents open now, newest first; with one open, it names it ("Include in *Chip
registry slow*"). The picker takes an optional line on why ("queue starts climbing here"). The chart's query is never
sent from the page: the page names the service, panel, environment and range, and the server looks the query up.

Each inclusion is kept with the incident in the notes store, as its own evidence set with one item, `keptBy` the
person, `from: included`, and the line. It is an `included` event on the incident: `included petshop Errors (/s),
13:00 to 14:00: "queue starts climbing here"`. It counts toward `incidents.evidence.maxMegabytes`; one that would pass
it is refused with how much room is left.

*Remove* on an included item, for whoever included it or an operator, hides it from the page and the summary and is an
`evidence-removed` event. The export keeps it under `removed/`, since the record is never edited.

Lines and error groups need the reader to read logs. Where `auth.logs` keeps them to operators, *Include* is not shown
on them to others, and the route refuses.

### The incident's page

Sections in this order: the header, **Summary**, **Evidence**, Firings, Services, What changed, Notes, Timeline.

```text
Chip registry slow                                            [Summarise]
open 25 min · opened by gil, 15 Oct 13:12

Summary
  (none yet: Summarise writes one from everything below)

Evidence
  Included                                                            newest first
    petshop · Errors (/s) · 13:00 to 14:00          gil, 13:31   "queue starts climbing here"   [chart]   Remove
    petshop · 5 log lines · 13:24 to 13:25          ada, 13:29                                  [lines]   Remove
    trace 4bf92f35 · adoption · 9.1 s               gil, 13:27   "the registry call"            [lanes]   Remove
  Kept by Estate, 13:40                                               (0047's set, as now)
```

An included item draws as it does where it was found: a chart with the incident's window shaded and its events marked,
lines as the Logs panel shows them, an error group as *Errors* does, a trace in lanes linking to its page.

### Summarise

*Summarise* on the incident's page, for any signed-in writer where `ai:` is set (the same `me.ai` as Ask AI), and on
open and closed incidents alike.

```text
POST /api/incidents/:id/summary         an IncidentSummary, or why there is none
```

The brief is the incident as its page reads it for this person:

- its title, state, who opened and closed it and how it ended
- its firings, services, window and *What changed*
- its notes and its timeline
- what was included and what Estate kept, each in short:
  - a chart as its first, last, lowest and highest values with their times
  - lines and error groups as text
  - a trace as its length and its five longest steps

What this person may not read (spec 0041) is left out of the brief and the answer is marked `readLogs: false`.

The answer is decoded against a shape of its own:

```text
IncidentSummary
  what       three to five sentences on what happened, in order
  impact     who was affected and how, or "not known from what Estate holds"
  cause      the likely cause, citing what it rests on
  turns      [{ at, text }]    the moments that mattered, from the timeline
  followUps  [string]          what to do next, or after
  confidence low | medium | high
  + model, usage, cost, readLogs       as AskAnswer has them (spec 0040)
```

The model port takes the instructions and the answer's schema from its caller rather than the alert's, so Ask AI and
Summarise share one provider, one client and its prompt caching. They also share `ai.budget.tokensPerDay`: one budget,
not two. A summary of the same incident within a minute shares the answer, as Ask AI's turn does, keyed by the incident
and whether the asker reads logs.

The answer shows in *Summary*, with its cost and model as Ask AI's does, and *Keep as note*, which keeps it as an
incident note marked as from Summarise. The newest kept summary heads `incident.md` in the export (spec 0047) as
`## Summary`. Asking, answering and failing are `ai-asked`, `ai-answered` and `ai-failed` events on the incident, with
`readLogs` on the answer so a viewer's timeline withholds it as 0041 does.

## Why this shape

Inclusion is per item, from where it is found, because that is when someone knows it matters. The alternative is a
form on the incident's page that names a service, panel and range, which needs the person to remember where they saw
it. The server reads charts and traces again rather than taking points from the page, so what is kept is what the
source said and the page cannot send a query. Lines and error groups are taken as shown because the page already holds
exactly those, masked.

Summarise reuses Ask AI's model port, budget and withholding rather than a second AI path, so an estate configures one
model and pays from one budget. It takes no tools: everything it needs is on the incident, and one round keeps it
cheap enough to press whenever the incident changes.

## Depends on

Specs 0024, 0040 and 0041 (Ask AI), 0047 (evidence), 0036 (picked lines) and 0046 (traces). `src/web/connect.ts` is at
the 300-line limit, so the incident actions move out of it first.

## Stack

- [x] **`spec-0051`** — this spec and its row in the README.
      Done when: they are committed.
- [x] **`spec-0051-connect-split`** — the incident actions out of `connect.ts` into `connect-incidents.ts`, no change
      in behaviour.
      Done when: the gate passes and `connect.ts` is well under 300 lines.
- [x] **`spec-0051-included`** — `POST /api/incidents/:id/included` for chart, lines and errors (traces with
      `spec-0051-include-traces`); kept as a one-item set; `included` and `evidence-removed` events; `DELETE` to remove; the limit and the logs rule held.
      Done when: each kind is kept and read back in each notes store; a chart's query comes from the catalog; a viewer
      where logs are for operators is refused lines; past the limit is refused with the room left; a removal hides
      the item and keeps the event.
- [x] **`spec-0051-picker`** — the open incidents as a picker beside *Link to incident…*'s, with a line on why;
      *Include* on picked log lines and on error groups.
      Done when: picking three lines and including them in the only open incident sends them with the line on why;
      with none open the button is not shown; a viewer sees it only where they read logs.
- [x] **`spec-0051-include-charts`** — *Include* on a service's and a store's charts, with the range on screen.
      Done when: including Errors over 6 h sends the service, panel, environment and range, and the incident's page
      draws it.
- [x] **`spec-0051-include-traces`** — *Include* on a trace's page.
      Done when: including a trace keeps it whole and the incident's page draws it in lanes linking to its page.
- [x] **`spec-0051-evidence-first`** — the page's sections reordered; *Included* listed newest first above Estate's
      set, each drawn as where it was found, with *Remove*; the export's `included/` and `removed/`.
      Done when: an incident's page shows Summary and Evidence before Firings; included items show who, when and why;
      the zip holds them.
- [x] **`spec-0051-model-shape`** — the model port takes its instructions and answer schema from the caller; Ask AI
      passes the alert's, unchanged.
      Done when: Ask AI's tests pass unchanged and a test asks the port for a second shape against a stub provider.
- [ ] **`spec-0051-summary`** — the incident's brief, `POST /api/incidents/:id/summary`, the shared budget and turn,
      the events with `readLogs`.
      Done when: against a stub model, a summary decodes as `IncidentSummary`; a second within a minute shares it; it
      spends from `tokensPerDay`; a viewer's brief has no lines and their timeline withholds an answer drawn from them.
- [ ] **`spec-0051-summary-panel`** — *Summarise* and *Summary* on the incident's page, cost and model shown, *Keep as
      note*, the export's `## Summary`.
      Done when: the panel shows what, impact, cause, turns and follow-ups; keeping it adds an incident note and heads
      `incident.md`; with `ai:` unset the button is not shown.

## Acceptance

```bash
bun run gate
```

Then, in the petshop's demo with `docker-compose.ai.yml`: `./chaos.sh registry-slow`; open an incident; include the
Errors chart from petshop's page, three lines from its Logs, and an adoption trace; *Summarise*; keep it; `./chaos.sh
restore`; close the incident. Its page shows the summary and the three included items above Firings, and *Everything
(zip)* holds them with `## Summary` at the top of `incident.md`.

## Open questions

- **Who may include?** Recommended: any signed-in writer, as with notes, since including is saying "look at this";
  only operators keep a whole set (0047).
- **Who may summarise?** Recommended: any writer, as with Ask AI; it spends the same budget.
- **Should a summary be written on close by itself?** Recommended: no; it spends tokens nobody asked for. A closed
  incident with no kept summary shows *Summarise* first.
- **Include on a past firing's page (spec 0037)?** Its charts and errors are the same parts. Recommended: yes, in the
  same entries, since they share the components.

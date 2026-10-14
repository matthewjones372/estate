# 0042: Firings that may belong to an incident

## Problem

Spec 0039 left grouping to people, and said suggesting candidates was a later spec if asked. An operator links a
firing into an incident from its card (*Link to incident…*, `src/web/parts/IncidentLink.tsx`, through
`POST /api/incidents/:id/firings` in `src/server/http/incidents.ts`). That works when the operator knows which alerts
are one problem. During an incident they often do not: the chip registry is slow, `ChipRegistryUnreachable` is in
the incident, and `AdoptionsNotRecorded` fires four minutes later on the service that calls it. Estate already knows
both facts, the time and the map edge, and the card says nothing. The operator finds it by reading every card, or the
incident's review finds it later.

## Not doing

- **Linking by itself.** Nothing is linked without a person pressing *Link*. A suggestion is a line on a card.
- **Learning.** No model, no ML, no scores tuned from history. A rule a person can read in one sentence.
- **Suggesting incidents to open.** Two related firings with no incident are not grouped into a new one; a person
  opens it, as now.
- **Closed incidents, or firings that have resolved.** Linking needs a live firing (`live` in `incidents.ts` refuses
  one that is not firing) and an open incident (`open` in `incident-record.ts`), so only those are suggested.
- **Viewers.** Only someone who may link (`canKeepIncidents`: an operator, where Estate writes, not a screen) sees a
  suggestion, since a suggestion is an offer to act.

## Shape

**The rule.** A firing alert is suggested for an open incident when it is not already in an open incident, has not
been dismissed from this one, and, against one of the incident's firings:

1. it started within `incidents.suggestWithin` (30 minutes unless set) of that firing's start, before or after; and
2. it is related to it in one of these ways, strongest first:
   - **the same alert** in another environment (the same rule firing in staging and production);
   - **the same service or store**, in the same environment;
   - **next to it on the map**, in the same environment: one edge either way, as `neighboursOf` in
     `src/server/views/around.ts` finds the *Depends* of a brief.

Time alone, or the same environment alone, is never enough: a busy morning fires many unrelated alerts within half an
hour. Two edges away is not suggested; the map is the catalog's, and its second ring is most of a small estate.

Where a firing fits more than one open incident, it is suggested for the one with the strongest relation, then the
nearest in time. Each suggestion says why, in the page's words:

```text
May be part of "Chip registry slow": adoptions calls chip-registry, and it fired 4 min after ChipRegistryUnreachable.
[Link] [Not this]
```

```ts
// src/server/views/suggested.ts: read-only, from what the estate already holds
export interface Suggested {
  readonly incident: { readonly id: string; readonly title: string }
  readonly why: "same alert" | "same service" | "same store" | "next to it"
  readonly to: { readonly environment: string; readonly alert: string; readonly name: string }
  readonly apart: number // minutes between the two starts
}

export const suggestedFor = (estate: EstateState, environment: string, alert: Alert, within: number) =>
  Option<Suggested>
```

The service or store of an incident's firing is read from the alerts Estate holds for its environment, or from the
firing's kept record (spec 0021) once it has resolved: a resolved firing still anchors the incident.

**On the card.** The alerts view (`src/server/views/alerts.ts`, beside `incidentOf`) adds `suggested` to each alert
it can suggest. The card shows it under *Part of* for those who may link: *Link* links it (the same call as the
chooser), and *Not this* dismisses it.

**On the incident's page.** `/incidents/:id` gains *May belong*, under its firings: every live firing suggested for
it, in any environment, each with its reason, *Link* and *Not this*. `GET /api/incidents/:id` carries them as
`suggested`.

**Dismissed stays dismissed.** *Not this* is `POST /api/incidents/:id/dismissed` with the firing, kept on the
incident's record:

```ts
// src/shared/incidents.ts
dismissed: Schema.optionalKey(Schema.Array(Schema.Struct({
  environment: Schema.String, alert: Schema.String, startsAt: Schema.String, by: Schema.String, at: Schema.String,
})))
```

The record is kept whole as JSON text in each store (`restOf` in `src/server/notes-incidents.ts`), so the field needs
no new column. It is by firing, so the same alert firing again tomorrow can be suggested again. Dismissing is an
event on the firing, `incident-dismissed`, saying "said not part of 'Chip registry slow'", so the review can see what
was ruled out and by whom. Operators only, and refused where Estate is read-only, as linking is.

**Cheap.** It is worked out when the alerts view is built, from what is in memory: the open incidents (a handful),
their firings, the environment's firing alerts, and the catalog's map. No source is read for it.

```yaml
# estate.yaml
incidents:
  suggestWithin: 30m   # how far apart two firings may start and still be suggested together
```

## Why this shape

A suggestion has to be right often enough that people read it, and wrong cheaply when it is not. Requiring both time
and a relation keeps it quiet on a busy morning; showing the reason lets a person judge it in a second; *Not this*
being kept means a wrong one is said once. Working it out in the alerts view puts it on every card that shows the
alert, the overview's, the service page's and the alert's own, for no new route.

The alternatives: scoring every firing against every incident and showing the top few, which finds more but needs
weights nobody can explain; or suggesting only on the incident's page, which is quieter but misses the operator who
is looking at the new card. Recommended: the rule above, on both the card and the incident's page.

## Depends on

Spec 0039's incidents and links. Nothing from outside.

## Stack

- [x] **`spec-0042-rule`**: `suggestedFor` in `src/server/views/suggested.ts`, and `incidents.suggestWithin` in the
      settings.
      Done when: `suggested.test.ts` suggests a firing with the same alert in another environment, the same service,
      and a neighbour on the map, each within the window and each with its reason; it does not suggest one outside
      the window, one related only by time, one two edges away, one already in an open incident, a dismissed one,
      or one for a closed incident; a firing fitting two incidents is suggested for the stronger relation.
- [ ] **`spec-0042-on-the-card`**: `suggested` on the alerts view; the line, *Link* and *Not this* on the card;
      `POST /api/incidents/:id/dismissed` kept on the record with its event.
      Done when: in `incident-card.suite.tsx`, an operator sees the line and its reason and *Link* links it, and a
      viewer sees no line; in `incidents.test.ts`, dismissing keeps the firing on the record, leaves an
      `incident-dismissed` event with the person, and the firing is no longer suggested; a viewer and a read-only
      Estate are refused.
- [ ] **`spec-0042-on-the-incident`**: *May belong* on `/incidents/:id`, from `GET /api/incidents/:id`.
      Done when: `incident-page.suite.tsx` lists the suggested firings with their environments and reasons, *Link*
      moves one into the firings, and *Not this* takes it off the list.

## Acceptance

```bash
bun run gate
```

Then, in the petshop's demo: `./chaos.sh registry-slow`; open an incident from ChipRegistryUnreachable; when
AdoptionsNotRecorded fires, its card says it may be part of it because adoptions calls the chip registry; *Not this*
takes the line away and the timeline says who dismissed it.

## Open questions

- **Is 30 minutes the right window?** Recommended: yes as the default; an incident's later alerts usually follow
  within minutes, and `incidents.suggestWithin` lets an estate change it.
- **Should a firing that starts long after the incident opened be suggested if the incident is still running?**
  Recommended: only within the window of one of its firings; an incident that is still firing keeps anchoring.
- **Should viewers see suggestions, read-only?** Recommended: no; they cannot act on it, and it is a guess, not a
  record.
- **Should the overview group a suggested firing with its incident (spec 0044)?** Recommended: no; only linked
  firings are grouped, so the page shows what people decided, with suggestions marked on their own rows.

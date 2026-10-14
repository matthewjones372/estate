# 0043: Raising an incident in the incident tool

## Problem

*Raise incident* on a card is a link out. `src/web/parts/RaiseIncident.tsx` finds the service's catalog link named
`incident` or `raise-incident` (`src/web/incident.ts`), fills `{alert}` and `{summary}`, and opens it in a new tab.
Estate creates nothing, and learns nothing back: the person fills in PagerDuty's form by hand, and whatever PagerDuty
says about it afterwards (acknowledged, who is on it, its priority) is not on Estate's page.

Since spec 0039, Estate has incidents of its own: a title, its firings, notes and a timeline. The record
(`src/shared/incidents.ts`) already has an optional `link` "to the same incident in the incident tool", but nothing
sets it. So an operator who has opened *Chip registry slow* in Estate opens it again in the incident tool, copies
the alerts across, and pastes the tool's link back into a note. The timeline does not say the incident was raised,
by whom, or when.

## Not doing

- **Running the incident.** Paging, escalation, roles, status pages and the postmortem stay in the tool. Estate
  raises the incident and reads a little back.
- **Changing it in the tool after raising.** Acknowledging, resolving and reassigning are done in the tool. Closing
  the incident in Estate does not resolve it there (see Open questions).
- **Raising for a firing on its own.** The tool's incident is Estate's incident. A card not yet in one opens one
  first, in the same press.
- **Per-alert routing.** Alertmanager, Grafana and Datadog already page the tool for alerts. This is a person
  raising an incident, not another integration paging on every alert.
- **Tools Estate does not support.** Jira, ServiceNow, FireHydrant and the rest stay a link out, as now.

## Shape

**The tool is a source, an interface and a test**, as specs 0001 and 0002 make every source: one implementation per
kind, each tested against a stub of its API, chosen by its key in `estate.yaml`, its credentials `Secret`s
(`src/server/secret.ts`) so they never reach a log.

```ts
// src/server/sources/incident-tools.ts
export interface IncidentTool {
  readonly name: string                                 // "PagerDuty", as the page and the timeline say it
  readonly raise: (raising: Raising) => Effect.Effect<Raised, Failure, Remote>
  readonly read: (id: string) => Effect.Effect<InTool, Failure, Remote>
}
interface Raising {
  readonly key: string                                  // Estate's incident id, so raising twice raises once
  readonly title: string
  readonly impact?: string
  readonly firings: ReadonlyArray<{ environment: string; name: string; service?: string; startsAt: string }>
  readonly page?: string                                // the incident's page in Estate, where its public URL is known
  readonly by: string
}
interface Raised { readonly id: string; readonly url: string }
interface InTool {
  readonly status: string                               // the tool's word: triggered, acknowledged, resolved
  readonly severity?: string                            // PagerDuty's priority or urgency, incident.io's severity
  readonly responders: ReadonlyArray<string>
  readonly url: string
}
export const incidentToolOf = (settings: Settings): IncidentTool | undefined => …
```

**PagerDuty first**, through its REST API, since the Events API answers with a dedup key rather than the incident
and its link:

```yaml
# estate.yaml
incidentTool:
  pagerduty:
    token: ${PAGERDUTY_TOKEN}   # a REST API key
    from: estate@example.com    # the PagerDuty user it raises as; PagerDuty's API requires one
    service: PABC123            # where an incident goes, unless the owning team names its own
    every: 1m                   # how often an open incident is read back
```

Raising is `POST /incidents` (with the `From` header, which PagerDuty requires) with `incident_key` set to Estate's
incident id, the title, `urgency: high` when any of its firings is critical, and a body naming each firing, its
service and environment, the impact, the link back to `/incidents/:id`, and "Raised from Estate by matt". PagerDuty
rejects a second raise with the same `incident_key` on the same service while the first is open, rather than handing
it back, so Estate's own `raised` record is what makes raising twice raise once. A raise whose answer was lost is
found again with `GET /incidents?incident_key=<Estate's id>`. Reading back is `GET /incidents/:id`: its `status`, its
`priority` (else `urgency`, since an account may have no priorities), its `assignments`' assignees as the responders,
and its `html_url` as the link.

A catalog team may name its own PagerDuty service, so payments' incidents go to payments' service:

```yaml
teams:
  - name: payments
    incidentTool: { pagerduty: PDEF456 }
```

The team is the owner of the service of the incident's first firing.

**Raising.** `POST /api/incidents/:id/raise` raises an open incident in the tool, for an operator, where Estate is
not read-only. It sets the record's `link` to the tool's link and keeps what it needs to read it back:

```ts
// src/shared/incidents.ts
raised: Schema.optionalKey(Schema.Struct({
  tool: Schema.String, id: Schema.String, by: Schema.String, at: Schema.String,
}))
```

The timeline gains `incident-raised`, on each of its firings (`happenedOnEach` in `src/server/happened.ts`), with the
tool's link:

```text
2026-10-12T16:51:20Z   matt   (incident)   raised in PagerDuty   https://example.pagerduty.com/incidents/Q1…
```

An incident already raised answers with its link and raises nothing. A tool that refuses says why, in its words, as
`Anthropic answered 400: …` does for Ask AI, and nothing is kept.

**Where it is pressed.**

```text
/incidents/:id   Chip registry slow · open 15 min · opened by matt
                 [Raise in PagerDuty]                                 before it is raised
                 In PagerDuty: acknowledged · P2 · ada, gil · Open in PagerDuty     once it is
```

On a card, where the tool is set, *Raise incident* becomes *Raise in PagerDuty*: on a card that is part of an
incident it raises that incident, or opens it in the tool once raised; on a card that is not, it opens an incident
titled with the alert's summary and raises it, in one press. Where no tool is set, the card keeps the catalog's link
out, unchanged.

**Read back, not stored.** Every `every`, Estate reads each open incident that was raised, and keeps what the tool
said in its state, as it keeps every source's answer. It is not written to the notes store: the tool keeps it. A
tool that does not answer turns off its line on the page ("PagerDuty did not answer: 503") and nothing else. Without
`incidentTool`, the parts are off and the page is as it is now. `estate doctor` reads the configured service once,
which proves the token, and looks `from` up among the account's users, since only a write would otherwise prove it.

**incident.io next, then Jira Service Management**, behind the same interface:

```yaml
incidentTool:
  incidentio: { token: ${INCIDENTIO_TOKEN}, severity: Minor, mode: standard }   # POST /v2/incidents
```

One tool an Estate. incident.io raises with `idempotency_key` as the key, `visibility`, the title as `name`, and the
`severity_id` looked up from the configured severity's name, since the API takes an id. `mode: test` raises without
announcing, for a demo; a `standard` raise is announced and may open a Slack or Teams channel. It reads back
`incident_status` (its name and category), `severity` and `incident_role_assignments`, and `permalink` as the link.
Jira Service Management, where Atlassian moves Opsgenie's customers, is the third kind, built when someone asks.

**Who and when.** Raising is for operators, as opening and linking incidents are (`operator` in `incidents.ts`).
`readOnly: true` raises nothing and hides the button; reading back still runs, since it writes nothing.

## Why this shape

The incident tool is where paging and the postmortem happen, and Estate is where the alerts, their context and the
record of who did what are. Raising from Estate carries that across once, with a link back, so people stop
re-typing the alerts; reading status back keeps the page honest about whether anyone has picked it up. Making it a
source, one interface with a kind per tool, is how every other tool is read, and keeps Estate's code knowing no one
tool.

The alternatives: keep the link out and fill more of the tool's form through its URL, which needs no credentials
but cannot read anything back or set the record's link; or a webhook from the tool into Estate, which reads changes
the moment they happen but needs Estate reachable from the tool and a secret to check, for status that a minute's
poll reads well enough. Recommended: raise through the API, poll back, and keep the link out for tools Estate does
not support.

## Depends on

Spec 0039's incidents. A PagerDuty REST API key and a PagerDuty user's email for `from`; an incident.io API key with
permission to create incidents. Until a team sets `incidentTool`, Estate links out as now.

## Stack

- [ ] **`spec-0043-port`**: `IncidentTool`, the PagerDuty kind, `incidentTool.pagerduty` in the settings and a
      team's own service in the catalog, checked at start.
      Done when: `pagerduty.test.ts`, against a stub of PagerDuty's API, raises with the token, `From`, the
      incident key, the title, the urgency and a body with each firing and the link back, and reads status,
      priority and assignees; a 400 fails with PagerDuty's message; a team's service is used for its incident;
      `estate check` names a team's service on a tool that is not set.
- [ ] **`spec-0043-raise`**: `POST /api/incidents/:id/raise`, `raised` and `link` on the record, the
      `incident-raised` event, *Raise in PagerDuty* on the incident's page and the card.
      Done when: in `incidents.test.ts`, raising keeps the link and `raised`, leaves `incident-raised` with the
      person and link on each firing, and raising again calls the tool no more; a viewer, a closed incident and a
      read-only Estate are refused; `incident-page.suite.tsx` shows the button, then the tool's link; on a card not
      in an incident, one press opens an incident and raises it.
- [ ] **`spec-0043-read-back`**: open raised incidents read every `every`; status, severity and responders on the
      incident's page; a tool that fails turns off only its line; `estate doctor` says whether the tool answers.
      Done when: against the stub, the page shows "acknowledged · P2 · ada, gil" and its link; a stub answering 503
      shows "PagerDuty did not answer" and the rest of the page; `doctor.test.ts` reports a bad token.
- [ ] **`spec-0043-incident-io`**: the incident.io kind.
      Done when: `incidentio.test.ts`, against a stub, raises with the idempotency key and reads back status,
      severity and role assignments into the same `InTool`.
- [ ] **`spec-0043-jsm`**: the Jira Service Management kind, built only when someone asks for it.
      Done when: `jsm.test.ts`, against a stub of its API, raises an incident and reads its status and responders
      back into the same `InTool`.

## Acceptance

```bash
bun run gate
```

Then, in the petshop's demo pointed at a PagerDuty developer account: open *Chip registry slow*, *Raise in
PagerDuty*, acknowledge it in PagerDuty, and within a minute the incident's page says acknowledged and who.

## Open questions

- **Does closing in Estate resolve in the tool?** Recommended: no; the tool's incident has its own responders and
  process. The page shows the tool's status beside Estate's, and the timeline records Estate's close.
- **One Slack thread per incident, rather than per firing?** Threads are kept per firing today (`threads.ts` finds
  one by environment, alert and start, and `tell.ts` posts once a firing). Recommended: yes, as its
  own spec after this one: *Tell the team* on the incident's page posts once, and its firings' notes, silences and
  ends reply in that thread instead of their own; it changes the threads' key, which touches notes, silences and
  tell, and is more than this spec's entries should carry.
- **Push the Markdown export into the tool's postmortem on close?** PagerDuty's public API has no postmortem endpoint;
  incident.io's can import a Markdown postmortem (`import_postmortem_document`). Recommended: not now; later, on
  close, the export as incident.io's postmortem, and as a note on PagerDuty's incident (`POST /incidents/:id/notes`)
  with the export's link, once raising is used.
- **Which PagerDuty service when the firings belong to different teams?** Recommended: the first firing's team's,
  else the settings' `service`; the body lists every firing and its team.
- **Opsgenie at all?** Decided: no. Atlassian stopped selling Opsgenie on 4 June 2025 and shuts it off on 5 April
  2027, moving customers to Jira Service Management or Compass, so the third kind is Jira Service Management.

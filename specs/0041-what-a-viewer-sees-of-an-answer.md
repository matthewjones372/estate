# 0041: What a viewer sees of an Ask AI answer

## Problem

With `auth.logs: operator` in `estate.yaml`, a service's logs are for operators: `src/server/http/logs.ts` refuses a
viewer, and the MCP `errors` tool answers "logs are for operators here" (`readsLogs` in
`src/server/http/mcp-shared.ts`). Ask AI keeps to that while it asks. `src/server/http/ask.ts` gathers the brief with
errors only for someone who may read logs, and `src/server/http/ask-tools.ts` runs the read tools as the person asking.

What it does not keep to is what happens to the answer afterwards. When an operator asks, the brief carries the
service's errors grouped by message, and the model may call `errors` for more. The answer's likely cause then goes
into the firing's timeline as an `ai-answered` event (`happened(firing, "Estate", "ai-answered", …)`), and every
event is read by anyone with a role: `GET /api/firings/:id/events` and `GET /api/incidents/:id` ask only for
`withRole`, and the Markdown and JSON exports in `src/server/http/timeline-export.ts` say outright that "a viewer's is
an operator's". So a viewer reads a summary drawn from lines they may not read: "lock timeout on orders_items for
customer 4411" can be the likely cause.

A kept answer is the same text again, as a note (`POST /api/notes` with `from: "ask-ai"`), which every viewer, the
kiosk, the MCP `alerts` tool and the team's Slack thread see. The difference is that a person chose to keep it.

## Not doing

- **Notes per role.** Notes reach the page in the environment's shared stream (`/events`, built once per environment
  since spec 0010) and are the same for everyone. A note seen by some and not others is a different product.
- **Changing what `auth.logs` means.** Logs stay as it says; this only makes Ask AI's answer follow it.
- **Masking the model's words.** Log lines are already masked as the page masks them before the model reads them.
  Estate does not try to find what in an answer came from a log.
- **Estates where viewers read logs.** With `auth.logs` unset or `viewer`, everyone may read what the model read,
  and nothing changes for them.
- **Slack.** A kept note is posted in the firing's thread as every note is; whoever keeps it is told so.

## Shape

**What the answer read is kept with it.** The answer says whether it read logs: the brief carried *Errors*, or the
model called `errors` and it answered. That is a fact about the answer, kept on the answer and on its event, and the
rule is applied when the event is read, so a later change to `auth.logs` applies to old events too.

```ts
// src/shared/ask.ts
export const AskAnswer = Schema.Struct({ ...ModelAnswer.fields, …, readLogs: Schema.Boolean })

// src/shared/timeline.ts
export const FiringEvent = Schema.Struct({ …, readLogs: Schema.optionalKey(Schema.Boolean) })

/** The events as this reader may see them: an answer drawn from logs they may not read keeps only that it was. */
export const seenBy = (events: ReadonlyArray<FiringEvent>, readsLogs: boolean): ReadonlyArray<FiringEvent> => …
```

`readLogs` is set only on `ai-answered`. Each notes store keeps it: a `read_logs boolean` column added to
`estate_events` with `add column if not exists` in Postgres, an attribute in DynamoDB, a field in memory.

**A viewer sees that it answered, not what.** Where the reader may not read logs, an `ai-answered` event with
`readLogs` keeps its time and who asked before it, and its text is withheld:

```text
2026-10-12T16:49:10Z   matt     ChipRegistryUnreachable   asked AI (claude-haiku-4-5)
2026-10-12T16:49:52Z   Estate   ChipRegistryUnreachable   AI answered from logs only operators read
```

`seenBy` is used by the four places that hand events out: the firing's events, the incident's record, and both
timeline exports. The export's header comment changes to say what a viewer's leaves out.

**Keeping it is a choice, and says so.** On an answer with `readLogs` where logs are for operators, *Keep as note*
reads *Keep as note for everyone*, with a line under it:

```text
This answer read logs only operators can read. A note is seen by everyone, viewers and the Slack thread too.
[Keep as note for everyone]
```

Pressing it keeps it as now. An operator who reads the logs and writes what they found in a note does the same thing
by hand; the button only stops it happening without the person seeing it.

**Shared answers follow what the asker may read.** `src/server/ask-limits.ts` keys an alert's turn by environment,
alert and role, so an operator's answer never reaches a viewer. The role was standing in for what the tools let each
person read, and the only role check in the tools is `readsLogs`. The key becomes environment, alert and whether the
asker may read logs:

```ts
const reads = settings.auth.logs !== "operator" || person.role === "operator"
const turn = `${environment}\u0000${id}\u0000${reads ? "logs" : "no-logs"}`
```

With `auth.logs` unset, a viewer and an operator who ask within the minute now share one answer and one call to the
model; with `auth.logs: operator`, they stay apart, as now.

## Why this shape

The leak is the event, which nobody chose to publish; a kept note is a person publishing on purpose. So the event is
held to the rule, and the note is left to the person with the rule in front of them. Keeping the fact (`readLogs`)
rather than the audience means the rule is decided once, at read time, in one function.

The alternatives: storing who may see each event (`audience: operator`) fixes the rule at the time of writing, so an
estate that opens its logs to viewers later still hides old answers. Hiding Ask AI's events from viewers altogether is
simpler but loses that an ask happened, which is the audit the timeline is for. Accepting it and saying so in the docs
leaves `auth.logs: operator` meaning less than it says. Withholding kept notes from viewers would need the shared
stream split by role. Recommended: mark the fact, withhold the event's text, warn on keeping.

## Depends on

Nothing. Spec 0039's events and spec 0024's `auth.logs` are already there.

## Stack

- [x] **`spec-0041-read-logs`**: `readLogs` on the answer and on its `ai-answered` event, kept by each notes store.
      Done when: in `http/ask.test.ts`, an operator's ask with `auth.logs: operator` whose brief has *Errors* answers
      `readLogs: true` and its event carries it, and a viewer's ask answers `readLogs: false`; an ask whose model
      calls `errors` and is answered is `readLogs: true`; Postgres, DynamoDB and memory each keep and read the field.
- [x] **`spec-0041-withheld`**: `seenBy` in `shared/timeline.ts`, used by the firing's events, the incident's record
      and both exports.
      Done when: with `auth.logs: operator`, a viewer's `GET /api/firings/:id/events`, `GET /api/incidents/:id` and
      both timeline exports show "AI answered from logs only operators read" with no likely cause, and an operator's
      show it whole; with `auth.logs` unset, both see it whole.
- [x] **`spec-0041-keep-and-share`**: *Keep as note for everyone* and its line on an answer that read logs; the
      shared answer keyed by whether the asker reads logs.
      Done when: `ask.suite.tsx` shows the line and the button's words for a `readLogs` answer only where logs are
      for operators; in `http/ask.test.ts`, with `auth.logs` unset a viewer and an operator asking within the minute
      call the model once, and with `auth.logs: operator` twice.

## Acceptance

```bash
bun run gate
```

Then, in the petshop's demo with `auth.logs: operator`: `./chaos.sh registry-slow`; an operator asks AI on
ChipRegistryUnreachable; a viewer opens the alert's timeline and its export and sees that the AI answered, not what.

## Open questions

- **`ai-answered` events kept before this ships carry no mark.** Recommended: read a missing mark as `true` where
  logs are for operators, so an old answer is withheld rather than guessed safe; the cost is one line of old timeline.
- **Should the `ai-kept` event, which carries the note's text, be withheld too?** Recommended: no; it is the note,
  which the viewer sees on the card anyway.
- **Should a viewer be able to ask for themselves after seeing the withheld line?** They can already: their own ask
  reads what they may read. Recommended: no new button; *Ask AI* is on the card.
- **Is `readLogs` the right name, if runbooks or other tools are gated later?** Recommended: yes for now; a second
  gated source becomes `read: ["logs", …]` when it exists.

# 0048 — Who wrote a line, and its trace

## Problem

A service's log lines on its page show their time, pod, level and text, and nothing else Loki knows about them. A
line written through a structured logger reaches Loki with the class that wrote it (`logger`), its thread, the trace
it belongs to (`trace_id`) and whatever else the service put in its context, as stream labels or structured metadata.
Estate reads only `pod` (or `instance`) from the stream and drops the rest.

So someone reading a slow or failing line cannot tell which class wrote it unless the text happens to say, and cannot
get from the line to its trace. They open the line in Grafana, find the trace ID there, and paste it into Tempo,
while Estate already shows a trace on a page of its own (spec 0046).

## Not doing

- **Every label.** Only the two that answer a question on the page: who wrote the line, and which trace it is part
  of. Thread, user and the rest stay in Loki.
- **Asking Loki for categorized labels.** Loki can split indexed labels from structured metadata
  (`X-Loki-Response-Encoding-Flags: categorize-labels`), but which of the two a key is does not matter here, the flag
  changes the shape of every value, and an older Loki or Grafana's proxy may not honour it. The plain answer merges
  both into `stream`, and that is what is read.
- **Datadog's or Elasticsearch's own attributes.** A JSON line from any source has its keys read, as below; those
  tools' separate attribute fields are left until someone asks.
- **Copy and Save.** Spec 0036's tab-separated text stays time, pod, level and text.
- **Taking the logger out of the text.** Many formats write it there too; the text is shown as it was written.
- **Searching by trace or logger.** The search box matches the text, as now.

## Shape

**The catalog** says which keys are which, per service, with defaults that suit most loggers:

```yaml
services:
  - name: orders
    logs:
      fields:
        trace: [trace_id, traceId, traceID]   # the default
        logger: [logger, logger_name, class]  # the default
```

Each is a list of keys, and the first one present wins. A key is looked for in the line's Loki stream (labels and
structured metadata), then in the line's own JSON when its text is JSON, so a pod's JSON log works the same way.

**A line** gains two fields, each there only when found:

```ts
interface Line {
  readonly at: string
  readonly pod?: string
  readonly level?: string
  readonly logger?: string // orders.app.Checkout
  readonly trace?: string // 9406a5bf06714196d42a68207f4a4bde
  readonly text: string
}
```

**The panel** shows them above the line's text, in the same row:

```text
10:31:02  orders-7f9c  WARN  orders.app.Checkout  trace 9406a5bf
                             Order 5271 is already paid
```

The logger is in mono, in `--ink-3`, with its full name in a `title`. The trace is a link reading its first eight
characters, with the whole ID in its `title`, to Estate's own trace page (`/traces/:id`, spec 0046), which reads the
environment's Tempo. A line with neither shows as it does now.

**Code**: `lines.ts` gains `fieldsOf`, which finds the two by the catalog's keys in a stream and a line's JSON;
`logs.ts` uses it for every source; `LogLine` in `shared/log-events.ts` gains the two fields; `parts/LogLine.tsx`
draws them.

## Why this shape

The keys are the catalog's, not Estate's, because one service writes `traceID` and another `trace_id`, and no one
estate's names belong in the code. They sit per service under `logs`, beside `mask` and `errors`, because that is
where a service's log format is already described. Linking to Estate's trace page rather than straight to Tempo or
Grafana reuses what spec 0046 built: it knows the environment's Tempo, through Grafana's proxy or not, and shows the
trace in lanes beside the rest of the estate. A link to Grafana's Explore would need a Grafana address and data source
uid per environment that the settings do not keep for the page.

## Depends on

Nothing. A line in an environment with no Tempo still links, and the trace page says the trace cannot be read there.

## Stack

- [ ] **`log-line-fields`** — `logs.fields` in the catalog, `logger` and `trace` on a line from Loki's stream or the
      line's JSON, and the panel showing both, the trace linked to its page.
      Done when: the Loki stub's lines carry their logger and trace by the default keys and by the catalog's, a JSON
      pod line carries its own, the panel suite shows the logger and a link to `/traces/:id` and a line with neither
      unchanged, and `bun run gate` passes.

## Acceptance

```bash
bun test src/server/sources/logs.test.ts src/web/logs.test.ts
bun run gate
```

By hand: against a Loki whose lines carry `logger` and `trace_id`, a line on its service's page shows the class and a
trace link that opens the trace.

## Open questions

- Should the trace link show only where the environment has a Tempo? Recommended: not yet. The page does not know
  which environments have one, and the trace page already says when it cannot read a trace; add a flag if a link that
  goes nowhere is reported.

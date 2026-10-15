# 0046 — Where a request spends its time

## Problem

Estate shows traces only as a link to the tracing tool and as the span metrics and service graph Tempo writes to
Prometheus. When a service's p99 rises, or someone asks why an adoption takes a second to reach other people's
screens, the answer is in the traces, and today it means opening Grafana's Explore, picking a trace and reading a
waterfall.

That waterfall is hard to read for a request that crosses an outbox or a queue. One long wait squashes every span
around it into a sliver. The time between spans, where a request sits in an outbox or on a topic, is blank space under
a parent span rather than a step with a name. Rows are span names, not the services and stores in the catalog. And a
single trace says nothing about whether it is typical: the question "where does the time usually go" needs many
traces, which Grafana leaves to TraceQL.

Estate already knows the estate: its services, stores, the map between them, what was deployed when, and the lines
each service wrote. It is the place to read a trace against that.

## Not doing

- **Storing traces.** Tempo keeps them; Estate reads a sample when a page asks and keeps nothing.
- **Other trace tools.** Tempo, directly or through Grafana, first. Jaeger, Datadog APM, Honeycomb and X-Ray would make
  the reader a port with Tempo its first kind; each is its own entry when someone asks.
- **TraceQL metrics.** A journey's percentiles come from a sample of recent traces read whole, not from
  `quantile_over_time`, which needs Tempo's `local-blocks` processor; see the open questions.
- **Discovering journeys.** A journey is written in the catalog. Estate does not guess which traces matter.
- **Findings and Ask AI.** "The outbox wait is the poll interval" is a person's reading for now. Giving the model a
  journey's stages is a later spec.
- **A trace's map path and its lines.** The trace page shows lanes and a waterfall; drawing it over the overview's map
  and listing its lines by `trace_id` are later entries in this spec's stack if the first ones earn their keep.
- **Alerts' example traces.** Pulling the slowest and failing traces into an alert's brief is a later spec built on
  this one's reader.

## Shape

**A journey in the catalog**: a named request that crosses the estate, the span that starts one, and its stages in
order. A stage is a span, or the time between two span edges. `where` names a node of the catalog's map, a service or
a store, and is the lane the stage is drawn in.

```yaml
journeys:
  - name: adoption
    title: Adoption, click to screen
    environments: [ demo ]
    # A trace is this journey when it holds a span of this name from this service (resource service.name).
    start: { service: petshop-web, span: adopt pet }
    stages:
      - { title: Click reaches the shop,    where: web,      from: { start: adopt pet }, to: { start: POST /adoptions } }
      - { title: Shop decides,              where: petshop,  span: adopt }
      - { title: Checks the chip,           where: registry, span: GET /chips/{id} }
      - { title: Written to the outbox,     where: postgres, span: INSERT outbox }
      - { title: Waits in the outbox,       where: postgres, from: { end: INSERT outbox }, to: { start: publish } }
      - { title: Published,                 where: bus,      span: publish }
      - { title: Kafka to the projection,   where: bus,      from: { end: publish }, to: { start: process } }
      - { title: Projected,                 where: petshop,  span: process }
      - { title: Reaches the page,          where: web,      from: { end: process }, to: { start: live event } }
```

A span is found by name, first by start time, and by service as well where the stage or the edge says `service:`, as
when a browser's call and the server's span share a name. A stage is a span's whole length (`span:`) or from one edge
to another (`from:`/`to:`, each `start:` or `end:` of a span). The
catalog check names a journey whose `where` is not a map node, service or store, whose stage has both `span:` and
`from:`/`to:` or neither, or whose environment is not the catalog's.

**When the caller has their answer** is the end of the starting span: in the example, `adopt pet` ends when the
browser has the shop's reply, while the stages after it are what everyone else waits for.

**Where Tempo is**, beside Loki in the settings, or through Grafana as Loki and Prometheus are:

```yaml
sources:
  demo:
    tempo: { url: http://tempo:3200, tenant: petshop }   # tenant sent as X-Scope-OrgID
    # or
    grafana: { url: …, token: …, tempo: <data source uid> }
```

**On the page of each service a journey's stages are in**, closed until someone asks: its title, a line saying what it
shows, and *Show where its time goes*. Tempo is read only then, so a page nobody opens it on costs no reads, and the
rest of the page stays as quiet as it was. Opened, nothing on it is live:

```text
ADOPTION, CLICK TO SCREEN                                              [ p50 | p99 ]
An adoption reaches everyone's screen in 589 ms at p50.                50 traces · last 15 min · Tempo
87% of that is Waits in the outbox.
The caller has their answer in 41 ms.

[█▌|██|█▌|▏|▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒|▏|▒|▏|▒]             ← one bar, a segment per stage
 ▲ answer · 41 ms                                    on screen · 589 ms ▲

Stage                    Where           From the trace               p50      p99
Click reaches the shop   petshop-web     adopt pet ··· POST /adoptions  8 ms    40 ms
Waits in the outbox      Postgres        INSERT outbox ··· publish    510 ms   985 ms   ← the largest, in amber
…

[ Slowest | Slowest that failed | Typical | Fastest ]                  ← which trace is drawn below; Typical first
<the picked trace in lanes, as on its own page, a step chosen to say what it was>
Open this trace, as a waterfall too
```

Spans are solid, the time between spans hatched, the largest stage amber. A stage missing from a trace (a refused
adoption never reaches the outbox) is left out of that trace's numbers, and the row says in how many traces it was
found.

**A trace's page**, `/journeys/:journey/:id`, or `/traces/:id` for a trace that is no journey's, read once:

```text
petshop / Adoption, click to screen / 4bf92f3577b34da6                     [ Lanes | Waterfall ]
Took 1.06 s to reach everyone's screen; the caller had an answer in 49 ms.  [ Waits cut short | True scale ]

Lanes        one row per `where`, spans placed in time, calls outlined, work filled, the time between spans
             hatched in the lane the stage names; arrows where the trace moves from one lane to another
Waterfall    one row per span or stage gap in time order, indented by depth, each with its lane, how long it
             took
```

Every bar and row is a button: choosing one, in either view, marks it in both and says under the trace what it was,
where, when it started, how long it took, and the lane it came from.

"Waits cut short" gives any stage longer than half the trace a tenth of the width and marks the cut, so the
millisecond spans either side stay readable; "True scale" draws time as it is. A trace that is no journey's still
opens, as a waterfall with lanes by service name.

**Server**:

```text
GET /api/journeys?env=&journey=&minutes=15   the sample: per stage p50, p99 and how many traces held it;
                                             the answer and the whole at p50 and p99; four example traces
GET /api/traces/:id?env=&journey=            one trace's spans, its stages measured, and its lanes
```

Both are read from Tempo when asked: a TraceQL search for the journey's start span in the window (`limit` 50), then
each trace read whole, four at a time. A Tempo that fails or is not set turns the panel off and says why; the page is
unharmed.

## Why this shape

The catalog already names the parts of the estate and draws the map between them, so a journey's stages are written
against those names and the lanes are the estate's, not span names. Writing stages by hand is the cost; the
alternative, inferring stages from the service graph and span kinds, cannot know that the gap between `INSERT outbox`
and `publish` is a wait with a name, and that gap is usually the answer. Percentiles from a sample read whole keep
Estate working against any Tempo without configuring its metrics generator, and the same reader serves the trace page;
the cost is a sample of 50 rather than every trace, said on the panel. Lanes are the default because they answer
"which part of the estate holds things up" at a glance; the waterfall is kept for the order and nesting of spans.

## Depends on

Spans that carry a request across its asynchronous hops, so that the outbox, the topic and the browser's live view
continue the same trace. Petshop does this from its `trace-whole-stack` branch. Without it a journey's later stages
are missing from every trace and the panel says so.

## Stack

- [x] **`tempo-reader`** — `tempo:` and `grafana.tempo` in the settings, and Tempo's reader: search
      by TraceQL in a window and read one trace whole, as OTLP's JSON in either of Tempo's shapes.
      Done when: against a stub of Tempo's API, a search reads trace ids, a trace reads its spans with their service,
      parent, times and status, the tenant is sent, and a failing Tempo is a `SourceFailure`.
- [x] **`journeys-catalog`** — `journeys:` in the catalog, checked at start, and a trace measured against a journey.
      Done when: a broken journey names each mistake, and a trace measures each stage, leaves out one it lacks, and
      finds the answer at the end of the start span.
- [x] **`journey-endpoint`** — `GET /api/journeys` and `GET /api/traces/:id`.
      Done when: against the Tempo stub, the sample's p50 and p99 per stage are those of the traces read, the four
      examples are the slowest, slowest failed, typical and fastest, and a journey without Tempo is a 404 naming why.
- [x] **`journey-panel`** — the panel on the page of each service a journey's stages are in.
      Done when: a suite shows it closed and unread until asked, then the bar, the p50/p99 switch, the stage table with
      the largest stage marked, and the typical trace in lanes, another drawn when picked; and the panel says why
      when Tempo is not there.
- [x] **`trace-page`** — `/journeys/:journey/:id` and `/traces/:id`, lanes and a waterfall, waits cut short or at true
      scale.
      Done when: a suite shows a trace's lanes with a hand-off between them, the waterfall's rows in time order, and
      the cut marked.
- [ ] **`trace-against-usual`** — each step on a trace's page beside the journey's p50 for it, and Playwright opening a
      trace from a journey panel.
      Done when: a suite shows a slow step marked against its p50, and the Playwright walk is accessible.

## Acceptance

```bash
bun run gate
bunx playwright test
```

With the petshop demo running from its `trace-whole-stack` branch, the petshop page shows Adoption, click to screen,
and its largest stage is Waits in the outbox, close to half the relay's `outboxEvery`.

## Open questions

1. **Percentiles from a sample, or from TraceQL metrics?** Recommended a sample of 50 read whole: it works on any
   Tempo and the trace page needs the same reader. TraceQL metrics can come later as a second way to answer the
   panel where Tempo has `local-blocks` on.
2. **Should `where` be inferred from a span's service and `db.system` or `messaging.system`?** Recommended written:
   the catalog's names for things are not OpenTelemetry's, and a written `where` is checked at start.
3. **Which pages show a journey?** Recommended every service a stage's `where` resolves to, and not stores, whose
   pages are about the store; a journey page of its own if people want to link to one.
4. **How long a window?** Recommended 15 minutes, `minutes=` up to 60: long enough for a sample at low traffic, short
   enough that a change shows.

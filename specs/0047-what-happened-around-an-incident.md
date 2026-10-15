# 0047 — What happened around an incident, kept to take away

## Problem

Spec 0039 keeps what people and Estate did to an incident's firings: fired, noted, silenced, asked AI, linked,
closed. It does not keep what changed around them, and that is half of a review:

- **Versions.** Estate holds each service's running version now and its latest deploy (spec 0037). Which version was
  running when the first alert fired, what was deployed or rolled back during the incident, and what was running when
  it closed are not kept anywhere. The review asks "what changed?" first and rebuilds it from the deploy tool.
- **The estate moving.** A pod OOMKilled and restarting, a workload scaled, a health check failing, a service going
  from healthy to critical and why, debug switched on, a job failing: Estate sees each one on its next read and keeps
  none of them, because none is an action on a firing.
- **What Estate cannot see.** "Rolled the registry back by hand", "Postgres failover at 14:10", "the vendor confirmed
  an outage": the person who did it writes a note later, and the note carries the time it was written, not the time
  it happened.
- **The evidence.** The charts, the error lines and the traces an incident was worked from live in Prometheus, Loki
  and Tempo, which keep days to weeks. A review three weeks later, or a reader without access to those tools, gets
  the words and none of what they were about. 0039's export is the timeline only.

The person writing the review rebuilds versions from the deploy tool, takes screenshots of Grafana while they still
can, pastes log lines into a document, and copies trace ids by hand.

## Not doing

- **Recording the estate always.** Changes are kept only for the services in an open incident, from its run-up to
  its close. Outside an incident Estate stays a reader, as `AGENTS.md` says.
- **Reading deploy history by time.** The run-up is rebuilt from what Estate holds when the incident opens (spec
  0037's limit stands); querying each deploy tool for a past window is its own spec if asked.
- **Running incidents.** Paging, roles, status pages and postmortem templates stay in the incident tool (0039, 0043).
  What the incident tool says of it (0043's read-back) stays on its page and is not copied into the record.
- **Pictures of Grafana.** Charts are drawn from the kept series, not captured from a browser. A PNG is a later entry
  if a tool that takes the export needs one.
- **All of the logs and traces.** Evidence is a bounded sample per service, and what was left out is listed.
- **Editing the record.** As in 0039, events are added, never changed or removed. A manual entry with the wrong time
  is corrected by another entry.
- **Evidence for a lone firing.** A past firing's page (0037) reads its sources live as now. Evidence is kept for
  incidents only.

## Shape

### An incident's services and window

An incident's **services** are the services and stores of its firings, plus any an operator adds (*Add a service*),
which is an event. Its **window** runs from `incidents.leadMinutes` (30 by default) before its first firing, or before
it was opened if that is earlier, to when it was closed; while open, to now.

### Events on the incident itself

0039 keeps events on firings. An incident gains events of its own, kept in the same notes store and merged into its
timeline by time. Every event, old kinds and new, gains two fields:

```text
at           when it happened, to the second, UTC
recordedAt   when Estate kept it; the same as `at` for what Estate saw live
source       seen      Estate saw it on a read while the incident was open
             rebuilt   rebuilt on open or link from what Estate held then
             written   a person wrote it, with a time of their choosing
service      the service or store it is about, where there is one
```

New kinds, all on the incident:

| Kind | Text | Who |
|---|---|---|
| `version-seen` | `petshop 1.41.2 running in demo` at the window's start, on link of a new service, and at close | Estate |
| `deployed` | `petshop 1.41.2 → 1.42.0 in demo`, with the build's link; a lower version is `rolled back` | Estate |
| `chosen` | `petshop 1.42.0 chosen in demo, not yet ready` (GitOps tools, from `chosen`) | Estate |
| `build` | `petshop main-212 failed at test` | Estate |
| `restarted` | `petshop-7f9c restarted (OOMKilled), 3 restarts` | Estate |
| `scaled` | `registry 2 → 0 pods` | Estate |
| `health-changed` | `petshop healthy → critical: registry unreachable, outbox backing up` | Estate |
| `debug` | `debug on for petshop until 15:00` / `off` | the person |
| `job` | `job outbox-sweep failed` | Estate |
| `service-added` | `registry added` | the person |
| `happened` | `Rolled the registry back by hand` | the person, `source: written` |
| `evidence-kept` | `kept 3 services' charts, 4,120 lines, 34 traces (6.1 MB)` | the person, or Estate on close |
| `exported` | `exported as zip` | the person |

**Seen.** While an incident is open, each read of its services' state is compared with the last, and each change is
kept as an event. In a cluster the runner that owns the environment (specs 0026, 0032) does it, so it is kept once.

**Rebuilt.** When an incident opens, or a service joins it, the window's run-up so far is rebuilt from what Estate
holds: firings, the feed, the latest deploy and builds, pod restart counts and their last termination reason. Each
is `source: rebuilt`. Where the latest deploy Estate holds is newer than the window's start, a `version-seen` says
the version before it is not known here, as the past firing's page does.

**Written.** *Add what happened* on the incident's page takes a line and a time (now by default, any time in the
window), and keeps who wrote it and when. Any signed-in writer may add one, as with notes.

```text
Timeline                                                         [Add what happened]
  13:58:20  Estate  petshop 1.41.2 → 1.42.0 in demo           rebuilt ↺
  14:02:11  Estate  ChipRegistryUnreachable fired, warning, petshop
  14:03:40  Estate  petshop healthy → critical: registry unreachable
  14:04:02  Estate  registry-6c1d restarted (OOMKilled), 1 restart
  14:05:00  gil     Rolled the registry back by hand          written 14:31 ✎
  14:09:15  Estate  registry 1.8.0 → 1.7.3 in demo, rolled back
```

`written` and `rebuilt` events are marked, and say when they were kept on hover.

### Versions

The incident's page gains *What changed*, from the version events:

```text
What changed                 at start        during                               at close
  petshop      demo          1.41.2          1.42.0 at 13:58 (before it fired)    1.42.0      compare ↗
  registry     demo          1.8.0           1.7.3 at 14:09, rolled back          1.7.3       compare ↗
  postgres     demo          16.4            -                                     16.4
```

*Compare* links from the version at start to the one at close: from the catalog's `repository` for GitHub and GitLab,
or the service's `links.compare` template with `{from}` and `{to}` for anything else, and not shown without either.

### Evidence

On close, Estate keeps the incident's evidence in the notes store. An operator may also *Keep evidence now* while it
is open; a later keep adds a new set beside the earlier one rather than replacing it.

- **Charts.** For each of its services, the series of its Load (requests, errors, p99) and its `stats`, over the
  window, at a step that keeps each under 600 points. Each kept with the query it came from.
- **Logs.** For each service: its errors grouped by message, as `/api/logs/errors` gives them, and up to
  `incidents.evidence.lines` (2,000) of its lines, newest errors first, masked as on the page.
- **Traces.** For each journey (spec 0046) whose stages include one of its services: the ten slowest and the ten that
  failed in the window. Then up to twenty more traces whose ids are in the kept lines. Each read whole through 0046's
  reader.

An incident's evidence is held under `incidents.evidence.maxMegabytes` (25). What did not fit, or a source that did
not answer, is named in the `evidence-kept` event and in the export, never dropped silently.

The incident's page draws *Evidence* from what was kept, not from the sources: each service's charts with the
window shaded and the timeline's events marked on the time axis, the grouped errors, and the traces, which open on
0046's trace page. Before anything is kept, the page reads live as a past firing's does and says so.

### Export

0039's `GET /api/incidents/:id/timeline?format=md|json` stays. A new route gives everything:

```text
GET /api/incidents/:id/export?format=zip
```

```text
chip-registry-slow-2026-10-12/
  incident.md            title, how it ended, impact, firings, What changed, the timeline as a table with `source`,
                         notes in full, and links to every file below
  incident.json          the incident, its events and its evidence, in the shared schemas
  timeline.csv           one row an event: at, recordedAt, source, who, kind, service, firing, text, link
  timeline.jsonl         the same, one event a line
  versions.json          each service's version at start, its changes, and at close
  charts/<service>-<panel>.svg   drawn on the server from the kept series, window shaded, events marked
  charts/<service>-<panel>.json  the series and its query
  logs/<service>.log     the kept lines, as *Save* on the Logs panel writes them (spec 0036)
  logs/<service>-errors.json
  traces/<trace id>.json the trace as Tempo gave it (OTLP JSON), so it opens in Tempo or Jaeger again
  manifest.json          Estate's version, the catalog's hash, the window, each source with what it was asked and
                         when, who kept the evidence and when, what was left out and why, and file sizes
```

Before evidence is kept, the zip reads its charts, logs and traces from the sources then, and `manifest.json` says
`"live": true`. *Download ▾* on the incident's page gains *Everything (zip)*. Each export is an `exported` event.

### Who may do what

- **Operators**: add a service, keep evidence now.
- **Writers** (any signed-in person but a screen): add what happened.
- **Viewers**: read the page and export. Where `auth.logs` keeps logs to operators, a viewer's page and export leave
  out logs, traces and AI answers drawn from logs (spec 0041), and `manifest.json` says they were left out for this
  reader.

### Settings

```yaml
incidents:
  leadMinutes: 30          # how far before the first firing an incident's window starts
  keepDays: 400            # an incident, its firings, events and evidence; firings in no incident follow alerts.historyDays
  evidence:
    lines: 2000            # log lines a service
    maxMegabytes: 25       # an incident's evidence in all
```

## Why this shape

Changes are recorded as they happen, rather than read back from each tool by time when the review asks. Reading
back would keep Estate a pure reader, but it needs a history query per deploy, cluster and CI kind, many of which
keep none, and it cannot recover a pod that restarted or a check that failed and recovered. Recording only while an
incident is open keeps the exception small: the incident record is Estate's own, as notes are.

The evidence is a copy because it will not be there later. The alternative is links into Grafana, Loki and Tempo with
the window filled in. That is smaller and needs no storage, but most estates keep logs and traces for days to weeks,
and an export with dead links is the problem it was meant to solve. Recommended: links as well, in `incident.md`,
beside the copy.

Charts are SVG drawn from the kept series rather than pictures of the page. SVG needs no browser on the server, stays
sharp, is small, opens in anything, and the series beside it can be charted again.

## Depends on

- Spec 0039's incidents and events, 0046's Tempo reader, and 0026/0032's runner owning an environment's reads.
- A zip writer. Bun has gzip but not zip. Recommended: `fflate`, which is small, has no dependencies and streams.
- In the petshop demo, *What changed* shows versions only if the shop says which one it runs. Until it does, the
  section says no version is known for it.

## Stack

- [x] **`spec-0047`** — this spec, the README's row, and pointers from 0021's and 0025's *Not doing* to 0039 and
      this one.
      Done when: they are committed.
- [x] **`spec-0047-incident-events`** — events on an incident itself, `recordedAt`, `source` and `service` on every
      event, in each notes store, merged into the incident's timeline; older events read as `seen`.
      Done when: each store's test keeps and reads an incident's own events beside its firings', in order by `at`; an
      event kept before this decodes with `source: seen` and `recordedAt` equal to `at`.
- [x] **`spec-0047-services-and-window`** — an incident's services from its firings and *Add a service*; its window
      from `incidents.leadMinutes`.
      Done when: an incident with a petshop firing has petshop as a service; adding registry is an event; its window
      starts 30 minutes before its first firing.
- [x] **`spec-0047-seen`** — while open, changes to its services kept: deployed and rolled back, chosen, builds,
      restarted, scaled, health changed, debug, jobs.
      Done when: against stub sources, a version change, a restart with OOMKilled, a scale to zero and a health change
      on an incident's service each become one event; the same change on a service outside it does not; in a cluster
      each is kept once.
- [x] **`spec-0047-rebuilt`** — the run-up rebuilt on open and on a service joining, `source: rebuilt`, with a
      `version-seen` at the window's start or that it is not known.
      Done when: opening an incident 10 minutes after a deploy keeps that deploy as rebuilt; a deploy newer than the
      window's start says the earlier version is not known here.
- [x] **`spec-0047-written`** — *Add what happened* with a time in the window, marked on the timeline.
      Done when: a written entry at 14:05 added at 14:31 shows at 14:05, marked written, with when it was kept; a time
      outside the window is refused with why; a screen cannot add one.
- [ ] **`spec-0047-versions`** — *What changed* on the incident's page and `versions.json`; compare links from
      `repository` or `links.compare`.
      Done when: an incident with a deploy and a rollback shows each service's start, changes and close, and a
      compare link for a GitHub repository; a service with no version known says so.
- [ ] **`spec-0047-evidence-charts`** — charts kept on close and on *Keep evidence now*, in each notes store, drawn on
      the page with the window and events.
      Done when: closing an incident keeps each service's Load and stats series with their queries; the page draws
      them after Prometheus is stopped; a second keep adds a set.
- [ ] **`spec-0047-evidence-logs`** — errors grouped and lines kept, masked, within the limits.
      Done when: a service's errors and lines are kept and shown with Loki stopped; past `evidence.lines` the rest is
      named as left out.
- [ ] **`spec-0047-evidence-traces`** — journeys' slowest and failed traces and the traces named in kept lines, kept
      whole.
      Done when: against a stub Tempo, an incident on a journey's service keeps its slowest and failed traces and
      the ones its lines name, and they open on the trace page with Tempo stopped.
- [ ] **`spec-0047-evidence-limit`** — `maxMegabytes` held; what did not fit and sources that did not answer named.
      Done when: evidence past the limit keeps charts first, then errors, then traces, then lines, and the
      `evidence-kept` event names what was left out.
- [ ] **`spec-0047-export-zip`** — `GET /api/incidents/:id/export?format=zip` with every file above; SVGs drawn on
      the server; *Everything (zip)*; an `exported` event.
      Done when: the zip of an incident holds each file, `incident.json` decodes as the shared schema, each SVG has
      the window and an event mark, and the CSV opens with one row an event.
- [ ] **`spec-0047-export-readers`** — a viewer's page and zip leave out what `auth.logs` and 0041 keep from them,
      and say so; a live export says it is live.
      Done when: a viewer's zip has no `logs/` or `traces/` where logs are for operators, and its manifest says why;
      an export before evidence is kept has `"live": true`.
- [ ] **`spec-0047-keep`** — `incidents.keepDays`: an incident, its firings, events and evidence kept that long;
      firings in no incident swept as now.
      Done when: a sweep past `alerts.historyDays` keeps a firing that is in an incident and its events, and a sweep
      past `incidents.keepDays` removes the incident with all of it.

## Acceptance

```bash
bun run gate
bun run integration -t "Notes"
```

Then, in the petshop's demo: `./chaos.sh registry-slow`; open an incident from ChipRegistryUnreachable, add
*Rolled the registry back by hand* at a time before now, `./chaos.sh restore`, and close it. The incident's page shows
the restart, the health changes and the written entry in order, its Evidence draws with Prometheus, Loki and Tempo
stopped, and *Everything (zip)* opens to the files above.

## Open questions

- **Does `AGENTS.md`'s "read, don't store" change?** Recommended: yes, one line: Estate keeps its own notes, who
  switched what, and an incident's record and evidence; everything else is read. A person's call, since it is the
  rule agents work by.
- **How long are incidents kept?** Recommended: 400 days, so last year's incident is there for this year's review;
  its firings and events stay with it past `alerts.historyDays`.
- **Evidence in DynamoDB?** An item holds 400 KB. Recommended: gzip each set and split it across items under the
  incident's key, read back in order. An S3 bucket is the alternative if an estate's evidence outgrows that.
- **Does reopening a closed incident keep evidence again on the next close?** Recommended: yes, as a new set; the
  earlier one stays.
- **Charts for a service's neighbours?** An incident on petshop is often caused by the registry next to it on the map.
  Recommended: no, only its services; adding the registry as a service brings its charts.
- **Should viewers keep evidence?** Recommended: no, operators; it reads every source for every service and is the
  costliest thing on the page.

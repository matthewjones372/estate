# 0008 — The whole of Effect

## Problem

The server is written in Effect, but in places it hand-rolls what Effect already has, and two of those places are bugs:

- **A catalog that gains an environment never reads it.** Sources are started once, for the environments known at
  start; an environment added by a reload stays "waiting" for ever.
- **A garbled session cookie is a 500.** Its JSON is parsed without a schema, so a bad cookie throws inside an Effect
  and becomes a defect rather than "signed out".

The rest costs clarity and safety rather than correctness:

- `fetch` is wrapped by hand, with its own timeout, status checks and `JSON.parse`.
- Environment variables are read from `process.env` directly.
- Secrets (the OIDC client secret, the session secret, tokens, the notes database URL) are plain strings that could be
  logged.
- Some failures are plain objects, not tagged errors.
- Time is millisecond arithmetic.
- Files are read with `Bun.file`, losing the error.
- State is kept in `let`s.
- Estate has no metrics or spans of its own, for a tool whose job is to read other tools' metrics.
- OIDC discovery and its keys are fetched on every sign-in.

## Not doing

- **HttpApi, Rpc, STM, Cluster or Workflow.** A dozen routes and one state ref don't need them.
- **`@effect/sql`** for the notes. Bun's SQL behind the Notes port is enough, with its rows decoded by a schema.
- **Vendoring Effect's repository** as a git subtree for agents to read. The package already ships its source,
  `AGENTS.md` and `ai-docs` in `node_modules/effect`, and `AGENTS.md` points there.
- **Effect in the pages** beyond Schema, which decodes each event.

## Shape

| Effect | Where |
|---|---|
| `HttpClient` (`FetchHttpClient`) with `filterStatusOk`, `schemaBodyJson`, `retryTransient`, `timeout` | `Remote`: every call to Prometheus, Alertmanager, Kubernetes, GitHub and the OIDC provider |
| `Config` / `ConfigProvider` | `ESTATE_SETTINGS`, the in-cluster `KUBERNETES_*` variables, `${NAME}` substitution in `estate.yaml` |
| `Redacted` | every secret in the settings, unwrapped only where it is sent |
| `Data.TaggedError` | `SourceFailure`, `Refusal` (an `HttpServerRespondable`), `NotesError`, exported |
| `Schema` at every edge | cookies, query parameters (`schemaSearchParams`), the notes' rows, bounded numbers (`Int`, `between`) |
| `FiberMap` in a scoped layer | one reader fiber per environment, started and stopped as the catalog changes |
| `Schedule` | one helper for "every n, for ever"; exponential back-off where a dependency is down |
| `Cache` / `cachedWithTTL` | OIDC discovery and keys, the cluster's token and CA, one Jobs list per namespace per read |
| `Ref` / `SynchronizedRef` | the catalog file's last good copy, memory notes, GitHub's ETags |
| `FileSystem` / `Path` (`BunServices`) | the catalog, the settings, the service account's token, the pages' bundle |
| `DateTime` / `Duration` | silences, debug, notes' expiry, sessions, jobs and the feed |
| `Logger` (JSON in the image), `annotateLogs` | every source's failures, with its environment and part |
| `Metric` and `/metrics` | source reads and failures per part, upstream latency, open streams, notes written |
| `Effect.fn` spans, OTLP export when set | each source read and each upstream call |

```ts
const readCluster = Effect.fn("source.cluster")(function* (environment: Environment) {
  const client = yield* Remote
  const pods = yield* client.get(`${api}/pods`).pipe(HttpClientResponse.schemaBodyJson(PodList))
  ...
})
```

## Why this shape

Each row replaces hand-written code with the Effect module made for it, so what the code does is said in Effect's
words and checked by its types. Errors stay in the type, retries and timeouts are policies rather than loops, secrets
can't reach a log line, and tests control time and configuration without stubbing globals. Metrics and spans are
the ones an operator of Estate needs, and they come almost for free once every upstream call goes through one
`HttpClient`. The alternative was to leave working code alone. Recommended against, because of the two bugs, and
because every later spec (logs, stores, more kinds) adds sources that should be written the Effect way from the start.

## Depends on

Nothing.

## Stack

- [x] **`edges`** — the session cookie and query parameters decoded by Schema; tagged `SourceFailure` and `Refusal`;
      secrets `Redacted`.
      Done when: a garbled cookie reads as signed out, a malformed query is a 400 saying what it should be, and a
      secret prints as `<redacted>`.
- [x] **`http-client`** — `Remote`, the port every source and test answers through, is built on `HttpClient`:
      reads retried on transport errors with back-off, writes tried once, every call given up on after 10 s.
      Done when: every source's tests pass through it, the pages work against the fake tools, and an upstream timing
      out is named.
- [x] **`config-files-state`** — `Config` for the environment, `FileSystem` and `Path` for files, `Ref` for state,
      `DateTime` and `Duration` for time.
      Done when: no `process.env`, `Bun.file`, `node:path` or `let` is left in `src/server` outside the bundler.
- [x] **`supervised`** — sources in a `FiberMap` per environment, following the catalog; the schedule helper;
      back-off where a dependency is down.
      Done when: an environment added by a catalog reload is read, and one removed stops being read.
- [x] **`caches`** — OIDC discovery and keys, the cluster's credentials, Jobs per namespace.
      Done when: ten sign-ins fetch discovery once.
- [ ] **`observability`** — JSON logs annotated with environment and part; `/metrics`; spans, exported over OTLP
      when `telemetry.otlp` is set.
      Done when: `/metrics` counts a failing source, and a span names the call that timed out.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

1. **`/metrics` behind sign-in?** Recommended no, on its own port (`metrics.port`, 9464), so Prometheus can scrape it
   without a session and the page's port stays signed-in only.
2. **OTLP on by default?** Recommended off: only when `telemetry.otlp` names a collector.

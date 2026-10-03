# 0016 — Against the real thing

## Problem

Every integration is tested against fakes written from each tool's documentation. A fake proves Estate reads what
its author thought the tool says; it cannot prove the tool says it. Where the fake and the tool differ, the gate is
green and the page is empty. Most of the tools Estate reads run in a container, so for those there is no reason to
trust a fake alone.

## Not doing

- **SaaS-only tools.** Datadog, Harness, GitHub Actions and Argo CD's hosted forms have no container. They stay on
  fakes, checked against a real account with `estate doctor` as `docs/real-tools.md` describes.
- **Replacing the fakes.** The unit tests and Playwright keep their fakes: fast, exact, and able to play failures a
  real tool will not.
- **Running in the gate.** Real tools take tens of seconds to start and need Docker. The suite is its own command.

## Shape

```bash
bun run integration                  # every suite: needs Docker
bun run integration -t "Grafana"     # one
```

Each suite starts its tools with Testcontainers, configures them as a team would (a rule that fires, a data source,
a log line, an index), and then asks Estate's own readers and writers, the same functions the server runs:

| Suite | Real tools | Proves |
|---|---|---|
| Prometheus | Prometheus, Alertmanager | a firing rule is an alert about its service, with a chart against its threshold; a silence written by Estate silences it and is ended by Estate |
| Grafana | Grafana with Prometheus and Loki behind it | load and lines through the data source proxy with a service account token; a Grafana-managed rule as an alert with its threshold; a silence through Grafana's Alertmanager |
| Logs | Loki, Elasticsearch | a service's lines, newest first in the window, masked, and its errors grouped |
| Notes | Postgres, DynamoDB Local | notes kept across a restart, and ended after `keepDays` |
| Jenkins | Jenkins | a job's running, failed and passing builds |

## Why this shape

Testcontainers starts each tool from its published image and throws it away afterwards, so a suite needs nothing
installed but Docker, and runs the same on a laptop and in CI. Calling Estate's readers directly, rather than
driving the page, keeps a failure pointing at the one call that disagreed with the tool. The alternative, a
docker-compose estate driven by Playwright, would prove more at once but say less about what broke. Recommended:
the readers, one suite a tool.

## Depends on

Docker where the suite runs.

## Stack

- [x] **`real-prometheus`** — the suite's harness and `bun run integration`; Prometheus and Alertmanager.
      Done when: a rule firing in a real Prometheus is silenced and unsilenced by Estate in a real Alertmanager.
- [x] **`real-grafana`** — Grafana's data source proxy, its alerting and its silences.
      Done when: a Grafana-managed rule fires and Estate charts it against its threshold, through a service account.
- [x] **`real-logs`** — Loki and Elasticsearch.
      Done when: a line pushed to each is read back, masked, and an error grouped.
- [x] **`real-notes`** — Postgres and DynamoDB Local.
      Done when: a note survives a restart of Estate's notes against each.
- [ ] **`real-jenkins`** — Jenkins.
      Done when: a job built three times reads as its three builds.

## Acceptance

```bash
bun run integration
```

## Open questions

- Should CI run the suite? Recommended: yes, nightly and on changes under `src/server/sources/`, once Actions
  minutes allow; until then, before each release, on a laptop.

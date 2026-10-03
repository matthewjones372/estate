# 0018 — Jobs and agents

## Problem

The catalog has services and stores. A job can only be listed under a service, so a batch platform's jobs, a
nightly settlement run or a reporting job that no service owns has to pretend to be a service. And teams now run AI
agents in production: a support triage agent, a code review bot, an agent that reconciles invoices. Today an agent
is either missing from Estate or listed as a service. That shows its pods and its request rate, but not what makes
an agent need someone: runs failing, a model changed under it, or spend running past what the team set aside.

With dozens of entries of three kinds, one long list of lanes is also hard to read in five seconds. Teams think in
areas (payments, data, support), and the overview should too.

## Not doing

- **Running, pausing or approving agents.** Estate shows how an agent is doing and links to where it is run. A pause
  switch like debug's is an open question below, not part of this spec.
- **Evaluating agents.** Whether an agent's answers are good is for its evaluation tool. Estate shows what that tool
  last scored, if the team names it, and nothing more.
- **Storing prompts, transcripts or traces.** Estate links to a run's trace in the tool that has it.
- **Its own alert rules for agents.** Alerts about an agent come from the team's alerting, as for any service. Budget
  is the one exception, shown as Estate shows a stalled deploy.

## Shape

```yaml
# catalog.yaml
services:
  - name: checkout
    category: payments                 # any entry: the overview groups lanes by category
jobs:
  - name: nightly-settlement
    category: payments
    owner: payments
    environments: [ production ]
    run: { kubernetes: { namespace: batch, cronJob: nightly-settlement } }   # or { ecs: { cluster, scheduledTask } }
agents:
  - name: support-triage
    category: support
    owner: support
    environments: [ production ]
    runtime: { kubernetes: { namespace: support, workloads: [ { kind: Deployment, name: triage } ] } }   # optional
    usage:                             # queries, as `load:` is; examples below use OpenTelemetry's GenAI metrics
      runs: sum(rate(gen_ai_client_operation_duration_seconds_count{gen_ai_agent_name="support-triage"}[5m]))
      errors: sum(rate(gen_ai_client_operation_duration_seconds_count{gen_ai_agent_name="support-triage",error_type!=""}[5m]))
      p99: histogram_quantile(0.99, sum by (le) (rate(gen_ai_client_operation_duration_seconds_bucket{gen_ai_agent_name="support-triage"}[5m])))
      tokens: sum(rate(gen_ai_client_token_usage_sum{gen_ai_agent_name="support-triage"}[5m])) * 3600
      model: group by (gen_ai_response_model) (gen_ai_client_token_usage_count{gen_ai_agent_name="support-triage"})
    budget: { tokens: 20M, per: day }  # a budget in money, and what an agent costs, are spec 0019's
    runs: { langfuse: { project: support, name: support-triage } }
```

```text
Overview
  Payments    checkout ▮▮▮  orders ▮▮▮  nightly-settlement ✓ 02:00 (next 02:00)
  Support     support-triage  ● 41 runs/h · 3% failed · p99 38 s · 6.1M of 20M tokens today · claude-… (changed 09:12)
  Data        …
```

- **Categories** apply to services, stores, jobs and agents. The overview shows a heading for each category, in
  the order the catalog first names it, with uncategorised entries last. The kiosk takes `?category=` as it takes
  `?team=`.
- **Jobs** have their own lane: the last runs and how each ended, the next run, and a run that was missed or failed.
  A failed or missed run is something that needs someone. A service's own `jobs:` stay as they are.
- **Agents** have a lane showing runs an hour, the share that failed, p99 duration, and tokens (or cost) today
  against the budget. They also show the model in use. When the model changes, that is an event on the feed, as a
  deploy is. Over budget, or a failure rate over the threshold the team sets, needs someone. An agent with a
  `runtime` also shows its pods; one with `build` or `deploy` shows its pipeline, as a service does.
- **An agent's page** lists its recent runs from the tool that traces them: outcome, duration, tokens, cost, the
  model, and a link to the trace there. Its alerts, logs and charts are as a service's.

## Why this shape

Jobs and agents are top-level lists beside `services` and `stores`, not a `kind:` on a service. They have fields a
service does not (a schedule, a budget, a model), and a service's fields (load, debug, logs) mostly do not apply.
Separate lists keep each one's checks exact, and leave every existing catalog valid as it is.

An agent's usage comes from metrics the team already sends. OpenTelemetry's GenAI conventions name them, and most
agent frameworks emit them to Prometheus, Datadog or Grafana, which Estate already reads. As spec 0012 decided for
load, the catalog names the queries, so nothing is assumed about a team's metric names. The docs give the
OpenTelemetry queries to copy. Recent runs need a tracing tool, since metrics do not keep runs. Langfuse is open
source, can be self-hosted, and has a public API, so it can be tested against the real thing. LangSmith and Datadog's
LLM Observability can follow it as kinds behind the same port. Recommended: metrics for the lane, a tracing tool for
the runs, Langfuse first.

## Depends on

Spec 0019 for spend in money: this spec's budget is in tokens. The team's agents emitting GenAI metrics, or any metrics Estate can query, and a tracing tool for the runs. Until a
`runs:` tool is named, the agent's page shows its usage, alerts and logs, without runs.

## Stack

- [x] **`categories`** — `category` on every entry; the overview grouped by it; `?category=` on the kiosk.
      Done when: the e2e estate's lanes sit under Payments and Support headings, and a kiosk shows one category.
- [ ] **`standalone-jobs`** — top-level `jobs:` on Kubernetes and ECS, each with its own lane.
      Done when: a CronJob that no service owns shows its runs and a missed run, and needs someone when it fails.
- [ ] **`agent-usage`** — top-level `agents:`, their lane from `usage:` queries, the model in use, the budget.
      Done when: an agent over its token budget needs someone, and its model changing is on the feed.
- [ ] **`agent-runs`** — an agent's recent runs from Langfuse, each linking to its trace.
      Done when: a test against Langfuse's API shows a failed and a succeeded run with tokens, cost and a link.
- [ ] **`agents-e2e`** — an agent and a standalone job in the Playwright estate, against fakes; the README and
      `examples/` show both; `estate doctor` reads each agent's usage and runs.
      Done when: `bunx playwright test` passes with them.

## Acceptance

```bash
bun run gate
bunx playwright test
bun run perf
```

## Open questions

- **Which tool traces your agents' runs?** Recommended: Langfuse first, as above. If yours is LangSmith, Datadog
  LLM Observability, Arize Phoenix or something else, that goes first instead.
- **A pause switch?** Setting an agent's replicas to zero, or a flag it reads, for a time, under your name, as debug
  is. Recommended: not yet. Whether it is wanted becomes clear once the lane shows when an agent needs stopping.
- **Evaluation scores?** A score from the team's evaluation tool on the lane. Recommended: leave it out until a team
  names the tool.
- **Budget by day or month?** Recommended: `per: day | month`, the lane showing today's or the month's share.
  Spec 0019 uses the same for budgets in money.

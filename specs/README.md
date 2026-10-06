# Specs

Nothing is built without a spec here. Each says what is wrong, what it will not do, the shape it takes, and a stack of
entries, one per pull request, each with what proves it done.

| Spec | What |
|---|---|
| [0001](0001-the-estate-on-one-page.md) | the estate on one page: alerts with notes and silences, health, versions through the pipeline in every environment, load, links, and a debug switch that turns itself off, for any estate described by a catalog; done |
| [0002](0002-more-kinds-of-estate.md) | more kinds of estate: Grafana alerting, Elasticsearch logs, Argo CD, GitLab CI, ECS, CloudWatch and notes in DynamoDB beside the first kinds, each part a port with its kinds behind it; done, with Buildkite, Nomad and Cloud Run left for when someone asks |
| [0003](0003-stores.md) | stores: databases, queues and caches in the catalog, with stats and health from a preset per engine (Postgres, CloudNativePG, MySQL, Redis, Kafka), on the overview and a page of their own; done |
| [0004](0004-notes-that-end.md) | notes that end: removed by their author or an operator, and after `notes.keepDays`; silences for 1 hour, 6 hours, 1 day or until 09:00; done |
| [0005](0005-charts-you-can-read.md) | charts you can read: point at, step through or drag across a chart to read a time and value, shared across a service's charts; done |
| [0006](0006-pages-in-solid.md) | the pages in Solid: the same pages and tests, updating only what changed, compiled by a Bun plugin; done |
| [0007](0007-logs-on-the-page.md) | logs on the page: a service's live lines and its errors grouped by message, from Loki or the cluster, masked; done |
| [0008](0008-the-whole-of-effect.md) | the whole of Effect: HttpClient, Config, Redacted, FiberMap, Cache, DateTime, FileSystem, metrics and spans where code is hand-rolled; fixes environments added by a reload never being read; done |
| [0009](0009-trying-it-on-a-real-estate.md) | trying it on a real estate: `estate doctor` reports what each source answered and what does not fit the catalog; `readOnly: true` so trying it can change nothing; done |
| [0010](0010-a-thousand-services.md) | a thousand services: each environment's views built once and shared by every page watching it, only changed services sent, the cluster read a namespace at a time, every flow of data a `Stream`, and lanes that look services up by name; done |
| [0011](0011-staying-fast.md) | staying fast: the bench in the repository, budgets at fifty services that fail the build, and how often each source is read set per environment; done |
| [0012](0012-through-the-platform.md) | through the platform: Prometheus and Loki through Grafana's data source proxy, and Datadog for alerts, silences, load and logs; done |
| [0013](0013-jenkins.md) | Jenkins: builds from Jenkins jobs on the pipeline rail; done |
| [0014](0014-on-a-screen.md) | on a screen: `/kiosk`, signed in once with a token, read-only, environments in turn, a team's services, and a screen that says when it is stale; done |
| [0015](0015-harness-and-teamcity.md) | Harness and TeamCity: builds from TeamCity and Harness CI, deploys from Harness CD; done |
| [0016](0016-against-the-real-thing.md) | against the real thing: `bun run integration` runs Estate's readers and writers against real Prometheus, Alertmanager, Grafana, Loki, Elasticsearch, Postgres, DynamoDB Local, Jenkins, CloudWatch's alarms in LocalStack, and Kubernetes with Flux's resources in containers; done |
| [0017](0017-what-a-review-found.md) | what a review found: sign-in returns only to a path on this host, `Secure` cookies behind https, the HMAC key imported once, silences held until the manager has them, an unsilenced alert back in its own state, and `/readyz` once every source has been read; done |
| [0018](0018-jobs-and-agents.md) | jobs and agents: categories that group the overview, jobs no service owns, and AI agents with their runs, failures, model and spend against a budget; done |
| [0019](0019-what-it-costs.md) | what it costs: each entry's cost beside its health, from AWS Cost Explorer by tag, OpenCost, and the AI providers' cost reports, with a labelled live estimate of an agent's spend from its tokens; anomalies and budgets passed need someone; proposed |
| [0020](0020-a-map-for-many.md) | a map for many: columns as tall as their nodes need, and past twelve nodes one node a category, opened in place, one that needs someone opening itself; done |
| [0021](0021-what-an-alert-means.md) | what an alert means, and has meant: an alert's impact on users, from its rule, the catalog, or written on the page by an operator; and its history, each past firing with its silences and notes, on its card; done |
| [0022](0022-who-to-ask.md) | who to ask: the catalog's teams with their Slack or Teams channel, Confluence or Notion pages and on-call, on service pages, job lanes and the cards of alerts about what they own; done |
| [0023](0023-tell-the-team.md) | tell the team: an alert posted to its team's Slack channel from its card, once a firing, and its notes, silences and resolution following in the thread; proposed |
| [0024](0024-ask-an-agent.md) | ask an agent: an alert's brief, *Around this alert* (what changed near it, its dependencies, errors, history and runbook); Estate as an MCP server at /mcp, so an AI agent reads the same estate a person does; Ask AI on an alert's page through Anthropic, OpenAI, xAI, Gemini or a self-hosted model, read-only; in progress (mcp-alerts, ask-with-tools, mcp-docs to come) |
| [0025](0025-from-alert-to-context.md) | from alert to context: what is firing first on the overview and the service page, an alert's own page with what is around it and Ask AI, a link to raise an incident, and services as lanes or a grid; done |
| [0026](0026-one-read-many-pages.md) | one read, many pages: with `cluster:` set, one runner reads every source, through an Effect Cluster entity with its shard lock in the notes' Postgres, and every replica serves the same state to its pages, `/events` and `/mcp`; writes reach the owner; one process stays the default; proposed |
| [0027](0027-jump-to.md) | jump to: header search and ⌘K palette to open a service, store, job or agent by name across the estate; thin `/jobs/:name` and `/agents/:name` pages so every kind has an address; done |
| [0028](0028-versions-across.md) | versions across environments: on the service page, a strip of that service's version in every environment from the deploys event, with a click to switch; done |
| [0029](0029-dead-map-edges.md) | dead map edges: null/zero rate or a failing source draws solid muted red with no dash flow; done |

# Specs

Nothing is built without a spec here. Each says what is wrong, what it will not do, the shape it takes, and a stack of
entries, one per pull request, each with what proves it done.

| Spec | What |
|---|---|
| [0001](0001-the-estate-on-one-page.md) | the estate on one page: alerts with notes and silences, health, versions through the pipeline in every environment, load, links, and a debug switch that turns itself off, for any estate described by a catalog; done |
| [0002](0002-more-kinds-of-estate.md) | more kinds of estate: Grafana alerting, Elasticsearch logs, Argo CD, GitLab CI, ECS, CloudWatch and notes in DynamoDB beside the first kinds, each part a port with its kinds behind it; done, with Buildkite, Nomad, Datadog and Cloud Run left for when someone asks |
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
| [0015](0015-harness-and-teamcity.md) | Harness and TeamCity: builds from TeamCity and Harness CI, deploys from Harness CD; draft |

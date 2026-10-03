# Specs

Nothing is built without a spec here. Each says what is wrong, what it will not do, the shape it takes, and a stack of
entries, one per pull request, each with what proves it done.

| Spec | What |
|---|---|
| [0001](0001-the-estate-on-one-page.md) | the estate on one page: alerts with notes and silences, health, versions through the pipeline in every environment, load, links, and a debug switch that turns itself off, for any estate described by a catalog; draft |
| [0002](0002-more-kinds-of-estate.md) | more kinds of estate: Argo CD, GitLab CI, ECS and CloudWatch as sources beside today's, each a port with its kinds behind it; draft |
| [0003](0003-stores.md) | stores: databases, queues and caches in the catalog, with stats and health from a preset per engine (Postgres, CloudNativePG, MySQL, Redis, Kafka), on the overview and a page of their own; draft |
| [0004](0004-notes-that-end.md) | notes that end: removed by their author or an operator, and after `notes.keepDays`; silences for 1 hour, 6 hours, 1 day or until 09:00; done |
| [0005](0005-charts-you-can-read.md) | charts you can read: point at, step through or drag across a chart to read a time and value, shared across a service's charts; done |
| [0006](0006-pages-in-solid.md) | the pages in Solid: the same pages and tests, updating only what changed, compiled by a Bun plugin; draft |
| [0007](0007-logs-on-the-page.md) | logs on the page: a service's live lines and its errors grouped by message, from Loki or the cluster, masked; draft |

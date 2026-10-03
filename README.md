# Estate

**Is the estate well, and if not, where do I look?** Estate answers that on one page, for every service your team
runs, in every environment, without anyone building a dashboard.

![The overview: what needs you, the estate drawn live, each service's lane, and what changed today](docs/overview.png)

Your team already has the answers. The alerts are in Alertmanager, what runs where is in Kubernetes and Flux, the
builds are in GitHub, the load is in Prometheus. Each morning, and at every alert, someone joins them up in their
head across five tabs. Estate does the joining:

- **What needs you now**, at the top, in plain words: "Two things need you." Each alert as a card drawing the metric
  that fired against its threshold, with the runbook, the logs and the traces one click away.
- **Notes on alerts**, so the person who looks next sees "on it, it's the vacuum" instead of starting again.
- **Silences with a reason**: an hour, four, or until nine tomorrow, written to Alertmanager under your name, and
  shown to everyone while they last.
- **Every service as a lane**: its health and why, its pipeline from commit to build to what Flux chose to what is
  running, its last hour of requests, errors and p99, and its links (the app, its API docs, logs, traces, dashboard,
  repository, runbook).
- **Deploys across environments** side by side, so a version moving from staging to production is one row, and a
  stalled step says why in the words Flux or GitHub used.
- **Debug logging with an off switch**: turn it on for fifteen minutes from the page, under your name; it turns
  itself off, and a restart of Estate forgets nothing.
- **Jobs and CronJobs**: last runs, how they ended, the next one, and the run that should have happened and didn't.
- **Stats for the process behind each service**: heap, GC pauses, threads and CPU for a JVM, or memory and CPU for
  any container, from presets, beside queries of your own.
- **What changed today**: deploys, builds, alerts, silences, notes, debug and jobs, in one feed.

![A service: its load over a chosen range, its stats, pods, jobs, alerts today, debug switch and builds](docs/service.png)

## Why Estate

- **Small.** One container, about 120 MB of memory. It keeps almost nothing: everything it shows is read live from
  the tools you already run, so there is nothing to back up and nothing to drift. Postgres only if you want notes kept
  across restarts.
- **Yours, in Git.** What Estate shows is a `catalog.yaml` in your repository: the environments, the services, their
  queries and links. Adding a service to the page is a commit, reviewed like any other, and `estate check` runs in
  your CI so a broken catalog never reaches the page.
- **Live.** The page is a stream: a change reaches every open page within seconds, with no refreshing.
- **Honest.** A tool that does not answer is named, with its own words and how old its last answer is. A part you
  have not set up says so. The page never claims "all quiet" before something has said so.
- **Safe to hand out.** Sign-in with any OIDC provider (Pocket ID, Keycloak, Dex, Google); viewers see everything and
  add notes, operators silence and switch debug. With impersonation, debug is switched as the person, so the cluster's
  own RBAC decides and its audit names them.
- **Calm.** Dark and quiet when all is well. Amber is the only colour that asks for attention, spent on exactly what
  needs someone. It works at phone width, and stops moving under reduced motion.

### Compared with

| | What it is good at | Why Estate beside it, or instead |
|---|---|---|
| **Backstage, Port, Cortex** | A catalog of everything an organisation owns | They know what exists, not how it is doing this minute; Backstage needs a database and a plugin per tool, the others are paid services. Estate is the live page, in one container. |
| **Grafana** | Any chart you can build | Someone has to build and keep each board, and it does not act. Estate needs no boards, and silences, notes and debug happen on the page. |
| **Headlamp, k9s, Lens** | The cluster, in depth | One cluster, no alerts, builds or other environments. Estate links into them, already filtered. |
| **Weave GitOps, Argo CD's UI** | Flux's or Argo's own state | The deploy tool alone. Estate puts it in the pipeline beside the build and what is running. |
| **Karma, Keep** | Alerts, in depth | Alerts alone. Estate puts each beside the service it is about. |
| **Homepage, Homarr** | A start page of links | Tiles and links, not health, pipelines or alerts. |

## Try it

```bash
docker build -t estate .
docker run -v ./examples:/etc/estate -p 8080:8080 estate
```

Open <http://localhost:8080>: the example shop's services, with its tools not there, so every part says why. Point
`examples/estate.yaml` at your own Prometheus, Alertmanager, cluster and GitHub to see your estate.

## Using it

Two files, mounted at `/etc/estate`:

- **`catalog.yaml`**, the estate: environments, services (workloads, Flux objects, load queries, links, runbook,
  debug ConfigMap, jobs, stats), vitals and the map. [`examples/catalog.yaml`](examples/catalog.yaml) has every part.
- **`estate.yaml`**, the settings: sign-in and roles, each environment's sources, the notes database, GitHub's token.
  Secrets are `${NAMES}` read from the environment.

[`deploy/`](deploy) is a Kubernetes base to overlay with those two files, your ingress and your secrets. The design,
and why it is shaped this way, is [spec 0001](specs/0001-the-estate-on-one-page.md). Its first estate is
[lark-bank](https://github.com/matthewjones372/lark-bank).

## Working on it

TypeScript on Bun, the server in [Effect](https://effect.website), the pages in React.

```bash
bun install
bun run gate          # typecheck, lint, unused, layers, slop, test: nothing is done until it passes
bunx playwright test  # the pages in Chromium against e2e/tools.ts, a fake estate's tools, with axe
```

[AGENTS.md](AGENTS.md) says how the code is written; the gate holds it to that.

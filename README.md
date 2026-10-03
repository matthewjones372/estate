# Estate

A team's whole estate on one page: what needs someone now, how every service is doing in each environment, what is
running and what is waiting to be, and a link from each service to its logs, traces, dashboard and runbook. Debug
logging for a service can be turned on from it, and turns itself off.

Estate reads Prometheus, Alertmanager, Kubernetes, Flux and GitHub, and keeps almost nothing of its own. What it
shows is described by a catalog in the estate owner's repository.

The design is [spec 0001](specs/0001-the-estate-on-one-page.md). Its first estate is
[orders](https://github.com/example/orders).

## Working on it

```bash
bun install
bun run gate     # typecheck, lint, unused, layers, slop, test: nothing is done until it passes
```

Try it with the example estate, whose sources are not there, so every part says why:

```bash
docker build -t estate .
docker run -v ./examples:/etc/estate -p 8080:8080 estate
bunx playwright test   # the pages in Chromium, with axe
```

[AGENTS.md](AGENTS.md) says how the code is written; the gate holds it to that.

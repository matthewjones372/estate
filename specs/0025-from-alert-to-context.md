# 0025 — From alert to context

## Problem

Estate's pages still read like a dashboard: vitals and the map sit above what is wrong, a service page leads with
load charts, and an alert lives only as a card with no place of its own. When something fires, an operator wants a
short path — what is happening, what changed near it, who owns it, where to look next — not another Grafana-shaped
overview. Spec 0024 already names *Around this alert* and Ask AI; the product framing and the pages have not yet
followed.

## Not doing

- **Replacing Grafana, Datadog or any source tool.** Estate links into them; it does not chart everything.
- **The MCP server** (`/mcp`, tokens, its tools). That is spec 0024's; this change lands the pages, the *around*
  brief and Ask AI reading it.
- **An agent that acts.** Ask AI reads; people silence, switch debug and post.
- **Rewriting the overview's lanes, map layout or kiosk.** Kiosk and Performance stay; they are demoted in the README
  only.
- **GitHub repo topics.** Left alone.
- **Owning or creating incidents.** A catalog `incident` link opens PagerDuty / Opsgenie / etc.; Estate does
  not call their APIs or keep an incident model.

## Shape

```text
ALERT → CONTEXT → INVESTIGATION

Service page
  context header (health + every reason) → What's happening (firing cards)
  → What changed (builds / deploys) → Where to look → Load → logs / pods

Alert permalink  /alerts/:id
  what's happening · what changed (Around) · who owns · environment
  · happened before · where to investigate · notes · Ask AI

Around this alert (no AI needed)
  "deployed X min before it fired" / "no deploys in the hour before"
  + depends, errors (link), before, runbook — from views already on the page

Ask AI (when ai: is set)
  settings.ai → HttpClient model port (Anthropic | OpenAI-compatible | xai | gemini)
  POST /api/alerts/:id/ask  a structured answer on the alert page, within a minute a turn and a day's tokens

Raise incident (when catalog link configured)
  service.links.incident (or raise-incident): URL template with {service} {env} {alert} {summary}
  Out / target blank on AlertCard + alert page (+ service Links chip); hidden when unset
  Estate does not create incidents — link out only

Overview services layout (viewer preference)
  List (lanes, default) ↔ Grid (compact cards) — kept in localStorage, not catalog config
```

```yaml
# catalog.yaml — Raise incident (optional link out)
services:
  - name: storefront
    links:
      incident: https://example.pagerduty.com/incidents/create?service={service}&env={env}&title={alert}&details={summary}

# estate.yaml — Ask AI (optional)
ai:
  provider: anthropic            # or openai | openai-compatible | xai | gemini
  apiKey: ${ANTHROPIC_API_KEY}   # XAI_API_KEY / GEMINI_API_KEY (or GOOGLE_API_KEY) for those providers
  model: claude-opus-5-5
  url: http://vllm.example/v1    # openai-compatible only; xai and gemini have fixed bases
  budget: { tokensPerDay: 500000 }
```

## Why this shape

The operational path is alert-first, not vitals-first. Putting Needs-you and firing cards above the map matches how
people actually open Estate during an incident. A permalink gives a shareable place for one alert without bloating
`AlertCard` (already near the 300-line limit). *Around* is useful with no model configured and is the brief Ask AI
starts from — the same split as spec 0024. Prefer Effect `HttpClient` / `Remote` for model APIs, like every other
remote, so Ask AI does not need the MCP SDK; the SDK waits for `/mcp`.

## Depends on

Nothing new from outside. Spec 0024 holds the brief's full shape and the MCP server.

## Stack

- [x] **`spec-0025`** — this spec.
      Done when: `specs/0025-from-alert-to-context.md` is committed.
- [x] **`service-alert-first`** — service page: firing AlertCards at top, all health reasons, hide Debug when unset;
      order context → alerts → changes → investigation → Load → logs/pods; split parts under 300 lines.
      Done when: pages.suite shows "What's happening" / firing card on storefront before Load.
- [x] **`around-on-card`** — a line on each alert's card: what was deployed in the hour before it fired, or that
      nothing was; the whole brief on the alert's page.
      Done when: OrdersSlow on the fixture shows storefront deployed before it fired.
- [x] **`alert-permalink`** — `/alerts/:id`, `pages/Alert.tsx`, App Match, link from the alert name; layout for the
      investigation sections and Ask AI entry.
      Done when: pages.suite opens `/alerts/a1` and shows What's happening for OrdersSlow.
- [x] **`overview-needs-first`** — Needs-you / alert cards above vitals+map (map demoted or collapsed); tests for copy.
      Done when: overview suite still finds the firing card; vitals sit below Needs you.
- [x] **`readme-context-layer`** — the README opens with the scattered context an alert needs and what Estate
      brings together, says it replaces none of the tools, and shows a morning with an alert; the kiosk and
      performance come after.
      Done when: the README says so before any technical detail.
- [x] **`around-api`** — `views/around.ts` + `GET /api/alerts/:id/around`; feeds Ask AI.
      Done when: a test asks for OrdersSlow's around and gets the deploy-before line.
- [x] **`ask-ai`** — `settings.ai`, a model port through `Remote`, `POST /api/alerts/:id/ask`, the Ask panel on the
      alert page; a structured answer, decoded; graceful when unset; one answer an alert a minute and a day's tokens.
      Done when: against a fake model, the panel shows likely cause, evidence, next steps and confidence.
- [x] **`services-layout`** — overview List/Grid toggle for services; `parts/ServiceGrid.tsx`; preference via `kept`.
      Done when: lanes suite switches to grid and shows storefront/orders cards.
- [x] **`raise-incident`** — catalog `incident` / `raise-incident` link template; Raise incident Out on alert
      context (and service Links) when configured; `{alert}` / `{summary}` filled at open time; no API create.
      Done when: tests show the control when configured, hide when not, and the URL fills placeholders.
- [x] **`tests-copy`** — unit/e2e assertions for new copy and pages.suite routes.
      Done when: `bun run gate` passes.

## Acceptance

```bash
bun run gate
```

## Open questions

- **Alert id in the URL?** Recommended: the alert's `id` from the alerts event (stable for the firing), not its name,
  so two firings of the same rule do not collide in the address bar. The card links by id; the list page stays
  `/alerts`.
- **Map collapsed by default on the overview?** Recommended: keep the map visible but *below* Needs-you, rather than
  collapsing it; collapsing can wait if the page still feels dashboard-heavy.
- **MCP SDK for Ask AI?** Recommended: no. Ask AI calls the model APIs through `Remote`, and `/mcp` is Effect's own
  `McpServer`, so no SDK is needed for either.

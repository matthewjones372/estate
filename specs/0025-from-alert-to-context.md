# 0025 — From alert to context

## Problem

Estate's pages still read like a dashboard: vitals and the map sit above what is wrong, a service page leads with
load charts, and an alert lives only as a card with no place of its own. When something fires, an operator wants a
short path — what is happening, what changed near it, who owns it, where to look next — not another Grafana-shaped
overview. Spec 0024 already names *Around this alert* and Ask AI; the product framing and the pages have not yet
followed.

## Not doing

- **Replacing Grafana, Datadog or any source tool.** Estate links into them; it does not chart everything.
- **The full MCP server** (`/mcp`, tokens, `estate_now`, …). Spec 0024's `mcp-server` / `mcp-alerts` / `mcp-docs`
  stay for later. This change lands the *around* brief and Ask AI that share the same tools once MCP exists.
- **An agent that acts.** Ask AI reads; people silence, switch debug and post.
- **Rewriting the overview's lanes, map layout or kiosk.** Kiosk and Performance stay; they are demoted in the README
  only.
- **GitHub repo topics.** Left alone.

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
  settings.ai → HttpClient model port (Anthropic | OpenAI-compatible)
  POST /api/alerts/:id/ask  streams a structured answer on the alert page
```

```yaml
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

Nothing new from outside. Spec 0024's Ask AI / around-alert path is the AI work this lands; MCP remains a later
stack entry there.

## Stack

- [x] **`spec-0025`** — this spec; mark 0024's around-alert / ask-on-card as the AI path for this change.
      Done when: `specs/0025-from-alert-to-context.md` is committed and 0024's stack notes the landing here.
- [ ] **`service-alert-first`** — service page: firing AlertCards at top, all health reasons, hide Debug when unset;
      order context → alerts → changes → investigation → Load → logs/pods; split parts under 300 lines.
      Done when: pages.suite shows "What's happening" / firing card on storefront before Load.
- [ ] **`around-on-card`** — `parts/Around.tsx`: deploy/build timing near the alert; wired beside AlertCard without
      growing it past 300 lines.
      Done when: OrdersSlow on the fixture shows storefront deployed before it fired.
- [ ] **`alert-permalink`** — `/alerts/:id`, `pages/Alert.tsx`, App Match, link from the alert name; layout for the
      investigation sections and Ask AI entry.
      Done when: pages.suite opens `/alerts/a1` and shows What's happening for OrdersSlow.
- [ ] **`overview-needs-first`** — Needs-you / alert cards above vitals+map (map demoted or collapsed); tests for copy.
      Done when: overview suite still finds the firing card; vitals sit below Needs you.
- [ ] **`readme-context-layer`** — README tagline as operational context layer; not a Grafana replacement; incident
      example; demote Kiosk/Performance; image.yml description if appropriate.
      Done when: README opens with ALERT → CONTEXT → INVESTIGATION and says it is not a Grafana replacement.
- [ ] **`around-api`** — `views/around.ts` + `GET /api/alerts/:id/around`; feeds Ask AI.
      Done when: a test asks for OrdersSlow's around and gets the deploy-before line.
- [ ] **`ask-ai`** — `settings.ai`, model port via HttpClient, `POST /api/alerts/:id/ask` streaming, Ask panel on the
      alert page; structured answer; graceful when unset; light rate limit; fake-model tests.
      Done when: against a fake that calls tools, the panel shows likely cause, evidence, next steps and confidence.
- [ ] **`tests-copy`** — unit/e2e assertions for new copy and pages.suite routes.
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
- **MCP SDK for Ask AI?** Recommended: no. HttpClient to Anthropic / OpenAI-compatible is enough for Ask AI; add
  `@modelcontextprotocol/sdk` only when `/mcp` lands.

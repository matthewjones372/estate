# 0024 — Ask an agent

## Problem

Estate puts the state of the stack on one page for a person. An AI agent asked "why is checkout slow?" or "is it
safe to deploy payments?" has to do what that person did before Estate: query Prometheus, Alertmanager, the cluster,
Flux and the logs one by one, with credentials for each, and put it together itself. Estate has already put it
together, with the catalog's names, the teams, what each alert means and what happened the last time it fired. An
agent should be able to ask Estate.

## Not doing

- **An agent that acts.** Whether reached over MCP or asked from a card, an agent reads; it silences, switches and
  posts nothing. People do that, on the page, with the agent's answer in front of them.
- **New credentials to the tools.** The agent reaches the tools only through Estate, with Estate's own access and
  its rules: it sees what a viewer sees.
- **Writes, at first.** Silencing, debug switching and posting stay with people on the page. Adding a note is the one
  write considered, below.

## Shape

```yaml
# estate.yaml
mcp:
  tokens:                                   # each agent's token, and the role it reads as
    - { name: claude-code, token: "${ESTATE_MCP_TOKEN}", role: viewer }
```

```bash
claude mcp add --transport http estate https://estate.example/mcp --header "Authorization: Bearer $ESTATE_MCP_TOKEN"
```

Tools, each answering from Estate's current state, in the words the page uses:

| Tool | Answers |
|---|---|
| `estate_now` | an environment's headline: what needs someone, and why, worst first |
| `services` | every service, store, job and agent in an environment: health, reasons, version, owner, category |
| `service` | one service: health, load over the last hour, pods, deploy and builds, alerts, debug, links, team |
| `alerts` | what is firing, pending and silenced, each with its impact, notes, silence and runbook |
| `alert_history` | an alert's earlier firings, with who silenced each and why, and the notes written then |
| `changes` | what changed in an environment: deploys, builds, alerts, silences and notes, newest first |
| `errors` | a service's errors over a range, grouped by message, masked as the page masks them |
| `agents` | each AI agent's usage, model and since when, tokens against budget, and recent runs |

Each tool returns structured content and a short text summary, and takes `environment`, defaulting to the
catalog's first.

### Ask Claude, on an alert's card

```yaml
# estate.yaml
ai: { apiKey: "${ANTHROPIC_API_KEY}", model: claude-opus-5-5 }   # the model, unless set
```

```text
┌ WARNING  OrdersSlow                                          firing 14 min ┐
│ Orders are slow to place                                                     │
│ [Ask Claude]                                                                 │
│ ─ Claude, reading Estate ──────────────────────────────────────────────────  │
│ orders' p99 rose from 60 ms to 220 ms at 11:46, two minutes after            │
│ main-88-04bc441 was chosen; its image policy is stalled, so staging and      │
│ production run different versions. The last firing, 27 Sep, cleared when     │
│ ada vacuumed the orders table. Errors since 11:44 are mostly "lock timeout   │
│ on orders_items".                                                           │
│ Looked at: service orders · changes · alert history · errors      [Keep as note] │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **"Ask Claude"** is on the card of any alert, for anyone who may write notes, when `ai` is set. Estate gives
  Claude the alert and the same tools the MCP server offers, and Claude decides what to look at: the service, what
  changed, the alert's history, the errors from the logs.
- **The answer streams onto the card**, with the tools it used listed under it, so whoever reads it can check the
  working. "Keep as note" saves it to the alert under "Claude, asked by ada", where everyone sees it.
- **What is sent** is what the tools return: the page's own views and masked log lines. Nothing goes to the model
  that a viewer could not see on the page.
- **One answer an alert a minute**, and a token budget a day in `ai.budget`, so a busy morning cannot run up a bill.

## Why this shape

An agent outside Estate and a button inside it share one thing: the tools. The MCP server gives them to whatever
agent a team already uses; the card gives them to Claude for the person who has just seen the alert and has no agent
open. MCP is how agents are given tools, and Claude Code, Claude Desktop and most agent frameworks speak it, so one server
serves all of them. Estate serves it over streamable HTTP at `/mcp`, beside the page, because Estate already runs as
a server with the state in memory; an agent asks the running Estate rather than starting one. The tools answer from
the views the page is built from, so an agent and a person see the same estate, and each answer costs no extra call
to the tools. Logs are the exception, read when asked, as on the page.

Tokens in `estate.yaml` keep it simple. MCP's OAuth flow could sign an agent in as the person running it, through
Estate's own OIDC, which is the better end state; it follows once a team asks for it. Recommended: tokens with a role
first.

## Depends on

Nothing.

## Stack

- [ ] **`mcp-server`** — `/mcp` over streamable HTTP with tokens and roles; `estate_now`, `services`, `service`.
      Done when: Claude Code, given the token, lists the tools and answers "what needs someone in production?".
- [ ] **`mcp-alerts`** — `alerts`, `alert_history`, `changes`, `errors`, `agents`.
      Done when: a test asks for an alert's history and gets its earlier firings with their notes.
- [ ] **`ask-on-card`** — "Ask Claude" on an alert's card: the tools, the answer streamed, kept as a note.
      Done when: against a fake Claude that calls `service` and `changes`, the card shows its answer and the tools it
      used, and Keep as note saves it under Claude's name and the asker's.
- [ ] **`mcp-docs`** — the README's section, `examples/estate.yaml`, and a Playwright-free end-to-end test that
      drives `/mcp` with the MCP SDK's client against the e2e estate.
      Done when: the e2e test lists the tools and calls each one.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

- **Which model for the card?** Recommended: Claude Opus 5.5 by default (`claude-opus-5-5`), set by `ai.model`; a
  team watching cost can choose Claude Sonnet 5.5 (`claude-sonnet-5-5`).
- **May an agent add a note?** Recommended: yes, for a token with the operator role, under the token's name, so
  "what I found" lands on the alert for the next person. Silencing and debug stay with people.
- **The MCP SDK, or a small server of Estate's own?** Recommended: the official TypeScript SDK, for the protocol's
  details, wrapped as an Effect route like the others.

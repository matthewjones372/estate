# 0024 — Ask an agent

## Problem

Estate puts the state of the stack on one page for a person. An AI agent asked "why is checkout slow?" or "is it
safe to deploy payments?" has to do what that person did before Estate: query Prometheus, Alertmanager, the cluster,
Flux and the logs one by one, with credentials for each, and put it together itself. Estate has already put it
together, with the catalog's names, the teams, what each alert means and what happened the last time it fired. An
agent should be able to ask Estate.

## Not doing

- **An agent inside Estate.** Estate serves what it knows; the thinking happens in whatever agent the team already
  uses: Claude Code, Claude Desktop, or their own.
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

## Why this shape

MCP is how agents are given tools, and Claude Code, Claude Desktop and most agent frameworks speak it, so one server
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
- [ ] **`mcp-docs`** — the README's section, `examples/estate.yaml`, and a Playwright-free end-to-end test that
      drives `/mcp` with the MCP SDK's client against the e2e estate.
      Done when: the e2e test lists the tools and calls each one.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

- **May an agent add a note?** Recommended: yes, for a token with the operator role, under the token's name, so
  "what I found" lands on the alert for the next person. Silencing and debug stay with people.
- **The MCP SDK, or a small server of Estate's own?** Recommended: the official TypeScript SDK, for the protocol's
  details, wrapped as an Effect route like the others.

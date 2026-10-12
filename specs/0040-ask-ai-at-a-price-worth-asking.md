# 0040 — Ask AI at a price worth asking

## Problem

A handful of asks on the petshop's demo cost 68p. Each ask is up to five calls to the model: the brief, then up to
four rounds of tool calls, then the answer. Every call sends everything again at the full input price: the system
prompt, the tools' definitions, the brief, and every tool result so far, so the last call of an ask pays for the
first call's input four more times. The model also thinks before each call with nothing holding it back, up to 8,192
output tokens a call (spec 0038), and output costs several times what input does. Tool results go to the model whole,
however long.

Nobody can see any of this. The answer says which model and which tools; it does not say what it cost, so the first
anyone hears is the bill.

## Not doing

- **Choosing the model for people.** `ai.model` stays theirs. The docs say which models answer well for less.
- **Answering without the model.** Spec 0025's *Around this alert* is the free answer, and stays.
- **Batch or delayed asks.** An ask is asked because someone is waiting on it.

## Shape

**Cached where it repeats.** Anthropic's calls mark the system prompt, the tools and the brief with `cache_control`,
and the conversation's latest turn too, so each round reads what came before at the cached price (a tenth of input)
and pays full price only for what is new. The chat APIs cache what repeats without being asked.

**Fewer, smaller rounds.** Two rounds of tools rather than four, since the brief already carries what most asks need;
each tool result cut to `ai.toolResultChars` (default 4,000), saying it was cut. Thinking held to `ai.effort`
(default `low`), sent to Anthropic as `output_config.effort` always, and to OpenAI and Gemini as `reasoning_effort`
only when set, since a chat model that does not reason refuses it.

**What it cost, on the answer.** The answer's line says its tokens (input, cached and output) and, where `prices`
names the model, an estimate:

```text
claude-sonnet-5-5 · 14,200 in (11,800 cached) · 1,100 out · about 2p · read: Changed · Depends · called: service petshop
```

The day's budget counts what was paid for: cached input at its share of the input price, rather than a token a token.

```yaml
ai:
  provider: anthropic
  model: claude-sonnet-5-5
  effort: low              # low | medium | high
  toolRounds: 2
  toolResultChars: 4000
  budget: { tokensPerDay: 150000 }
prices:
  claude-sonnet-5-5: { input: 3, output: 15, cachedInput: 0.3 }   # per million tokens; an example, use the real price
```

## Why this shape

Caching is the biggest saving for nothing lost: the same text is sent five times an ask, and only the newest part
changes. Fewer rounds and shorter tool results cut what is sent at all, at a small cost to the hardest asks, which
`toolRounds` can give back. The alternative is a cheaper default model alone; it helps more than any one change here
but leaves every model paying for the same text five times. Recommended: all of it, and the docs naming a cheaper
model for most estates.

## Depends on

Nothing. Prices already come from the settings (spec 0019).

## Stack

- [ ] **`spec-0040-cache`**: `cache_control` on the system prompt, tools, brief and latest turn for Anthropic; the
      reply's cached tokens read and counted.
      Done when: in `model.test.ts`, Anthropic's calls carry the cache marks in the right places, and an ask's
      tokens split into input, cached and output.
- [ ] **`spec-0040-rounds`**: `ai.toolRounds` (default 2), `ai.toolResultChars` (default 4,000) and `ai.effort`
      (default `low`).
      Done when: an ask stops offering tools after its rounds; a long tool result reaches the model cut and saying
      so; the effort reaches the provider's call.
- [ ] **`spec-0040-cost`**: the answer's tokens and its estimated cost from `prices`, on the card; the budget counts
      cached input at its price.
      Done when: `ask.suite.tsx` shows "about 2p" for an answer whose model has a price and none without one.

## Acceptance

```bash
bun run gate
```

Then, in the petshop's demo, one ask on Sonnet shows its tokens and an estimate on the card, and costs under 3p.

## Open questions

- **Is `effort` the right name, and does each provider take it?** Anthropic has an effort setting; OpenAI has
  `reasoning_effort`; a self-hosted model may have neither. Recommended: `ai.effort`, sent as each provider names it,
  and left out where there is none.
- **Two rounds or three?** Recommended: two; the demo's best answers so far read the brief and called three tools in
  one round.
- **Show cost to viewers, or only operators?** Recommended: everyone; it is an estimate of a shared budget, not a
  secret.

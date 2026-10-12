# 0038 — Ask AI that answers, where the alert is

## Problem

Ask AI (spec 0024) fails on Anthropic's current models. Claude Opus 5.5 thinks before it calls a tool, and its reply
starts with a `thinking` block carrying the thought and its `signature`. Estate decodes the reply with a schema that
keeps only `type`, `text`, `id`, `name` and `input`, then sends that narrowed reply back with the tools' answers. The
thinking block goes back as `{"type": "thinking"}`, and Anthropic refuses the second call:

```text
400 invalid_request_error: messages.1.content.0.thinking.thinking: Field required
```

The page shows "Anthropic answered 400" and nothing else, so the person asking reads it as a wrong key. The petshop's
demo found this, with a working key and the alert firing.

When it does answer, it is hard to find. Ask AI is on an alert's own page only, last, under *Around this alert* and
*Who owns it*. The cards on the overview and on Alerts, where an alert is first seen, have the runbook, an incident,
the team, logs and Silence, but not Ask AI. Reaching it means knowing the alert's mono name is a link, following it,
and scrolling to the bottom.

## Not doing

- **Other providers' reasoning.** OpenAI-style chat replies carry no block that must go back; they stay as they are.
- **Asking from a past firing's page.** Spec 0037 leaves it out; so does this.
- **Streaming what the model reads as it reads it.** The ask is one request; the bar shows it is working, and the
  answer lists what it called. Live progress per tool is its own change if the wait is still unclear.
- **Showing the model's thinking.** It is sent back as the API requires and never shown.
- **A different answer.** The brief, the tools and the answer's shape are as spec 0024 has them.

## Shape

**The reply kept as it came.** Estate reads the text and the tool calls from a reply as now, and keeps the reply's
content blocks whole, every field, for the next turn:

```ts
// model-apis.ts, Anthropic
read: (text) => … ({ text, calls, tokens, kept: { role: "assistant", content: raw.content } })
```

A failed call says what the provider said, not only its status:

```text
Anthropic answered 400: messages.1.content.0.thinking.thinking: Field required
```

**Ask AI on the card, answered there.** Wherever an alert's card is shown (the overview, Alerts, a service's page,
the alert's own page) and `ai:` is set, its buttons gain *Ask AI*. Pressing it asks at once, and the answer opens on
the card itself, under its buttons, with its evidence, next steps and *Keep as note*. Nobody has to open the alert to
ask about it.

```text
[Open the runbook] [Raise an incident] [Tell #team] [petshop] [Logs] [Ask AI] [Lines from then]   [Silence…]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reading Estate… 12 s                                                                  ← while it asks
```

**Asking shows it is asking.** While the model reads, the card shows a moving bar and how long it has been reading,
and the button is disabled, so a wait of half a minute reads as work, not as a page that did nothing.

**One place on the alert's page.** The alert's page loses its separate Ask AI section, since its card now asks and
answers. An answer is kept while the page is open, so moving between the overview and the alert's page does not ask
again; leaving Estate, or a new firing, starts afresh.

## Why this shape

Keeping the reply whole is what Anthropic's API asks for any block it may add later, not only thinking: decoding
only the fields Estate reads, and sending back exactly what came, keeps Estate correct for blocks it has never seen.
The alternative, turning thinking off, would cost the model's best answers and break again with the next new block.
Recommended: keep it whole.

For the button, the alternative is a button that opens the alert's page and asks there, which keeps the overview
quiet but costs a click and a change of page at the moment someone wants an answer. Decided: the card asks and
answers in place, on every page that shows it.

## Depends on

Nothing.

## Stack

- [ ] **`spec-0038-keep-the-reply`** — Anthropic's reply kept whole between turns; a failed call names the
      provider's message.
      Done when: in `model.test.ts`, an Anthropic fake that answers first with a `thinking` block (with `thinking` and
      `signature`) and a tool call receives that block back unchanged on the second call, and the ask answers; a fake
      that answers 400 with an error body gives "Anthropic answered 400: ‹its message›".
- [ ] **`spec-0038-ask-from-the-card`** — *Ask AI* on every alert card, answered on the card, with a bar and the
      seconds while it asks; the alert's page's separate section folded into its card.
      Done when: in `alert.suite.tsx`, a card with `ai:` set has *Ask AI* and one without has not; pressing it shows
      a progress bar and "Reading Estate…" until the answer, then the answer on the card; the alert's page has one
      *Ask AI*; an answer asked on one page is still shown on the same alert's card on another.

## Acceptance

```bash
bun run gate
```

Then, in the petshop's demo with `ai:` set: `./chaos.sh registry-slow`, *Ask AI* on the alert's card on the
overview, a bar while it reads, and the answer on that card.

## Open questions

- **Is the answer kept beyond the page?** A kept answer is what *Keep as note* is for. Recommended: no;
  an answer lives while Estate is open in that tab.
- **How much of the provider's message is shown?** It is the provider's text, not Estate's, and can be long.
  Recommended: its `error.message`, cut at 200 characters as other sources' failures are.

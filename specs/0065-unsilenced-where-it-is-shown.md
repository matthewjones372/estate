# 0065 — Unsilenced where it is shown

## Problem

A silenced alert can be unsilenced from the overview's list of silences and from *Alerts*, and nowhere else. Its own
page shows its card with *Silence…*, as if nothing silenced it, and offers no way back. Its service's page lists only
what is firing, so the silence is not there at all, and a store's page is the same. An operator who silenced
something from its card, on the page they were working from, has to go back to the overview to undo it.

## Not doing

- **Changing a silence.** Its end or reason are changed by unsilencing and silencing again, as now.
- **Silences the manager holds for no alert Estate shows.** Those stay in the manager's own page.

## Shape

```text
What's happening                                 (a service's page; a store's page as "Alerts about it")
  …what is firing…
  🔕 DiskFilling  silenced until 15:00 by ada: "resizing"                    [Unsilence]

DiskFilling                                       (its own page)
  🔕 DiskFilling  silenced until 15:00 by ada: "resizing"                    [Unsilence]
  …its card, without Silence…
```

- The overview's line for a silence (who, until when, why, and *Unsilence* for an operator who may silence) is one
  part, shown on the overview, under what fires on a service's and a store's page, and on a silenced alert's card.
- A silenced alert's card offers *Unsilence* in place of *Silence…*. A viewer sees the line without the button.

## Why this shape

The silence is said the same way everywhere it is shown, and undone from the same line. The alternative was an
*Unsilence* button on the card alone; a service's page shows no card for a silenced alert, so it would still have
had no way back. Recommended: the one line, everywhere.

## Depends on

Spec 0001's silences and spec 0017's unsilence.

## Stack

- [x] **`unsilence-where-shown`** — the silence's line on a service's, a store's and the alert's own page, with
      *Unsilence* for an operator.
      Done when: a page test unsilences from each of the three, and a viewer sees the line with no button.

## Acceptance

```bash
bun run gate
```

## Open questions

- **Should a service's lane on the overview mark that one of its alerts is silenced?** Recommended: not here; the
  overview already lists every silence under *Needs you now*.

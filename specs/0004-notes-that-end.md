# 0004 — Notes that end, and silences by the hour

## Problem

A note stays on its alert forever: "on it, it's the vacuum" from last month greets whoever looks at the same alert
next month, and a note written by mistake cannot be taken back. And the silence lengths on offer (1 hour, 4 hours,
until 09:00) miss the most asked-for one, the rest of the working day.

## Not doing

- **Editing a note.** Remove it and write another; the feed keeps what was said and when.
- **A silence of any length typed in.** Four choices cover nearly every case, and keep the page a single click.

## Shape

- **Silences** are offered for 1 hour, 6 hours, 1 day, or until 09:00 tomorrow.
- **A note is removed** from its alert by whoever wrote it, or by an operator: `DELETE /api/notes/:id`, a "Remove"
  beside the note.
- **Notes end by themselves** after `notes.keepDays` in `estate.yaml` (30 by default): Estate removes older notes as it
  starts and every hour, from Postgres as from memory.

## Why this shape

Kept for a set time rather than until the alert resolves: the same alert firing again next week is exactly when last
week's note helps, and a month is long enough for that and short enough not to mislead.

## Depends on

Nothing.

## Stack

- [x] **`notes-end`** — the silence lengths, removing a note, and notes older than `keepDays` removed.
      Done when: a note's author and an operator can remove it and a viewer who did not write it cannot; a note older
      than `keepDays` is gone after the next sweep, from Postgres too.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

1. **Thirty days?** Recommended, as a default each estate can change.

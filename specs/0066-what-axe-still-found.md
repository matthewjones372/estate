# 0066 — What axe still found

## Problem

The browser tests check every page they visit with axe, and 16 of them fail before reaching their own steps:

- **The environment switcher's name leaves out what it shows.** Its label is "Environment: production. Change
  environment", but the button shows the environment's title too ("Production, three machines"). A person using
  speech input says what they see, and the button does not answer to it.
- **A version cell's words run together.** "staging" and "not read" are adjacent spans with no space between them, so
  the visible text is "stagingnot read", which its label "staging: not read" does not contain.
- **Grey text that is too faint.** The Kafka and database cards' second lines, the Kafka key and the rate on the map's
  trouble arrows are `--quiet` (#6e7687) on the panels, about 3.8:1 where text needs 4.5:1.
- **An empty heading.** A database instance whose exporter sends no `instance` (or, for cnpg, `pod`) label is
  headed by nothing.

## Not doing

- **Changing `--quiet` itself.** It stays for borders, lines and fills, which need 3:1 and have it.
- **Turning rules off.** The tests keep running axe's whole rule set.

## Shape

- The switcher's label is "Environment: production Production, three machines. Change environment", the title in it
  when there is one, and a space between the name and the title on the button.
- A version cell has a space between its environment, its version and its note.
- Those lines of text are `--ink-3`.
- An instance with no name is headed "(no name)", as a client with none is.

## Why this shape

Each fix is the smallest that makes what is shown and what is said agree, without changing what a sighted viewer
sees. The alternative for the labels was to drop them and let the buttons be named by their content; the labels say
what the button does ("Change environment"), which the content alone does not. Recommended: keep the labels.

## Depends on

Nothing.

## Stack

- [x] **`axe-clean`** — the switcher's and version cells' names, the faint text, and the empty heading.
      Done when: `bunx playwright test` passes with axe's full rule set.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

- **Should the e2e fake Prometheus send an `instance` label?** Recommended: no; a real exporter always does, and the
  fake without it is what showed the empty heading.

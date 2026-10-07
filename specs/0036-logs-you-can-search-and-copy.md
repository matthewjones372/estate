# 0036 — Logs you can search and copy

## Problem

Spec 0007 put a service's lines on its page, but getting anything out of them is hard. The text filter matches one
literal string, so `connection*refused` or `status=5\d\d` finds nothing, and nothing shows where in a line it matched.
The level filter is a threshold, so Info and Error together, without Warn, cannot be shown. Copying means dragging a
selection across a list that keeps moving, and the copy carries no times or pods; there is no way to keep the lines as
a file. And every level but Error looks much the same, with errors in the amber that elsewhere on the page means
"needs someone".

During an incident people copy lines into Slack, a ticket or an AI, and today they retype or screenshot them.

## Not doing

- **A log explorer.** As spec 0007: no queries sent to Loki, no history beyond what the page holds. Search, copy and
  save act on the lines in the browser, the last 500 live lines and the error examples.
- **Excluding terms.** `-health` to hide lines is left until someone misses it.
- **Searching the Errors view.** Its groups are already few; their examples can be copied.
- **New colours.** Every colour below is already in `base.css`.
- **Unmasking.** Lines are masked on the server before they reach the page, so what is copied or saved is masked too.

## Shape

**Search**, the Live view's existing box:

```text
timeout             the text, case aside
conn*refused        * is anything within the line
/status=5\d\d/      between slashes, a regular expression, case aside
/status=(5/         "not a valid pattern" beside the box, and no line hidden
```

Each shown line marks what matched, and the foot says how many match: `37 of the last 500 lines match`.

**Levels** are toggles, any mix of them, all on to start, each with its count among the lines held:

```text
[Error 12] [Warn 40] [Info 340] [Debug 96] [Other 12]
Error is ERROR, FATAL and PANIC; Debug is DEBUG and TRACE; Other is a line with no level, or one Estate does not know
```

**Colour**: each line gains a level badge between its pod and its text; the badge carries the colour, so long lines
stay readable and the search's marks stand out.

| Level | Badge | Line |
|---|---|---|
| Error | `ERROR` in `--critical` | a `--critical` edge, on `--critical-panel` |
| Warn | `WARN` in `--amber` | an `--amber` edge |
| Info | `INFO` in `--healthy` | as now |
| Debug | `DEBUG` in `--debug` | in `--ink-3` |
| Other | none | as now |

The toggles wear their level's colour, so they are the key. A search's marks are `--link` behind dark text. The
level is always written in the badge, never shown by colour alone.

**Copy and save**:

```text
click a line                 selects it; shift-click selects the lines between; Esc clears
selecting                    pauses the Live view, as scrolling up does
[Copy 12 lines]              the selected lines, or every shown line when none is selected
[Save]                       the same lines as orders-production-2026-10-07T1031.log
a line's copy icon, on hover that line alone
an error group, opened       [Copy] its examples
```

A copied or saved line is its time in full, pod, level and text, separated by tabs:

```text
2026-10-07T10:31:02.123Z	orders-7f9c	ERROR	connection refused to db:5432
```

The foot says what Copy and Save reach: the lines the page holds, at most 500.

**Code**: `src/web/log-search.ts` turns what was typed into a matcher, or a reason it is not one, and finds the matched
ranges in a line; `src/web/log-copy.ts` writes lines as text and makes the file. Both are plain functions with their
own tests; `parts/Logs.tsx` uses them.

## Why this shape

Plain text with `*` is what people type without thinking, and pasting an error message must not trip over its dots
and brackets; slashes opt in to a regular expression for the few who want one. Everything runs over the lines already
in the browser, so it is instant, needs no change on the server, and keeps spec 0007's line against an explorer. The
alternative, sending the search to Loki as `|~`, would reach older lines but makes the panel the explorer 0007 chose not
to be; recommended against. Colouring the badge rather than the whole line keeps a page of errors readable and leaves
the marks visible; amber stays for warnings, as it means "needs someone" elsewhere.

## Depends on

Nothing.

## Stack

- [x] **`logs-levels`** — the level badge and colours, and the level toggles in place of the threshold.
      Done when: a suite shows Error and Info together with Warn hidden, each toggle's count, and each line's badge.
- [x] **`logs-search`** — `log-search.ts`, the box reading it, the marks and the count.
      Done when: tests show `conn*refused` and `/status=5\d\d/` match, case aside, a bad pattern hides nothing and says
      so, and a suite shows the matched text marked.
- [ ] **`logs-copy`** — `log-copy.ts`, selecting lines, Copy, Save, a line's copy icon, and Copy on an error group.
      Done when: a suite copies a shift-clicked range to a stubbed clipboard as tab-separated lines, and Save makes a
      file of the shown lines; Playwright searches, selects a range and copies it.

## Acceptance

```bash
bun run gate
bunx playwright test   # e2e/tools.ts answers as Loki
```

## Open questions

1. **Exclude terms with `-word`?** Recommended not yet; add it when someone misses it.
2. **Search the Errors view's groups too?** Recommended not yet; the groups are few and their examples can be copied.
3. **Does clicking a line to select it fight selecting text with the mouse?** Recommended: a click without dragging
   selects the line; a drag selects text as the browser does.

# 0069 — Copied lines say where they are from

## Problem

Spec 0036 made a service's lines copyable as text, and people paste them into Slack, a ticket or an AI during an
incident. The paste carries each line's time, pod, level and text, but not which service or environment it came from,
nor a way back to it. Whoever reads the paste asks where it is from, and whoever pasted it goes back for the page's
address and pastes that too.

## Not doing

- **Save.** A saved file is already named for its service, environment and minute, and stays lines alone so a tool
  reading `.log` files reads it as it is.
- **An incident's export.** It says which service each set of lines is from already.
- **Rich text.** The clipboard gets plain text; a chat tool turns the address into a link itself.
- **A link to each line.** The page holds the last 500 live lines and no more, so a line has no address of its own.

## Shape

Every copy of lines, *Copy N lines*, a line's copy icon and an error group's *Copy these lines*, starts with one line
naming the service and environment, and the address of the service's page in that environment showing the same logs:

```text
storefront in production · https://estate.example/services/storefront?env=production
2026-10-07T10:31:02.123Z	storefront-1	ERROR	order 41 lost
```

Lines from the Errors view link to the Errors view over the same range (`?logs=errors&range=6h&env=…`); errors from
a moment, on an alert's card or a past firing's page, link to the Errors view over the last hour, the nearest the
service's page can show.

**Code**: `src/web/log-copy.ts` gains `fromWhere`, the heading line, and `headed`, the lines below it; `asText` is
unchanged, as the incident export and Save use it.

## Why this shape

One line above the rest keeps the tab-separated lines as they were, so a spreadsheet still splits them, and costs a
reader one line. The alternative, a column of the service on every line, repeats the same word down a paste of one
service's lines and leaves out the address; recommended against.

## Depends on

Nothing.

## Stack

- [x] **`copied-lines-say-where`** — the heading line on every copy of lines.
      Done when: a test shows the heading with the service, the environment and its address, a suite shows each of
      the three copies starting with it, and the Errors view's copy linking to its range.

## Acceptance

```bash
bun run gate
```

## Open questions

1. **Head a saved file too?** Recommended not; the file's name says where, and a `.log` read by a tool should be
   lines alone.

# 0071 — Long names in what changed today

## Problem

*What changed today* runs off its panel when a line holds a long word with no break in it. A version that is an image
digest (`743fb49a20393a43ea2b57a628414504a1e8baf536ef836d0981dec3c0839701 applied`) is 64 characters wide and spills
past the panel's edge over whatever is beside it; a CloudWatch alarm's name
(`TargetTracking-service/doorlist-test/api-AlarmLow-7e818fd0-…`) breaks only at its hyphens. Nothing in the 64
characters of a digest tells one version from another that the first twelve do not.

## Not doing

- **Other panels.** Versions elsewhere (the rail, the deploys page, the version strip) stay as they are drawn.
- **The version kept on the item.** `version` is still the whole version, so anything reading it has all of it.

## Shape

- A line in *What changed today*, and a batch's lines, wrap anywhere they must to stay within the panel.
- A version that is a bare hex digest of 40 or more characters, with or without `sha256:`, is said by its first 12:
  `743fb49a2039 applied`, and a batch `includes api 743fb49a2039`.

**Code**: `shortVersion` in `src/shared/feed.ts`, used by the server's feed and `src/web/feed-batches.ts`;
`overflow-wrap: anywhere` on the feed's lines in `src/web/styles/overview.css`.

## Why this shape

Wrapping alone keeps the panel whole but still spends two lines on a digest no one reads past its start; shortening
alone leaves an alarm's name spilling. Twelve characters is what container tools show for an image ID.

## Depends on

Nothing.

## Stack

- [x] **`long-names-in-the-feed`** — feed lines wrap, and a digest is said by its first 12 characters.
      Done when: a test shows a digest version said short in its line and its batch, and the feed's lines wrap.

## Acceptance

```bash
bun run gate
```

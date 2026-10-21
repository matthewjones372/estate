# 0062 — A silence undone where it was made

## Problem

An operator silences an alert from its card, which is on the alert's own page, its service's page and its store's page.
Only the overview's silenced rows and the Alerts page can take the silence back. On the alert's own page the card
offers *Silence…* again and says nothing of the silence already on it; on the service's and the store's page only
firing alerts are shown, so a silenced one disappears from them. The operator has to go to the overview or the Alerts
page to find it and press *Unsilence*.

## Not doing

- **Changing a silence.** Its length and reason stay as made; unsilence and silence again.
- **Silencing from the silenced row.** The row only says who, until when and why, and undoes it.
- **Pending alerts on the service's and store's pages.** They stay on the Alerts page.

## Shape

- **One silenced row**, the overview's, moved to `parts/Silenced.tsx`: the alert's name, *silenced until 15:00 by ada:
  “resizing”*, and *Unsilence* for an operator where silences can be written (`me.role === "operator"` and
  `events().alerts?.silences === true`). A viewer sees the row without the button.
- **The alert's card** shows that row when the alert carries a silence, in place of *Silence…*.
- **The service's page** lists its silenced alerts under *What's happening*, and **the store's page** under *Alerts
  about it*, as those rows.

```tsx
<SilencedAlerts alerts={silenced()} canSilence={canSilence()} />
```

## Why this shape

The overview already says a silence in one row and undoes it with one click; using that row everywhere keeps one way to
read a silence. Showing the whole card for a silenced alert on the service's page was the alternative, but it puts a
quiet alert at the size of one that needs someone; the row is recommended.

## Depends on

Nothing.

## Stack

- [x] **`unsilence-where-silenced`** — the silenced row as a part, on the card, the service's page and the store's page.
      Done when: an operator sees who, until when and why and *Unsilence* on the alert's, service's and store's page,
      which calls `unsilence` with the silence's id; a viewer sees the silence without the button.

## Acceptance

```bash
bun run gate
```

## Open questions

1. **Should the card's head still say "firing since" for a silenced alert?** Recommended: yes for now; it is still
   true in the alert manager, and the silenced row beneath says the rest.

# 0069 — From an alert to what it is about

## Problem

An alert names the service or store it is about, on its row under *Needs you now*, under its card's title, in its own
page's first line and on a past firing's page, but only as text. The one way to its service's page is a button
named for the service among the card's actions, which reads as another action and is not on a row or a store's alert
at all. People reading an alert look for the service's name to click and do not find it.

## Not doing

- **The card's action button.** It stays, for whoever reaches the actions first.
- **Other names.** Changes, dependencies and evidence that name a service stay as they are.

## Shape

Wherever an alert or a past firing names what it is about, the name is a link to that page: a service's at
`/services/:name`, or a store's at `/stores/:name` when the alert is on a store.

```text
row        ▸ critical  OrdersSlow  [storefront]  29 min  …
card       Orders are slow
           [storefront]
alert page critical · firing for 29 min · [storefront] · production
firing     critical · fired 2 Oct 09:00 for 22 min, ended 09:22 · [storefront] · production
```

**Code**: `src/web/parts/Subject.tsx`, the link, used by `AlertRows`, `AlertCard`, and the alert and firing pages.

## Why this shape

The name is already where people look; making it the link adds nothing to read. The alternative, an *Open service*
button, is one more action on a card that has many; recommended against.

## Depends on

Nothing.

## Stack

- [x] **`alert-to-its-service`** — the service or store an alert names, linked, on its row, card and pages.
      Done when: suites show the row's link to a service and to a store, the card's and the alert page's to the
      service, and the past firing's page's.

## Acceptance

```bash
bun run gate
```

## Open questions

1. **Drop the card's button named for the service, now the name above it links?** Recommended not yet; take it away
   if no one misses it.

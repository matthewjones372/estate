# 0014 — On a screen

## Problem

Teams want the estate on a screen on the wall, where everyone sees what needs someone without opening a laptop. The
pages today are made for a person at a desk. They need a sign-in that a TV cannot do, show buttons and note boxes
nobody at a wall can use, and use type too small to read from across a room. They show one environment, and every
service, when a team cares about its own. A screen whose stream has quietly stopped looks exactly like a calm estate.

## Not doing

- **Pages beyond the overview.** A screen shows what needs someone and how each service is. The service, deploys and
  alerts pages stay for desks.
- **Choosing the layout per screen.** One layout, set by the size of the screen.
- **Writing anything.** A screen silences nothing, notes nothing and switches no debug.

## Shape

```yaml
# estate.yaml
kiosk:
  token: "${KIOSK_TOKEN}"            # a screen signs in once at /kiosk?token=…
  environments: [ production, staging ]
  every: 30s                          # each environment in turn
```

```text
https://estate.example/kiosk?token=…            sign the screen in, then /kiosk
https://estate.example/kiosk?team=payments      only the services whose catalog owner is payments, and their alerts
```

- `/kiosk?token=…` checks the token and seals a session for a person named `kiosk` for 30 days, renewed whenever the
  screen loads the page with the token. That person may read what a viewer reads, and every route that writes
  refuses them. Without `kiosk.token`, `/kiosk` is a page like any other, for whoever is signed in.
- The page is the headline, the alerts firing as cards with their charts, who is on them from the notes, and every
  service as a tile with its health and its requests, worst first. Type is sized from the screen's width. There are
  no buttons, boxes or links.
- Environments take turns every `every`, an environment with something firing staying twice as long.
- When nothing has been heard for two minutes, the whole screen says "Not updated since 09:41" in red, until it
  is again. The stream's keep-alive is a `beat` event every five seconds rather than a comment, so a calm estate is
  heard as well as a busy one.
- The page asks the browser to keep the screen awake.

## Why this shape

A token in the URL is what a TV can do: open a page once, and keep it open. Sealing it into a session cookie keeps
the token out of every later request and the server's logs, as sign-in already does. The alternative, an
unauthenticated kiosk route, would publish the estate to anyone who finds the URL. Recommended: the token. A
separate page rather than a flag on the overview keeps the overview's code free of "unless on a screen" at every
button.

## Depends on

Nothing.

## Stack

- [x] **`kiosk-session`** — `kiosk` in the settings, `/kiosk?token=…`, the kiosk person, and writes refused to them.
      Done when: a wrong token is refused with 403, and a kiosk session's silence, note and debug calls get 403.
- [x] **`kiosk-page`** — the page: headline, cards, tiles worst first, `?team=`, turns, the stale banner, wake lock.
      Done when: a page test shows tiles in order of health and the stale banner after two quiet minutes.
- [x] **`kiosk-e2e`** — Playwright signs a screen in with the token and sees the environments take turns, with no
      buttons on the page and no accessibility violations.
      Done when: `bunx playwright test` passes with it.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

- Should a team's screen show alerts that name no service? Recommended: no. They belong to whoever owns the
  estate, whose screen has no `?team=`.

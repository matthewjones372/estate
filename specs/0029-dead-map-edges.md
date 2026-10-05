# 0029 — Dead map edges

## Problem

The map animates every edge with a dashed flow, even when nothing is moving or the source is down. A null or zero
rate still crawls; an edge out of a critical service looks as live as a healthy one. Operators reading the estate in
five seconds cannot tell traffic from a corpse.

## Not doing

- **Inferring edges from traces or a mesh.** The catalog still lists what the map draws (spec 0020).
- **Changing how rates are read or summed.** Dead is a draw rule on the rates and health Estate already has.
- **Hiding dead edges.** They stay on the map; they stop pretending to move.
- **Kiosk.** `/kiosk` has no map.

## Shape

```ts
// DrawnEdge (drawnOf) gains:
dead: boolean
// true when rate is null or 0, or the drawn source node's health is attention or critical
// (category sources use that category's worst health)
```

```text
Live edge     dashed stroke, flow animation (as now); amber when alerting
Dead edge     solid stroke, muted red, no dash / no flow animation
Label         rate and name unchanged; alerting label may still read hot
```

- **Source health** is the drawn `from` node: a service or store's health, or a closed category's worst. Unknown and
  healthy sources are not dead on their own.
- **Rate** of a merged category edge is still the sum; a sum of zero, or no rates at all (`null`), is dead.

## Why this shape

A second visual language (hide, grey-out, or annotate "no traffic") would compete with amber-for-alerting. Reusing the
critical red the nodes already use, solid and still, says "nothing useful is moving" without another legend. Computing
`dead` in `drawnOf` keeps the SVG part thin and the rule under unit tests.

## Depends on

Spec 0020's drawn map (rates, alerting, categories).

## Stack

- [x] **`feat/dead-map-edges`** — `DrawnEdge.dead`; Map lines solid muted-red without `.flow` when dead; drawn tests
      and a map suite for live vs dead classes; `bun run gate`.
      Done when: null/zero rate and attention/critical sources mark `dead: true`; a live edge keeps `.flow`; gate
      passes.

## Acceptance

```bash
bun run gate
```

## Open questions

- **Is unknown a dead source?** Recommended: no — unknown is "not read", not failing; null rate already marks dead.
- **Dead and alerting together?** Recommended: the line is dead (solid muted red); the label may stay hot. Alerting
  names the rule; dead names the traffic.

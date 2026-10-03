# 0020 — A map for many

## Problem

The map at the top of the overview draws the nodes the catalog's `map:` lists, in columns by who calls whom, each
column's nodes spread down a box of fixed height. With a handful of nodes it reads at a glance. With more than about
six in a column, the nodes overlap, their names collide, and the lines between them cross into a tangle. A team with
forty services either leaves most of them off the map or gets a picture nobody can read. That is the opposite of
what the top of the page is for.

## Not doing

- **Drawing the map from traffic.** The catalog says what the map shows, as now. Finding edges from traces or a
  service mesh is a different spec.
- **Panning and zooming.** A map that needs them is not readable in five seconds.
- **A layout library.** The layout stays Estate's own, small and tested.

## Shape

```yaml
# catalog.yaml: unchanged; nodes take their category from the service or store they name
map:
  nodes: [ { id: storefront, service: storefront }, … forty more … ]
  edges: [ … ]
```

```text
Up to 12 nodes        as now, but each column as tall as its nodes need: nothing overlaps
More than 12 nodes,   one node a category: "Payments · 9 nodes", its worst health
with categories       edges between categories, their rates summed, amber when any edge in them alerts
                      a category opened (click, or Enter) shows its own nodes in place; the others stay closed
                      a node that needs someone is never hidden: it is drawn on its own beside its closed category
More than 12 nodes,   as now, each column as tall as its nodes need, and the map scrolls inside its box
no categories         after the first 12 rows, with how many more there are
```

- **Spacing** comes from the nodes, not the box: each node gets the room its label needs, and a column of ten is
  taller than a column of three, up to the map's maximum height.
- **Category nodes** sum what their members say: how many there are, and the worst health. A member that needs
  someone is drawn on its own beside its category, so one firing alert in each of five categories is five nodes and
  five categories, not every node.
  An edge between two categories is drawn once, its rate the sum of the edges it stands for. It is amber when any of
  them is alerting.
- **Opening** a category is remembered for the viewer, as the environment is.
- **The kiosk** has no map, as now.

## Why this shape

Grouping is what a person does with forty boxes anyway, and categories (spec 0018) are already how the catalog
says which services belong together. Collapsing by category keeps the map a summary: the five areas of the estate and
which one is amber. Opening a category gives the detail where it is wanted. The alternative is a force-directed
layout of every node. It spreads them out, but forty nodes and their lines still do not read in five seconds, and
the picture moves on every reload. Recommended: categories, with spacing from the nodes.

## Depends on

Spec 0018's categories.

## Stack

- [x] **`map-spacing`** — each column as tall as its nodes need, within a maximum, scrolling past it.
      Done when: a layout test of 40 nodes has no two nodes overlapping.
- [x] **`map-categories`** — past 12 nodes, a node per category with its count and worst health, edges summed,
      a category opened in place, and what needs someone drawn on its own beside it.
      Done when: the bench's 50-service estate draws as its categories, and opening one shows its nodes.

## Acceptance

```bash
bun run gate
bunx playwright test
bun run perf
```

## Open questions

- **Is 12 the right point to collapse?** Recommended: yes, as a default. A catalog can set `map.collapse` to change
  it, or set it to `never`.

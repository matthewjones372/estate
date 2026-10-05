# 0027 — Jump to

## Problem

An operator who knows the name of a service, store, job or agent still has to find it by eye: scroll the overview,
open a category, or remember which nav page it lives on. The header has Overview, Deploys and Alerts, and nothing that
takes a name. Spec 0010's estates can hold a thousand services; jobs and agents (spec 0018) sit only as lanes with no
address of their own. During ALERT → CONTEXT → INVESTIGATION the first move is often "open that thing" — and Estate
makes them hunt.

## Not doing

- **Searching alerts, logs, metrics, traces or notes.** Jump is catalog entities by name. Alerts already have `/alerts` and `/alerts/:id`; logs stay on the service page.
- **A server search API or a search index.** The catalog is already on the page via `/events`. Match in the browser.
- **Fuzzy ranking libraries, AI search, or "do anything" command palettes.** Type a name, pick a row, go there.
- **Kiosk.** `/kiosk` has no header; jump stays off the wall.
- **Changing how the overview groups or filters lanes.** List/Grid and category headings stay as they are.
- **Grafana Explore, Datadog search, or any source tool's query UI.** Estate links out; it does not become one.

## Shape

```text
Header
  … brand · env · Overview · Deploys · Alerts · [ Search  ⌘K ] · Live · person …

⌘K / Ctrl+K  or  click / focus the header field  →  same palette

Palette
  input: "Jump to a service, store, job or agent…"
  groups (only kinds with hits, in this order):
    Services   storefront · payments · Healthy
    Stores     orders-db · cnpg · Degraded
    Jobs       nightly-settlement · CronJob
    Agents     support-triage · over budget
  empty query: recent jumps (last few, local), else nothing
  arrows + Enter open; Esc closes; click opens
```

```text
Paths (same env query the rest of Estate keeps)
  /services/:name     — already
  /stores/:name       — already
  /jobs/:name         — thin page: what JobLane shows today
  /agents/:name       — thin page: what AgentLane shows today (runs on demand)
```

```ts
// match over the catalog already on the page — no fetch
jumpHits(catalog, query): ReadonlyArray<{
  kind: "service" | "store" | "job" | "agent"
  name: string
  path: string           // /services/… | /stores/… | /jobs/… | /agents/…
  hint?: string          // category, engine, schedule, model…
  health?: Health
}>
// case-insensitive substring on name; exact / prefix before mid-string; cap ~20
```

- **One surface.** The header field and ⌘K open the same palette. Focusing the field with an empty query opens it;
  typing filters; choosing navigates with `actions.navigate` (env kept), records the jump as recent, and closes.
- **Health when known.** A hit shows the current environment's health from the services event when that kind has
  state; missing state is fine (unknown, no dot drama).
- **Jobs and agents get addresses.** Today only services and stores have pages (`route.ts`). Jump needs a place to
  land, so `/jobs/:name` and `/agents/:name` are thin pages that render what the overview lanes already show — not a
  second product, the lane content at a URL. Missing name → the same "no such page" Estate already uses.

## Why this shape

Operators already have the catalog in memory on the page; a round trip to search it would be slower and another API
to keep honest. Substring match is enough for catalog names people typed themselves; a Fuse-style scorer is weight
with little gain at a few thousand rows. One palette behind both the header and ⌘K matches how Linear/GitHub feel
without becoming a command runner.

Jobs and agents could instead scroll to a lane on the overview (`#…`). That leaves them without a shareable address
and fights Soft nav. Spec 0018 already described an agent's page; thin job and agent pages finish that and give Jump
a uniform target. Recommended: paths for all four kinds.

## Depends on

Nothing new from outside. The catalog and per-environment health are already on the page. Alert permalinks
stay on `/alerts`; Jump does not list alerts.

## Stack

One entry per pull request, in build order.

- [x] **`spec-0027`** — this spec, and its row in `specs/README.md` as proposed.
      Done when: `specs/0027-jump-to.md` is committed and the README lists 0027 as proposed.
- [ ] **`jump-match`** — `jumpHits` (or equivalent) over catalog services, stores, jobs and agents; paths for all
      four; unit tests for empty, prefix, mid-string, kind grouping and the cap.
      Done when: a fixture catalog's `nightly` hits the job and not a similarly named service first when kinds differ;
      twenty-one `svc-N` names return at most twenty.
- [ ] **`job-agent-pages`** — `route` + `App` Match for `/jobs/:name` and `/agents/:name`; thin pages reusing
      `JobLane` / `AgentLane` (or the same parts); missing name → Missing.
      Done when: pages.suite opens `/jobs/nightly-settlement` and `/agents/support-triage` and sees their titles;
      unknown names show "There is no such page."
- [ ] **`jump-palette`** — `parts/Jump.tsx` (palette + results); wired from Header (search field + ⌘K / Ctrl+K);
      recent jumps in `kept`; navigate on choose; closed on Esc and after navigate; not mounted on kiosk.
      Done when: a suite opens ⌘K, types `storefront`, Enter, and the page is the service; Esc closes without
      navigating; kiosk has no listener.
- [ ] **`jump-e2e`** — Playwright: header field and ⌘K reach a store and an agent; README mentions Jump / ⌘K once.
      Done when: `bunx playwright test` covers both entry points; `bun run gate` passes.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

- **Prefix kind filters (`s:`, `store:`, `job:`, `agent:`)?** Recommended: not in the first stack. Substring across
  kinds is enough; add prefixes if mixed hits get noisy on large estates.
- **Match category and owner as well as name?** Recommended: name only at first. Category is already how the overview
  groups; owner is on the card once you arrive.
- **How many recents?** Recommended: eight, in `kept` (`estate.jump.recent`), oldest dropped; cleared when the name
  leaves the catalog.
- **Should Jump list firing alerts by name?** Recommended: no. Alerts have `/alerts` and permalinks; mixing them into
  entity jump blurs ALERT vs CONTEXT. A later "go to alert" can sit beside this without growing it.
- **Thin job/agent pages vs overview anchors?** Recommended: thin pages, as in Shape. Anchors are cheaper but not
  shareable and leave 0018's agent page unfinished.

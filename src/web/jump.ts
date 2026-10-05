/** Jump to a catalog entity by name: substring match over services, stores, jobs and agents. */
import type { CatalogEvent, Health } from "../shared/events"

export type JumpKind = "service" | "store" | "job" | "agent"

export type JumpHit = {
  readonly kind: JumpKind
  readonly name: string
  readonly path: string
  readonly hint?: string
  readonly health?: Health
}

const kindOrder: Readonly<Record<JumpKind, number>> = { service: 0, store: 1, job: 2, agent: 3 }

const paths: Readonly<Record<JumpKind, (name: string) => string>> = {
  service: (name) => `/services/${encodeURIComponent(name)}`,
  store: (name) => `/stores/${encodeURIComponent(name)}`,
  job: (name) => `/jobs/${encodeURIComponent(name)}`,
  agent: (name) => `/agents/${encodeURIComponent(name)}`,
}

/** How well `name` matches `query`: exact, prefix, mid-string; or nothing. */
const rankOf = (name: string, query: string): 0 | 1 | 2 | undefined => {
  const lower = name.toLowerCase()
  const q = query.toLowerCase()
  if (lower === q) return 0
  if (lower.startsWith(q)) return 1
  if (lower.includes(q)) return 2
  return undefined
}

const cap = 20

type Candidate = JumpHit & { readonly rank: 0 | 1 | 2 }

/** Hits for `query` over the catalog: kinds grouped in order, exact / prefix before mid-string, at most twenty. */
export const jumpHits = (catalog: CatalogEvent | undefined, query: string): ReadonlyArray<JumpHit> => {
  const trimmed = query.trim()
  if (trimmed === "" || catalog === undefined) return []
  const candidates: Candidate[] = []
  const push = (kind: JumpKind, name: string, hint: string | undefined) => {
    const rank = rankOf(name, trimmed)
    if (rank === undefined) return
    candidates.push({
      kind,
      name,
      path: paths[kind](name),
      ...(hint === undefined || hint === "" ? {} : { hint }),
      rank,
    })
  }
  for (const each of catalog.services) push("service", each.name, each.category)
  for (const each of catalog.stores ?? []) push("store", each.name, each.engine)
  for (const each of catalog.jobs ?? []) push("job", each.name, each.kind)
  for (const each of catalog.agents ?? []) push("agent", each.name, each.category)
  candidates.sort(
    (a, b) => a.rank - b.rank || kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name),
  )
  return candidates.slice(0, cap).map(({ rank: _, ...hit }) => hit)
}

/** Hits still in the catalog, in the order kept, oldest dropped past eight. */
export const recentHits = (
  catalog: CatalogEvent | undefined,
  recent: ReadonlyArray<JumpHit>,
): ReadonlyArray<JumpHit> => {
  if (catalog === undefined) return []
  const known = new Set([
    ...catalog.services.map((each) => `service:${each.name}`),
    ...(catalog.stores ?? []).map((each) => `store:${each.name}`),
    ...(catalog.jobs ?? []).map((each) => `job:${each.name}`),
    ...(catalog.agents ?? []).map((each) => `agent:${each.name}`),
  ])
  return recent.filter((hit) => known.has(`${hit.kind}:${hit.name}`)).slice(0, 8)
}

const recentKey = "estate.jump.recent"

/** Recent jumps in this browser: newest first, at most eight. */
export const jumpRecent = {
  read: (read: () => string | null): ReadonlyArray<JumpHit> => {
    const raw = read()
    if (raw === null) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (each): each is JumpHit =>
          typeof each === "object" &&
          each !== null &&
          typeof (each as JumpHit).kind === "string" &&
          typeof (each as JumpHit).name === "string" &&
          typeof (each as JumpHit).path === "string",
      )
    } catch {
      return []
    }
  },
  write: (write: (value: string) => void, hits: ReadonlyArray<JumpHit>) => {
    write(
      JSON.stringify(
        hits.slice(0, 8).map(({ kind, name, path, hint }) => ({
          kind,
          name,
          path,
          ...(hint === undefined ? {} : { hint }),
        })),
      ),
    )
  },
  key: recentKey,
}

/** Attach health from the current environment's services event onto catalog hits. */
export const withHealth = (
  hits: ReadonlyArray<JumpHit>,
  services:
    | {
        readonly services: ReadonlyArray<{ readonly name: string; readonly health: Health }>
        readonly stores?: ReadonlyArray<{ readonly name: string; readonly health: Health }>
        readonly jobs?: ReadonlyArray<{ readonly name: string; readonly health: Health }>
        readonly agents?: ReadonlyArray<{ readonly name: string; readonly health: Health }>
      }
    | undefined,
): ReadonlyArray<JumpHit> => {
  if (services === undefined) return hits
  const healthOf = (kind: JumpKind, name: string): Health | undefined => {
    const list =
      kind === "service"
        ? services.services
        : kind === "store"
          ? (services.stores ?? [])
          : kind === "job"
            ? (services.jobs ?? [])
            : (services.agents ?? [])
    return list.find((each) => each.name === name)?.health
  }
  return hits.map((hit) => {
    const health = healthOf(hit.kind, hit.name)
    return health === undefined ? hit : { ...hit, health }
  })
}

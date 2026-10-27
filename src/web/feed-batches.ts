/**
 * What changed today in batches (spec 0068): builds that passed together, and versions applied together, are one
 * line each; everything else stays a line of its own, and an alert that fired within half an hour of a version applied
 * to its service says so.
 */
import { type FeedItem, shortVersion } from "../shared/feed"
import { duration } from "./format"

/** Changes within this of the first in their batch are one batch. */
const together = 5 * 60_000
const afterDeploy = 30 * 60_000

export type Entry =
  | { readonly kind: "item"; readonly item: FeedItem; readonly after?: string }
  | {
      readonly kind: "builds" | "versions"
      readonly at: string
      readonly items: ReadonlyArray<FeedItem>
      readonly text: string
      readonly sub: string
    }

type Batched = "builds" | "versions"

const batchOf = (item: FeedItem): Batched | undefined => {
  if (item.kind === "build" && item.build?.passed === true) return "builds"
  if (item.kind === "deploy" && item.version !== undefined) return "versions"
  return undefined
}

const named = (item: FeedItem) =>
  `${item.service === undefined ? "" : `${item.service} `}${shortVersion(item.version ?? "")}`.trim()

/** Said of a batch: the first of it that needs someone, else the first, and how many more. */
const sayBatch = (
  kind: Batched,
  items: ReadonlyArray<FeedItem>,
  needing: ReadonlySet<string>,
  stuck: ReadonlySet<string>,
): { readonly text: string; readonly sub: string } => {
  const first = items.find((item) => item.service !== undefined && needing.has(item.service)) ?? items[0]
  if (kind === "builds") {
    const title = `${first?.service === undefined ? "" : `${first.service}: `}${first?.build?.title ?? ""}`
    return {
      text: `${items.length} builds passed`,
      sub: items.length === 1 ? title : `${title}, and ${items.length - 1} more`,
    }
  }
  const held = items.flatMap((item) => (item.service !== undefined && stuck.has(item.service) ? [item.service] : []))
  return {
    text: `${items.length} versions applied`,
    sub: [`includes ${first === undefined ? "" : named(first)}`, ...held.map((service) => `${service} stuck`)].join(
      " · ",
    ),
  }
}

/** The version applied to an alert's service in the hour before it fired, said as how long before. */
const deployBefore = (alert: FeedItem, items: ReadonlyArray<FeedItem>): string | undefined => {
  if (alert.kind !== "alert" || alert.service === undefined) return undefined
  const fired = Date.parse(alert.at)
  const before = items
    .filter(
      (item) =>
        item.kind === "deploy" &&
        item.version !== undefined &&
        item.service === alert.service &&
        Date.parse(item.at) <= fired &&
        fired - Date.parse(item.at) <= afterDeploy,
    )
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
  return before === undefined ? undefined : `${duration(fired - Date.parse(before.at))} after ${named(before)} applied`
}

/** The feed, newest first, as the overview says it. */
export const batchesOf = (
  items: ReadonlyArray<FeedItem>,
  needing: ReadonlySet<string> = new Set(),
  stuck: ReadonlySet<string> = new Set(),
): ReadonlyArray<Entry> => {
  const entries: Entry[] = []
  let open: { kind: Batched; items: FeedItem[] } | undefined
  const close = () => {
    if (open === undefined) return
    const [only] = open.items
    if (open.items.length === 1 && only !== undefined) entries.push({ kind: "item", item: only })
    else {
      const at = open.items[0]?.at ?? ""
      entries.push({ kind: open.kind, at, items: open.items, ...sayBatch(open.kind, open.items, needing, stuck) })
    }
    open = undefined
  }
  for (const item of items) {
    const kind = batchOf(item)
    const start = open?.items[0]
    if (kind !== undefined && open?.kind === kind && start !== undefined) {
      if (Date.parse(start.at) - Date.parse(item.at) <= together) {
        open.items.push(item)
        continue
      }
    }
    close()
    if (kind !== undefined) open = { kind, items: [item] }
    else {
      const after = deployBefore(item, items)
      entries.push(after === undefined ? { kind: "item", item } : { kind: "item", item, after })
    }
  }
  close()
  return entries
}

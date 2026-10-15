/**
 * An incident's evidence held to `incidents.evidence.maxMegabytes` (spec 0047): its charts first, then each service's
 * errors, then its traces, then its lines, the newest first, each while it fits; what does not is named.
 */
import type { EvidenceSet, KeptLogs } from "../shared/evidence"

const encoder = new TextEncoder()

/** How many bytes a value takes as the JSON it is kept as. */
export const sizeOf = (value: unknown) => encoder.encode(JSON.stringify(value)).length

/** Those of `items` that fit in `room` bytes, in order, and the room left after them. */
const taking = <A>(items: ReadonlyArray<A>, room: number) =>
  items.reduce<{ readonly kept: ReadonlyArray<A>; readonly room: number }>(
    (taken, item) => {
      const size = sizeOf(item) + 1
      return size > taken.room ? taken : { kept: [...taken.kept, item], room: taken.room - size }
    },
    { kept: [], room },
  )

/** Each service's part of `logs` that fits, one service after another, and the room left. */
const takingEach = <A>(
  logs: ReadonlyArray<KeptLogs>,
  room: number,
  of: (logs: KeptLogs) => ReadonlyArray<A>,
): { readonly kept: ReadonlyArray<ReadonlyArray<A>>; readonly room: number } =>
  logs.reduce<{ readonly kept: ReadonlyArray<ReadonlyArray<A>>; readonly room: number }>(
    (taken, each) => {
      const fitted = taking(of(each), taken.room)
      return { kept: [...taken.kept, fitted.kept], room: fitted.room }
    },
    { kept: [], room },
  )

// Room kept back for the line that names what was left out.
const naming = 160

const many = (count: number, one: string, more: string) => `${count} ${count === 1 ? one : more}`

const listed = (parts: ReadonlyArray<string>) =>
  parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`

/** The set within `most` bytes, and what it left out named in its `leftOut`. */
export const withinLimit = (set: EvidenceSet, most: number): EvidenceSet => {
  if (sizeOf(set) <= most) return set
  const logs = set.logs ?? []
  const bare = { ...set, charts: [], logs: logs.map((each) => ({ ...each, errors: [], lines: [] })), traces: [] }
  const charts = taking(set.charts, most - sizeOf(bare) - naming)
  const errors = takingEach(logs, charts.room, (each) => each.errors)
  const traces = taking(set.traces ?? [], errors.room)
  // The newest lines are kept when only some fit, and kept oldest first as ever.
  const lines = takingEach(traces.room === 0 ? [] : logs, traces.room, (each) => each.lines.toReversed())
  const kept = logs.map((each, index) => ({
    ...each,
    errors: errors.kept[index] ?? [],
    lines: (lines.kept[index] ?? []).toReversed(),
  }))
  const count = (of: (each: KeptLogs) => ReadonlyArray<unknown>, from: ReadonlyArray<KeptLogs>) =>
    from.reduce((total, each) => total + of(each).length, 0)
  const left = [
    [set.charts.length - charts.kept.length, "chart", "charts"],
    [count((each) => each.errors, logs) - count((each) => each.errors, kept), "error group", "error groups"],
    [(set.traces?.length ?? 0) - traces.kept.length, "trace", "traces"],
    [count((each) => each.lines, logs) - count((each) => each.lines, kept), "line", "lines"],
  ] as const
  const named = left.flatMap(([number, one, more]) => (number === 0 ? [] : [many(number, one, more)]))
  return {
    ...set,
    charts: charts.kept,
    ...(set.logs === undefined ? {} : { logs: kept }),
    ...(set.traces === undefined ? {} : { traces: traces.kept }),
    leftOut: [...(set.leftOut ?? []), `${listed(named)} past incidents.evidence.maxMegabytes`],
  }
}

/**
 * A service's series moved along: once a minute each series of the last hour gains a point and loses its first, and
 * sending that as the points it gained, rather than the whole series again, is most of what keeps a page's stream
 * small. Worked out by the server and applied by the page.
 */
import type { Load, Series, ServiceState } from "./events"

export interface Shift {
  readonly service: string
  /** `requests`, `errors`, `p99`, or `stats.<index>`. */
  readonly series: string
  /** How many points fell off the front. */
  readonly shift: number
  /** The points at the end: those that came on, and any of the last ones revised as late samples arrived. */
  readonly tail: ReadonlyArray<number | null>
}

const kinds = ["requests", "errors", "p99"] as const

const seriesIn = (load: Load): ReadonlyArray<readonly [string, Series]> => [
  ...kinds.flatMap((kind) => {
    const series = load[kind]
    return series === undefined ? [] : [[kind, series] as const]
  }),
  ...(load.stats ?? []).map((stat, index) => [`stats.${index}`, stat.series] as const),
]

/** The load with each series replaced by `replace`. */
const withSeries = (load: Load, replace: (path: string, series: Series) => Series): Load => ({
  ...load,
  ...Object.fromEntries(
    kinds.flatMap((kind) => {
      const series = load[kind]
      return series === undefined ? [] : [[kind, replace(kind, series)]]
    }),
  ),
  ...(load.stats === undefined
    ? {}
    : { stats: load.stats.map((stat, index) => ({ ...stat, series: replace(`stats.${index}`, stat.series) })) }),
})

const most = 4

/**
 * `after` as `before` moved along by `shift` points, with its last `tail` points new or revised: the fewest that do,
 * or nothing if more changed than that.
 */
const shiftOf = (before: Series, after: Series): { readonly shift: number; readonly tail: number } | undefined => {
  const length = after.points.length
  if (before.points.length !== length) return undefined
  const tails = Array.from({ length: Math.min(most, length) + 1 }, (_, tail) => tail)
  return tails
    .flatMap((tail) => tails.filter((shift) => shift <= tail).map((shift) => ({ shift, tail })))
    .find(({ shift, tail }) =>
      after.points.slice(0, length - tail).every((point, index) => point === before.points[index + shift]),
    )
}

const empty: Series = { now: null, points: [] }
const withoutSeries = (service: ServiceState) =>
  JSON.stringify({ ...service, load: withSeries(service.load, () => empty) })

/** `after` as `before` with its series moved along, or nothing if anything else about it changed. */
export const shiftsBetween = (before: ServiceState, after: ServiceState): ReadonlyArray<Shift> | undefined => {
  if (withoutSeries(before) !== withoutSeries(after)) return undefined
  const was = new Map(seriesIn(before.load))
  const shifts = seriesIn(after.load).map(([path, series]) => {
    const old = was.get(path)
    const moved = old === undefined ? undefined : shiftOf(old, series)
    return moved === undefined
      ? undefined
      : {
          service: after.name,
          series: path,
          shift: moved.shift,
          tail: series.points.slice(series.points.length - moved.tail),
        }
  })
  return shifts.every((each) => each !== undefined) && was.size === shifts.length
    ? shifts.filter((each) => each.tail.length > 0)
    : undefined
}

/** The service with each of its series moved along as `shifts` say. */
export const applyShifts = (service: ServiceState, shifts: ReadonlyArray<Shift>): ServiceState => {
  const mine = shifts.filter((each) => each.service === service.name)
  if (mine.length === 0) return service
  return {
    ...service,
    load: withSeries(service.load, (path, series) => {
      const found = mine.find((each) => each.series === path)
      if (found === undefined) return series
      const kept = series.points.length - found.tail.length
      const points = [...series.points.slice(found.shift, found.shift + kept), ...found.tail]
      return { now: points.at(-1) ?? null, points }
    }),
  }
}

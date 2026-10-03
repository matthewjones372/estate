/** The geometry of the hand-drawn charts: a line and the area under it, in a box, with gaps where data is missing. */

export interface Shape {
  readonly line: string
  readonly area: string
  readonly y: (value: number) => number
}

export const shape = (
  values: ReadonlyArray<number | null>,
  width: number,
  height: number,
  options: { readonly pad?: number; readonly low?: number; readonly high?: number } = {},
): Shape => {
  const pad = options.pad ?? 3
  const known = values.filter((value): value is number => value !== null)
  const low = options.low ?? Math.min(0, ...known)
  const high = options.high ?? Math.max(...known, low + 1)
  const span = high - low || 1
  const y = (value: number) => Number((height - pad - ((value - low) / span) * (height - 2 * pad)).toFixed(1))
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const points = values.flatMap((value, index) => (value === null ? [] : [`${(index * step).toFixed(1)},${y(value)}`]))
  const line = points.join(" ")
  const first = points[0]?.split(",")[0] ?? "0"
  const last = points.at(-1)?.split(",")[0] ?? String(width)
  return { line, area: points.length === 0 ? "" : `${first},${height} ${line} ${last},${height}`, y }
}

/** A span of a chart's range, as fractions of it from its start: the whole of it is 0 to 1. */
export interface Zoom {
  readonly from: number
  readonly to: number
}

export const whole: Zoom = { from: 0, to: 1 }

/** The points a zoom shows, and the index of the first of them among all the points. */
export const visible = <T>(
  points: ReadonlyArray<T>,
  zoom: Zoom,
): { readonly shown: ReadonlyArray<T>; readonly first: number } => {
  const last = points.length - 1
  const first = Math.max(0, Math.min(last - 1, Math.round(zoom.from * last)))
  const end = Math.max(first + 1, Math.min(last, Math.round(zoom.to * last)))
  return { shown: points.slice(first, end + 1), first }
}

/** Points are evenly spread over `span` milliseconds ending at `end`, the last of them at `end`. */
export const timeOf = (index: number, count: number, end: number, span: number): number =>
  count < 2 ? end : end - span + (index * span) / (count - 1)

export const indexAt = (at: number, count: number, end: number, span: number): number =>
  count < 2 ? 0 : Math.max(0, Math.min(count - 1, Math.round(((at - (end - span)) * (count - 1)) / span)))

/** The point nearest a moment: when it was and what it read, or nothing where the source had nothing. */
export const reading = (
  points: ReadonlyArray<number | null>,
  end: number,
  span: number,
  at: number | undefined,
): { readonly at: number; readonly value: number } | undefined => {
  if (at === undefined || points.length === 0) return undefined
  const index = indexAt(at, points.length, end, span)
  const value = points[index]
  return value === null || value === undefined ? undefined : { at: timeOf(index, points.length, end, span), value }
}

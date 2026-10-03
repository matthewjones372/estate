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

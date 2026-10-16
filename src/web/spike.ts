/**
 * Where a request rate jumped, as fractions of `span`. A jump clears 100 a second and is more than ten times the rate
 * about five minutes earlier. The band then follows it while it stays above 100 a second.
 */
const floor = 100
const times = 10
const earlierMs = 5 * 60 * 1000

export const spikes = (
  points: ReadonlyArray<number | null>,
  span: number,
): ReadonlyArray<{ readonly from: number; readonly to: number }> => {
  const count = points.length
  if (count < 2 || !(span > 0)) return []
  const step = span / (count - 1)
  const back = Math.max(1, Math.round(earlierMs / step))
  const jumped = (index: number) => {
    const value = points[index]
    const earlier = points[index - back]
    return typeof value === "number" && value > floor && typeof earlier === "number" && value > times * earlier
  }
  const runs: Array<{ from: number; to: number }> = []
  let start: number | undefined
  let held = false
  const close = (end: number) => {
    if (start === undefined) return
    let from = start / (count - 1)
    const to = Math.min(1, (end + 1) / (count - 1))
    // The newest point sits on the right edge, so a spike there needs the last step to be visible.
    if (to <= from) from = Math.max(0, (count - 2) / (count - 1))
    runs.push({ from, to: Math.max(to, from) })
    start = undefined
  }
  for (let index = 0; index < count; index++) {
    const value = points[index]
    const up = typeof value === "number" && value > floor && (held || jumped(index))
    if (up) {
      if (start === undefined) start = index
      held = true
    } else if (start !== undefined) {
      close(index - 1)
      held = false
    }
  }
  if (start !== undefined) close(count - 1)
  return runs
}

/** The same bands as times along a series that ends at `end`. */
export const spikeBands = (
  points: ReadonlyArray<number | null>,
  end: number,
  span: number,
): ReadonlyArray<{ readonly from: number; readonly to: number }> =>
  spikes(points, span).map((band) => ({
    from: end - span + band.from * span,
    to: end - span + band.to * span,
  }))

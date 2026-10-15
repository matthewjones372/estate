/**
 * A window of time to chart, as the server reads it and the page draws it: whole steps of a minute or more, about 120
 * points, its start at or before the time asked and its end at or after, so both agree on where each point falls.
 */
export interface Window {
  /** Seconds since the epoch. */
  readonly start: number
  readonly end: number
  readonly step: number
}

export const windowOf = (from: number, to: number): Window => {
  const step = Math.max(60, Math.ceil((to - from) / 1000 / 120 / 60) * 60)
  return { start: Math.floor(from / 1000 / step) * step, end: Math.ceil(to / 1000 / step) * step, step }
}

/** Numbers, times and durations in the page's words. */
import type { Health } from "../shared/events"

export { amount, measured } from "../shared/measure"

const pad = (value: number) => String(value).padStart(2, "0")

/** "14:17", in the viewer's time zone. */
export const clock = (iso: string): string => {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "27 Sep 09:10", in the viewer's time zone. */
export const day = (iso: string): string => {
  const date = new Date(iso)
  return `${date.getDate()} ${months[date.getMonth()] ?? ""} ${clock(iso)}`
}

/** "2 Oct 09:05:30": a moment, to the second, as a timeline lists it. */
export const instant = (iso: string): string => {
  const date = new Date(iso)
  return `${date.getDate()} ${months[date.getMonth()] ?? ""} ${clock(iso)}:${pad(date.getSeconds())}`
}

/** "14:02" for a time today, "2 Oct 09:05" for one before: a note's time, dated once it is not today's. */
export const stamp = (iso: string, now: number): string =>
  new Date(iso).toDateString() === new Date(now).toDateString() ? clock(iso) : day(iso)

/** "8 min", "1 h 52 min", "3 d": how long from `iso` to `now`. */
export const since = (iso: string, now: number): string => duration(now - new Date(iso).getTime())

export const duration = (milliseconds: number): string => {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000))
  if (minutes < 1) return "under a minute"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} d`
}

/** "<1 ms", "48 ms", "1.06 s": how long a span or stage took. */
export const took = (milliseconds: number): string => {
  if (milliseconds < 1) return "<1 ms"
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(2)} s`
}

/** "One thing", "Two things": counted in words up to twelve. */
const counts = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"]
export const counted = (count: number, noun: string): string =>
  `${counts[count] ?? count.toLocaleString("en-GB")} ${count === 1 ? noun : `${noun}s`}`

export const initials = (name: string): string => {
  const words = name.split(/[\s._@-]+/).filter((word) => word !== "")
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2)
  return letters.toUpperCase()
}

/** A health in the words a lane, a card or a search result shows. */
export const healthWords: Readonly<Record<Health, string>> = {
  healthy: "Healthy",
  attention: "Degraded",
  critical: "Down",
  unknown: "Unknown",
}

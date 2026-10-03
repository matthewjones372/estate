/** Numbers, times and durations in the page's words. */

const pad = (value: number) => String(value).padStart(2, "0")

/** "14:17", in the viewer's time zone. */
export const clock = (iso: string): string => {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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

/** A metric's value with few digits: 1,250 · 148 · 9.4 · 0.03 · 0. */
export const amount = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "–"
  const size = Math.abs(value)
  if (size === 0) return "0"
  if (size >= 100) return Math.round(value).toLocaleString("en-GB")
  if (size >= 10) return value.toFixed(1).replace(/\.0$/, "")
  if (size >= 0.01) return value.toFixed(2).replace(/\.?0+$/, "")
  return value.toExponential(1)
}

/** A value with its unit: seconds become ms or s, a rate keeps its "/s". */
export const measured = (value: number | null | undefined, unit: string | undefined): string => {
  if (value === null || value === undefined) return "–"
  if (unit === "s") return value < 1 ? `${amount(value * 1000)} ms` : `${amount(value)} s`
  if (unit === undefined || unit === "") return amount(value)
  return unit.startsWith("/") || unit === "%" ? `${amount(value)}${unit}` : `${amount(value)} ${unit}`
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

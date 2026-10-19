/** A metric's value in words a page, a brief and an export all read the same way. */

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

const binary = ["B", "KiB", "MiB", "GiB", "TiB"]

/** 1,536 bytes is 1.5 KiB. */
const bytes = (value: number): string => {
  let size = value
  let index = 0
  while (Math.abs(size) >= 1024 && index < binary.length - 1) {
    size /= 1024
    index += 1
  }
  return `${amount(size)} ${binary[index]}`
}

/** A value with its unit: seconds become ms or s, a rate keeps its "/s". */
export const measured = (value: number | null | undefined, unit: string | undefined): string => {
  if (value === null || value === undefined) return "–"
  if (unit === "s") return value < 1 ? `${amount(value * 1000)} ms` : `${amount(value)} s`
  if (unit === "bytes") return bytes(value)
  if (unit === "cores") return `${amount(value)} ${value === 1 ? "core" : "cores"}`
  if (unit === undefined || unit === "") return amount(value)
  return unit.startsWith("/") || unit === "%" ? `${amount(value)}${unit}` : `${amount(value)} ${unit}`
}

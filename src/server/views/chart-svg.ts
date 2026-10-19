/**
 * A kept chart as SVG for an incident's export (spec 0047), drawn on the server from the kept series: no browser, sharp
 * at any size, and it opens in anything. The incident's span is shaded and each of its events marked, with its highest
 * and the window's ends in UTC written on it, so it reads without the JSON beside it.
 */
import { highestOf, type KeptChart, unitOf } from "../../shared/evidence"
import { measured } from "../../shared/measure"

const [width, height, pad, top, axis] = [600, 180, 8, 20, 20]
const floor = height - axis
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "16:00", in UTC. */
const clockOf = (instant: number) => new Date(instant).toISOString().slice(11, 16)

/** "12 Oct 16:00", in UTC. */
const dayOf = (instant: number) => {
  const date = new Date(instant)
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${clockOf(instant)}`
}

const escaped = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The line through the points, broken where the source had nothing. */
const pathOf = (points: ReadonlyArray<number | null>) => {
  const high = Math.max(...points.filter((point): point is number => point !== null), 0.000001)
  const across = (width - 2 * pad) / Math.max(1, points.length - 1)
  return points
    .map((point, index) => {
      if (point === null) return ""
      const [x, y] = [pad + index * across, floor - pad - (point / high) * (floor - pad - top)]
      const starts = index === 0 || points[index - 1] === null
      return `${starts ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(" ")
    .trim()
}

export const chartSvg = (
  chart: KeptChart,
  window: { readonly start: number; readonly end: number; readonly step: number },
  shaded: { readonly from: number; readonly to: number },
  marks: ReadonlyArray<number>,
): string => {
  const [start, end] = [window.start * 1000, window.end * 1000]
  const x = (time: number) =>
    pad + ((Math.min(end, Math.max(start, time)) - start) / (end - start || 1)) * (width - 2 * pad)
  const unit = unitOf(chart)
  const title = `${chart.service} ${chart.panel}${unit === undefined ? "" : ` (${unit})`}, ${chart.environment}`
  const peak = highestOf(chart, window)
  const highest = peak === undefined ? "no points" : `highest ${measured(peak.value, unit)} at ${clockOf(peak.at)} UTC`
  const label = (left: number, y: number, anchor: string, className: string, text: string) =>
    `<text class="${className}" x="${left}" y="${y}" text-anchor="${anchor}" fill="#e9ecf2" font-family="sans-serif" font-size="12">${escaped(text)}</text>`
  const events = marks
    .filter((time) => time >= start && time <= end)
    .map(
      (time) =>
        `<line class="event" x1="${x(time).toFixed(1)}" x2="${x(time).toFixed(1)}" y1="${top}" y2="${floor}" stroke="#8c93a3" stroke-dasharray="2 3"/>`,
    )
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<title>${escaped(title)}</title>`,
    `<rect width="${width}" height="${height}" fill="#0b0d12"/>`,
    `<rect class="window" x="${x(shaded.from).toFixed(1)}" y="${top}" width="${(x(shaded.to) - x(shaded.from)).toFixed(1)}" height="${floor - top}" fill="#f5a524" fill-opacity="0.15"/>`,
    ...events,
    `<path d="${pathOf(chart.points)}" fill="none" stroke="#8fb0ff" stroke-width="1.5"/>`,
    label(pad, 14, "start", "title", title),
    label(width - pad, 14, "end", "high", highest),
    label(pad, height - 6, "start", "axis", `${dayOf(start)} UTC`),
    label(width - pad, height - 6, "end", "axis", `${dayOf(end)} UTC`),
    "</svg>",
  ].join("\n")
}

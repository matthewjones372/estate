/** @jsxImportSource solid-js */
/**
 * A chart as an incident kept it, drawn from its points over the window it was read for, and read as a live chart is:
 * its highest, or the value at the moment marked, and the window's ends beneath it.
 */
import { type EvidenceSet, highestOf, type KeptChart, unitOf } from "../../shared/evidence"
import type { Incident } from "../../shared/incidents"
import { reading } from "../chart"
import { clock, day, measured } from "../format"
import { Plot } from "./Plot"

/** The incident's span on a kept chart: from its first firing, or its opening if earlier, to its close or the end. */
export const shadeOf = (incident: Incident, set: EvidenceSet) => ({
  from: Math.min(Date.parse(incident.openedAt), ...incident.firings.map((each) => Date.parse(each.startsAt))),
  to: incident.closedAt === undefined ? set.window.end * 1000 : Date.parse(incident.closedAt),
})

const iso = (ms: number) => new Date(ms).toISOString()

export const KeptChartFigure = (props: {
  readonly chart: KeptChart
  readonly set: EvidenceSet
  readonly shade: { readonly from: number; readonly to: number } | undefined
  readonly marks: ReadonlyArray<number>
  readonly mark: number | undefined
  readonly onMark: (at: number | undefined) => void
}) => {
  const unit = () => unitOf(props.chart)
  const end = () => props.set.window.end * 1000
  const span = () => (props.set.window.end - props.set.window.start) * 1000
  const read = () => reading(props.chart.points, end(), span(), props.mark)
  const high = () => highestOf(props.chart, props.set.window)
  const name = () =>
    `${props.chart.service} ${props.chart.panel}${unit() === undefined ? "" : ` (${unit()})`}, ${props.chart.environment}`
  const value = () => {
    const at = read()
    if (at !== undefined) return measured(at.value, unit())
    const peak = high()
    return peak === undefined ? "no points" : `highest ${measured(peak.value, unit())} at ${clock(iso(peak.at))}`
  }
  return (
    <figure class="chart">
      <figcaption class="spread">
        <span class="muted">{read() === undefined ? name() : `${name()} at ${clock(iso(read()?.at ?? 0))}`}</span>
        <span class="mono" aria-live="polite">
          {value()}
        </span>
      </figcaption>
      <Plot
        label={`${props.chart.service} ${props.chart.panel} in ${props.chart.environment}, as kept. Arrow keys read each point.`}
        points={props.chart.points}
        end={end()}
        span={span()}
        width={300}
        height={110}
        pad={4}
        ink="#8FB0FF"
        baseline
        keys
        mark={props.mark}
        onMark={props.onMark}
        shade={props.shade}
        marks={props.marks}
      />
      <div class="chart-axis mono ink-3">
        <span>{day(iso(props.set.window.start * 1000))}</span>
        <span>{day(iso(end()))}</span>
      </div>
    </figure>
  )
}

/** @jsxImportSource solid-js */
/** A chart as an incident kept it, drawn from its points over the window it was read for. */
import type { EvidenceSet, KeptChart } from "../../shared/evidence"
import type { Incident } from "../../shared/incidents"
import { Plot } from "./Plot"

/** The incident's span on a kept chart: from its first firing, or its opening if earlier, to its close or the end. */
export const shadeOf = (incident: Incident, set: EvidenceSet) => ({
  from: Math.min(Date.parse(incident.openedAt), ...incident.firings.map((each) => Date.parse(each.startsAt))),
  to: incident.closedAt === undefined ? set.window.end * 1000 : Date.parse(incident.closedAt),
})

export const KeptChartFigure = (props: {
  readonly chart: KeptChart
  readonly set: EvidenceSet
  readonly shade: { readonly from: number; readonly to: number } | undefined
  readonly marks: ReadonlyArray<number>
  readonly mark: number | undefined
  readonly onMark: (at: number | undefined) => void
}) => (
  <figure class="chart">
    <figcaption class="muted">
      {props.chart.service} {props.chart.panel}
      {props.chart.unit === undefined ? "" : ` (${props.chart.unit})`}, {props.chart.environment}
    </figcaption>
    <Plot
      label={`${props.chart.service} ${props.chart.panel} in ${props.chart.environment}, as kept`}
      points={props.chart.points}
      end={props.set.window.end * 1000}
      span={(props.set.window.end - props.set.window.start) * 1000}
      width={300}
      height={110}
      pad={4}
      ink="#8FB0FF"
      baseline
      mark={props.mark}
      onMark={props.onMark}
      shade={props.shade}
      marks={props.marks}
    />
  </figure>
)

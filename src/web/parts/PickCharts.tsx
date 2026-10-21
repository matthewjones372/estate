/** @jsxImportSource solid-js */
/**
 * One *Include charts…* for a panel of charts (spec 0063): it turns on a box on each chart, and what is ticked goes to
 * the incident at once, each chart over the range on screen.
 */
import { createSignal } from "solid-js"
import { useSnapshot } from "../context"
import { IncludeInIncident } from "./IncludeInIncident"

/** What a chart asks of its panel while charts are being picked. */
export interface Picking {
  readonly on: () => boolean
  readonly has: (panel: string) => boolean
  readonly toggle: (panel: string) => void
}

export const pickingCharts = () => {
  const [on, setOn] = createSignal(false)
  const [picked, setPicked] = createSignal<ReadonlySet<string>>(new Set())
  const toggle = (panel: string) => {
    const next = new Set(picked())
    if (next.has(panel)) next.delete(panel)
    else next.add(panel)
    setPicked(next)
  }
  const choosing = (now: boolean) => {
    setOn(now)
    if (!now) setPicked(new Set<string>())
  }
  const picking: Picking = { on, has: (panel) => picked().has(panel), toggle }
  return { picking, picked, choosing }
}

export const IncludeCharts = (props: {
  readonly service: string
  readonly charts: ReturnType<typeof pickingCharts>
  /** The range on screen, as the server reads it again. */
  readonly range: () => { readonly from: string; readonly to: string }
}) => {
  const snapshot = useSnapshot()
  return (
    <IncludeInIncident
      label="Include charts…"
      hint="Tick the charts to include."
      onChoosing={props.charts.choosing}
      what={() =>
        [...props.charts.picked()].map((panel) => ({
          kind: "chart" as const,
          environment: snapshot.environment,
          service: props.service,
          panel,
          ...props.range(),
        }))
      }
    />
  )
}

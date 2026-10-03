/** @jsxImportSource solid-js */
/** A metric over the last hour, drawn small; amber when it is the thing that needs someone. Pointing reads a point. */
import { createMemo, createSignal, on } from "solid-js"
import type { Series } from "../../shared/events"
import { reading } from "../chart"
import { useEstate } from "../context"
import { clock, measured } from "../format"
import { Plot } from "./Plot"

const hour = 3_600_000

export const Spark = (props: {
  readonly label: string
  readonly series: Series | undefined
  readonly unit?: string
  readonly alarm?: boolean
}) => {
  const { now } = useEstate()
  const [mark, setMark] = createSignal<number | undefined>(undefined)
  const points = () => props.series?.points ?? []
  // When the series was last read: the times of its points move on as it does.
  const end = createMemo(on(() => props.series, now))
  const read = () => reading(points(), end(), hour, mark())
  const current = () => measured(props.series?.now, props.unit)
  return (
    <div class="spark">
      <span class="spark-label">
        <span>{read() === undefined ? props.label : clock(new Date(read()?.at ?? 0).toISOString())}</span>
        <span class="mono spark-now" style={{ color: props.alarm ? "var(--amber-text)" : undefined }}>
          {read() === undefined ? current() : measured(read()?.value, props.unit)}
        </span>
      </span>
      <Plot
        label={`${props.label} over the last hour, now ${current()}`}
        points={points()}
        end={end()}
        span={hour}
        width={120}
        height={34}
        headroom={1}
        ink={props.alarm ? "var(--amber)" : "var(--quiet)"}
        stroke={1.5}
        mark={mark()}
        onMark={setMark}
      />
    </div>
  )
}

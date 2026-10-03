/** A metric over the last hour, drawn small; amber when it is the thing that needs someone. Pointing reads a point. */
import { useState } from "react"
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
  const [mark, setMark] = useState<number | undefined>(undefined)
  const points = props.series?.points ?? []
  const end = now()
  const read = reading(points, end, hour, mark)
  const ink = props.alarm ? "var(--amber)" : "var(--quiet)"
  const current = measured(props.series?.now, props.unit)
  return (
    <div className="spark">
      <span className="spark-label">
        <span>{read === undefined ? props.label : clock(new Date(read.at).toISOString())}</span>
        <span className="mono spark-now" style={{ color: props.alarm ? "var(--amber-text)" : undefined }}>
          {read === undefined ? current : measured(read.value, props.unit)}
        </span>
      </span>
      <Plot
        label={`${props.label} over the last hour, now ${current}`}
        points={points}
        end={end}
        span={hour}
        width={120}
        height={34}
        headroom={1}
        ink={ink}
        stroke={1.5}
        mark={mark}
        onMark={setMark}
      />
    </div>
  )
}

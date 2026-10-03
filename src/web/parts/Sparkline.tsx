/** A metric over the last hour, drawn small; amber when it is the thing that needs someone. */
import type { Series } from "../../shared/events"
import { shape } from "../chart"
import { measured } from "../format"

export const Spark = (props: {
  readonly label: string
  readonly series: Series | undefined
  readonly unit?: string
  readonly alarm?: boolean
}) => {
  const points = props.series?.points ?? []
  const drawn = shape(points, 120, 34)
  const ink = props.alarm ? "var(--amber)" : "var(--quiet)"
  const now = measured(props.series?.now, props.unit)
  return (
    <div className="spark">
      <span className="spark-label">
        <span>{props.label}</span>
        <span className="mono spark-now" style={{ color: props.alarm ? "var(--amber-text)" : undefined }}>
          {now}
        </span>
      </span>
      <svg
        viewBox="0 0 120 34"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${props.label} over the last hour, now ${now}`}
      >
        {drawn.area !== "" && <polygon points={drawn.area} fill={ink} fillOpacity="0.14" />}
        <polyline
          points={drawn.line}
          fill="none"
          stroke={ink}
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

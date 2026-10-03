/**
 * A hand-drawn chart that can be read: pointing at it, or stepping with the keys, marks the nearest point; dragging
 * across it zooms to that span. The mark is a moment, not an index, so charts of one range can share it.
 */
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useState } from "react"
import { indexAt, shape, timeOf, visible, whole, type Zoom } from "../chart"

export interface PlotProps {
  readonly label: string
  readonly points: ReadonlyArray<number | null>
  /** When the last point was read, and how long the points span. */
  readonly end: number
  readonly span: number
  readonly width: number
  readonly height: number
  readonly pad?: number
  /** The least the top of the chart may be, so a flat line near zero is not drawn as a cliff. */
  readonly headroom?: number
  readonly ink: string
  readonly fill?: number
  readonly stroke?: number
  readonly limit?: { readonly value: number; readonly ink: string }
  readonly baseline?: boolean
  readonly mark: number | undefined
  readonly onMark: (at: number | undefined) => void
  /** Given, the chart takes focus and answers to the arrow keys. */
  readonly keys?: boolean
  readonly zoom?: Zoom
  readonly onZoom?: (zoom: Zoom) => void
  readonly style?: CSSProperties
}

const across = (event: PointerEvent<SVGSVGElement>): number => {
  const box = event.currentTarget.getBoundingClientRect()
  return box.width === 0 ? 0 : Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
}

export const Plot = (props: PlotProps) => {
  const zoom = props.zoom ?? whole
  const count = props.points.length
  const { shown, first } = visible(props.points, zoom)
  const known = shown.filter((point): point is number => point !== null)
  const high = Math.max(...known, props.headroom ?? 0, 0.000001)
  const drawn = shape(shown, props.width, props.height, { pad: props.pad ?? 3, low: 0, high })
  const [dragging, setDragging] = useState<{ readonly from: number; readonly to: number } | undefined>(undefined)

  const step = shown.length > 1 ? props.width / (shown.length - 1) : 0
  const markAt = (fraction: number) =>
    props.onMark(timeOf(first + Math.round(fraction * (shown.length - 1)), count, props.end, props.span))
  const marked = props.mark === undefined ? undefined : indexAt(props.mark, count, props.end, props.span) - first
  const inView = marked !== undefined && marked >= 0 && marked < shown.length ? marked : undefined
  const value = inView === undefined ? undefined : shown[inView]

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const fraction = across(event)
    markAt(fraction)
    if (dragging !== undefined) setDragging({ ...dragging, to: fraction })
  }
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (props.onZoom === undefined || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const fraction = across(event)
    setDragging({ from: fraction, to: fraction })
  }
  const up = () => {
    if (dragging === undefined) return
    setDragging(undefined)
    const low = Math.min(dragging.from, dragging.to)
    const high = Math.max(dragging.from, dragging.to)
    if (high - low < 0.03 || props.onZoom === undefined) return
    const width = zoom.to - zoom.from
    props.onZoom({ from: zoom.from + low * width, to: zoom.from + high * width })
  }
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    const at = inView ?? shown.length - 1
    const to = {
      ArrowLeft: Math.max(0, at - 1),
      ArrowRight: Math.min(shown.length - 1, at + 1),
      Home: 0,
      End: shown.length - 1,
    }[event.key]
    if (event.key === "Escape") props.onMark(undefined)
    else if (to === undefined) return
    else props.onMark(timeOf(first + to, count, props.end, props.span))
    event.preventDefault()
  }

  const x = inView === undefined ? 0 : inView * step
  return (
    <div className="plot">
      <svg
        viewBox={`0 0 ${props.width} ${props.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={props.label}
        style={props.style}
        tabIndex={props.keys === true ? 0 : undefined}
        onPointerMove={move}
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={() => dragging === undefined && props.onMark(undefined)}
        onKeyDown={props.keys === true ? key : undefined}
        onBlur={() => props.onMark(undefined)}
      >
        {props.baseline === true && (
          <line
            x1="0"
            y1={props.height - 1}
            x2={props.width}
            y2={props.height - 1}
            stroke="#232836"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {drawn.area !== "" && <polygon points={drawn.area} fill={props.ink} fillOpacity={props.fill ?? 0.14} />}
        {props.limit !== undefined && (
          <line
            x1="0"
            y1={drawn.y(props.limit.value)}
            x2={props.width}
            y2={drawn.y(props.limit.value)}
            stroke={props.limit.ink}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={drawn.line}
          fill="none"
          stroke={props.ink}
          strokeWidth={props.stroke ?? 2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {dragging !== undefined && (
          <rect
            className="plot-span"
            x={Math.min(dragging.from, dragging.to) * props.width}
            y="0"
            width={Math.abs(dragging.to - dragging.from) * props.width}
            height={props.height}
          />
        )}
        {inView !== undefined && (
          <line className="plot-mark" x1={x} y1="0" x2={x} y2={props.height} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {value !== undefined && value !== null && (
        <span
          className="plot-dot"
          style={{
            left: `${(x / props.width) * 100}%`,
            top: `${(drawn.y(value) / props.height) * 100}%`,
            background: props.ink,
          }}
        />
      )}
    </div>
  )
}

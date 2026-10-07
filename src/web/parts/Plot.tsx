/** @jsxImportSource solid-js */
/**
 * A hand-drawn chart that can be read: pointing at it, or stepping with the keys, marks the nearest point; dragging
 * across it zooms to that span. The mark is a moment, not an index, so charts of one range can share it.
 */
import { createMemo, createSignal, type JSX, Show } from "solid-js"
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
  readonly limit?: { readonly value: number; readonly ink: string } | undefined
  readonly baseline?: boolean
  readonly mark: number | undefined
  readonly onMark: (at: number | undefined) => void
  /** Given, the chart takes focus and answers to the arrow keys. */
  readonly keys?: boolean
  readonly zoom?: Zoom
  readonly onZoom?: (zoom: Zoom) => void
  /** A span of time to shade, such as when an alert fired, as times like `end`. */
  readonly shade?: { readonly from: number; readonly to: number } | undefined
  readonly style?: JSX.CSSProperties
}

type Pointer = PointerEvent & { readonly currentTarget: SVGSVGElement }

const across = (event: Pointer): number => {
  const box = event.currentTarget.getBoundingClientRect()
  return box.width === 0 ? 0 : Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
}

export const Plot = (props: PlotProps) => {
  const zoom = () => props.zoom ?? whole
  const count = () => props.points.length
  const view = createMemo(() => visible(props.points, zoom()))
  const drawn = createMemo(() => {
    const known = view().shown.filter((point): point is number => point !== null)
    const high = Math.max(...known, props.headroom ?? 0, 0.000001)
    return shape(view().shown, props.width, props.height, { pad: props.pad ?? 3, low: 0, high })
  })
  const [dragging, setDragging] = createSignal<{ readonly from: number; readonly to: number } | undefined>(undefined)

  const step = () => (view().shown.length > 1 ? props.width / (view().shown.length - 1) : 0)
  const timeAt = (index: number) => timeOf(view().first + index, count(), props.end, props.span)
  const inView = () => {
    if (props.mark === undefined) return undefined
    const marked = indexAt(props.mark, count(), props.end, props.span) - view().first
    return marked >= 0 && marked < view().shown.length ? marked : undefined
  }
  const value = () => {
    const at = inView()
    return at === undefined ? undefined : (view().shown[at] ?? undefined)
  }
  const x = () => (inView() ?? 0) * step()
  /** Where a time falls across the chart as zoomed, from 0 to 1, held to its edges. */
  const placed = (time: number) => {
    const share = (time - (props.end - props.span)) / props.span
    return Math.max(0, Math.min(1, (share - zoom().from) / (zoom().to - zoom().from)))
  }

  const move = (event: Pointer) => {
    const fraction = across(event)
    props.onMark(timeAt(Math.round(fraction * (view().shown.length - 1))))
    const drag = dragging()
    if (drag !== undefined) setDragging({ ...drag, to: fraction })
  }
  const down = (event: Pointer) => {
    if (props.onZoom === undefined || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const fraction = across(event)
    setDragging({ from: fraction, to: fraction })
  }
  const up = () => {
    const drag = dragging()
    if (drag === undefined) return
    setDragging(undefined)
    const low = Math.min(drag.from, drag.to)
    const high = Math.max(drag.from, drag.to)
    if (high - low < 0.03 || props.onZoom === undefined) return
    const width = zoom().to - zoom().from
    props.onZoom({ from: zoom().from + low * width, to: zoom().from + high * width })
  }
  const key = (event: KeyboardEvent) => {
    const last = view().shown.length - 1
    const at = inView() ?? last
    const to = { ArrowLeft: Math.max(0, at - 1), ArrowRight: Math.min(last, at + 1), Home: 0, End: last }[event.key]
    if (event.key === "Escape") props.onMark(undefined)
    else if (to === undefined) return
    else props.onMark(timeAt(to))
    event.preventDefault()
  }

  return (
    <div class="plot">
      <svg
        viewBox={`0 0 ${props.width} ${props.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={props.label}
        style={props.style}
        tabindex={props.keys === true ? 0 : undefined}
        onPointerMove={move}
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={() => dragging() === undefined && props.onMark(undefined)}
        onKeyDown={(event) => props.keys === true && key(event)}
        onBlur={() => props.onMark(undefined)}
      >
        <Show when={props.baseline === true}>
          <line
            x1="0"
            y1={props.height - 1}
            x2={props.width}
            y2={props.height - 1}
            stroke="#232836"
            vector-effect="non-scaling-stroke"
          />
        </Show>
        <Show when={props.shade}>
          {(shade) => (
            <rect
              class="plot-firing"
              x={placed(shade().from) * props.width}
              y="0"
              width={(placed(shade().to) - placed(shade().from)) * props.width}
              height={props.height}
            />
          )}
        </Show>
        <Show when={drawn().area !== ""}>
          <polygon points={drawn().area} fill={props.ink} fill-opacity={props.fill ?? 0.14} />
        </Show>
        <Show when={props.limit}>
          {(limit) => (
            <line
              x1="0"
              y1={drawn().y(limit().value)}
              x2={props.width}
              y2={drawn().y(limit().value)}
              stroke={limit().ink}
              stroke-dasharray="4 4"
              vector-effect="non-scaling-stroke"
            />
          )}
        </Show>
        <polyline
          points={drawn().line}
          fill="none"
          stroke={props.ink}
          stroke-width={props.stroke ?? 2}
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
        <Show when={dragging()}>
          {(drag) => (
            <rect
              class="plot-span"
              x={Math.min(drag().from, drag().to) * props.width}
              y="0"
              width={Math.abs(drag().to - drag().from) * props.width}
              height={props.height}
            />
          )}
        </Show>
        <Show when={inView() !== undefined}>
          <line class="plot-mark" x1={x()} y1="0" x2={x()} y2={props.height} vector-effect="non-scaling-stroke" />
        </Show>
      </svg>
      <Show when={value() !== undefined}>
        <span
          class="plot-dot"
          style={{
            left: `${(x() / props.width) * 100}%`,
            top: `${(drawn().y(value() ?? 0) / props.height) * 100}%`,
            background: props.ink,
          }}
        />
      </Show>
    </div>
  )
}

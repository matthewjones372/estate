/** @jsxImportSource solid-js */
/** What a trace's lanes and its waterfall share: where time falls on the track, the cut, the marks, the chosen step. */
import { Show } from "solid-js"
import type { Row, TraceView } from "../../shared/trace-view"
import { took } from "../format"

export type Scale = "cut" | "true"

/** What the lanes and the waterfall share: where time falls, and which step is chosen. */
export interface Drawn {
  readonly view: TraceView
  readonly place: (at: number) => number
  readonly scale: Scale
  readonly chosen: number | undefined
  readonly choose: (row: number) => void
}

export const percent = (share: number) => `${share.toFixed(3)}%`

/** Where a row's bar sits across its track. */
export const barAt = (row: Row, place: (at: number) => number) => {
  const left = place(row.from)
  return { left: percent(left), width: percent(Math.max(place(row.to) - left, 0.4)) }
}

export const kindWords: Readonly<Record<Row["kind"], string>> = {
  call: "a call, waiting on what it called",
  work: "work",
  wait: "waiting between two spans",
}

export const labelOf = (view: TraceView, row: Row) =>
  `${row.title}, ${view.lanes[row.lane]?.title ?? ""}, ${took(row.to - row.from)}${row.failed ? ", failed" : ""}`

export const hot = (view: TraceView, row: Row) => row.kind === "wait" && row.from === view.cut?.from

export const CutBand = (props: Drawn) => (
  <Show when={props.scale === "cut" ? props.view.cut : undefined}>
    {(cut) => (
      <span
        class="trace-cut"
        aria-hidden="true"
        style={{
          left: percent(props.place(cut().from)),
          width: percent(props.place(cut().to) - props.place(cut().from)),
        }}
      />
    )}
  </Show>
)

export const Marks = (props: Drawn) => (
  <>
    <Show when={props.view.answered}>
      {(answered) => (
        <span class="trace-mark trace-answer" aria-hidden="true" style={{ left: percent(props.place(answered())) }} />
      )}
    </Show>
    <span class="trace-mark" aria-hidden="true" style={{ left: percent(props.place(props.view.total)) }} />
  </>
)

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
  /** Each stage's usual time, where the journey's sample has been read. */
  readonly usual?: Usual | undefined
}

/** Each stage's usual time, its p50 over the journey's recent traces, by the stage's place in the journey. */
export type Usual = ReadonlyArray<number | undefined>

/** A step against its stage's usual time: slow from half as long again, which is when it is worth a look. */
export const against = (row: Row, usual: Usual | undefined) => {
  const p50 = row.stage === undefined ? undefined : usual?.[row.stage]
  if (p50 === undefined || p50 <= 0) return undefined
  const ratio = (row.to - row.from) / p50
  const slow = ratio >= 1.5
  return {
    p50,
    slow,
    words: slow ? `${ratio.toFixed(1)}× usual` : ratio <= 0.67 ? "quicker than usual" : "about usual",
  }
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

export const labelOf = (view: TraceView, row: Row, compared?: string) =>
  `${row.title}, ${view.lanes[row.lane]?.title ?? ""}, ${took(row.to - row.from)}${row.failed ? ", failed" : ""}${
    compared === undefined ? "" : `, ${compared}`
  }`

/** The wait the cut is in: the longest, where most of the time goes. */
export const hot = (view: TraceView, row: Row) =>
  row.kind === "wait" && view.cut !== undefined && row.from <= view.cut.from && row.to >= view.cut.to

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

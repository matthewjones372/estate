/** @jsxImportSource solid-js */
/** A trace in lanes: a row for each part of the estate it crossed, its spans placed in time, hand-offs between them. */
import { For, Show } from "solid-js"
import type { Row, TraceView } from "../../shared/trace-view"
import { took } from "../format"
import { barAt, CutBand, type Drawn, hot, labelOf, Marks, percent } from "./TraceDrawn"

const LaneHeight = 64

/** A call inside another in its lane is drawn inside it, so their outlines and names do not sit on one another. */
const laneTop = (row: Row) => {
  if (row.kind !== "call") return { top: 22, height: 24 }
  const inset = Math.min(row.nested, 2) * 7
  return { top: 4 + inset, height: 56 - 2 * inset }
}

/**
 * A bar names itself only when its name fits, roughly, in the share of the track it has; a call never does, since its
 * name sits on the spans inside it. The longest wait always does, past its end if need be. The rest are named when
 * chosen, and in the waterfall.
 */
const labelled = (view: TraceView, row: Row, place: (at: number) => number) =>
  hot(view, row) || (row.kind !== "call" && place(row.to) - place(row.from) >= Math.max(6, row.title.length * 0.62))

export const Lanes = (props: Drawn) => {
  const handed = () => props.view.rows.filter((row) => row.handedFrom !== undefined)
  return (
    <div class="trace-lanes">
      <div class="trace-lane-names" aria-hidden="true">
        <For each={props.view.lanes}>{(lane) => <div class="trace-lane-name">{lane.title}</div>}</For>
      </div>
      <div class="trace-tracks" style={{ height: `${props.view.lanes.length * LaneHeight}px` }}>
        <For each={props.view.lanes}>
          {(_, index) => <div class="trace-track" aria-hidden="true" style={{ top: `${index() * LaneHeight}px` }} />}
        </For>
        <CutBand {...props} />
        <Marks {...props} />
        <For each={handed()}>
          {(row) => {
            const [from, to] = [row.handedFrom ?? 0, row.lane]
            return (
              <span
                class="trace-handoff"
                aria-hidden="true"
                classList={{ "trace-handoff-up": to < from }}
                style={{
                  left: percent(props.place(row.from)),
                  top: `${Math.min(from, to) * LaneHeight + LaneHeight / 2}px`,
                  height: `${Math.abs(to - from) * LaneHeight}px`,
                }}
              />
            )
          }}
        </For>
        <For each={props.view.rows}>
          {(row, index) => (
            <button
              type="button"
              class={`trace-bar trace-${row.kind}`}
              classList={{
                "trace-failed": row.failed,
                "trace-hot": hot(props.view, row),
                "trace-nested": row.nested > 0,
              }}
              aria-label={labelOf(props.view, row)}
              aria-pressed={props.chosen === index()}
              title={`${row.title}: ${took(row.to - row.from)}`}
              onClick={() => props.choose(index())}
              style={{
                ...barAt(row, props.place),
                top: `${row.lane * LaneHeight + laneTop(row).top}px`,
                height: `${laneTop(row).height}px`,
              }}
            >
              <Show when={labelled(props.view, row, props.place)}>
                <span class="trace-bar-label">{row.title}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

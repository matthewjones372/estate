/** @jsxImportSource solid-js */
/** A trace as a waterfall, a row per span or wait in time order, and the step chosen in it or in the lanes. */
import { For, Show } from "solid-js"
import type { Row, TraceView } from "../../shared/trace-view"
import { took } from "../format"
import { against, barAt, CutBand, type Drawn, hot, kindWords, Marks, type Usual } from "./TraceDrawn"

export const Waterfall = (props: Drawn) => (
  <div class="table-box">
    <table class="trace-waterfall">
      <thead>
        <tr>
          <th scope="col">Step</th>
          <th scope="col">Where</th>
          <th scope="col" class="trace-timeline-head">
            When
          </th>
          <th scope="col" class="number">
            Took
          </th>
          <Show when={props.usual}>
            <th scope="col" class="number">
              Against usual
            </th>
          </Show>
        </tr>
      </thead>
      <tbody>
        <For each={props.view.rows}>
          {(row, index) => (
            <tr classList={{ "trace-row-wait": row.kind === "wait", "trace-row-chosen": props.chosen === index() }}>
              <th scope="row" style={{ "padding-left": `${8 + row.depth * 14}px` }}>
                <button
                  type="button"
                  class="trace-step"
                  aria-pressed={props.chosen === index()}
                  onClick={() => props.choose(index())}
                >
                  {row.title}
                </button>
                <span class="mono muted trace-text">{row.text}</span>
              </th>
              <td>{props.view.lanes[row.lane]?.title}</td>
              <td class="trace-timeline">
                <CutBand {...props} />
                <Marks {...props} />
                <span
                  class={`trace-bar trace-${row.kind}`}
                  aria-hidden="true"
                  classList={{ "trace-failed": row.failed, "trace-hot": hot(props.view, row) }}
                  style={barAt(row, props.place)}
                />
              </td>
              <td class="number mono">
                {took(row.to - row.from)}
                <Show when={row.failed}>
                  <span class="trace-failed-word"> failed</span>
                </Show>
              </td>
              <Show when={props.usual}>
                <td class="number">
                  <Show when={against(row, props.usual)}>
                    {(compared) => (
                      <span classList={{ "trace-slow-word": compared().slow }}>
                        {compared().words} <span class="muted mono">({took(compared().p50)})</span>
                      </span>
                    )}
                  </Show>
                </td>
              </Show>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  </div>
)

/** The chosen step: what it was, where, when it started and how long it took. */
export const Chosen = (props: { readonly view: TraceView; readonly row: Row; readonly usual?: Usual | undefined }) => (
  <section aria-label="The chosen step" class="trace-chosen" aria-live="polite">
    <p class="trace-chosen-title">
      {props.row.title}
      <span class="muted"> · {props.view.lanes[props.row.lane]?.title}</span>
      <Show when={props.row.failed}>
        <span class="trace-failed-word"> · failed</span>
      </Show>
    </p>
    <dl class="trace-facts">
      <dt>Took</dt>
      <dd class="mono">{took(props.row.to - props.row.from)}</dd>
      <Show when={against(props.row, props.usual)}>
        {(compared) => (
          <>
            <dt>Usually</dt>
            <dd>
              <span class="mono">{took(compared().p50)}</span>, the p50 of its recent traces:{" "}
              <span classList={{ "trace-slow-word": compared().slow }}>{compared().words}</span>
            </dd>
          </>
        )}
      </Show>
      <dt>Started</dt>
      <dd class="mono">{took(props.row.from)} in</dd>
      <dt>Is</dt>
      <dd>{kindWords[props.row.kind]}</dd>
      <dt>From the trace</dt>
      <dd class="mono">{props.row.text}</dd>
      <Show when={props.row.handedFrom}>
        {(from) => (
          <>
            <dt>Came from</dt>
            <dd>{props.view.lanes[from()]?.title}</dd>
          </>
        )}
      </Show>
    </dl>
  </section>
)

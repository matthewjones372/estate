/** @jsxImportSource solid-js */
/**
 * One trace: in lanes, a row for each part of the estate it crossed with hand-offs between them, or as a waterfall
 * of its spans and the waits between them in time order. A wait longer than half the trace can be drawn short, so the
 * spans around it can be read. Choosing a step, in either, says what it was. Read once, for the environment the page
 * is in (spec 0046).
 */
import { createEffect, createSignal, For, on, Show } from "solid-js"
import { placeOf, type TraceView } from "../../shared/trace-view"
import { useEstate, useSnapshot } from "../context"
import { took } from "../format"
import { A } from "../parts/A"
import type { Drawn, Scale } from "../parts/TraceDrawn"
import { Lanes } from "../parts/TraceLanes"
import { Chosen, Waterfall } from "../parts/TraceWaterfall"

type Shown = "lanes" | "waterfall"

const Toggle = <T extends string>(props: {
  readonly label: string
  readonly options: ReadonlyArray<readonly [T, string]>
  readonly value: T
  readonly choose: (value: T) => void
}) => (
  <fieldset class="choices">
    <legend class="visually-hidden">{props.label}</legend>
    <For each={props.options}>
      {([value, words]) => (
        <button type="button" class="choice" aria-pressed={props.value === value} onClick={() => props.choose(value)}>
          {words}
        </button>
      )}
    </For>
  </fieldset>
)

const Read = (props: { readonly view: TraceView }) => {
  const [shown, setShown] = createSignal<Shown>("lanes")
  const [scale, setScale] = createSignal<Scale>("cut")
  const [chosen, setChosen] = createSignal<number | undefined>()
  const choose = (row: number) => setChosen((now) => (now === row ? undefined : row))
  const drawn = (): Drawn => ({
    view: props.view,
    place: placeOf(props.view.total, scale() === "cut" ? props.view.cut : undefined),
    scale: scale(),
    chosen: chosen(),
    choose,
  })
  const row = () => {
    const at = chosen()
    return at === undefined ? undefined : props.view.rows[at]
  }
  return (
    <>
      <p class="lede">
        Took {took(props.view.total)} from its first span to its last
        <Show when={props.view.answered}>{(answered) => <>; the caller had an answer in {took(answered())}</>}</Show>.
        <Show when={props.view.cut}>{(cut) => <> It waited {took(cut().to - cut().from)} in one place.</>}</Show>
      </p>
      <div class="trace-controls">
        <Toggle
          label="Drawn as"
          options={[
            ["lanes", "Lanes"],
            ["waterfall", "Waterfall"],
          ]}
          value={shown()}
          choose={setShown}
        />
        <Show when={props.view.cut !== undefined}>
          <Toggle
            label="Time scale"
            options={[
              ["cut", "Waits cut short"],
              ["true", "True scale"],
            ]}
            value={scale()}
            choose={setScale}
          />
        </Show>
      </div>
      <section aria-label="The trace" class="panel section-box">
        <Show when={shown() === "lanes"} fallback={<Waterfall {...drawn()} />}>
          <Lanes {...drawn()} />
        </Show>
        <Show
          when={row()}
          fallback={<p class="muted trace-hint">Choose a step to see what it was, where, and how long it took.</p>}
        >
          {(found) => <Chosen view={props.view} row={found()} />}
        </Show>
        <p class="muted trace-legend">
          <span class="trace-key trace-work" /> work <span class="trace-key trace-call" /> a call, waiting on others{" "}
          <span class="trace-key trace-wait" /> waiting between spans <span class="trace-key trace-answer-key" /> the
          caller's answer
        </p>
      </section>
    </>
  )
}

export const TracePage = (props: { readonly id: string; readonly journey?: string | undefined }) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [read, setRead] = createSignal<TraceView | "none" | "loading" | undefined>("loading")
  createEffect(
    on([() => props.id, () => props.journey, () => snapshot.environment], ([id, journey]) => {
      setRead("loading")
      void actions.trace(id, journey).then(setRead)
    }),
  )
  const found = () => {
    const now = read()
    return typeof now === "object" ? now : undefined
  }
  return (
    <main class="main">
      <section aria-labelledby="trace-title" class="stack">
        <nav aria-label="Breadcrumb" class="muted crumbs">
          <A to="/">Overview</A> / {found()?.journey?.title ?? "Trace"} / <span class="mono">{props.id}</span>
        </nav>
        <h1 id="trace-title" class="headline" style={{ "font-size": "32px" }}>
          {found()?.journey?.title ?? "A trace"}
        </h1>
        <Show when={read() !== "loading"} fallback={<p class="muted">Reading the trace…</p>}>
          <Show
            when={found()}
            fallback={
              <p class="muted">
                {read() === "none"
                  ? `Trace ${props.id} is not in ${snapshot.environment}'s Tempo.`
                  : "The trace could not be read."}
              </p>
            }
          >
            {(view) => <Read view={view()} />}
          </Show>
        </Show>
      </section>
    </main>
  )
}

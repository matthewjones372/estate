/** @jsxImportSource solid-js */
/**
 * One of a journey's example traces in lanes, inside its panel on a service's page: read when it is picked, with its
 * long wait cut short and a step chosen to say what it was. Its own page has the waterfall and the true scale.
 */
import { createEffect, createSignal, on, Show } from "solid-js"
import { placeOf, type TraceView } from "../../shared/trace-view"
import { useEstate, useSnapshot } from "../context"
import { pathOf } from "../route"
import { A } from "./A"
import type { Usual } from "./TraceDrawn"
import { Lanes } from "./TraceLanes"
import { Chosen } from "./TraceWaterfall"

export const ExampleLanes = (props: {
  readonly journey: string
  readonly id: string
  readonly usual?: Usual | undefined
}) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [read, setRead] = createSignal<TraceView | "none" | "loading" | undefined>("loading")
  const [chosen, setChosen] = createSignal<number | undefined>()
  createEffect(
    on([() => props.id, () => props.journey, () => snapshot.environment], ([id, journey]) => {
      setRead("loading")
      setChosen(undefined)
      void actions.trace(id, journey).then(setRead)
    }),
  )
  const view = () => {
    const now = read()
    return typeof now === "object" ? now : undefined
  }
  const row = () => {
    const at = chosen()
    return at === undefined ? undefined : view()?.rows[at]
  }
  return (
    <div class="stack journey-lanes spaced">
      <Show when={read() !== "loading"} fallback={<p class="muted">Reading the trace…</p>}>
        <Show when={view()} fallback={<p class="muted">The trace could not be read.</p>}>
          {(found) => (
            <>
              <Lanes
                view={found()}
                place={placeOf(found().total, found().cut)}
                scale="cut"
                chosen={chosen()}
                choose={(at) => setChosen((now) => (now === at ? undefined : at))}
                usual={props.usual}
              />
              <Show
                when={row()}
                fallback={
                  <p class="muted trace-hint">Choose a step to see what it was, where, and how long it took.</p>
                }
              >
                {(step) => <Chosen view={found()} row={step()} usual={props.usual} />}
              </Show>
            </>
          )}
        </Show>
      </Show>
      <A to={pathOf({ page: "trace", id: props.id, journey: props.journey })}>Open this trace, as a waterfall too</A>
    </div>
  )
}

/** @jsxImportSource solid-js */
/** A request rate that jumped, said on the overview. Not an alert. */
import { For, Show } from "solid-js"
import type { Series } from "../../shared/events"
import { spikes } from "../spike"
import { A } from "./A"
import { Spark } from "./Sparkline"

const hour = 3_600_000

type Named = { readonly name: string; readonly load: { readonly requests?: Series } }

/** Services whose request rate jumped in the hour. The headline and Needs you now stay as they are. */
const signalsOf = (services: ReadonlyArray<Named>): ReadonlyArray<string> =>
  services
    .filter((service) => spikes(service.load.requests?.points ?? [], hour).length > 0)
    .map((service) => service.name)

/** The same sentence above a service's Load charts, for the range on screen. */
export const TrafficSpike = (props: {
  readonly points: ReadonlyArray<number | null> | undefined
  readonly span: number
}) => (
  <Show when={spikes(props.points ?? [], props.span).length > 0}>
    <p class="muted" style={{ margin: 0 }}>
      Unusual spike in traffic.
    </p>
  </Show>
)

export const Signals = (props: { readonly services: ReadonlyArray<Named> | undefined }) => {
  const signals = () => signalsOf(props.services ?? [])
  return (
    <Show when={signals().length > 0}>
      <section aria-labelledby="signals" class="stack">
        <h2 id="signals" class="section-title">
          Interesting signals
        </h2>
        <div class="signal-rows">
          <For each={signals()}>
            {(name) => {
              const service = () => props.services?.find((each) => each.name === name)
              return (
                <div class="signal-row">
                  <A to={`/services/${encodeURIComponent(name)}`}>Unusual spike in traffic to {name}</A>
                  <Spark label="Requests" unit="/s" series={service()?.load.requests} spike />
                </div>
              )
            }}
          </For>
        </div>
      </section>
    </Show>
  )
}

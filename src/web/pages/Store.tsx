/** @jsxImportSource solid-js */
/** A store in the chosen environment: its health, its stats over a range, and the alerts about it. */
import { For, Show } from "solid-js"
import { useEstate, useSnapshot } from "../context"
import { A } from "../parts/A"
import { AlertCard } from "../parts/AlertCard"
import { Load, Timeline } from "../parts/Charts"
import { HealthLine, Links } from "../parts/Lane"

export const StorePage = (props: { readonly name: string }) => {
  const { actions, me, now } = useEstate()
  const snapshot = useSnapshot()
  const events = () => snapshot.events
  const store = () => events().catalog?.stores?.find((each) => each.name === props.name)
  const state = () => events().services?.stores?.find((each) => each.name === props.name)
  const alerts = () => (events().alerts?.alerts ?? []).filter((alert) => alert.store === props.name)
  const firing = () => alerts().filter((alert) => alert.state === "firing")
  const canSilence = () => me.role === "operator" && events().alerts?.silences === true
  return (
    <Show
      when={events().catalog === undefined || store() !== undefined}
      fallback={
        <main class="state-page">
          <h1>
            {props.name} is not in {snapshot.environment}.
          </h1>
          <A to="/">The overview</A>
        </main>
      }
    >
      <main class="main">
        <section aria-label={props.name} class="stack">
          <nav aria-label="Breadcrumb" class="muted crumbs">
            <A to="/">Overview</A> / {props.name}
          </nav>
          <h1 class="headline" style={{ "font-size": "38px" }}>
            {props.name}
          </h1>
          <HealthLine state={state()} />
          <Show when={(state()?.reasons ?? []).length > 1}>
            <ul class="reasons muted">
              <For each={state()?.reasons ?? []}>{(reason) => <li>{reason}</li>}</For>
            </ul>
          </Show>
          <p class="lede" style={{ "max-width": "760px" }}>
            {[store()?.description, store()?.engine].filter(Boolean).join(" · ")}
          </p>
          <Show when={store()}>{(described) => <Links service={described()} />}</Show>
        </section>
        <Load
          name={props.name}
          title="Stats"
          hour={state() === undefined ? undefined : { stats: state()?.stats ?? [] }}
          read={actions.storeLoad}
          alerts={alerts()}
        />
        <section aria-labelledby="store-alerts" class="stack">
          <h2 id="store-alerts" class="section-title">
            Alerts about it
          </h2>
          <Show when={firing().length === 0}>
            <p class="muted" style={{ margin: 0 }}>
              Nothing firing.
            </p>
          </Show>
          <div class="cards">
            <For each={firing()}>
              {(alert) => <AlertCard alert={alert} catalog={events().catalog} canSilence={canSilence()} />}
            </For>
          </div>
        </section>
        <section aria-labelledby="store-today" class="panel section-box">
          <h2 id="store-today" class="section-title">
            Alerts today
          </h2>
          <Timeline
            now={now()}
            alerts={[
              ...alerts().map((alert) => ({ id: alert.id, name: alert.name, startsAt: alert.startsAt })),
              ...(events().alerts?.resolved ?? [])
                .filter((each) => each.store === props.name)
                .map(({ alert, ...each }) => ({ id: alert, ...each })),
            ]}
          />
        </section>
      </main>
    </Show>
  )
}

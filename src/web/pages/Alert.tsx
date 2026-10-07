/** @jsxImportSource solid-js */
/**
 * One alert's own page, to share: what's happening, what is around it, who owns it, and Ask AI. The card carries the
 * links to the runbook, the logs and the team, so the page does not repeat them.
 */
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import type { PastFiring } from "../../shared/firing"
import { useEstate, useSnapshot } from "../context"
import { day, since } from "../format"
import { A } from "../parts/A"
import { AlertCard } from "../parts/AlertCard"
import { Around } from "../parts/Around"
import { AskAi } from "../parts/AskAi"
import { Owner } from "../parts/Team"
import { firingPath } from "../route"
import { teamOf } from "../teams"

/** Where an alert that no longer fires last fired here, if a firing of it is kept. */
const LastFiring = (props: { readonly id: string }) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [last, setLast] = createSignal<PastFiring | undefined>(undefined)
  createEffect(
    on([() => props.id, () => snapshot.environment], ([id]) => {
      let current = true
      void actions.firing(id).then((found) => {
        if (current) setLast(typeof found === "object" ? found : undefined)
      })
      onCleanup(() => {
        current = false
      })
    }),
  )
  return (
    <Show when={last()}>
      {(firing) => (
        <A to={firingPath(firing().alert, firing().startsAt)}>
          Its last firing, {firing().name} at {day(firing().startsAt)} ›
        </A>
      )}
    </Show>
  )
}

export const AlertPage = (props: { readonly id: string }) => {
  const { me, now } = useEstate()
  const snapshot = useSnapshot()
  const events = () => snapshot.events
  const alert = () => (events().alerts?.alerts ?? []).find((each) => each.id === props.id)
  const catalog = () => events().catalog
  const service = () => catalog()?.services.find((each) => each.name === alert()?.service)
  const canSilence = () => me.role === "operator" && events().alerts?.silences === true
  return (
    <Show
      when={alert()}
      fallback={
        <main class="state-page">
          <Show when={events().alerts !== undefined} fallback={<p class="muted">Reading the alerts…</p>}>
            <h1>
              {props.id} is not firing in {snapshot.environment} now.
            </h1>
            <LastFiring id={props.id} />
            <A to="/alerts">All alerts, and what resolved today</A>
          </Show>
        </main>
      }
    >
      {(found) => (
        <main class="main">
          <nav aria-label="Breadcrumb" class="muted crumbs">
            <A to="/">Overview</A> / <A to="/alerts">Alerts</A> / {found().name}
          </nav>
          <section aria-labelledby="alert-happening" class="stack">
            <h1 id="alert-happening" class="headline" style={{ "font-size": "32px" }}>
              What's happening
            </h1>
            <p class="lede">
              {found().severity} · firing {since(found().startsAt, now())}
              {found().service === undefined ? "" : ` · ${found().service}`} · {snapshot.environment}
            </p>
            <AlertCard alert={found()} catalog={catalog()} canSilence={canSilence()} level={2} />
          </section>
          {/* Keyed by the alert, so moving to another alert starts its brief and its answer afresh. */}
          <Show when={found().id} keyed>
            <section aria-labelledby="alert-around" class="stack">
              <h2 id="alert-around" class="section-title">
                Around this alert
              </h2>
              <Around alert={found()} />
            </section>
            <section aria-labelledby="alert-owns" class="stack">
              <h2 id="alert-owns" class="section-title">
                Who owns it
              </h2>
              <Owner owner={service()?.owner} team={teamOf(catalog(), service()?.owner)} />
            </section>
            <AskAi alert={found()} />
          </Show>
        </main>
      )}
    </Show>
  )
}

/** @jsxImportSource solid-js */
/**
 * One alert's own page, to share: what's happening, what is around it, who owns it, and Ask AI. The card carries the
 * links to the runbook, the logs and the team, so the page does not repeat them.
 */
import { Show } from "solid-js"
import { useEstate, useSnapshot } from "../context"
import { since } from "../format"
import { A } from "../parts/A"
import { AlertCard } from "../parts/AlertCard"
import { Around } from "../parts/Around"
import { AskAi } from "../parts/AskAi"
import { Owner } from "../parts/Team"
import { teamOf } from "../teams"

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

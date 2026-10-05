/** @jsxImportSource solid-js */
/**
 * One alert's permalink: what's happening, what changed, who owns it, the environment, where to look, and Ask AI.
 */
import { Show } from "solid-js"
import { useEstate, useSnapshot } from "../context"
import { since } from "../format"
import { A, Out } from "../parts/A"
import { AlertCard } from "../parts/AlertCard"
import { Around } from "../parts/Around"
import { AskAi } from "../parts/AskAi"
import { RaiseIncident } from "../parts/RaiseIncident"
import { Owner } from "../parts/Team"
import { chatOf, teamOf } from "../teams"

export const AlertPage = (props: { readonly id: string }) => {
  const { me, now } = useEstate()
  const snapshot = useSnapshot()
  const events = () => snapshot.events
  const alert = () => (events().alerts?.alerts ?? []).find((each) => each.id === props.id)
  const catalog = () => events().catalog
  const service = () => catalog()?.services.find((each) => each.name === alert()?.service)
  const canSilence = () => me.role === "operator" && events().alerts?.silences === true
  const chat = () => chatOf(teamOf(catalog(), service()?.owner))
  const link = (name: string) => service()?.links.find((each) => each.name === name)
  return (
    <Show
      when={alert()}
      fallback={
        <main class="state-page">
          <h1>
            There is no alert {props.id} in {snapshot.environment}.
          </h1>
          <A to="/alerts">All alerts</A>
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
              {found().service === undefined ? "" : ` · ${found().service}`}
            </p>
            <AlertCard alert={found()} catalog={catalog()} canSilence={canSilence()} />
          </section>
          <section aria-labelledby="alert-changed" class="stack">
            <h2 id="alert-changed" class="section-title">
              What changed
            </h2>
            <Around alert={found()} />
          </section>
          <section aria-labelledby="alert-owns" class="stack">
            <h2 id="alert-owns" class="section-title">
              Who owns it
            </h2>
            <Owner owner={service()?.owner} team={teamOf(catalog(), service()?.owner)} />
            <Show when={chat()}>
              {(team) => (
                <Out href={team().url} class="amber-button ghost">
                  {team().text}
                </Out>
              )}
            </Show>
          </section>
          <section aria-labelledby="alert-env" class="stack">
            <h2 id="alert-env" class="section-title">
              Environment
            </h2>
            <p class="muted" style={{ margin: 0 }}>
              {catalog()?.environment ?? snapshot.environment}
            </p>
          </section>
          <section aria-labelledby="alert-investigate" class="stack">
            <h2 id="alert-investigate" class="section-title">
              Where to investigate
            </h2>
            <div class="choices">
              <Show when={found().runbook}>
                {(runbook) => (
                  <Out href={runbook()} class="primary-button">
                    Open the runbook
                  </Out>
                )}
              </Show>
              <RaiseIncident alert={found()} links={service()?.links} class="primary-button" />
              <Show when={found().service}>
                {(name) => (
                  <A to={`/services/${encodeURIComponent(name())}`} class="amber-button ghost">
                    {name()}
                  </A>
                )}
              </Show>
              <Show when={link("logs")}>
                {(logs) => (
                  <Out href={logs().url} class="amber-button ghost">
                    Logs
                  </Out>
                )}
              </Show>
              <Show when={link("traces")}>
                {(traces) => (
                  <Out href={traces().url} class="amber-button ghost">
                    Traces
                  </Out>
                )}
              </Show>
            </div>
          </section>
          <AskAi alert={found()} />
        </main>
      )}
    </Show>
  )
}

/** @jsxImportSource solid-js */
/**
 * A service in the chosen environment: what's happening, what changed, where to look, then load, logs and pods.
 * Alert → context → investigation, not a chart dashboard.
 */
import { For, Show } from "solid-js"
import { useEstate, useSnapshot } from "../context"
import { A } from "../parts/A"
import { Load, Timeline } from "../parts/Charts"
import { CodeLine } from "../parts/CodeLine"
import { CostLine } from "../parts/CostLine"
import { DebugPanel } from "../parts/Debug"
import { FoundEntry } from "../parts/Found"
import { Jobs } from "../parts/Jobs"
import { HealthLine, Links } from "../parts/Lane"
import { LogsPanel } from "../parts/Logs"
import { ServiceAlerts } from "../parts/ServiceAlerts"
import { ServiceBuilds } from "../parts/ServiceBuilds"
import { ServicePods } from "../parts/ServicePods"
import { Owner } from "../parts/Team"
import { Versions } from "../parts/Versions"
import { teamOf } from "../teams"

export const ServicePage = (props: { readonly name: string }) => {
  const { actions, me, now } = useEstate()
  const snapshot = useSnapshot()
  const events = () => snapshot.events
  const service = () => events().catalog?.services.find((each) => each.name === props.name)
  const state = () => events().services?.services.find((each) => each.name === props.name)
  const alerts = () => (events().alerts?.alerts ?? []).filter((alert) => alert.service === props.name)
  const resolved = () => (events().alerts?.resolved ?? []).filter((each) => each.service === props.name)
  const builds = () => events().deploys?.services.find((each) => each.name === props.name)?.builds ?? []
  const canSilence = () => me.role === "operator" && events().alerts?.silences === true
  const hasDebug = () => (service()?.debug?.levels?.length ?? 0) > 0
  return (
    <Show
      when={events().catalog === undefined || service() !== undefined}
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
            {[service()?.description, state()?.version === undefined ? undefined : `running ${state()?.version}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <CostLine cost={state()?.cost} />
          <CodeLine code={state()?.code} />
          <Versions name={props.name} />
          <Show when={service()}>{(described) => <Links service={described()} />}</Show>
          <Owner owner={service()?.owner} team={teamOf(events().catalog, service()?.owner)} />
          <FoundEntry discovered={service()?.discovered} />
        </section>
        <ServiceAlerts alerts={alerts()} catalog={events().catalog} canSilence={canSilence()} />
        <div class="row">
          <div class="stack" style={{ flex: "999 1 640px", "min-width": 0, gap: "24px" }}>
            <Load name={props.name} hour={state()?.load} read={actions.load} alerts={alerts()} />
            <LogsPanel service={props.name} />
            <ServicePods pods={state()?.pods ?? []} />
            <section aria-labelledby="jobs" class="stack">
              <h2 id="jobs" class="section-title">
                Jobs
              </h2>
              <Jobs jobs={state()?.jobs ?? []} />
            </section>
            <section aria-labelledby="today" class="panel section-box">
              <h2 id="today" class="section-title">
                Alerts today
              </h2>
              <Timeline
                now={now()}
                alerts={[...alerts().map((alert) => ({ name: alert.name, startsAt: alert.startsAt })), ...resolved()]}
              />
            </section>
          </div>
          <div class="stack" style={{ flex: "1 1 320px", "min-width": 0, gap: "24px" }}>
            <ServiceBuilds builds={builds()} />
            <Show when={hasDebug()}>
              <section aria-labelledby="debug" class="panel section-box">
                <h2 id="debug" class="section-title">
                  Debug logging
                </h2>
                <Show when={service()}>{(described) => <DebugPanel service={described()} state={state()} />}</Show>
              </section>
            </Show>
          </div>
        </div>
      </main>
    </Show>
  )
}

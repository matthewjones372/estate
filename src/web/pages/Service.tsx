/** @jsxImportSource solid-js */
/** A service in the chosen environment: its load over a range, its pods, its alerts today, debug, and builds. */
import { For, Show } from "solid-js"
import { useEstate, useSnapshot } from "../context"
import { since } from "../format"
import { A, Out } from "../parts/A"
import { Load, Timeline } from "../parts/Charts"
import { DebugPanel } from "../parts/Debug"
import { Jobs } from "../parts/Jobs"
import { HealthLine, Links } from "../parts/Lane"

export const ServicePage = (props: { readonly name: string }) => {
  const { now } = useEstate()
  const snapshot = useSnapshot()
  const events = () => snapshot.events
  const service = () => events().catalog?.services.find((each) => each.name === props.name)
  const state = () => events().services?.services.find((each) => each.name === props.name)
  const alerts = () => (events().alerts?.alerts ?? []).filter((alert) => alert.service === props.name)
  const resolved = () => (events().alerts?.resolved ?? []).filter((each) => each.service === props.name)
  const builds = () => events().deploys?.services.find((each) => each.name === props.name)?.builds ?? []
  const pods = () => state()?.pods ?? []
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
          <p class="lede" style={{ "max-width": "760px" }}>
            {[
              service()?.description,
              service()?.owner === undefined ? undefined : `Owner ${service()?.owner}`,
              state()?.version === undefined ? undefined : `running ${state()?.version}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <Show when={service()}>{(described) => <Links service={described()} />}</Show>
        </section>
        <div class="row">
          <div class="stack" style={{ flex: "999 1 640px", "min-width": 0, gap: "24px" }}>
            <Load name={props.name} state={state()} alerts={alerts()} />
            <section aria-labelledby="pods" class="stack">
              <h2 id="pods" class="section-title">
                Pods
              </h2>
              <Show when={pods().length === 0}>
                <p class="muted" style={{ margin: 0 }}>
                  No pods read for it here.
                </p>
              </Show>
              <div class="pods">
                <For each={pods()}>
                  {(pod) => (
                    <div class="pod">
                      <span class="spread">
                        <span class="mono">{pod.name}</span>
                        <span class="health">
                          <span class={`dot ${pod.ready ? "healthy" : "attention"}`} />
                          {pod.ready ? "Ready" : pod.phase}
                        </span>
                      </span>
                      <span class="muted" style={{ "font-size": "12px" }}>
                        {pod.node ?? ""}
                        {pod.startedAt === undefined ? "" : ` · up ${since(pod.startedAt, now())}`}
                      </span>
                      <span class="muted" style={{ "font-size": "12px" }}>
                        {pod.restarts === 0 ? "no restarts" : `${pod.restarts} restarts`}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </section>
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
            <section aria-labelledby="debug" class="panel section-box">
              <h2 id="debug" class="section-title">
                Debug logging
              </h2>
              <Show when={service()}>{(described) => <DebugPanel service={described()} state={state()} />}</Show>
            </section>
            <section aria-labelledby="builds" class="panel section-box">
              <h2 id="builds" class="section-title">
                Builds on main
              </h2>
              <Show when={builds().length === 0}>
                <p class="muted" style={{ margin: 0 }}>
                  No builds read.
                </p>
              </Show>
              <ol class="builds">
                <For each={builds()}>
                  {(build) => (
                    <li>
                      <span
                        class={`dot ${build.status === "success" ? "healthy" : build.status === "failure" ? "critical" : "unknown"}`}
                        style={{ "margin-top": "6px" }}
                      />
                      <div style={{ "min-width": 0 }}>
                        <Out href={build.url}>{build.title}</Out>
                        <div class="muted mono" style={{ "font-size": "12px" }}>
                          {build.sha.slice(0, 7)} · {build.status} · {since(build.at, now())} ago
                        </div>
                      </div>
                    </li>
                  )}
                </For>
              </ol>
            </section>
          </div>
        </div>
      </main>
    </Show>
  )
}

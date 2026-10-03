/** A service in the chosen environment: its load over a range, its pods, its alerts today, debug, and builds. */
import { useEstate, useSnapshot } from "../context"
import { since } from "../format"
import { A, Out } from "../parts/A"
import { Load, Timeline } from "../parts/Charts"
import { DebugPanel } from "../parts/Debug"
import { Jobs } from "../parts/Jobs"
import { HealthLine, Links } from "../parts/Lane"

export const ServicePage = (props: { readonly name: string }) => {
  const { now } = useEstate()
  const { events, environment } = useSnapshot()
  const service = events.catalog?.services.find((each) => each.name === props.name)
  const state = events.services?.services.find((each) => each.name === props.name)
  const alerts = (events.alerts?.alerts ?? []).filter((alert) => alert.service === props.name)
  const resolved = (events.alerts?.resolved ?? []).filter((each) => each.service === props.name)
  const builds = events.deploys?.services.find((each) => each.name === props.name)?.builds ?? []
  if (events.catalog !== undefined && service === undefined) {
    return (
      <main className="state-page">
        <h1>
          {props.name} is not in {environment}.
        </h1>
        <A to="/">The overview</A>
      </main>
    )
  }
  return (
    <main className="main">
      <section aria-label={props.name} className="stack">
        <nav aria-label="Breadcrumb" className="muted crumbs">
          <A to="/">Overview</A> / {props.name}
        </nav>
        <h1 className="headline" style={{ fontSize: 38 }}>
          {props.name}
        </h1>
        <HealthLine state={state} />
        <p className="lede" style={{ maxWidth: 760 }}>
          {[
            service?.description,
            service?.owner === undefined ? undefined : `Owner ${service.owner}`,
            state?.version === undefined ? undefined : `running ${state.version}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {service !== undefined && <Links service={service} />}
      </section>
      <div className="row">
        <div className="stack" style={{ flex: "999 1 640px", minWidth: 0, gap: 24 }}>
          <Load name={props.name} state={state} alerts={alerts} />
          <section aria-labelledby="pods" className="stack">
            <h2 id="pods" className="section-title">
              Pods
            </h2>
            {(state?.pods ?? []).length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                No pods read for it here.
              </p>
            )}
            <div className="pods">
              {(state?.pods ?? []).map((pod) => (
                <div key={pod.name} className="pod">
                  <span className="spread">
                    <span className="mono">{pod.name}</span>
                    <span className="health">
                      <span className={`dot ${pod.ready ? "healthy" : "attention"}`} />
                      {pod.ready ? "Ready" : pod.phase}
                    </span>
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {pod.node ?? ""}
                    {pod.startedAt === undefined ? "" : ` · up ${since(pod.startedAt, now())}`}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {pod.restarts === 0 ? "no restarts" : `${pod.restarts} restarts`}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section aria-labelledby="jobs" className="stack">
            <h2 id="jobs" className="section-title">
              Jobs
            </h2>
            <Jobs jobs={state?.jobs ?? []} />
          </section>
          <section aria-labelledby="today" className="panel section-box">
            <h2 id="today" className="section-title">
              Alerts today
            </h2>
            <Timeline
              now={now()}
              alerts={[...alerts.map((alert) => ({ name: alert.name, startsAt: alert.startsAt })), ...resolved]}
            />
          </section>
        </div>
        <div className="stack" style={{ flex: "1 1 320px", minWidth: 0, gap: 24 }}>
          <section aria-labelledby="debug" className="panel section-box">
            <h2 id="debug" className="section-title">
              Debug logging
            </h2>
            {service !== undefined && <DebugPanel service={service} state={state} />}
          </section>
          <section aria-labelledby="builds" className="panel section-box">
            <h2 id="builds" className="section-title">
              Builds on main
            </h2>
            {builds.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                No builds read.
              </p>
            )}
            <ol className="builds">
              {builds.map((build) => (
                <li key={`${build.sha}-${build.at}`}>
                  <span
                    className={`dot ${build.status === "success" ? "healthy" : build.status === "failure" ? "critical" : "unknown"}`}
                    style={{ marginTop: 6 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <Out href={build.url}>{build.title}</Out>
                    <div className="muted mono" style={{ fontSize: 12 }}>
                      {build.sha.slice(0, 7)} · {build.status} · {since(build.at, now())} ago
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </main>
  )
}

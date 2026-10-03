/** A service in the chosen environment: its load over a range, its pods, its alerts today, debug, and builds. */
import { useEffect, useState } from "react"
import type { Alert, Series, ServiceState } from "../../shared/events"
import { shape } from "../chart"
import { type Range, useEstate, useSnapshot } from "../context"
import { clock, measured, since } from "../format"
import { A, Out } from "../parts/A"
import { DebugPanel } from "../parts/Debug"
import { HealthLine, Links } from "../parts/Lane"

const ranges: ReadonlyArray<Range> = ["1h", "6h", "24h", "7d"]

const Chart = (props: {
  readonly label: string
  readonly unit: string
  readonly series: Series | undefined
  readonly limit: number | undefined
  readonly range: Range
}) => {
  const points = props.series?.points ?? []
  const known = points.filter((point): point is number => point !== null)
  const high = Math.max(...known, (props.limit ?? 0) * 1.2, 0.000001)
  const drawn = shape(points, 300, 110, { pad: 4, low: 0, high })
  const alarm = props.limit !== undefined && (props.series?.now ?? 0) > props.limit
  const ink = alarm ? "#F5A524" : "#8FB0FF"
  const now = measured(props.series?.now, props.unit)
  return (
    <figure className="chart">
      <figcaption className="spread">
        <span className="muted">{props.label}</span>
        <span className="mono" style={{ color: alarm ? "var(--amber-text)" : undefined }}>
          {now}
        </span>
      </figcaption>
      <svg
        viewBox="0 0 300 110"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${props.label} over ${props.range}, now ${now}`}
      >
        <line x1="0" y1="109" x2="300" y2="109" stroke="#232836" vectorEffect="non-scaling-stroke" />
        {drawn.area !== "" && <polygon points={drawn.area} fill={ink} fillOpacity="0.14" />}
        {props.limit !== undefined && (
          <line
            x1="0"
            y1={drawn.y(props.limit)}
            x2="300"
            y2={drawn.y(props.limit)}
            stroke="#F5A524"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={drawn.line}
          fill="none"
          stroke={ink}
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="chart-axis mono" style={{ color: "var(--ink-3)" }}>
        <span>{props.range} ago</span>
        {props.limit !== undefined && <span>threshold {measured(props.limit, props.unit)}</span>}
        <span>now</span>
      </div>
    </figure>
  )
}

const Load = (props: {
  readonly name: string
  readonly state: ServiceState | undefined
  readonly alerts: ReadonlyArray<Alert>
}) => {
  const { actions } = useEstate()
  const [range, setRange] = useState<Range>("1h")
  const [load, setLoad] = useState<ServiceState["load"] | undefined>(undefined)
  useEffect(() => {
    let current = true
    if (range !== "1h")
      void actions.load(props.name, range).then((read) => {
        if (current) setLoad(read)
      })
    return () => {
      current = false
    }
  }, [range, props.name, actions])
  const shown = range === "1h" ? props.state?.load : load
  const limit = props.alerts.find((alert) => alert.chart !== undefined && /latency|slow|p99|duration/i.test(alert.name))
    ?.chart?.threshold
  return (
    <section aria-labelledby="load" className="panel section-box">
      <div className="spread">
        <h2 id="load" className="section-title">
          Load
        </h2>
        <fieldset className="choices bare">
          <legend className="visually-hidden">Range</legend>
          {ranges.map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={range === each}
              className="filter"
              onClick={() => setRange(each)}
            >
              {each}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="charts">
        <Chart label="Requests" unit="/s" series={shown?.requests} limit={undefined} range={range} />
        <Chart label="Errors" unit="/s" series={shown?.errors} limit={undefined} range={range} />
        <Chart label="p99" unit="s" series={shown?.p99} limit={limit} range={range} />
      </div>
    </section>
  )
}

const day = 24 * 3_600_000

const Timeline = (props: {
  readonly alerts: ReadonlyArray<{ readonly name: string; readonly startsAt: string; readonly endsAt?: string }>
  readonly now: number
}) => {
  const start = props.now - day
  const at = (iso: string) => Math.max(0, Math.min(100, ((Date.parse(iso) - start) / day) * 100))
  return (
    <div className="stack" style={{ gap: 8 }}>
      {props.alerts.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Nothing fired in the last day.
        </p>
      )}
      {props.alerts.map((alert) => (
        <div key={`${alert.name}-${alert.startsAt}`} className="timeline-row">
          <span className="mono" style={{ fontSize: 12 }}>
            {alert.name}
          </span>
          <div className="timeline-track">
            <span
              className={`timeline-bar ${alert.endsAt === undefined ? "live" : ""}`}
              title={`${clock(alert.startsAt)} to ${alert.endsAt === undefined ? "now" : clock(alert.endsAt)}`}
              style={{
                left: `${at(alert.startsAt)}%`,
                width: `${Math.max(1, at(alert.endsAt ?? new Date(props.now).toISOString()) - at(alert.startsAt))}%`,
              }}
            />
          </div>
        </div>
      ))}
      <div className="timeline-row muted mono" style={{ fontSize: 11 }}>
        <span />
        <span className="spread">
          <span>24 h ago</span>
          <span>12 h ago</span>
          <span>now</span>
        </span>
      </div>
    </div>
  )
}

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

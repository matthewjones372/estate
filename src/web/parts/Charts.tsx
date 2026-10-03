/** A service's load and stats over a chosen range, and its alerts over the day. */
import { useEffect, useState } from "react"
import type { Alert, Series, ServiceState } from "../../shared/events"
import { shape } from "../chart"
import { type Range, useEstate } from "../context"
import { clock, measured } from "../format"

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

export const Load = (props: {
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
      {(shown?.stats ?? []).length > 0 && (
        <>
          <h3 className="section-title">Stats</h3>
          <div className="charts">
            {(shown?.stats ?? []).map((stat) => (
              <Chart
                key={stat.title}
                label={stat.title}
                unit={stat.unit ?? ""}
                series={stat.series}
                limit={undefined}
                range={range}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

const day = 24 * 3_600_000

export const Timeline = (props: {
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

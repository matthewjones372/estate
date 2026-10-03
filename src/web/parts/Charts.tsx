/** A service's load and stats over a chosen range, and its alerts over the day. */
import { useEffect, useState } from "react"
import type { Alert, Series, ServiceState } from "../../shared/events"
import { reading, whole, type Zoom } from "../chart"
import { type Range, useEstate } from "../context"
import { clock, measured } from "../format"
import { Plot } from "./Plot"

const ranges: ReadonlyArray<Range> = ["1h", "6h", "24h", "7d"]

const spans: Readonly<Record<Range, number>> = {
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
}

const at = (ms: number) => clock(new Date(ms).toISOString())

/** What the charts of one range share: when they end, the moment marked, and the span zoomed to. */
interface Reading {
  readonly range: Range
  readonly end: number
  readonly mark: number | undefined
  readonly onMark: (at: number | undefined) => void
  readonly zoom: Zoom
  readonly onZoom: (zoom: Zoom) => void
}

const Chart = (props: {
  readonly label: string
  readonly unit: string
  readonly series: Series | undefined
  readonly limit: number | undefined
  readonly reading: Reading
}) => {
  const { range, end, zoom } = props.reading
  const span = spans[range]
  const points = props.series?.points ?? []
  const alarm = props.limit !== undefined && (props.series?.now ?? 0) > props.limit
  const ink = alarm ? "#F5A524" : "#8FB0FF"
  const now = measured(props.series?.now, props.unit)
  const read = reading(points, end, span, props.reading.mark)
  const zoomed = zoom.from > 0 || zoom.to < 1
  return (
    <figure className="chart">
      <figcaption className="spread">
        <span className="muted">{read === undefined ? props.label : `${props.label} at ${at(read.at)}`}</span>
        <span className="mono" aria-live="polite" style={{ color: alarm ? "var(--amber-text)" : undefined }}>
          {read === undefined ? now : measured(read.value, props.unit)}
        </span>
      </figcaption>
      <Plot
        label={`${props.label} over ${range}, now ${now}. Arrow keys read each point.`}
        points={points}
        end={end}
        span={span}
        width={300}
        height={110}
        pad={4}
        headroom={(props.limit ?? 0) * 1.2}
        ink={ink}
        baseline
        {...(props.limit === undefined ? {} : { limit: { value: props.limit, ink: "#F5A524" } })}
        keys
        mark={props.reading.mark}
        onMark={props.reading.onMark}
        zoom={zoom}
        onZoom={props.reading.onZoom}
      />
      <div className="chart-axis mono" style={{ color: "var(--ink-3)" }}>
        <span>{zoomed ? at(end - span + zoom.from * span) : `${range} ago`}</span>
        {props.limit !== undefined && <span>threshold {measured(props.limit, props.unit)}</span>}
        <span>{zoomed && zoom.to < 1 ? at(end - span + zoom.to * span) : "now"}</span>
      </div>
    </figure>
  )
}

export const Load = (props: {
  readonly name: string
  readonly state: ServiceState | undefined
  readonly alerts: ReadonlyArray<Alert>
}) => {
  const { actions, now } = useEstate()
  const [range, setRange] = useState<Range>("1h")
  const [load, setLoad] = useState<ServiceState["load"] | undefined>(undefined)
  const [mark, setMark] = useState<number | undefined>(undefined)
  const [zoom, setZoom] = useState<Zoom>(whole)
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
  const choose = (each: Range) => {
    setRange(each)
    setZoom(whole)
    setMark(undefined)
  }
  const shared: Reading = { range, end: now(), mark, onMark: setMark, zoom, onZoom: setZoom }
  return (
    <section aria-labelledby="load" className="panel section-box">
      <div className="spread">
        <h2 id="load" className="section-title">
          Load
        </h2>
        <fieldset className="choices bare">
          <legend className="visually-hidden">Range</legend>
          {(zoom.from > 0 || zoom.to < 1) && (
            <button type="button" className="filter" onClick={() => setZoom(whole)}>
              Show all {range}
            </button>
          )}
          {ranges.map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={range === each}
              className="filter"
              onClick={() => choose(each)}
            >
              {each}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="charts">
        <Chart label="Requests" unit="/s" series={shown?.requests} limit={undefined} reading={shared} />
        <Chart label="Errors" unit="/s" series={shown?.errors} limit={undefined} reading={shared} />
        <Chart label="p99" unit="s" series={shown?.p99} limit={limit} reading={shared} />
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
                reading={shared}
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

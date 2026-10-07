/** @jsxImportSource solid-js */
/** A service's load and stats, or a store's stats, over a chosen range; and alerts over the day. */
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { Alert, Load as Read, Series } from "../../shared/events"
import { reading, whole, type Zoom } from "../chart"
import { type Range, useEstate } from "../context"
import { clock, measured } from "../format"
import { firingPath, pathOf } from "../route"
import { A } from "./A"
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
  readonly range: () => Range
  readonly end: () => number
  readonly mark: () => number | undefined
  readonly onMark: (at: number | undefined) => void
  readonly zoom: () => Zoom
  readonly onZoom: (zoom: Zoom) => void
}

const Chart = (props: {
  readonly label: string
  readonly unit: string
  readonly series: Series | undefined
  readonly limit: number | undefined
  readonly reading: Reading
}) => {
  const shared = props.reading
  const span = () => spans[shared.range()]
  const points = () => props.series?.points ?? []
  const alarm = () => props.limit !== undefined && (props.series?.now ?? 0) > props.limit
  const ink = () => (alarm() ? "#F5A524" : "#8FB0FF")
  const now = () => measured(props.series?.now, props.unit)
  const read = () => reading(points(), shared.end(), span(), shared.mark())
  const zoomed = () => shared.zoom().from > 0 || shared.zoom().to < 1
  const edge = (fraction: number) => at(shared.end() - span() + fraction * span())
  return (
    <figure class="chart">
      <figcaption class="spread">
        <span class="muted">{read() === undefined ? props.label : `${props.label} at ${at(read()?.at ?? 0)}`}</span>
        <span class="mono" aria-live="polite" style={{ color: alarm() ? "var(--amber-text)" : undefined }}>
          {read() === undefined ? now() : measured(read()?.value, props.unit)}
        </span>
      </figcaption>
      <Plot
        label={`${props.label} over ${shared.range()}, now ${now()}. Arrow keys read each point.`}
        points={points()}
        end={shared.end()}
        span={span()}
        width={300}
        height={110}
        pad={4}
        headroom={(props.limit ?? 0) * 1.2}
        ink={ink()}
        baseline
        limit={props.limit === undefined ? undefined : { value: props.limit, ink: "#F5A524" }}
        keys
        mark={shared.mark()}
        onMark={shared.onMark}
        zoom={shared.zoom()}
        onZoom={shared.onZoom}
      />
      <div class="chart-axis mono" style={{ color: "var(--ink-3)" }}>
        <span>{zoomed() ? edge(shared.zoom().from) : `${shared.range()} ago`}</span>
        <Show when={props.limit !== undefined}>
          <span>threshold {measured(props.limit, props.unit)}</span>
        </Show>
        <span>{zoomed() && shared.zoom().to < 1 ? edge(shared.zoom().to) : "now"}</span>
      </div>
    </figure>
  )
}

/**
 * The last hour as the stream sends it in `hour`, or a longer range as `read` fetches it; for a store, `title` is
 * Stats and only its stats are drawn.
 */
export const Load = (props: {
  readonly name: string
  readonly hour: Read | undefined
  readonly read: (name: string, range: Range) => Promise<Read | undefined>
  readonly alerts: ReadonlyArray<Alert>
  readonly title?: string
}) => {
  const { now } = useEstate()
  const [range, setRange] = createSignal<Range>("1h")
  const [load, setLoad] = createSignal<Read | undefined>(undefined)
  const [mark, setMark] = createSignal<number | undefined>(undefined)
  const [zoom, setZoom] = createSignal<Zoom>(whole)
  const [readAt, setReadAt] = createSignal(now())
  createEffect(
    on([range, () => props.name], ([chosen, name]) => {
      let current = true
      onCleanup(() => {
        current = false
      })
      if (chosen !== "1h")
        void props.read(name, chosen).then((read) => {
          if (!current) return
          setLoad(read)
          setReadAt(now())
        })
    }),
  )
  const shown = () => (range() === "1h" ? props.hour : load())
  // The last hour ends when its event came; a longer range when it was read.
  const heard = createMemo(on(() => props.hour, now))
  const end = () => (range() === "1h" ? heard() : readAt())
  const limit = () =>
    props.alerts.find((alert) => alert.chart !== undefined && /latency|slow|p99|duration/i.test(alert.name))?.chart
      ?.threshold
  const choose = (each: Range) => {
    setRange(each)
    setZoom(whole)
    setMark(undefined)
  }
  const shared: Reading = { range, end, mark, onMark: setMark, zoom, onZoom: setZoom }
  return (
    <section aria-labelledby="load" class="panel section-box">
      <div class="spread">
        <h2 id="load" class="section-title">
          {props.title ?? "Load"}
        </h2>
        <fieldset class="choices bare">
          <legend class="visually-hidden">Range</legend>
          <Show when={zoom().from > 0 || zoom().to < 1}>
            <button type="button" class="filter" onClick={() => setZoom(whole)}>
              Show all {range()}
            </button>
          </Show>
          <For each={ranges}>
            {(each) => (
              <button type="button" aria-pressed={range() === each} class="filter" onClick={() => choose(each)}>
                {each}
              </button>
            )}
          </For>
        </fieldset>
      </div>
      <Show when={props.title === undefined}>
        <div class="charts">
          <Chart label="Requests" unit="/s" series={shown()?.requests} limit={undefined} reading={shared} />
          <Chart label="Errors" unit="/s" series={shown()?.errors} limit={undefined} reading={shared} />
          <Chart label="p99" unit="s" series={shown()?.p99} limit={limit()} reading={shared} />
        </div>
      </Show>
      <Show when={(shown()?.stats ?? []).length > 0}>
        <Show when={props.title === undefined}>
          <h3 class="section-title">Stats</h3>
        </Show>
        <div class="charts">
          <For each={shown()?.stats ?? []}>
            {(stat) => (
              <Chart
                label={stat.title}
                unit={stat.unit ?? ""}
                series={stat.series}
                limit={undefined}
                reading={shared}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

const day = 24 * 3_600_000

export const Timeline = (props: {
  readonly alerts: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly startsAt: string
    readonly endsAt?: string
  }>
  readonly now: number
}) => {
  const place = (iso: string) => Math.max(0, Math.min(100, ((Date.parse(iso) - (props.now - day)) / day) * 100))
  return (
    <div class="stack" style={{ gap: "8px" }}>
      <Show when={props.alerts.length === 0}>
        <p class="muted" style={{ margin: 0 }}>
          Nothing fired in the last day.
        </p>
      </Show>
      <For each={props.alerts}>
        {(alert) => (
          <div class="timeline-row">
            <A
              to={
                alert.endsAt === undefined
                  ? pathOf({ page: "alert", id: alert.id })
                  : firingPath(alert.id, alert.startsAt)
              }
              class="mono"
              style={{ "font-size": "12px" }}
            >
              {alert.name}
            </A>
            <div class="timeline-track">
              <span
                class={`timeline-bar ${alert.endsAt === undefined ? "live" : ""}`}
                title={`${clock(alert.startsAt)} to ${alert.endsAt === undefined ? "now" : clock(alert.endsAt)}`}
                style={{
                  left: `${place(alert.startsAt)}%`,
                  width: `${Math.max(1, place(alert.endsAt ?? new Date(props.now).toISOString()) - place(alert.startsAt))}%`,
                }}
              />
            </div>
          </div>
        )}
      </For>
      <div class="timeline-row muted mono" style={{ "font-size": "11px" }}>
        <span />
        <span class="spread">
          <span>24 h ago</span>
          <span>12 h ago</span>
          <span>now</span>
        </span>
      </div>
    </div>
  )
}

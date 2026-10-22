/** @jsxImportSource solid-js */
/** A service's load and stats, or a store's stats, over a chosen range. */
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { Alert, Load as Read, Series } from "../../shared/events"
import { loadPanels } from "../../shared/stats"
import { onScreen, reading, whole, type Zoom } from "../chart"
import { type ChartMark, marksOf } from "../chart-marks"
import { type Range, useEstate, useSnapshot } from "../context"
import { clock, measured } from "../format"
import { spikeBands } from "../spike"
import { IncludeCharts, type Picking, pickingCharts } from "./PickCharts"
import { Plot } from "./Plot"
import { TrafficSpike } from "./Signals"

const ranges: ReadonlyArray<Range> = ["1h", "6h", "24h", "7d"]

const spans: Readonly<Record<Range, number>> = {
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
}

const at = (ms: number) => clock(new Date(ms).toISOString())

/**
 * What the charts of one window share: how long it is and how to say so, when it ends, the moment marked, the span
 * zoomed to, and a span to shade.
 */
export interface Reading {
  readonly span: () => number
  /** The window as the chart's label says it, "1h" or "the firing", and as its axis's ends do. */
  readonly over: () => string
  readonly starts: () => string
  readonly ends: () => string
  readonly end: () => number
  readonly mark: () => number | undefined
  readonly onMark: (at: number | undefined) => void
  readonly zoom: () => Zoom
  readonly onZoom: (zoom: Zoom) => void
  readonly shade?: () => { readonly from: number; readonly to: number } | undefined
  /** Charts being picked for an incident (spec 0063). */
  readonly pick?: Picking
  /** Versions applied and alerts fired in the window, drawn across every chart of it (spec 0068). */
  readonly happened?: () => ReadonlyArray<ChartMark>
}

export const Chart = (props: {
  readonly label: string
  readonly unit: string
  readonly series: Series | undefined
  readonly limit: number | undefined
  readonly reading: Reading
  /** The service and panel it is, for picking it for an incident (specs 0051 and 0063). */
  readonly of?: { readonly service: string; readonly panel: string }
  /** Shade jumps in this request rate. The number and the line stay as they are. */
  readonly spike?: boolean
}) => {
  const shared = props.reading
  const span = () => shared.span()
  const points = () => props.series?.points ?? []
  const alarm = () => props.limit !== undefined && (props.series?.now ?? 0) > props.limit
  const ink = () => (alarm() ? "#F5A524" : "#8FB0FF")
  const now = () => measured(props.series?.now, props.unit)
  const read = () => reading(points(), shared.end(), span(), shared.mark())
  const zoomed = () => shared.zoom().from > 0 || shared.zoom().to < 1
  const edge = (fraction: number) => at(shared.end() - span() + fraction * span())
  const said = () => {
    const marks = shared.happened?.() ?? []
    return marks.length === 0 ? "" : ` Marked: ${marks.map((mark) => mark.label).join("; ")}.`
  }
  return (
    <figure class="chart" classList={{ "chart-picked": props.of !== undefined && shared.pick?.has(props.of.panel) }}>
      <figcaption class="spread">
        <span class="chart-name">
          <Show when={shared.pick?.on() ? props.of : undefined}>
            {(of) => (
              <input
                type="checkbox"
                class="chart-pick"
                aria-label={`Pick ${props.label}`}
                checked={shared.pick?.has(of().panel)}
                onClick={() => shared.pick?.toggle(of().panel)}
              />
            )}
          </Show>
          <span class="muted">{read() === undefined ? props.label : `${props.label} at ${at(read()?.at ?? 0)}`}</span>
        </span>
        <span class="mono" aria-live="polite" style={{ color: alarm() ? "var(--amber-text)" : undefined }}>
          {read() === undefined ? now() : measured(read()?.value, props.unit)}
        </span>
      </figcaption>
      <Plot
        label={`${props.label} over ${shared.over()}, now ${now()}.${said()} Arrow keys read each point.`}
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
        shade={shared.shade?.()}
        bands={props.spike === true ? spikeBands(points(), shared.end(), span()) : undefined}
        happened={shared.happened?.() ?? []}
      />
      <div class="chart-axis mono ink-3">
        <span>{zoomed() ? edge(shared.zoom().from) : shared.starts()}</span>
        <Show when={props.limit !== undefined}>
          <span>threshold {measured(props.limit, props.unit)}</span>
        </Show>
        <span>{zoomed() && shared.zoom().to < 1 ? edge(shared.zoom().to) : shared.ends()}</span>
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
  /** What the charts are of, for the versions applied to it and its alerts that fired. */
  readonly of?: { readonly service?: string; readonly store?: string }
}) => {
  const { now } = useEstate()
  const snapshot = useSnapshot()
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
  const charts = pickingCharts()
  const shared: Reading = {
    pick: charts.picking,
    span: () => spans[range()],
    over: range,
    starts: () => `${range()} ago`,
    ends: () => "now",
    end,
    mark,
    onMark: setMark,
    zoom,
    onZoom: setZoom,
    happened: () =>
      marksOf(
        props.of ?? { service: props.name },
        snapshot.events.feed?.items ?? [],
        props.alerts,
        snapshot.events.alerts?.resolved ?? [],
        { end: end(), span: spans[range()] },
      ),
  }
  return (
    <section aria-labelledby="load" class="panel section-box">
      <div class="spread charts-head">
        <h2 id="load" class="section-title">
          {props.title ?? "Load"}
        </h2>
        <div class="charts-include">
          <IncludeCharts
            service={props.name}
            charts={charts}
            range={() => onScreen(shared.end(), shared.span(), shared.zoom())}
          />
        </div>
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
      <Show when={(shared.happened?.() ?? []).length > 0}>
        <ul class="chart-legend" aria-label="Marked on the charts">
          <For each={shared.happened?.() ?? []}>
            {(mark) => (
              <li>
                <span class={`legend-swatch ${mark.kind}`} aria-hidden="true" />
                {mark.label}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.title === undefined}>
        <TrafficSpike points={shown()?.requests?.points} span={spans[range()]} />
        <div class="charts">
          <For each={loadPanels}>
            {(panel) => (
              <Chart
                label={panel.label}
                unit={panel.unit}
                series={shown()?.[panel.key]}
                limit={panel.key === "p99" ? limit() : undefined}
                reading={shared}
                of={{ service: props.name, panel: panel.key }}
                spike={panel.key === "requests"}
              />
            )}
          </For>
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
                of={{ service: props.name, panel: stat.title }}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

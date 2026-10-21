/** @jsxImportSource solid-js */
/**
 * A service's load around a past firing: from an hour before it fired to an hour after it ended, the firing shaded.
 * Its charts are picked for an incident over the range on screen (specs 0051 and 0063).
 */
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import type { Load } from "../../shared/events"
import type { PastFiring } from "../../shared/firing"
import { windowOf } from "../../shared/window"
import { onScreen, whole, type Zoom } from "../chart"
import { useEstate } from "../context"
import { day } from "../format"
import { Chart, type Reading } from "./Charts"
import { IncludeCharts, pickingCharts } from "./PickCharts"

const hour = 3_600_000

export const LoadThen = (props: { readonly service: string; readonly firing: PastFiring }) => {
  const { actions, now } = useEstate()
  const [load, setLoad] = createSignal<Load | undefined>(undefined)
  const [mark, setMark] = createSignal<number | undefined>(undefined)
  const [zoom, setZoom] = createSignal<Zoom>(whole)
  const started = () => Date.parse(props.firing.startsAt)
  const ended = () => (props.firing.endsAt === undefined ? undefined : Date.parse(props.firing.endsAt))
  const asked = () => ({ from: started() - hour, to: Math.min((ended() ?? started()) + hour, now()) })
  // The window as the server reads it, so each point is drawn where it was read.
  const window = () => windowOf(asked().from, asked().to)
  createEffect(
    on([() => props.service, () => JSON.stringify(asked())], ([service]) => {
      let current = true
      const { from, to } = asked()
      void actions
        .loadBetween(service, new Date(from).toISOString(), new Date(to).toISOString())
        .then((read) => current && setLoad(read))
      onCleanup(() => {
        current = false
      })
    }),
  )
  const of = (panel: string) => ({ service: props.service, panel })
  const charts = pickingCharts()
  const shared: Reading = {
    pick: charts.picking,
    span: () => (window().end - window().start) * 1000,
    over: () => "the firing",
    starts: () => day(new Date(window().start * 1000).toISOString()),
    ends: () => day(new Date(window().end * 1000).toISOString()),
    end: () => window().end * 1000,
    mark,
    onMark: setMark,
    zoom,
    onZoom: setZoom,
    shade: () => ({ from: started(), to: ended() ?? asked().to }),
  }
  return (
    <section aria-labelledby="firing-load" class="panel section-box">
      <div class="spread charts-head">
        <h2 id="firing-load" class="section-title">
          Load then
        </h2>
        <div class="charts-include">
          <IncludeCharts
            service={props.service}
            charts={charts}
            range={() => onScreen(shared.end(), shared.span(), shared.zoom())}
          />
        </div>
      </div>
      <div class="charts">
        <Chart
          label="Requests"
          unit="/s"
          series={load()?.requests}
          limit={undefined}
          reading={shared}
          of={of("requests")}
          spike
        />
        <Chart label="Errors" unit="/s" series={load()?.errors} limit={undefined} reading={shared} of={of("errors")} />
        <Chart label="p99" unit="s" series={load()?.p99} limit={undefined} reading={shared} of={of("p99")} />
      </div>
    </section>
  )
}

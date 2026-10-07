/** @jsxImportSource solid-js */
/** A service's load around a past firing: from an hour before it fired to an hour after it ended, the firing shaded. */
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import type { Load } from "../../shared/events"
import type { PastFiring } from "../../shared/firing"
import { windowOf } from "../../shared/window"
import { whole, type Zoom } from "../chart"
import { useEstate } from "../context"
import { day } from "../format"
import { Chart, type Reading } from "./Charts"

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
  const shared: Reading = {
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
      <h2 id="firing-load" class="section-title">
        Load then
      </h2>
      <div class="charts">
        <Chart label="Requests" unit="/s" series={load()?.requests} limit={undefined} reading={shared} />
        <Chart label="Errors" unit="/s" series={load()?.errors} limit={undefined} reading={shared} />
        <Chart label="p99" unit="s" series={load()?.p99} limit={undefined} reading={shared} />
      </div>
    </section>
  )
}

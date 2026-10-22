/** @jsxImportSource solid-js */
/**
 * The overview: what needs you, counted once (spec 0068), as the headline and a row a thing; then the map, services
 * by area, worst first, and what changed. Alert → context, not vitals-first.
 */
import { createMemo, Show } from "solid-js"
import { useEstate, useSnapshot } from "../context"
import { thingsOf } from "../needs"
import { Feed } from "../parts/Feed"
import { Hero } from "../parts/Hero"
import { Lanes } from "../parts/Lanes"
import { EstateMap } from "../parts/Map"
import { Signals } from "../parts/Signals"
import { SilencedAlerts } from "../parts/Silenced"
import { Things } from "../parts/Things"
import { Unfolded } from "../parts/Unfolded"
import { ViewMenu } from "../parts/ViewMenu"
import { mapChoice, servicesChoice } from "../view-choices"
import { Reading, SourceNotices } from "./States"

export const Overview = () => {
  const { me, now } = useEstate()
  const snapshot = useSnapshot()
  const events = () => snapshot.events
  const things = createMemo(() => thingsOf(events()))
  const map = mapChoice()
  const services = servicesChoice()
  const silenced = () => (events().alerts?.alerts ?? []).filter((alert) => alert.state === "silenced")
  const canSilence = () => me.role === "operator" && events().alerts?.silences === true
  const waiting = () =>
    events().services === undefined || (events().services?.sources ?? []).some((source) => source.state === "waiting")
  return (
    <main class="main">
      <Show when={waiting()}>
        <Reading sources={events().services?.sources} />
      </Show>
      <SourceNotices services={events().services} now={now()} />
      <Hero events={events()} things={things()} />
      <Things things={things()} catalog={events().catalog} canSilence={canSilence()} />
      <SilencedAlerts alerts={silenced()} canSilence={canSilence()} />
      <Signals services={events().services?.services} />
      <Show when={events().catalog}>
        {(catalog) => <EstateMap catalog={catalog()} services={events().services} layout={map} />}
      </Show>
      <Show when={things().find((thing) => thing.kind === "incident")}>
        {(incident) => <Unfolded incident={incident()} />}
      </Show>
      <div class="row">
        <Lanes layout={services} menu={<ViewMenu map={map} services={services} />} />
        <Feed
          feed={events().feed}
          needing={new Set(things().flatMap((thing) => thing.about))}
          stuck={new Set(things().flatMap((thing) => (thing.kind === "deploy" ? thing.about : [])))}
        />
      </div>
    </main>
  )
}

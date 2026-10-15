/** @jsxImportSource solid-js */
/**
 * A journey on the estate's map: chosen in the map's caption, its route drawn node to node over the dimmed map, each
 * node it passes through numbered with how long it usually spends there. The usual times are the journey's sample,
 * read when it is chosen (spec 0046).
 */
import { createEffect, createSignal, For, on, Show } from "solid-js"
import type { CatalogEvent } from "../../shared/events"
import type { JourneySample } from "../../shared/traces"
import { useEstate, useSnapshot } from "../context"
import { took } from "../format"
import { kept } from "../kept"
import { JourneyLink } from "./Journey"

type Described = NonNullable<CatalogEvent["journeys"]>[number]
type At = (node: string) => { readonly x: number; readonly y: number } | undefined

const keeping = kept("estate.map.journey")

/** The journey chosen on the map, kept per browser, and its sample once read. */
export const journeyOnMap = (catalog: () => CatalogEvent) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [chosen, setChosen] = createSignal(keeping.read() ?? undefined)
  const [sample, setSample] = createSignal<JourneySample | undefined>()
  const journeys = () => catalog().journeys ?? []
  const journey = () => journeys().find((each) => each.name === chosen())
  createEffect(
    on([() => journey()?.name, () => snapshot.environment], ([name]) => {
      setSample(undefined)
      if (name === undefined) return
      void actions.journey(name).then((read) => setSample(typeof read === "object" ? read : undefined))
    }),
  )
  const choose = (name: string) => {
    const next = chosen() === name ? undefined : name
    setChosen(next)
    keeping.write(next ?? "")
  }
  /** The steps of the journey at a node, numbered from one, empty where it does not pass. */
  const stepsAt = (node: string) =>
    (journey()?.places ?? []).flatMap((place, index) => (place.node === node ? [index + 1] : []))
  /** How long the journey usually spends at a node: its stages' p50 there, added up. */
  const hereAt = (node: string) => {
    const read = sample()
    const stages = (journey()?.places ?? []).filter((place) => place.node === node).flatMap((place) => place.stages)
    if (read === undefined || stages.length === 0) return undefined
    return stages.reduce((sum, stage) => sum + (read.stages[stage]?.p50 ?? 0), 0)
  }
  return { journeys, journey, chosen, choose, sample, stepsAt, hereAt }
}

export type OnMap = ReturnType<typeof journeyOnMap>

/** The journeys to choose from, in the map's caption. */
export const JourneyChoices = (props: { readonly on: OnMap }) => (
  <Show when={props.on.journeys().length > 0}>
    <fieldset class="choices map-journeys">
      <legend class="visually-hidden">A journey to draw on the map</legend>
      <For each={props.on.journeys()}>
        {(journey) => (
          <button
            type="button"
            class="choice"
            aria-pressed={props.on.chosen() === journey.name}
            onClick={() => props.on.choose(journey.name)}
          >
            {journey.title}
          </button>
        )}
      </For>
    </fieldset>
  </Show>
)

/** The chosen journey's route, a line from each node it passes through to the next, over the map's own lines. */
export const RouteLines = (props: { readonly journey: Described | undefined; readonly at: At }) => {
  const hops = () => {
    const places = props.journey?.places ?? []
    return places.slice(1).flatMap((place, index) => {
      const from = props.at(places[index]?.node ?? "")
      const to = props.at(place.node)
      return from === undefined || to === undefined ? [] : [{ from, to }]
    })
  }
  return (
    <For each={hops()}>
      {(hop) => (
        <line
          class="map-route"
          x1={hop.from.x}
          y1={hop.from.y}
          x2={hop.to.x}
          y2={hop.to.y}
          stroke-width="2.5"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      )}
    </For>
  )
}

/** Under the map: the chosen journey end to end, and a way to its panel. */
export const RouteNote = (props: { readonly on: OnMap }) => (
  <Show when={props.on.journey()}>
    {(journey) => (
      <p class="map-route-note">
        <span>
          <strong>{journey().title}</strong>
          <Show when={props.on.sample()?.total.p50} fallback={<span class="muted"> · reading its traces…</span>}>
            {(total) => <> usually takes {took(total())} end to end; each node says how long it spends there.</>}
          </Show>
        </span>
        <Show when={journey().services[0]}>
          {(service) => (
            <JourneyLink service={service()} journey={journey().name}>
              Where its time goes
            </JourneyLink>
          )}
        </Show>
      </p>
    )}
  </Show>
)

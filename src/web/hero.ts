/**
 * The top of the overview: the headline, counted in things (spec 0068); with an incident open, its impact, its likely
 * cause and who last wrote on it; and the tiles beside it.
 */
import type { Alert, Events, Series } from "../shared/events"
import { counted, measured } from "./format"
import { namedOf, type Thing, thingsOf } from "./needs"

export interface Headline {
  readonly tone: "healthy" | "attention" | "critical"
  readonly kicker: string
  readonly top: string
  readonly bottom: string
  readonly lede: string
}

const entriesOf = (events: Partial<Events>) => [
  ...(events.services?.services ?? []),
  ...(events.services?.stores ?? []),
  ...(events.services?.jobs ?? []),
  ...(events.services?.agents ?? []),
]

export const headlineOf = (events: Partial<Events>): Headline => {
  const things = thingsOf(events)
  const entries = entriesOf(events)
  if (things.length === 0 && entries.length > 0 && entries.every((entry) => entry.health === "unknown")) {
    return {
      tone: "healthy",
      kicker: "Listening",
      top: "Not heard yet.",
      bottom: "Reading the sources.",
      lede: "No source has said how the services are, so nothing is claimed about them yet.",
    }
  }
  if (things.length === 0) {
    const healthy = entries.filter((entry) => entry.health === "healthy").length
    return {
      tone: "healthy",
      kicker: "All healthy",
      top: "All quiet.",
      bottom: "Nothing needs you.",
      lede:
        entries.length === 0
          ? "No service is in this environment yet."
          : `${counted(healthy, "service")} healthy, nothing firing.`,
    }
  }
  const critical = things.some((thing) => thing.tone === "critical")
  return {
    tone: critical ? "critical" : "attention",
    kicker: critical ? "Something is down" : "Needs attention",
    top: counted(things.length, "thing"),
    bottom: things.length === 1 ? "needs you." : "need you.",
    lede: `${things[0]?.title ?? ""}.`,
  }
}

export interface Opened {
  readonly thing: Thing
  /** What it means for the people using the product, from its alerts, else its title. */
  readonly impact: string
  /** The alert at its root, where it holds more than one: one about a store, else the first to fire. */
  readonly cause?: { readonly where: string; readonly text: string }
  readonly latest?: Alert["notes"][number]
}

const firstFired = (a: Alert, b: Alert) => Date.parse(a.startsAt) - Date.parse(b.startsAt)

/** The open incident that needs someone most, said as its impact, its likely cause and its latest note. */
export const openedOf = (events: Partial<Events>, things = thingsOf(events)): Opened | undefined => {
  const thing = things.find((each) => each.kind === "incident")
  if (thing === undefined) return undefined
  const alerts = thing.alerts
  const id = alerts[0]?.incident?.id
  const root =
    alerts.length > 1
      ? (alerts.filter((alert) => alert.store !== undefined).toSorted(firstFired)[0] ?? alerts.toSorted(firstFired)[0])
      : undefined
  const where = root?.store ?? root?.service
  const latest = alerts
    .flatMap((alert) => alert.notes.filter((note) => note.incident?.id === id))
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
  const impact = alerts.find((alert) => alert.impact !== undefined)?.impact?.text ?? thing.title
  return {
    thing,
    impact,
    ...(root === undefined || where === undefined
      ? {}
      : { cause: { where: namedOf(events, where), text: root.summary ?? `${root.name} is firing` } }),
    ...(latest === undefined ? {} : { latest }),
  }
}

export interface Tile {
  readonly label: string
  readonly value: string
  readonly note?: string
  readonly alarm: boolean
  /** A vital's hour, drawn under its value. */
  readonly series?: Series
  readonly unit?: string
}

/** The catalog's vitals, each with its hour; then how many are healthy, pods and builds, to fill four tiles. */
export const tilesOf = (events: Partial<Events>): ReadonlyArray<Tile> => {
  const things = thingsOf(events)
  const entries = entriesOf(events)
  const healthy = entries.filter((entry) => entry.health === "healthy").length
  const affected = entries.filter((entry) => entry.health === "attention" || entry.health === "critical").length
  const pods = (events.services?.services ?? []).flatMap((service) => service.pods)
  const runtime = events.services?.sources.find((source) => source.kind === "cluster")
  const here = new Set((events.services?.services ?? []).map((service) => service.name))
  const failing = (events.deploys?.services ?? [])
    .filter((service) => here.has(service.name) && service.builds[0]?.status === "failure")
    .map((service) => service.name)
  const own: ReadonlyArray<Tile> = (events.services?.vitals ?? []).map((vital) => ({
    label: vital.title,
    value: measured(vital.series.now, vital.unit),
    alarm: false,
    series: vital.series,
    ...(vital.unit === undefined ? {} : { unit: vital.unit }),
  }))
  const always: ReadonlyArray<Tile> = [
    {
      label: "Healthy",
      value: `${healthy} of ${entries.length}`,
      note:
        affected === 0
          ? "nothing affected"
          : `${affected} affected, in the ${counted(things.length, "thing").toLowerCase()} above`,
      alarm: false,
    },
    ...(runtime === undefined || runtime.state === "off"
      ? []
      : [
          {
            label: `${runtime.tool === "ECS" ? "Tasks" : "Pods"} ready`,
            value: `${pods.filter((pod) => pod.ready).length}/${pods.length}`,
            note: `${pods.reduce((total, pod) => total + pod.restarts, 0)} restarts`,
            alarm: pods.some((pod) => !pod.ready),
          },
        ]),
    {
      label: "Builds failing",
      value: String(failing.length),
      note: failing.length === 0 ? "every last build passed" : failing.slice(0, 2).join(", "),
      alarm: failing.length > 0,
    },
  ]
  return [...own, ...always].slice(0, Math.max(4, own.length))
}

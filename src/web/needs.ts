/**
 * What needs someone, counted once (spec 0068): an open incident with its firing alerts, an alert in no incident, a
 * deploy stuck here, and an entry degraded or down that none of those is about. Every count on the overview is these.
 */
import type { Alert, Events, Health } from "../shared/events"
import { worstFirst } from "./parts/AlertLine"
import { pathOf } from "./route"

export type ThingKind = "incident" | "alert" | "deploy" | "degraded"

export interface Thing {
  readonly kind: ThingKind
  readonly tone: "critical" | "attention"
  readonly title: string
  /** One line in Estate's words; a tool's own message is left to the page the thing opens. */
  readonly what: string
  readonly owners: ReadonlyArray<string>
  readonly since?: string
  readonly to: string
  /** The firing alerts it holds, worst first, for their cards. */
  readonly alerts: ReadonlyArray<Alert>
  /** The services and stores it is about, so a degraded one is not counted again. */
  readonly about: ReadonlyArray<string>
}

export const kindWords: Readonly<Record<ThingKind, string>> = {
  incident: "Incident",
  alert: "Alert",
  deploy: "Deploy stuck",
  degraded: "Degraded",
}

const order: ReadonlyArray<ThingKind> = ["incident", "alert", "deploy", "degraded"]

const engines: Readonly<Record<string, string>> = {
  postgres: "Postgres",
  cnpg: "Postgres",
  mysql: "MySQL",
  redis: "Redis",
  kafka: "Kafka",
}

/** A store by its catalog name with its kind beside it, "bus (Kafka)"; a service by its name. */
export const namedOf = (events: Partial<Events>, name: string): string => {
  const store = events.catalog?.stores?.find((each) => each.name === name)
  const engine = store === undefined ? undefined : engines[store.engine]
  return engine === undefined ? name : `${name} (${engine})`
}

const whereOf = (alert: Alert) => alert.service ?? alert.store

/** Who owns an entry: its team's title, else its owner's name, else its category. */
const ownerOf = (events: Partial<Events>, name: string | undefined): string | undefined => {
  if (name === undefined) return undefined
  const catalog = events.catalog
  const entry = [
    ...(catalog?.services ?? []),
    ...(catalog?.stores ?? []),
    ...(catalog?.jobs ?? []),
    ...(catalog?.agents ?? []),
  ].find((each) => each.name === name)
  const owner = entry !== undefined && "owner" in entry ? entry.owner : undefined
  return catalog?.teams?.find((team) => team.name === owner)?.title ?? owner ?? entry?.category
}

const ownersOf = (events: Partial<Events>, names: ReadonlyArray<string | undefined>) => [
  ...new Set(names.flatMap((name) => ownerOf(events, name) ?? [])),
]

const toneOf = (alerts: ReadonlyArray<Alert>): Thing["tone"] =>
  alerts.some((alert) => alert.severity === "critical") ? "critical" : "attention"

const incidentsOf = (events: Partial<Events>, firing: ReadonlyArray<Alert>): ReadonlyArray<Thing> => {
  const open = new Map<string, Alert[]>()
  for (const alert of firing)
    if (alert.incident !== undefined && !alert.incident.closed)
      open.set(alert.incident.id, [...(open.get(alert.incident.id) ?? []), alert])
  return [...open.values()].flatMap((held) => {
    const alerts = held.toSorted(worstFirst)
    const incident = alerts[0]?.incident
    if (incident === undefined) return []
    const first = held.toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0]
    return [
      {
        kind: "incident" as const,
        tone: toneOf(alerts),
        title: incident.title,
        what: `${alerts.length === 1 ? "1 alert" : `${alerts.length} alerts`}: ${alerts.map((alert) => alert.name).join(", ")}.`,
        owners: ownersOf(events, alerts.map(whereOf)),
        ...(first === undefined ? {} : { since: first.startsAt }),
        to: pathOf({ page: "incident", id: incident.id }),
        alerts,
        about: alerts.flatMap((alert) => whereOf(alert) ?? []),
      },
    ]
  })
}

const alertOf = (events: Partial<Events>, alert: Alert): Thing => {
  const where = whereOf(alert)
  const said = where === undefined ? alert.name : `${alert.name} on ${namedOf(events, where)}`
  return {
    kind: "alert",
    tone: toneOf([alert]),
    title: alert.summary ?? alert.name,
    what: alert.impact === undefined ? `${said}.` : `${said}. ${alert.impact.text}`,
    owners: ownersOf(events, [where]),
    since: alert.startsAt,
    to: pathOf({ page: "alert", id: alert.id }),
    alerts: [alert],
    about: where === undefined ? [] : [where],
  }
}

const stuckOf = (events: Partial<Events>): ReadonlyArray<Thing> => {
  const environment = events.catalog?.environment
  const here = new Set((events.services?.services ?? []).map((service) => service.name))
  return (events.deploys?.services ?? []).flatMap((service) =>
    service.environments
      .filter((each) => each.environment === environment && each.stalled !== undefined && here.has(service.name))
      .map((each) => ({
        kind: "deploy" as const,
        tone: "attention" as const,
        title: `${service.name} cannot roll out its new version`,
        what: `${each.running === undefined ? "Its deploy is stuck" : `${each.running} still serves`}; its page says what the deploy tool said.`,
        owners: ownersOf(events, [service.name]),
        ...(each.chosen?.at === undefined ? {} : { since: each.chosen.at }),
        to: pathOf({ page: "service", name: service.name }),
        alerts: [],
        about: [service.name],
      })),
  )
}

const troubled = (health: Health): health is "attention" | "critical" => health === "attention" || health === "critical"

const degradedOf = (events: Partial<Events>, covered: ReadonlySet<string>): ReadonlyArray<Thing> => {
  const entries: ReadonlyArray<{
    readonly name: string
    readonly health: Health
    readonly reasons: ReadonlyArray<string>
    readonly to: string
  }> = [
    ...(events.services?.services ?? []).map((each) => ({ ...each, to: pathOf({ page: "service", name: each.name }) })),
    ...(events.services?.stores ?? []).map((each) => ({ ...each, to: pathOf({ page: "store", name: each.name }) })),
    ...(events.services?.jobs ?? []).map((each) => ({ ...each, to: pathOf({ page: "job", name: each.name }) })),
    ...(events.services?.agents ?? []).map((each) => ({ ...each, to: pathOf({ page: "agent", name: each.name }) })),
  ]
  return entries.flatMap((entry) => {
    const health = entry.health
    if (!troubled(health) || covered.has(entry.name)) return []
    return [
      {
        kind: "degraded" as const,
        tone: health,
        title: `${namedOf(events, entry.name)} is ${health === "critical" ? "down" : "degraded"}`,
        what: entry.reasons.length === 0 ? "Its source says it is unwell." : `${entry.reasons.join("; ")}.`,
        owners: ownersOf(events, [entry.name]),
        to: entry.to,
        alerts: [],
        about: [entry.name],
      },
    ]
  })
}

const rank = (thing: Thing) => order.indexOf(thing.kind) * 2 + (thing.tone === "critical" ? 0 : 1)

/** Everything that needs someone here, incidents first, then alerts, stuck deploys and the degraded; worst first. */
export const thingsOf = (events: Partial<Events>): ReadonlyArray<Thing> => {
  const firing = (events.alerts?.alerts ?? []).filter((alert) => alert.state === "firing")
  const incidents = incidentsOf(events, firing)
  const alone = firing
    .filter((alert) => alert.incident === undefined || alert.incident.closed)
    .toSorted(worstFirst)
    .map((alert) => alertOf(events, alert))
  const stuck = stuckOf(events)
  const covered = new Set([...incidents, ...alone, ...stuck].flatMap((thing) => thing.about))
  const things = [...incidents, ...alone, ...stuck, ...degradedOf(events, covered)]
  return things.toSorted((a, b) => rank(a) - rank(b) || Date.parse(a.since ?? "9999") - Date.parse(b.since ?? "9999"))
}

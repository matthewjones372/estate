/**
 * The open incident a live firing may belong to (spec 0042), from what the estate already holds: one of its firings
 * started near it in time and is related to it, by the same alert elsewhere, the same service or store, or a map edge.
 * Time alone is never enough.
 */
import { Option } from "effect"
import type { Alert } from "../../shared/events"
import type { Incident, Suggested } from "../../shared/incidents"
import { sameFiring } from "../notes"
import type { EstateState } from "../state"
import { serviceOf } from "./health"
import { neighboursOf } from "./neighbours"
import { storeOf, storesIn } from "./stores"

type Firing = Pick<Alert, "id" | "name" | "state" | "startsAt" | "service" | "store">
type Why = Suggested["why"]

/** Strongest first, for a firing that fits more than one incident. */
const strength: Readonly<Record<Why, number>> = { "same alert": 0, "same service": 1, "same store": 1, "next to it": 2 }

interface Anchor {
  readonly environment: string
  readonly alert: string
  readonly name: string
  readonly startsAt: string
  readonly service: string | undefined
  readonly store: string | undefined
}

/** One of an incident's firings, its service or store read from the alert held now, or its kept record once resolved. */
const anchorOf = (estate: EstateState, firing: Incident["firings"][number]): Anchor => {
  const held = estate.environments[firing.environment]?.alerts.value?.find((each) => each.id === firing.alert)
  const key = { environment: firing.environment, alert: firing.alert, startsAt: firing.startsAt }
  if (held !== undefined)
    return {
      ...key,
      name: held.name,
      service: serviceOf(held.labels, estate.catalog.services),
      store: storeOf(held.labels, storesIn(estate.catalog, firing.environment)),
    }
  const kept = estate.firings?.find((each) => sameFiring(each, firing))
  return { ...key, name: kept?.name ?? firing.name ?? firing.alert, service: kept?.service, store: kept?.store }
}

const relationOf = (estate: EstateState, environment: string, alert: Firing, anchor: Anchor): Why | undefined => {
  if (anchor.environment !== environment) return anchor.name === alert.name ? "same alert" : undefined
  if (alert.service !== undefined && alert.service === anchor.service) return "same service"
  if (alert.store !== undefined && alert.store === anchor.store) return "same store"
  const subject = alert.service ?? alert.store
  const other = anchor.service ?? anchor.store
  return subject !== undefined &&
    other !== undefined &&
    neighboursOf(estate, other).some((each) => each.name === subject)
    ? "next to it"
    : undefined
}

const minute = 60_000

/** The open incident `alert`, firing in `environment`, may belong to: started within `within` minutes of one of its firings. */
export const suggestedFor = (
  estate: EstateState,
  environment: string,
  alert: Firing,
  within: number,
): Option.Option<Suggested> => {
  if (alert.state !== "firing") return Option.none()
  const firing = { environment, alert: alert.id, startsAt: alert.startsAt }
  const open = (estate.incidents ?? []).filter((each) => each.closedAt === undefined)
  if (open.some((each) => each.firings.some((one) => sameFiring(one, firing)))) return Option.none()
  const found = open
    .filter((incident) => !(incident.dismissed ?? []).some((each) => sameFiring(each, firing)))
    .flatMap((incident) =>
      incident.firings.flatMap((one): ReadonlyArray<Suggested> => {
        const since = Date.parse(alert.startsAt) - Date.parse(one.startsAt)
        if (Math.abs(since) > within * minute) return []
        const anchor = anchorOf(estate, one)
        const why = relationOf(estate, environment, alert, anchor)
        return why === undefined
          ? []
          : [
              {
                incident: { id: incident.id, title: incident.title },
                why,
                to: { environment: anchor.environment, alert: anchor.alert, name: anchor.name },
                apart: Math.round(since / minute),
              },
            ]
      }),
    )
  return Option.fromUndefinedOr(
    found.toSorted((a, b) => strength[a.why] - strength[b.why] || Math.abs(a.apart) - Math.abs(b.apart))[0],
  )
}

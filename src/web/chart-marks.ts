/**
 * When something happened to what a chart is of, to draw across it (spec 0068): each version applied to the service,
 * from the day's feed, and each of its alerts that fired, firing still or ended today; only those in the window shown.
 */
import type { Alert, AlertsEvent } from "../shared/events"
import type { FeedItem } from "../shared/feed"
import { clock } from "./format"

export interface ChartMark {
  readonly at: number
  readonly kind: "deploy" | "fired"
  /** "main-154-199fdaf applied 10:31", "CheckoutSlow fired 10:53". */
  readonly label: string
}

export const marksOf = (
  of: { readonly service?: string; readonly store?: string },
  feed: ReadonlyArray<FeedItem>,
  alerts: ReadonlyArray<Alert>,
  resolved: AlertsEvent["resolved"],
  window: { readonly end: number; readonly span: number },
): ReadonlyArray<ChartMark> => {
  const inside = (at: number) => at >= window.end - window.span && at <= window.end
  const about = (each: { readonly service?: string; readonly store?: string }) =>
    (of.service !== undefined && each.service === of.service) || (of.store !== undefined && each.store === of.store)
  const deploys = feed.flatMap((item): ReadonlyArray<ChartMark> => {
    const at = Date.parse(item.at)
    return item.kind === "deploy" && item.version !== undefined && about(item) && inside(at)
      ? [{ at, kind: "deploy", label: `${item.version} applied ${clock(item.at)}` }]
      : []
  })
  const fired = [...alerts.filter((alert) => alert.state !== "pending"), ...resolved].flatMap(
    (alert): ReadonlyArray<ChartMark> => {
      const at = Date.parse(alert.startsAt)
      return about(alert) && inside(at)
        ? [{ at, kind: "fired", label: `${alert.name} fired ${clock(alert.startsAt)}` }]
        : []
    },
  )
  return [...deploys, ...fired].toSorted((a, b) => a.at - b.at)
}

/** An environment's headline: what needs someone, and why, worst first — the same words as the overview. */
import type { Health } from "../../shared/events"
import type { EstateState } from "../state"
import { alertsView } from "./alerts"
import { servicesView } from "./services"

const counts = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"]
const counted = (count: number, noun: string): string =>
  `${counts[count] ?? count.toLocaleString("en-GB")} ${count === 1 ? noun : `${noun}s`}`

const rank: Readonly<Record<Health, number>> = { healthy: 0, unknown: 1, attention: 2, critical: 3 }

interface NowItem {
  readonly name: string
  readonly kind: "service" | "store" | "job" | "agent"
  readonly health: Health
  readonly reasons: ReadonlyArray<string>
}

export interface NowView {
  readonly environment: string
  readonly tone: "healthy" | "attention" | "critical"
  readonly kicker: string
  readonly top: string
  readonly bottom: string
  readonly lede: string
  readonly needs: ReadonlyArray<NowItem>
  readonly summary: string
}

/** What needs someone in an environment, worst first, in the overview's words. */
export const nowView = (estate: EstateState, environment: string): NowView => {
  const services = servicesView(estate, environment)
  const firing = alertsView(estate, environment, false).alerts.filter((alert) => alert.state === "firing")
  const items: NowItem[] = [
    ...services.services.map((each) => ({
      name: each.name,
      kind: "service" as const,
      health: each.health,
      reasons: each.reasons,
    })),
    ...(services.stores ?? []).map((each) => ({
      name: each.name,
      kind: "store" as const,
      health: each.health,
      reasons: each.reasons,
    })),
    ...(services.jobs ?? []).map((each) => ({
      name: each.name,
      kind: "job" as const,
      health: each.health,
      reasons: each.reasons,
    })),
    ...(services.agents ?? []).map((each) => ({
      name: each.name,
      kind: "agent" as const,
      health: each.health,
      reasons: each.reasons,
    })),
  ]
  const troubled = items
    .filter((each) => each.health === "attention" || each.health === "critical")
    .sort((a, b) => rank[b.health] - rank[a.health] || a.name.localeCompare(b.name))
  const critical =
    firing.some((alert) => alert.severity === "critical") || items.some((each) => each.health === "critical")
  const count = Math.max(firing.length, troubled.length)
  const reasons = troubled.flatMap((each) => each.reasons.slice(0, 1).map((reason) => `${each.name}: ${reason}`))
  if (count === 0 && items.length > 0 && items.every((each) => each.health === "unknown")) {
    return {
      environment,
      tone: "healthy",
      kicker: "Listening",
      top: "Not heard yet.",
      bottom: "Reading the sources.",
      lede: "No source has said how the services are, so nothing is claimed about them yet.",
      needs: [],
      summary: "Not heard yet. Reading the sources.",
    }
  }
  if (count === 0) {
    const healthy = items.filter((each) => each.health === "healthy").length
    const lede =
      items.length === 0
        ? "No service is in this environment yet."
        : `${counted(healthy, "service")} healthy, nothing firing.`
    return {
      environment,
      tone: "healthy",
      kicker: "All healthy",
      top: "All quiet.",
      bottom: "Nothing needs you.",
      lede,
      needs: [],
      summary: `All quiet. ${lede}`,
    }
  }
  const tone = critical ? ("critical" as const) : ("attention" as const)
  const kicker = critical ? "Something is down" : "Needs attention"
  const top = counted(count, "thing")
  const bottom = count === 1 ? "needs you." : "need you."
  const lede = `${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? `; and ${reasons.length - 3} more` : ""}.`
  return {
    environment,
    tone,
    kicker,
    top,
    bottom,
    lede,
    needs: troubled,
    summary: `${kicker}: ${top} ${bottom} ${lede}`,
  }
}

/**
 * The demo's traffic rising and falling, in production, on a cycle told from when the world started: a lunchtime
 * rush through the shop and checkout, a newsletter that sends people searching, and an app's push notification that
 * brings a burst to the apps and baskets. Staging's traffic is the testers', and stays level.
 */
import { type Environment, started } from "./clock"

/** How long the cycle of events is, in seconds: every chart's last hour holds a couple of each. */
const cycle = 24 * 60

interface Event {
  readonly name: string
  readonly services: ReadonlySet<string>
  /** When in the cycle it starts, in seconds. */
  readonly at: number
  /** How many times the usual traffic it peaks at, and the seconds it takes to rise, hold and fall. */
  readonly peak: number
  readonly rise: number
  readonly hold: number
  readonly fall: number
}

export const events: ReadonlyArray<Event> = [
  {
    name: "a lunchtime rush",
    services: new Set(["web", "mobile-api", "basket", "checkout", "payments", "fraud", "orders", "pricing", "loyalty"]),
    at: 3 * 60,
    peak: 2.6,
    rise: 180,
    hold: 240,
    fall: 180,
  },
  {
    name: "the weekly newsletter",
    services: new Set(["search", "recommendations", "web"]),
    at: 15 * 60,
    peak: 4,
    rise: 40,
    hold: 30,
    fall: 210,
  },
  {
    name: "a push notification from the app",
    services: new Set(["mobile-api", "basket", "identity", "notifications"]),
    at: 20 * 60,
    peak: 5,
    rise: 25,
    hold: 40,
    fall: 60,
  },
]

/** How far through an event's shape a moment is: 0 before and after, 1 at its peak, smooth between. */
const shape = (event: Event, into: number) => {
  const eased = (share: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, share)))) / 2
  if (into < 0 || into > event.rise + event.hold + event.fall) return 0
  if (into < event.rise) return eased(into / event.rise)
  if (into < event.rise + event.hold) return 1
  return 1 - eased((into - event.rise - event.hold) / event.fall)
}

const intoCycle = (seconds: number) => (((seconds - started / 1000) % cycle) + cycle) % cycle

/** How many times its usual traffic a service has at a moment, in seconds since the epoch. */
export const trafficOf = (service: string, environment: Environment, seconds: number) =>
  environment === "staging"
    ? 1
    : events.reduce(
        (factor, event) =>
          event.services.has(service)
            ? factor * (1 + (event.peak - 1) * shape(event, intoCycle(seconds) - event.at))
            : factor,
        1,
      )

/** The shop as a whole, for the vitals and the stores: the rush's share of it. */
export const shopTrafficOf = (environment: Environment, seconds: number) => trafficOf("checkout", environment, seconds)

/** When each event next starts, for the words `run.ts` prints. */
export const nextOf = (event: Event, now = Date.now() / 1000) => {
  const wait = (event.at - intoCycle(now) + cycle) % cycle
  return Math.round(wait / 60)
}

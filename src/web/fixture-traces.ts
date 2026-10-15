/** A journey and its traces as the server would answer them, for the pages' tests. */
import type { Journey } from "../shared/catalog"
import type { Events } from "../shared/events"
import { traceView } from "../shared/trace-view"
import { type Lanes, sampleOf, type Trace, type TraceSpan } from "../shared/traces"
import { events } from "./fixture"

const at = Date.parse("2026-10-03T11:58:00Z")

const span = (id: string, service: string, name: string, from: number, to: number, more: Partial<TraceSpan> = {}) => ({
  id,
  service,
  name,
  kind: "internal" as const,
  start: at + from,
  end: at + to,
  failed: false,
  ...more,
})

/** An order that waits in the outbox until the relay's next poll. */
const order = (id: string, wait: number, failed = false): Trace => ({
  id,
  spans: [
    span("a", "storefront", "place order", 0, 40, { kind: "client" }),
    span("b", "orders", "POST /orders", 6, 38, { kind: "server", parent: "a" }),
    span("c", "orders", "take order", 7, 36, { parent: "b", failed }),
    span("d", "orders", "INSERT outbox", 33, 36, { parent: "c" }),
    span("e", "orders", "publish", 36 + wait, 41 + wait, { kind: "producer", parent: "c" }),
  ],
})

const journey: Journey = {
  name: "order",
  title: "Placing an order",
  environments: ["production"],
  start: { service: "storefront", span: "place order" },
  stages: [
    { title: "Reaches orders", where: "storefront", from: { start: "place order" }, to: { start: "POST /orders" } },
    { title: "Takes the order", where: "orders", span: "take order" },
    { title: "Written to the outbox", where: "orders-db", span: "INSERT outbox" },
    { title: "Waits in the outbox", where: "orders-db", from: { end: "INSERT outbox" }, to: { start: "publish" } },
    { title: "Published", where: "events", span: "publish" },
  ],
}

const lanes: Lanes = {
  where: (where) => ({ id: where, title: where }),
  service: (service) => ({ id: service, title: service }),
}

export const journeySample = sampleOf(
  journey,
  lanes,
  [order("t1", 480), order("t2", 950), order("t3", 20), order("t4", 300, true)],
  15,
)

export const orderTrace = traceView(order("t2", 950), lanes, journey)

/** An order refused while it was taken: it never reached the outbox. */
export const refusedTrace = traceView(
  { id: "t4", spans: order("t4", 300, true).spans.filter((each) => ["a", "b", "c"].includes(each.id)) },
  lanes,
  journey,
)

/** The fixture's events with one journey, by `name`, across storefront, orders and the database. */
export const withJourney = (name: string): Partial<Events> => ({
  ...events,
  ...(events.catalog === undefined
    ? {}
    : {
        catalog: {
          ...events.catalog,
          journeys: [
            {
              name,
              title: "Placing an order",
              services: ["storefront", "orders"],
              places: [
                { node: "storefront", stages: [0] },
                { node: "orders", stages: [1] },
                { node: "db", stages: [2, 3] },
              ],
            },
          ],
        },
      }),
})

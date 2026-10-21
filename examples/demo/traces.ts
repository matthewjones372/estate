/**
 * Tempo in the demo: an order placed every few seconds, each one trace from the web through checkout and payments to
 * orders, which publishes it to bus's orders topic with OpenTelemetry's messaging attributes. Each group reading
 * orders has a consumer span once its committed offset has passed the order's, so a followed order is read live.
 */
import { type Environment, seedOf, started } from "./clock"
import { clustersIn, newest, orders, passedAt } from "./kafka"
import { slowSince } from "./story"

const every = (environment: Environment) => (environment === "production" ? 6_000 : 30_000)

/** Orders are counted from the hour before the world started. */
const first = started - 3_600_000

const placedAt = (environment: Environment, order: number) => first + order * every(environment)

const prefix = (environment: Environment) => (environment === "production" ? "a1" : "5a")

/** An order's trace ID: its environment and its number, as 32 hex digits. */
export const traceIdOf = (environment: Environment, order: number) =>
  `${prefix(environment)}${order.toString(16).padStart(30, "0")}`

const orderOf = (environment: Environment, id: string) =>
  id.startsWith(prefix(environment)) && id.length === 32 ? Number.parseInt(id.slice(2), 16) : undefined

/** The newest order placed by now: its trace is complete as far as it has got. */
export const latestOrder = (environment: Environment) => Math.floor((Date.now() - first) / every(environment)) - 1

const nanos = (millis: number) => `${Math.round(millis)}000000`
const text = (key: string, value: string) => ({ key, value: { stringValue: value } })
const number = (key: string, value: number) => ({ key, value: { intValue: String(value) } })

interface Span {
  readonly service: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly name: string
  readonly kind: string
  readonly from: number
  readonly to: number
  readonly attributes?: ReadonlyArray<unknown>
  readonly failed?: boolean
}

/** Where an order went on the bus: its partition, and the offset it was written at. */
export const writtenOf = (environment: Environment, order: number) => {
  const placed = placedAt(environment, order)
  const slow = environment === "production" && placed > slowSince
  const checkout = slow ? 940 : 160
  const published = placed + checkout + (environment === "production" ? 320 : 90)
  const partition = order % orders.partitions
  return { placed, checkout, published, partition, offset: newest(orders, partition, published + 4) }
}

const spansOf = (environment: Environment, order: number): ReadonlyArray<Span> => {
  const { placed, checkout, published, partition, offset } = writtenOf(environment, order)
  const at = (millis: number) => millis - placed
  const customer = `cust-${100 + (seedOf(String(order)) % 900)}`
  const bus = clustersIn(environment).find((cluster) => cluster.name === "bus")
  const topic = bus?.topics.find((each) => each.name === "orders") ?? orders
  const consumers = (bus?.groups ?? [])
    .filter((group) => group.topics.includes("orders"))
    .flatMap((group, index): ReadonlyArray<Span> => {
      const read = bus === undefined ? undefined : passedAt(bus, group, topic, partition, offset, published + 4)
      return read === undefined
        ? []
        : [
            {
              service: group.service,
              spanId: `c${index}`,
              parentSpanId: "e",
              name: "process orders",
              kind: "CONSUMER",
              from: at(read),
              to: at(read) + 6 + index,
              attributes: [
                text("messaging.system", "kafka"),
                text("messaging.operation.type", "process"),
                text("messaging.destination.name", "orders"),
                text("messaging.consumer.group.name", group.name),
                text("messaging.destination.partition.id", String(partition)),
                number("messaging.kafka.offset", offset),
              ],
            },
          ]
    })
  return [
    { service: "web", spanId: "a", name: "place order", kind: "CLIENT", from: 0, to: checkout + 30 },
    {
      service: "checkout",
      spanId: "b",
      parentSpanId: "a",
      name: "POST /checkout",
      kind: "SERVER",
      from: 8,
      to: checkout + 20,
    },
    { service: "payments", spanId: "c", parentSpanId: "b", name: "take payment", kind: "SERVER", from: 20, to: 92 },
    {
      service: "orders",
      spanId: "d",
      parentSpanId: "b",
      name: "INSERT orders",
      kind: "INTERNAL",
      from: checkout,
      to: checkout + 12,
    },
    {
      service: "orders",
      spanId: "e",
      parentSpanId: "d",
      name: "publish",
      kind: "PRODUCER",
      from: at(published),
      to: at(published) + 4,
      attributes: [
        text("messaging.system", "kafka"),
        text("messaging.operation.type", "send"),
        text("messaging.destination.name", "orders"),
        text("messaging.destination.partition.id", String(partition)),
        number("messaging.kafka.offset", offset),
        text("messaging.kafka.message.key", customer),
        text("messaging.message.id", `order-${order}`),
      ],
    },
    ...consumers,
  ]
}

const traceOf = (environment: Environment, order: number) => {
  const placed = placedAt(environment, order)
  const spans = spansOf(environment, order)
  const services = [...new Set(spans.map((span) => span.service))]
  return {
    batches: services.map((service) => ({
      resource: { attributes: [text("service.name", service)] },
      scopeSpans: [
        {
          spans: spans
            .filter((span) => span.service === service)
            .map((span) => ({
              spanId: span.spanId,
              ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
              name: span.name,
              kind: `SPAN_KIND_${span.kind}`,
              startTimeUnixNano: nanos(placed + span.from),
              endTimeUnixNano: nanos(placed + span.to),
              attributes: span.attributes ?? [],
              status: span.failed === true ? { code: 2 } : {},
            })),
        },
      ],
    })),
  }
}

/** Tempo's answer to a path under its API, or undefined where it is not one of Tempo's. */
export const tempoAnswer = (environment: Environment, url: URL): unknown => {
  if (url.pathname === "/api/search") {
    const query = url.searchParams.get("q") ?? ""
    const id = /messaging\.message\.id = "order-(\d+)"/.exec(query)?.[1]
    if (id !== undefined) {
      const order = Number(id)
      return { traces: order <= latestOrder(environment) ? [{ traceID: traceIdOf(environment, order) }] : [] }
    }
    const from = Number(url.searchParams.get("start")) * 1000
    const to = Math.min(Date.now(), Number(url.searchParams.get("end")) * 1000)
    const most = Number(url.searchParams.get("limit") ?? 20)
    const traces: Array<{ traceID: string }> = []
    for (let order = latestOrder(environment); order >= 0 && traces.length < most; order -= 1) {
      const placed = placedAt(environment, order)
      if (placed < from) break
      if (placed <= to) traces.push({ traceID: traceIdOf(environment, order) })
    }
    return { traces }
  }
  const id = /^\/api\/traces\/([0-9a-f]+)$/.exec(url.pathname)?.[1]
  const order = id === undefined ? undefined : orderOf(environment, id)
  return order === undefined || order > latestOrder(environment) ? undefined : traceOf(environment, order)
}

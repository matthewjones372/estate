/** Tempo, as e2e/tools.ts answers it: a few orders placed in the last minutes, each one trace from the storefront on. */
const ids = ["c0ffee01", "c0ffee02", "c0ffee03", "c0ffee04"] as const

/** How long each order waited in the outbox: the last is the slowest by far, to be marked against the usual. */
const waits: Readonly<Record<string, number>> = { c0ffee01: 120, c0ffee02: 180, c0ffee03: 150, c0ffee04: 900 }

const nanos = (millis: number) => String(Math.round(millis * 1e6))
const resource = (service: string) => ({ attributes: [{ key: "service.name", value: { stringValue: service } }] })

const traceOf = (id: string) => {
  const wait = waits[id] ?? 150
  const start = Date.now() - (ids.indexOf(id as (typeof ids)[number]) + 1) * 60_000
  const span = (spanId: string, name: string, from: number, to: number, kind: string, parent?: string) => ({
    spanId,
    ...(parent === undefined ? {} : { parentSpanId: parent }),
    name,
    kind: `SPAN_KIND_${kind}`,
    startTimeUnixNano: nanos(start + from),
    endTimeUnixNano: nanos(start + to),
    status: {},
  })
  return {
    batches: [
      { resource: resource("storefront"), scopeSpans: [{ spans: [span("a", "place order", 0, 42, "CLIENT")] }] },
      {
        resource: resource("orders"),
        scopeSpans: [
          {
            spans: [
              span("b", "POST /orders", 6, 40, "SERVER", "a"),
              span("c", "take order", 7, 38, "INTERNAL", "b"),
              span("d", "INSERT outbox", 34, 38, "INTERNAL", "c"),
              span("e", "publish", 38 + wait, 44 + wait, "PRODUCER", "d"),
            ],
          },
        ],
      },
    ],
  }
}

/** Tempo's answer to `path`, or undefined where it is not one of Tempo's. */
export const tempo = (path: string): unknown => {
  if (path === "/api/search") return { traces: ids.map((traceID) => ({ traceID })) }
  const id = /^\/api\/traces\/([^/]+)$/.exec(path)?.[1]
  return id !== undefined && ids.includes(id as (typeof ids)[number]) ? traceOf(id) : undefined
}

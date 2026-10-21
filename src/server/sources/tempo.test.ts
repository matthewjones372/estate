import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import { messageNames } from "../../shared/messaging"
import { type Call, reply, stubRemote } from "../remote"
import { readTrace, searchTraces, spansCarrying, spansNamed } from "./tempo"

const tempo = { url: "http://tempo:3200", headers: { "x-scope-orgid": "shop" } }

const resource = (service: string) => ({ attributes: [{ key: "service.name", value: { stringValue: service } }] })

const text = (key: string, value: string) => ({ key, value: { stringValue: value } })
const number = (key: string, value: string | number) => ({ key, value: { intValue: value } })

/** A producer's or a consumer's span through Kafka, its attributes under both the current names and older ones. */
const carried = (service: string, name: "publish" | "process", kind: number) => ({
  resource: resource(service),
  scopeSpans: [
    {
      spans: [
        {
          spanId: name,
          name,
          kind,
          startTimeUnixNano: "1791979421000000000",
          endTimeUnixNano: "1791979421002000000",
          attributes:
            name === "publish"
              ? [
                  text("messaging.system", "kafka"),
                  text("messaging.operation.type", "send"),
                  text("messaging.destination.name", "events"),
                  text("messaging.destination.partition.id", "2"),
                  number("messaging.kafka.offset", "1882340"),
                  text("messaging.kafka.message.key", "pet-7"),
                  text("messaging.message.id", "81723"),
                  text("http.route", "/adoptions"),
                ]
              : [
                  text("messaging.system", "kafka"),
                  text("messaging.operation", "process"),
                  text("messaging.destination.name", "events"),
                  number("messaging.destination.partition.id", 2),
                  number("messaging.kafka.message.offset", 1882340),
                  text("messaging.kafka.consumer.group", "petshop-projection"),
                ],
        },
      ],
    },
  ],
})

/** Tempo's answers, in the shapes its API reference gives: a search, and a trace whole as OTLP's JSON. */
const fake = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.headers?.["x-scope-orgid"] !== "shop") return reply("no org id", 401)
  const url = new URL(call.url)
  if (url.pathname === "/api/search") return reply({ traces: [{ traceID: "4bf92f35" }, { traceID: "9a1c" }] })
  if (url.pathname === "/api/traces/4bf92f35")
    return reply({
      batches: [
        {
          resource: resource("shop-web"),
          scopeSpans: [
            {
              spans: [
                {
                  spanId: "AAA=",
                  parentSpanId: "",
                  name: "adopt pet",
                  kind: "SPAN_KIND_CLIENT",
                  startTimeUnixNano: "1791979421000000000",
                  endTimeUnixNano: "1791979421049000000",
                  status: {},
                },
              ],
            },
          ],
        },
        {
          resource: resource("shop"),
          instrumentationLibrarySpans: [
            {
              spans: [
                {
                  spanId: "BBB=",
                  parentSpanId: "AAA=",
                  name: "POST /adoptions",
                  kind: 2,
                  startTimeUnixNano: 1791979421009000000,
                  endTimeUnixNano: 1791979421048000000,
                  status: { code: "STATUS_CODE_ERROR" },
                },
              ],
            },
          ],
        },
      ],
    })
  if (url.pathname === "/api/traces/5c0d")
    return reply({ batches: [carried("shop", "publish", 4), carried("shop", "process", 5)] })
  if (url.pathname === "/api/traces/9a1c")
    return reply({ trace: { resourceSpans: [{ resource: resource("shop"), scopeSpans: [{ spans: [] }] }] } })
  return reply("trace not found", 404)
}

describe("traces in Tempo", () => {
  test("are found by TraceQL in a window, sending the tenant", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      searchTraces(tempo, spansNamed("shop-web", "adopt pet"), { from: 1_000_500, to: 1_900_200 }, 50).pipe(
        Effect.provide(stubRemote(fake(calls))),
      ),
    ).then((ids) => {
      expect(ids).toEqual(["4bf92f35", "9a1c"])
      const asked = new URL(calls[0]?.url ?? "").searchParams
      expect(Object.fromEntries(asked)).toEqual({
        q: '{ resource.service.name = "shop-web" && name = "adopt pet" }',
        start: "1000",
        end: "1901",
        limit: "50",
      })
    })
  })

  test("are read whole, each span with its service, parent, kind, times and whether it failed", () =>
    Effect.runPromise(readTrace(tempo, "4bf92f35").pipe(Effect.provide(stubRemote(fake([]))))).then((trace) =>
      expect(trace).toEqual({
        id: "4bf92f35",
        spans: [
          {
            id: "AAA=",
            service: "shop-web",
            name: "adopt pet",
            kind: "client",
            start: 1791979421000,
            end: 1791979421049,
            failed: false,
          },
          {
            id: "BBB=",
            parent: "AAA=",
            service: "shop",
            name: "POST /adoptions",
            kind: "server",
            start: 1791979421009,
            end: 1791979421048,
            failed: true,
          },
        ],
      }),
    ))

  test("keep a producer span's topic, partition, offset, key and message ID, under OpenTelemetry's names", () =>
    Effect.runPromise(readTrace(tempo, "5c0d").pipe(Effect.provide(stubRemote(fake([]))))).then((trace) =>
      expect(trace.spans.map((span) => span.messaging)).toEqual([
        {
          system: "kafka",
          operation: "send",
          topic: "events",
          partition: 2,
          offset: 1_882_340,
          key: "pet-7",
          id: "81723",
        },
        { system: "kafka", topic: "events", partition: 2 },
      ]),
    ))

  test("keep a consumer span's group under the names a store gives, where its instrumentation is older", () =>
    Effect.runPromise(
      readTrace(
        tempo,
        "5c0d",
        messageNames({
          operation: "messaging.operation",
          offset: "messaging.kafka.message.offset",
          group: "messaging.kafka.consumer.group",
        }),
      ).pipe(Effect.provide(stubRemote(fake([])))),
    ).then((trace) =>
      expect(trace.spans[1]?.messaging).toEqual({
        system: "kafka",
        operation: "process",
        topic: "events",
        partition: 2,
        offset: 1_882_340,
        group: "petshop-projection",
      }),
    ))

  test("are searched by a message's ID and topic, under the names in use", () => {
    expect(spansCarrying(messageNames(undefined), { id: "81723", topic: "events" })).toBe(
      '{ span.messaging.message.id = "81723" && span.messaging.destination.name = "events" }',
    )
    expect(spansCarrying(messageNames({ id: "message id" }), { id: "81723", topic: "events" })).toBe(
      '{ span."message id" = "81723" && span.messaging.destination.name = "events" }',
    )
  })

  test("read in Tempo's v2 shape too", () =>
    Effect.runPromise(readTrace(tempo, "9a1c").pipe(Effect.provide(stubRemote(fake([]))))).then((trace) =>
      expect(trace).toEqual({ id: "9a1c", spans: [] }),
    ))

  test("say why when Tempo fails, or answers in a shape it does not know", () =>
    Effect.runPromise(
      Effect.all([
        Effect.result(readTrace(tempo, "gone")),
        Effect.result(readTrace(tempo, "4bf92f35").pipe(Effect.provide(stubRemote(() => reply({ odd: true }))))),
      ]).pipe(Effect.provide(stubRemote(fake([])))),
    ).then(([gone, odd]) => {
      expect(Result.isFailure(gone) && gone.failure.message).toBe("Tempo answered 404: trace not found")
      expect(Result.isFailure(odd) && odd.failure.message).toBe("Tempo answered in a shape Estate does not know")
    }))
})

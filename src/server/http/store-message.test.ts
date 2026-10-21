import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Catalog, Store } from "../../shared/catalog"
import type { FollowedMessage } from "../../shared/kafka-message"
import { ask, catalog, estate, serverFor, settings } from "../fixture"
import { offsetsNow, tempoNow, writtenAt } from "../fixture-kafka"
import { type Call, reply } from "../remote"
import type { Settings } from "../settings"

const bus: Store = { name: "bus", environments: ["staging"], engine: "kafka", selector: 'job="kafka"' }
const withBus: Catalog = { ...catalog, stores: [bus] }
const traced: Settings = {
  ...settings({ anonymous: { name: "visitor", role: "viewer" } }),
  sources: { staging: { prometheus: { url: "http://prometheus" }, tempo: { url: "http://tempo" } } },
}

const both = (billing?: number) => (call: Call) =>
  new URL(call.url).host === "tempo" ? tempoNow(call) : offsetsNow(billing)(call)

const asked = (path: string, from = traced, billing?: number, answer = both(billing)) =>
  Effect.flatMap(serverFor(from, estate({ catalog: withBus }), answer), (server) =>
    ask(server, new Request(`http://estate${path}`)),
  )

const followed: FollowedMessage["groups"] = [
  { name: "audit", state: "past it", offset: 1_882_400 },
  { name: "billing", state: "not yet", offset: 1_870_940, before: 11_400, seconds: 240 },
  { name: "orders-projector", state: "read", service: "petshop-projector", at: writtenAt + 276, after: 276 },
]

describe("a followed message", () => {
  test("is where it was written, and each group reading its topic read it, not yet, or past it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answered = yield* asked("/api/store-message?env=staging&store=bus&trace=4bf92f35")
        const message = answered.json() as FollowedMessage
        expect([answered.status, message.trace, message.done]).toEqual([200, "4bf92f35", false])
        expect(message.written).toEqual({
          service: "petshop",
          topic: "orders",
          partition: 0,
          offset: 1_882_340,
          key: "cust-118",
          id: "81723",
          at: writtenAt,
        })
        expect(message.groups).toEqual(followed)
        expect(message.missing).toEqual([])
      }),
    ))

  test("is found by its message ID and topic", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answered = yield* asked("/api/store-message?env=staging&store=bus&id=81723&topic=orders")
        const message = answered.json() as FollowedMessage
        expect([message.trace, message.written.offset, message.groups]).toEqual(["4bf92f35", 1_882_340, followed])
      }),
    ))

  test("is done once every group is past it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answered = yield* asked("/api/store-message?env=staging&store=bus&trace=4bf92f35", traced, 1_882_341)
        const message = answered.json() as FollowedMessage
        expect([message.groups[1], message.done]).toEqual([
          { name: "billing", state: "past it", offset: 1_882_341 },
          true,
        ])
      }),
    ))

  test("says which attribute it did not find, and why it cannot be followed without Tempo or a trace", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const plain = yield* asked("/api/store-message?env=staging&store=bus&trace=5e1f")
        expect([plain.status, plain.json()]).toEqual([
          404,
          { message: "no producer span in trace 5e1f carries messaging.destination.name" },
        ])
        const unknown = yield* asked("/api/store-message?env=staging&store=bus&id=999&topic=orders")
        expect([unknown.status, unknown.json()]).toEqual([
          404,
          { message: 'Tempo has no span with messaging.message.id = "999" on orders in the last day' },
        ])
        const bare = yield* asked("/api/store-message?env=staging&store=bus&trace=4bf92f35", {
          ...traced,
          sources: { staging: { prometheus: { url: "http://prometheus" } } },
        })
        expect([bare.status, bare.json()]).toEqual([404, { message: "staging has no Tempo to follow a message in" }])
        const vague = yield* asked("/api/store-message?env=staging&store=bus&topic=orders")
        expect([vague.status, vague.json()]).toEqual([
          400,
          { message: "a message is followed by its trace, or by its id and topic" },
        ])
      }),
    ))

  test("says why when the offsets cannot be read, and goes without its rates and linked traces when they fail", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failing = (what: string) => (call: Call) =>
          call.url.includes(what) ? reply({ error: "down" }, 503) : both()(call)
        const offsets = yield* asked(
          "/api/store-message?env=staging&store=bus&trace=4bf92f35",
          traced,
          undefined,
          failing("current_offset%7B"),
        )
        expect([offsets.status, (offsets.json() as { message: string }).message]).toEqual([
          502,
          'Prometheus answered 503: {"error":"down"}',
        ])
        const partly = yield* asked(
          "/api/store-message?env=staging&store=bus&trace=4bf92f35",
          traced,
          undefined,
          (call) =>
            call.url.includes("/api/search") || call.url.includes("sum+by")
              ? reply({ error: "down" }, 503)
              : both()(call),
        )
        const message = partly.json() as FollowedMessage
        expect([partly.status, message.groups[1]]).toEqual([
          200,
          { name: "billing", state: "not yet", offset: 1_870_940, before: 11_400, seconds: null },
        ])
      }),
    ))
})

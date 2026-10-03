import { describe, expect, test } from "bun:test"
import { BunFileSystem } from "@effect/platform-bun"
import { Effect, Layer, Redacted, Result } from "effect"
import type { Service } from "../../shared/catalog"
import { type Call, reply, stubRemote } from "../remote"
import { type Elastic, elasticLines, fieldOf, matchOf } from "./elastic"
import { logsFor } from "./logs"

const orders: Service = { name: "orders", environments: ["staging"], kubernetes: { namespace: "shop", workloads: [] } }
const elastic: Elastic = { url: "https://logs.example:9200/", apiKey: Redacted.make("a2V5") }

const hits = [
  {
    _source: {
      "@timestamp": "2026-10-03T11:59:58.000Z",
      message: "ERROR card 4111111111111111 declined",
      kubernetes: { pod: { name: "orders-a" } },
    },
  },
  {
    _source: {
      "@timestamp": "2026-10-03T11:59:57.000Z",
      message: "basket 4031 updated",
      "log.level": "info",
      "host.name": "node-1",
    },
  },
  { _source: { "@timestamp": "2026-10-03T11:59:56.000Z" } },
]

const search =
  (calls: Call[], status = 200, body: unknown = { hits: { hits } }) =>
  (call: Call) => {
    calls.push(call)
    return call.url.endsWith("/_search") ? reply(body, status) : undefined
  }

const from = Date.parse("2026-10-03T11:45:00Z")
const to = Date.parse("2026-10-03T12:00:00Z")

const read = (answer: (call: Call) => ReturnType<ReturnType<typeof search>>, settings = elastic, service = orders) =>
  Effect.runPromise(Effect.result(Effect.provide(elasticLines(settings, service, from, to, 200), stubRemote(answer))))

describe("a field in an Elasticsearch document", () => {
  test("is found nested or flat, and is nothing when it is not text", () => {
    expect(fieldOf({ log: { level: "warn" } }, "log.level")).toBe("warn")
    expect(fieldOf({ "log.level": "warn" }, "log.level")).toBe("warn")
    expect(fieldOf({ log: "flat" }, "log.level")).toBeUndefined()
    expect(fieldOf({ count: 3 }, "count")).toBeUndefined()
  })
})

describe("a service's lines from Elasticsearch", () => {
  test("are searched for by its namespace and app label over the window, newest first, with the API key", () => {
    const calls: Call[] = []
    return read(search(calls)).then((result) => {
      const lines = Result.isSuccess(result) ? result.success : []
      expect(lines).toEqual([
        { at: "2026-10-03T11:59:57.000Z", pod: "node-1", level: "INFO", text: "basket 4031 updated" },
        {
          at: "2026-10-03T11:59:58.000Z",
          pod: "orders-a",
          level: "ERROR",
          text: "ERROR card 4111111111111111 declined",
        },
      ])
      expect(calls[0]?.url).toBe("https://logs.example:9200/logs-*/_search")
      expect(calls[0]?.headers?.["authorization"]).toBe("ApiKey a2V5")
      expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
        size: 200,
        sort: [{ "@timestamp": "desc" }],
        query: {
          bool: {
            filter: [
              {
                range: {
                  "@timestamp": {
                    gte: "2026-10-03T11:45:00.000Z",
                    lte: "2026-10-03T12:00:00.000Z",
                    format: "strict_date_optional_time",
                  },
                },
              },
              { match_phrase: { "kubernetes.namespace": "shop" } },
              { match_phrase: { "kubernetes.labels.app": "orders" } },
            ],
          },
        },
      })
    })
  })

  test("are matched by the catalog's fields and message, through a user's password or no sign-in at all", () => {
    const calls: Call[] = []
    const shipped: Service = {
      name: "orders",
      environments: [],
      logs: { elastic: { match: { "service.name": "orders" }, message: "body" } },
    }
    const user = { url: "http://os:9200", index: "app-logs", username: "estate", password: Redacted.make("pw") }
    return read(search(calls, 200, { hits: { hits: [] } }), user, shipped).then(() => {
      expect(calls[0]?.url).toBe("http://os:9200/app-logs/_search")
      expect(calls[0]?.headers?.["authorization"]).toBe(`Basic ${btoa("estate:pw")}`)
      expect(matchOf(shipped)).toEqual({ "service.name": "orders" })
      expect(matchOf({ name: "x", environments: [] })).toEqual({ "kubernetes.labels.app": "x" })
      return read(search(calls), { url: "http://es", username: "estate" }).then(() => {
        expect(calls[1]?.headers?.["authorization"]).toBe(`Basic ${btoa("estate:")}`)
        return read(search(calls), { url: "http://es" }).then(() => {
          expect(calls[2]?.headers?.["authorization"]).toBeUndefined()
        })
      })
    })
  })

  test("say what Elasticsearch said when it refuses, or answers in another shape", () =>
    read(search([], 401, "no")).then((refused) => {
      expect(Result.isFailure(refused) && refused.failure.message).toBe("Elasticsearch answered 401: no")
      return read(search([], 200, { took: 3 })).then((odd) => {
        expect(Result.isFailure(odd) && odd.failure.message).toBe(
          "Elasticsearch answered in a shape Estate does not know",
        )
        return read(() => undefined).then((gone) => {
          expect(Result.isFailure(gone) && gone.failure.message).toStartWith("Elasticsearch answered 404")
        })
      })
    }))

  test("are a service's logs in an environment with Elasticsearch, masked", () => {
    const logs = logsFor({ elasticsearch: elastic }, { ...orders, logs: { mask: ["\\d{16}"] } })
    expect(logs?.from).toBe("Elasticsearch")
    return Effect.runPromise(
      Effect.provide(
        logs?.read(from, to, 200) ?? Effect.succeed([]),
        Layer.merge(stubRemote(search([])), BunFileSystem.layer),
      ),
    ).then((lines) => {
      expect(lines.at(-1)?.text).toBe("ERROR card ••• declined")
    })
  })
})

import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Result } from "effect"
import { platform } from "../platform"
import { type Call, reply, stubRemote } from "../remote"
import { logsFor } from "./logs"

const datadog = {
  url: "https://datadog",
  apiKey: Redacted.make("api"),
  appKey: Redacted.make("app"),
  tags: ["env:production"],
}

const found = {
  data: [
    {
      attributes: {
        timestamp: "2026-10-03T11:59:30.000Z",
        message: "card 4111111111111111 declined by the provider\n",
        status: "error",
        attributes: { pod_name: "checkout-7f9-abc" },
      },
    },
    { attributes: { timestamp: "2026-10-03T11:59:00.000Z", message: "paid", status: "info", host: "ip-10-0-0-1" } },
    { attributes: { timestamp: "2026-10-03T11:58:00.000Z" } },
  ],
}

describe("Datadog's lines", () => {
  test("are a service's by its tag in the environment's tags, newest asked first, given oldest first and masked", () => {
    const calls: Call[] = []
    const service = { name: "checkout", environments: [], logs: { mask: ["\\d{16}"] } }
    const logs = logsFor({ datadog }, service)
    const answer = (call: Call) => {
      calls.push(call)
      return call.headers?.["dd-api-key"] === "api" ? reply(found) : reply("no", 403)
    }
    const read = logs?.read(Date.parse("2026-10-03T11:45:00Z"), Date.parse("2026-10-03T12:00:00Z"), 5000)
    return Effect.runPromise(
      Effect.result(read ?? Effect.succeed([])).pipe(Effect.provide(Layer.merge(stubRemote(answer), platform))),
    ).then((result) => {
      expect(logs?.from).toBe("Datadog")
      expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
        filter: {
          query: "service:checkout env:production",
          from: "2026-10-03T11:45:00.000Z",
          to: "2026-10-03T12:00:00.000Z",
        },
        sort: "-timestamp",
        page: { limit: 1000 },
      })
      expect(Result.isSuccess(result) && result.success).toEqual([
        { at: "2026-10-03T11:58:00.000Z", text: "" },
        { at: "2026-10-03T11:59:00.000Z", pod: "ip-10-0-0-1", level: "INFO", text: "paid" },
        {
          at: "2026-10-03T11:59:30.000Z",
          pod: "checkout-7f9-abc",
          level: "ERROR",
          text: "card ••• declined by the provider",
        },
      ])
    })
  })

  test("are searched by the catalog's query where it gives one, and say so in Datadog's name when refused", () => {
    const service = { name: "checkout", environments: [], logs: { selector: "service:payments-api" } }
    const calls: Call[] = []
    const logs = logsFor({ datadog }, service)
    return Effect.runPromise(
      Effect.result(logs?.read(0, 1, 10) ?? Effect.succeed([])).pipe(
        Effect.provide(
          Layer.merge(
            stubRemote((call) => {
              calls.push(call)
              return reply({ errors: ["Forbidden"] }, 403)
            }),
            platform,
          ),
        ),
      ),
    ).then((result) => {
      expect(JSON.parse(calls[0]?.body ?? "{}").filter.query).toBe("service:payments-api")
      expect(Result.isFailure(result) && result.failure.message).toBe('Datadog answered 403: {"errors":["Forbidden"]}')
    })
  })
})

test("Datadog's lines in a shape Estate does not know say so", () =>
  Effect.runPromise(
    Effect.result(
      logsFor({ datadog }, { name: "checkout", environments: [] })?.read(0, 1, 10) ?? Effect.succeed([]),
    ).pipe(
      Effect.provide(
        Layer.merge(
          stubRemote(() => reply({ data: 1 })),
          platform,
        ),
      ),
    ),
  ).then((result) =>
    expect(Result.isFailure(result) && result.failure.message).toBe("Datadog answered in a shape Estate does not know"),
  ))

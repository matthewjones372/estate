import { describe, expect, test } from "bun:test"
import { Effect, Layer, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { catalog, estate, settings } from "../fixture"
import { memoryNotes, Notes } from "../notes"
import { reply, stubRemote } from "../remote"
import { Estate, estateLayer } from "../state"
import { alertId } from "./alerts"
import { backfillHistory, firingsIn } from "./backfill"

const labels = { alertname: "OrdersSlow", severity: "warning", app: "storefront" }
const series = (points: ReadonlyArray<number>) => ({
  data: {
    result: [
      {
        metric: { __name__: "ALERTS", alertstate: "firing", ...labels },
        values: points.map((at) => [at, "1"] as const),
      },
    ],
  },
})

describe("firings from before Estate kept them", () => {
  test("are each run of points in Prometheus's ALERTS, ended a step after its last; one still running is left", () => {
    const read = firingsIn(series([0, 300, 600, 3600, 3900, 9900, 10200]), "staging", catalog.services, 10_500)
    expect(read).toEqual([
      {
        environment: "staging",
        alert: alertId(labels),
        name: "OrdersSlow",
        service: "storefront",
        startsAt: "1970-01-01T00:00:00.000Z",
        endsAt: "1970-01-01T00:15:00.000Z",
      },
      {
        environment: "staging",
        alert: alertId(labels),
        name: "OrdersSlow",
        service: "storefront",
        startsAt: "1970-01-01T01:00:00.000Z",
        endsAt: "1970-01-01T01:10:00.000Z",
      },
    ])
  })

  test("are kept once, beside those Estate recorded, and a Prometheus that fails is only logged", () => {
    const at = Date.parse("1970-01-31T00:00:00Z") / 1000
    const answer = (url: string) =>
      url.startsWith("http://prometheus/api/v1/query_range")
        ? reply(series([at - 86_400, at - 86_100]))
        : reply("down", 500)
    const configured = {
      ...settings(),
      sources: {
        staging: { prometheus: { url: "http://prometheus" } },
        production: { prometheus: { url: "http://down" } },
      },
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(at * 1000)
        yield* backfillHistory(configured)
        yield* backfillHistory(configured)
        return {
          stored: yield* (yield* Notes).firings("1970-01-01T00:00:00Z"),
          shown: (yield* SubscriptionRef.get(yield* Estate)).firings,
        }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            memoryNotes,
            estateLayer(estate()),
            stubRemote((call) => answer(call.url)),
            TestClock.layer(),
          ),
        ),
      ),
    ).then(({ stored, shown }) => {
      expect(stored.map((each) => [each.environment, each.startsAt, each.endsAt])).toEqual([
        ["staging", "1970-01-30T00:00:00.000Z", "1970-01-30T00:10:00.000Z"],
      ])
      expect(shown).toHaveLength(1)
    })
  })
})

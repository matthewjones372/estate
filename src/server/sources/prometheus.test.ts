import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { reply, stubRemote } from "../remote"
import { prometheusRanges } from "./prometheus"

const ranges = prometheusRanges({ url: "http://prometheus", headers: {} })

const instant = (answer: () => ReturnType<typeof reply>) =>
  Effect.result(
    (ranges.instant?.("kafka_topic_partition_leader") ?? Effect.succeed([])).pipe(
      Effect.provide(
        stubRemote((call) => (call.url.startsWith("http://prometheus/api/v1/query?") ? answer() : undefined)),
      ),
    ),
  )

describe("an instant query", () => {
  test("gives each series' labels and its value now, leaving out a value that is not a number", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const read = yield* instant(() =>
          reply({
            data: {
              result: [
                { metric: { topic: "orders", partition: "0" }, value: [1_700_000_000, "2"] },
                { metric: { topic: "orders", partition: "1" }, value: [1_700_000_000, "NaN"] },
                { metric: { topic: "orders", partition: "2" }, value: [1_700_000_000, "+Inf"] },
              ],
            },
          }),
        )
        expect(read._tag === "Success" && read.success).toEqual([
          { labels: { topic: "orders", partition: "0" }, value: 2 },
        ])
      }),
    ))

  test("that fails is a source failure in Prometheus's words", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const read = yield* instant(() => reply({ error: "bad" }, 400))
        expect(read._tag === "Failure" && read.failure._tag).toBe("SourceFailure")
      }),
    ))
})

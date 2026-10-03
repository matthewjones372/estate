import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PrometheusMetrics } from "effect/observability"
import { countRead, noteWritten, streamClosed, streamOpened, timeCall } from "./observed"

/** The value on the line `series` starts, or zero before anything is counted. */
const seriesValue = (text: string, series: string): number => {
  const line = text.split("\n").find((each) => each.startsWith(`${series} `))
  return line === undefined ? 0 : Number(line.slice(series.length + 1))
}

// The metrics are the process's, shared with every other test file, so each is checked by how much it moved.
const watched = [
  'estate_source_reads_total{environment="observed",part="alerts",outcome="failing"}',
  'estate_source_reads_total{environment="observed",part="alerts",outcome="ok"}',
  'estate_upstream_call_duration_count{host="observed:9090"}',
  "estate_open_streams",
  "estate_notes_written_total",
]
const read = PrometheusMetrics.format().pipe(Effect.map((text) => watched.map((series) => seriesValue(text, series))))

describe("Estate's own metrics", () => {
  test("count each source's reads by whether it answered, time each call by host, and gauge open streams", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const before = yield* read
        yield* countRead("observed", "alerts", false)
        yield* countRead("observed", "alerts", true)
        expect(yield* timeCall("observed:9090", Effect.succeed("answered"))).toBe("answered")
        yield* streamOpened
        yield* streamOpened
        yield* streamClosed
        yield* noteWritten
        const after = yield* read
        return after.map((value, index) => value - (before[index] ?? 0))
      }),
    ).then((moved) => {
      expect(moved).toEqual([1, 1, 1, 1, 1])
    }))

  test("read nothing as zero", () => {
    expect(seriesValue("", "estate_open_streams")).toBe(0)
  })
})

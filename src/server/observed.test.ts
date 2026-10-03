import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PrometheusMetrics } from "effect/observability"
import { countRead, noteWritten, streamClosed, streamOpened, timeCall } from "./observed"

describe("Estate's own metrics", () => {
  test("count each source's reads by whether it answered, time each call by host, and gauge open streams", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* countRead("staging", "alerts", false)
        yield* countRead("staging", "alerts", true)
        expect(yield* timeCall("prometheus:9090", Effect.succeed("answered"))).toBe("answered")
        yield* streamOpened
        yield* streamOpened
        yield* streamClosed
        yield* noteWritten
        return yield* PrometheusMetrics.format()
      }),
    ).then((text) => {
      expect(text).toMatch(/estate_source_reads\w*\{[^}]*outcome="failing"[^}]*\} 1/)
      expect(text).toMatch(/estate_source_reads\w*\{[^}]*outcome="ok"[^}]*\} 1/)
      expect(text).toMatch(/estate_upstream_call_duration\w*\{[^}]*host="prometheus:9090"/)
      expect(text).toMatch(/estate_open_streams\w* 1/)
      expect(text).toMatch(/estate_notes_written\w* 1/)
    }))
})

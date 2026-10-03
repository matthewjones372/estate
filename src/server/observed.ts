/** What Estate says about itself: its own metrics, read on `/metrics` by the Prometheus it reads. */
import { Effect, Metric } from "effect"

const sourceReads = Metric.counter("estate_source_reads_total", {
  description: "Reads of a source by environment and part, and whether it answered",
})
const upstreamCalls = Metric.timer("estate_upstream_call_duration", {
  description: "How long a call to another tool took, by host",
})
const openStreams = Metric.gauge("estate_open_streams", { description: "Pages with the event stream open" })
const notesWritten = Metric.counter("estate_notes_written_total", { description: "Notes added on the page" })

/** A source's read, counted by whether it answered. */
export const countRead = (environment: string, part: string, answered: boolean) =>
  Metric.update(Metric.withAttributes(sourceReads, { environment, part, outcome: answered ? "ok" : "failing" }), 1)

/** A call to another tool, timed by host. */
export const timeCall = <A, E, R>(host: string, call: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.timed(call).pipe(
    Effect.tap(([took]) => Metric.update(Metric.withAttributes(upstreamCalls, { host }), took)),
    Effect.map(([, answered]) => answered),
  )

/** An event stream opened, and closed. */
export const streamOpened = Metric.modify(openStreams, 1)
export const streamClosed = Metric.modify(openStreams, -1)

export const noteWritten = Metric.update(notesWritten, 1)

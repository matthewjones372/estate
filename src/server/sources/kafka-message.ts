/**
 * A message followed through a Kafka store (spec 0057): its spans from Tempo, on its trace and on any other trace that
 * carries its ID, beside each group's committed offset on its partition now, from kafka_exporter's series.
 */
import { Data, Effect, Result } from "effect"
import type { Store } from "../../shared/catalog"
import { type FollowedMessage, type Found, followedFrom, messageQueries, writtenOf } from "../../shared/kafka-message"
import { messageNames } from "../../shared/messaging"
import type { Remote } from "../remote"
import type { Reach } from "./grafana"
import type { Ranges } from "./prometheus"
import { type Failure, SourceFailure } from "./run"
import { readTrace, searchTraces, spansCarrying } from "./tempo"

/** The message cannot be followed from what its spans say: why, naming the attribute it did not find. */
export const NotFollowed = Data.TaggedError("NotFollowed")<{ readonly message: string }>
export type NotFollowed = InstanceType<typeof NotFollowed>

/** A message is followed by its trace, or by its ID on its topic. */
export type Asked = { readonly trace: string; readonly id?: string } | { readonly id: string; readonly topic: string }

const day = 24 * 60 * 60 * 1000
/** Traces read for one message: its own, and a few more that carry its ID, as a consumer's linked trace does. */
const most = 20

/** `now` in milliseconds since the epoch. */
export const followMessage = (
  tempo: Reach,
  ranges: Ranges,
  store: Store,
  asked: Asked,
  now: number,
): Effect.Effect<FollowedMessage, Failure | NotFollowed, Remote> =>
  Effect.gen(function* () {
    const names = messageNames(store.messages)
    const instant = ranges.instant
    if (instant === undefined)
      return yield* Effect.fail(new SourceFailure({ message: "this metrics source cannot read a query now" }))
    const tracesOf = (ids: ReadonlyArray<string>) =>
      Effect.forEach(ids, (id) => readTrace(tempo, id, names), { concurrency: 4 }).pipe(
        Effect.map((traces) => traces.flatMap((trace) => trace.spans.map((span) => ({ trace: trace.id, span })))),
      )
    const carrying = (message: { readonly id: string; readonly topic: string }, from: number) =>
      searchTraces(tempo, spansCarrying(names, message), { from, to: now }, most)
    const ids = "trace" in asked ? [asked.trace] : yield* carrying(asked, now - day)
    if (ids.length === 0 && !("trace" in asked))
      return yield* Effect.fail(
        new NotFollowed({
          message: `Tempo has no span with ${names.id} = ${JSON.stringify(asked.id)} on ${asked.topic} in the last day`,
        }),
      )
    const first: ReadonlyArray<Found> = yield* tracesOf(ids)
    const chosen = writtenOf(first, names, asked)
    if (Result.isFailure(chosen)) return yield* Effect.fail(new NotFollowed({ message: chosen.failure }))
    const { written, trace } = chosen.success
    // Consumers that link to the producer's trace, not continue it, are found by the message's ID.
    const read = new Set(first.map((each) => each.trace))
    const linked =
      written.id === undefined
        ? []
        : yield* carrying({ id: written.id, topic: written.topic }, written.at - 60_000).pipe(
            Effect.flatMap((ids) => tracesOf(ids.filter((id) => !read.has(id)))),
            Effect.orElseSucceed(() => []),
          )
    const queries = messageQueries(store.selector, written.topic, written.partition)
    const [offsets, rates] = yield* Effect.all(
      [instant(queries.offsets), instant(queries.rates).pipe(Effect.orElseSucceed(() => []))],
      { concurrency: 2 },
    )
    return followedFrom(trace, written, [...first, ...linked], { offsets, rates }, names, now)
  })

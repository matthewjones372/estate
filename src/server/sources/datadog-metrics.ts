/**
 * Datadog's metric queries as `Ranges`. Datadog limits how many metric queries an organisation makes an hour, so
 * queries over the same span are batched: every query a read asks for at once goes in one call of up to fifty. When
 * Datadog says the limit is reached, nothing more is asked until the time it gives, and the read fails saying so.
 */
import { Clock, Context, Effect, Exit, Ref, Request, RequestResolver, Schema } from "effect"
import type { Series } from "../../shared/events"
import { Remote } from "../remote"
import { type Datadog, datadogReach, monitorsOf } from "./datadog"
import { onGrid, type Ranges, type Span, thresholdOf } from "./prometheus"
import { type Failure, SourceFailure } from "./run"

interface RangeRequest extends Request.Request<Series, Failure, Remote> {
  readonly _tag: "Range"
  readonly query: string
  readonly start: number
  readonly span: Span
  readonly labels: Readonly<Record<string, string>>
}
const Range = Request.tagged<RangeRequest>("Range")

const Answer = Schema.Struct({
  data: Schema.Struct({
    attributes: Schema.Struct({
      series: Schema.Array(
        Schema.Struct({ query_index: Schema.Number, group_tags: Schema.optionalKey(Schema.Array(Schema.String)) }),
      ),
      times: Schema.Array(Schema.Number),
      values: Schema.Array(Schema.Array(Schema.NullOr(Schema.Number))),
    }),
  }),
})

const most = 50

/** Whether every `name:value` a series is grouped by is one of the alert's labels. */
const within = (tags: ReadonlyArray<string>, labels: Readonly<Record<string, string>>) =>
  tags.every((tag) => {
    const at = tag.indexOf(":")
    return at > 0 && labels[tag.slice(0, at)] === tag.slice(at + 1)
  })

/** Datadog's metrics, batched, with each monitor's threshold as a rule. */
export const datadogRanges = (datadog: Datadog): Effect.Effect<Ranges> =>
  Effect.gen(function* () {
    const reach = datadogReach(datadog)
    const limitedUntil = yield* Ref.make(0)
    const limited = Effect.gen(function* () {
      const wait = Math.ceil(((yield* Ref.get(limitedUntil)) - (yield* Clock.currentTimeMillis)) / 1000)
      if (wait > 0)
        return yield* new SourceFailure({ message: `Datadog limits metric queries: it allows more in ${wait}s` })
    })
    const ask = (entries: ReadonlyArray<Request.Entry<RangeRequest>>, remote: Remote) =>
      Effect.gen(function* () {
        yield* limited
        const [first] = entries
        if (first === undefined) return
        const { start, span } = first.request
        const answered = yield* remote
          .call({
            url: `${reach.url}/api/v2/query/timeseries`,
            method: "POST",
            headers: { ...reach.headers, "content-type": "application/json" },
            body: JSON.stringify({
              data: {
                type: "timeseries_request",
                attributes: {
                  from: start * 1000,
                  to: (start + span.seconds) * 1000,
                  interval: span.step * 1000,
                  queries: entries.map((entry, index) => ({
                    name: `q${index}`,
                    data_source: "metrics",
                    query: entry.request.query,
                  })),
                  formulas: entries.map((_, index) => ({ formula: `q${index}` })),
                },
              },
            }),
          })
          .pipe(Effect.mapError((error) => new SourceFailure({ message: `Datadog ${error.message}` })))
        if (answered.status === 429) {
          const reset = Number(answered.headers["x-ratelimit-reset"] ?? 60)
          yield* Ref.set(limitedUntil, (yield* Clock.currentTimeMillis) + reset * 1000)
          return yield* limited
        }
        if (answered.status !== 200)
          return yield* new SourceFailure({
            message: `Datadog answered ${answered.status}: ${answered.text.slice(0, 200)}`,
          })
        const { attributes } = (yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Answer))(answered.text).pipe(
          Effect.mapError(() => new SourceFailure({ message: "Datadog answered in a shape Estate does not know" })),
        )).data
        entries.forEach((entry, index) => {
          const found = attributes.series.flatMap((series, at) => (series.query_index === index ? [at] : []))
          const at = found.find((each) => within(attributes.series[each]?.group_tags ?? [], entry.request.labels))
          const values = attributes.values[at ?? found[0] ?? -1] ?? []
          const pairs = attributes.times.flatMap((time, step) => {
            const value = values[step]
            return value === null || value === undefined ? [] : [[time / 1000, String(value)] as const]
          })
          entry.completeUnsafe(Exit.succeed(onGrid(pairs, start, span)))
        })
      })
    const resolver = RequestResolver.makeGrouped<RangeRequest, string>({
      key: ({ request }) => `${request.start}:${request.span.seconds}:${request.span.step}`,
      resolver: (entries) =>
        Effect.gen(function* () {
          const remote = Context.get(entries[0].context, Remote)
          const exit = yield* Effect.exit(ask(entries, remote))
          if (Exit.isFailure(exit)) for (const entry of entries) entry.completeUnsafe(Exit.failCause(exit.cause))
        }),
    }).pipe(RequestResolver.batchN(most))
    return {
      concurrency: "unbounded",
      range: (query, span, now, labels = {}) => {
        const start = Math.floor(now / 1000 / span.step) * span.step - span.seconds
        return Effect.request(Range({ query, start, span, labels }), resolver)
      },
      rules: Effect.gen(function* () {
        yield* limited
        const monitors = yield* monitorsOf(datadog)
        return new Map(
          monitors.flatMap((monitor) => {
            const measured = thresholdOf((monitor.query ?? "").replace(/^\w+\(last_\w+\):/, ""))
            return measured === undefined
              ? []
              : [[monitor.name, `${measured.measure} > ${measured.threshold}`] as const]
          }),
        )
      }),
    } satisfies Ranges
  })

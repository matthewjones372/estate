/**
 * A service's lines from Elasticsearch or OpenSearch: `_search` over an index pattern, newest first within the window,
 * filtered by the fields its shipper writes. The defaults are Filebeat's, Elastic Agent's and the OpenTelemetry
 * collector's; a service shipped otherwise names its own.
 */
import { Effect, Redacted, Schema } from "effect"
import type { Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import { Remote } from "../remote"
import type { Sources } from "../settings"
import { iso } from "../time"
import { type Line, lineOf } from "./lines"
import { type Failure, SourceFailure } from "./run"

export type Elastic = NonNullable<Sources["elasticsearch"]>

const Hits = Schema.Struct({
  hits: Schema.Struct({ hits: Schema.Array(Schema.Struct({ _source: Schema.Record(Schema.String, Schema.Unknown) })) }),
})
const decodeHits = Schema.decodeUnknownEffect(Schema.fromJsonString(Hits))

/** A field by its dotted name, whether the document nests it (`log: { level }`) or keeps it flat (`log.level`). */
export const fieldOf = (document: Readonly<Record<string, unknown>>, name: string): string | undefined => {
  const flat = document[name]
  if (typeof flat === "string") return flat
  const dot = name.indexOf(".")
  const inner = dot < 0 ? undefined : document[name.slice(0, dot)]
  return typeof inner === "object" && inner !== null
    ? fieldOf(inner as Record<string, unknown>, name.slice(dot + 1))
    : undefined
}

const headersOf = (elastic: Elastic): Readonly<Record<string, string>> => {
  if (elastic.apiKey !== undefined) return { authorization: `ApiKey ${Redacted.value(elastic.apiKey)}` }
  if (elastic.username === undefined) return {}
  const password = elastic.password === undefined ? "" : Redacted.value(elastic.password)
  return { authorization: `Basic ${Buffer.from(`${elastic.username}:${password}`).toString("base64")}` }
}

/** The fields a service's lines carry: the catalog's, or its namespace and its name as the app label. */
export const matchOf = (service: Service): Readonly<Record<string, string>> =>
  service.logs?.elastic?.match ?? {
    ...(service.kubernetes?.namespace === undefined ? {} : { "kubernetes.namespace": service.kubernetes.namespace }),
    "kubernetes.labels.app": service.name,
  }

export const elasticLines = (
  elastic: Elastic,
  service: Service,
  from: number,
  to: number,
  limit: number,
): Effect.Effect<ReadonlyArray<Line>, Failure, Remote> =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const message = service.logs?.elastic?.message ?? "message"
    const body = {
      size: limit,
      // The newest lines in the window, so that a busy service skips its older lines rather than its latest.
      sort: [{ "@timestamp": "desc" }],
      query: {
        bool: {
          filter: [
            { range: { "@timestamp": { gte: iso(from), lte: iso(to), format: "strict_date_optional_time" } } },
            ...Object.entries(matchOf(service)).map(([field, value]) => ({ match_phrase: { [field]: value } })),
          ],
        },
      },
    }
    const answered = yield* remote
      .call({
        url: `${elastic.url.replace(/\/$/, "")}/${encodeURIComponent(elastic.index ?? "logs-*")}/_search`,
        method: "POST",
        headers: { ...headersOf(elastic), "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      .pipe(Effect.mapError((error) => new SourceFailure({ message: `Elasticsearch ${error.message}` })))
    if (answered.status !== 200)
      return yield* new SourceFailure({
        message: `Elasticsearch answered ${answered.status}: ${answered.text.slice(0, 200)}`,
      })
    const found = yield* decodeHits(answered.text).pipe(
      Effect.mapError(() => new SourceFailure({ message: "Elasticsearch answered in a shape Estate does not know" })),
    )
    return found.hits.hits
      .flatMap(({ _source: document }) => {
        const at = Date.parse(fieldOf(document, "@timestamp") ?? "")
        const text = fieldOf(document, message)
        if (Number.isNaN(at) || text === undefined) return []
        const line = lineOf(iso(at), text, fieldOf(document, "kubernetes.pod.name") ?? fieldOf(document, "host.name"))
        return [compact({ ...line, level: fieldOf(document, "log.level")?.toUpperCase() ?? line.level })]
      })
      .sort((a, b) => a.at.localeCompare(b.at))
  })

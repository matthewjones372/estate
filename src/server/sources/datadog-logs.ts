/** A service's lines from Datadog's log search: the newest in the window, oldest first, its status as their level. */
import { Effect, Schema } from "effect"
import type { Service } from "../../shared/catalog"
import { callJson, type Remote } from "../remote"
import { iso } from "../time"
import { type Datadog, datadogReach } from "./datadog"
import type { Line } from "./lines"
import { type Failure, SourceFailure } from "./run"

const Found = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      attributes: Schema.Struct({
        timestamp: Schema.String,
        message: Schema.optionalKey(Schema.NullOr(Schema.String)),
        status: Schema.optionalKey(Schema.NullOr(Schema.String)),
        host: Schema.optionalKey(Schema.NullOr(Schema.String)),
        attributes: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    }),
  ),
})

/** The most lines one search answers. */
export const datadogPage = 1000

/** Datadog's statuses, which it gives every line. */
const statuses = ["emergency", "alert", "critical", "error", "warn", "notice", "info", "debug", "ok"]

/** The statuses whose lines are errors by `pattern`, as a search term; undefined when none are. */
export const datadogErrors = (pattern: string): string | undefined => {
  const errors = new RegExp(pattern, "i")
  const matched = statuses.filter((status) => errors.test(status.toUpperCase()))
  return matched.length === 0 ? undefined : `status:(${matched.join(" OR ")})`
}

/** What a service's lines are searched by: the catalog's query, or its service tag in the environment's tags. */
export const datadogQueryOf = (datadog: Datadog, service: Service): string =>
  service.logs?.selector ?? [`service:${service.name}`, ...(datadog.tags ?? [])].join(" ")

export const datadogLines = (
  datadog: Datadog,
  service: Service,
  from: number,
  to: number,
  limit: number,
  /** More to search by, such as the statuses that are errors. */
  narrowed?: string,
): Effect.Effect<ReadonlyArray<Line>, Failure, Remote> => {
  const reach = datadogReach(datadog)
  return callJson({
    url: `${reach.url}/api/v2/logs/events/search`,
    method: "POST",
    headers: { ...reach.headers, "content-type": "application/json" },
    body: JSON.stringify({
      filter: {
        query: [datadogQueryOf(datadog, service), ...(narrowed === undefined ? [] : [narrowed])].join(" "),
        from: iso(from),
        to: iso(to),
      },
      // The newest lines in the window, so that a busy service skips its older lines rather than its latest.
      sort: "-timestamp",
      page: { limit: Math.min(limit, datadogPage) },
    }),
  }).pipe(
    Effect.mapError((error) => new SourceFailure({ message: `Datadog ${error.message}` })),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(Found)(body).pipe(
        Effect.mapError(() => new SourceFailure({ message: "Datadog answered in a shape Estate does not know" })),
      ),
    ),
    Effect.map((found) =>
      found.data
        .map(({ attributes }): Line => {
          const pod = attributes.attributes?.["pod_name"]
          return {
            at: iso(Date.parse(attributes.timestamp)),
            ...(typeof pod === "string" ? { pod } : attributes.host ? { pod: attributes.host } : {}),
            ...(attributes.status ? { level: attributes.status.toUpperCase() } : {}),
            text: (attributes.message ?? "").trimEnd(),
          }
        })
        .sort((a, b) => a.at.localeCompare(b.at)),
    ),
  )
}

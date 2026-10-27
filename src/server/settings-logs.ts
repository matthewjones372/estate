/**
 * Where services' lines are read beside Loki: Elasticsearch or OpenSearch, and CloudWatch Logs through the
 * environment's `aws`, held to a share of the account's few FilterLogEvents calls a second.
 */
import { Schema } from "effect"
import type { Mistake } from "../shared/shape"
import { Secret } from "./secret"

const optional = Schema.optionalKey

export const Elasticsearch = Schema.Struct({
  url: Schema.String,
  index: optional(Schema.String),
  apiKey: optional(Secret),
  username: optional(Schema.String),
  password: optional(Secret),
})

export const CloudwatchLogs = Schema.Struct({ callsPerSecond: optional(Schema.Number) })

/** CloudWatch Logs with no region to read it in, or asked more often than any region's account allows. */
export const cloudwatchLogsMistakes = (settings: {
  readonly sources: Readonly<
    Record<string, { readonly aws?: unknown; readonly cloudwatchLogs?: typeof CloudwatchLogs.Type }>
  >
}): ReadonlyArray<Mistake> =>
  Object.entries(settings.sources).flatMap(([name, { aws, cloudwatchLogs }]) => {
    if (cloudwatchLogs === undefined) return []
    const at = `sources.${name}.cloudwatchLogs`
    const perSecond = cloudwatchLogs.callsPerSecond
    return [
      ...(aws === undefined ? [{ at, message: "needs aws: { region } beside it" }] : []),
      ...(perSecond === undefined || (perSecond >= 1 && perSecond <= 10)
        ? []
        : [
            { at: `${at}.callsPerSecond`, message: `${perSecond} is not between 1 and 10, the most any region allows` },
          ]),
    ]
  })

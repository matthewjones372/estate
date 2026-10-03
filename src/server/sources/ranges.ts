/** An environment's metrics source as `Ranges`: its Prometheus, or else Datadog, or else CloudWatch. */
import { Effect } from "effect"
import { makeAwsJson } from "../aws/json"
import type { Sources } from "../settings"
import { cloudwatchApi, cloudwatchRanges } from "./cloudwatch"
import { datadogRanges } from "./datadog-metrics"
import { grafanaRules, prometheusOf } from "./grafana"
import { metricsOf } from "./ports"
import { prometheusRanges } from "./prometheus"

export const rangesIn = (section: Sources) =>
  Effect.gen(function* () {
    const { aws, datadog, grafana } = section
    const prometheus = prometheusOf(section)
    const kind = metricsOf(section)
    if (kind === "prometheus" && prometheus !== undefined)
      return prometheusRanges(prometheus, grafana === undefined ? undefined : grafanaRules(grafana))
    if (kind === "datadog" && datadog !== undefined) return yield* datadogRanges(datadog)
    if (kind === "cloudwatch" && aws !== undefined)
      return cloudwatchRanges(yield* makeAwsJson(cloudwatchApi, aws.region, aws.endpoint))
    return undefined
  })

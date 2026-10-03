/** An environment's metrics source as `Ranges`: its Prometheus, or CloudWatch where it has none. */
import { Effect } from "effect"
import { makeAwsJson } from "../aws/json"
import type { Sources } from "../settings"
import { cloudwatchApi, cloudwatchRanges } from "./cloudwatch"
import { prometheusOf } from "./grafana"
import { metricsOf } from "./ports"
import { prometheusRanges, type Ranges } from "./prometheus"

export const rangesIn = (section: Sources) =>
  Effect.gen(function* () {
    const { aws } = section
    const prometheus = prometheusOf(section)
    const kind = metricsOf(section)
    if (kind === "prometheus" && prometheus !== undefined) return prometheusRanges(prometheus) as Ranges
    if (kind === "cloudwatch" && aws !== undefined)
      return cloudwatchRanges(yield* makeAwsJson(cloudwatchApi, aws.region, aws.endpoint))
    return undefined
  })

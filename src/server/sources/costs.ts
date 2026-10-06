/**
 * What each entry in an environment costs, from the cost tools its section of the settings names. Where more than one
 * knows an entry, the bill by tag is preferred to Kubernetes' share of it.
 */
import { Clock, Effect, type FileSystem, SubscriptionRef } from "effect"
import type { Cost } from "../../shared/costs"
import { makeAwsJson } from "../aws/json"
import type { Remote } from "../remote"
import type { Sources } from "../settings"
import { Estate } from "../state"
import { agentsIn, inEnvironment, jobsIn } from "../views/catalog"
import { type Billed, costExplorerApi, readAwsCosts } from "./aws-costs"
import type { Failure } from "./run"

/** Every entry of an environment that can have a cost: its services, its jobs and its agents. */
const billedIn = (environment: string) =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const billed: ReadonlyArray<Billed> = [
      ...inEnvironment(catalog, environment),
      ...jobsIn(catalog, environment),
      ...agentsIn(catalog, environment),
    ]
    return billed
  })

/** The reader of an environment's costs, or none where its section names no cost tool. */
export const costsReader = (
  section: Sources,
  environment: string,
): Effect.Effect<
  Effect.Effect<Readonly<Record<string, Cost>>, Failure, Estate> | undefined,
  never,
  Remote | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const costs = section.costs
    const aws = costs?.aws
    if (costs === undefined || aws === undefined) return undefined
    const ce = yield* makeAwsJson(costExplorerApi, aws.region, aws.endpoint)
    const currency = costs.currency ?? "USD"
    return Effect.gen(function* () {
      const billed = yield* billedIn(environment)
      return yield* readAwsCosts(ce, aws.tag, billed, yield* Clock.currentTimeMillis, currency)
    })
  })

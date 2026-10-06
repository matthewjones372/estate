/**
 * `cluster:` in the settings: off, or on as one boolean with an override for the port or how runners judge each other.
 * Clustered, the runners find each other and hold their shard locks in Estate's Postgres, so it needs
 * `database.postgres`.
 */
import { Schema } from "effect"
import type { Mistake } from "../shared/shape"

const optional = Schema.optionalKey

export const ClusterSettings = Schema.Union([
  Schema.Boolean,
  Schema.Struct({ port: optional(Schema.Number), health: optional(Schema.Literals(["ping", "k8s"])) }),
])

/** How a clustered Estate runs: the port runners talk on, and how they judge whether another is alive. */
export interface Clustered {
  readonly port: number
  readonly health: "ping" | "k8s"
}

/** The port runners talk on unless the settings say otherwise, apart from the one serving the pages. */
const runnerPort = 34431

/** The cluster the settings ask for, with its defaults; or none, for the one process Estate is otherwise. */
export const clusteredBy = (cluster: typeof ClusterSettings.Type | undefined): Clustered | undefined =>
  cluster === undefined || cluster === false
    ? undefined
    : cluster === true
      ? { port: runnerPort, health: "ping" }
      : { port: cluster.port ?? runnerPort, health: cluster.health ?? "ping" }

export const clusterMistakes = (settings: {
  readonly cluster?: typeof ClusterSettings.Type
  readonly database?: { readonly postgres?: unknown }
}): ReadonlyArray<Mistake> =>
  clusteredBy(settings.cluster) !== undefined && settings.database?.postgres === undefined
    ? [{ at: "cluster", message: "needs database.postgres, where the runners find each other" }]
    : []

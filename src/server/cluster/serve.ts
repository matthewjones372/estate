/**
 * Estate as one runner of a cluster: it serves the pages as ever, follows the estate's entities into its own state,
 * sends its writes to their owners, and holds whichever entities its shards have, running the estate's own work for
 * `estate` and an environment's for `env:<name>`.
 */
import { Effect, Layer } from "effect"
import { environmentWork, estateWork, type Started } from "../app"
import type { StoredFiring } from "../notes"
import type { Clustered } from "../settings-cluster"
import { beating } from "./beat"
import { follow, ownerWrites } from "./follow"
import { EstateEntity, environmentOf, estateId, ownerLayer } from "./owner"
import { clusterLayer, runnerHost } from "./runtime"

/** Firings an environment's entity recorded, sent to the estate's, which keeps the estate's firings. */
const toEstate = (firings: ReadonlyArray<StoredFiring>) =>
  Effect.flatMap(EstateEntity.client, (clientFor) =>
    clientFor(estateId).Apply({ write: { _tag: "FiringsKept", firings } }),
  ).pipe(Effect.catchCause(Effect.logWarning), Effect.annotateLogs("writing to", estateId))

const workOf = (started: Started) => (entity: string) => {
  const name = environmentOf(entity)
  const work = name === undefined ? estateWork(started) : environmentWork(started, name, toEstate)
  return Effect.all([work, beating(entity)], { concurrency: "unbounded" }).pipe(Effect.andThen(Effect.never))
}

/** This runner, at its own address: what it serves with, runs beside the routes, and joins. */
export const asRunner = (started: Started, clustered: Clustered) =>
  Effect.map(runnerHost, (host) => ({
    holding: { writes: ownerWrites, role: { _tag: "Runner", self: `${host}:${clustered.port}`, owners: {} } as const },
    alongside: Effect.all([follow, Layer.launch(ownerLayer(started.initial, workOf(started)))], {
      concurrency: "unbounded",
    }),
    sharding: clusterLayer(clustered, host),
  }))

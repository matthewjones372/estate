/**
 * Estate as one runner of a cluster: it serves the pages as ever, follows the estate entity into its own state, sends
 * its writes to the owner, and holds the entity, so runs the readers, only while its runner holds the entity's shard.
 */
import { Effect, Layer } from "effect"
import { background, type Started } from "../app"
import type { Clustered } from "../settings-cluster"
import { beating } from "./beat"
import { follow, ownerWrites } from "./follow"
import { ownerLayer } from "./owner"
import { clusterLayer } from "./runtime"

export const asRunner = (started: Started, clustered: Clustered) => ({
  holding: { writes: ownerWrites, role: { _tag: "Joining" } as const },
  alongside: Effect.all(
    [
      follow,
      Layer.launch(
        ownerLayer(
          started.initial,
          Effect.all([background(started), beating], { concurrency: "unbounded" }).pipe(Effect.andThen(Effect.never)),
        ),
      ),
    ],
    { concurrency: "unbounded" },
  ),
  sharding: clusterLayer(clustered),
})

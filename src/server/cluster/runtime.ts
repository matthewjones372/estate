/**
 * The cluster a runner joins when `cluster:` is on: Effect's sharding over Bun sockets on its own port, with runners,
 * shard locks and messages kept in Estate's Postgres under `estate_cluster`. Loaded only when clustered.
 */
import { hostname } from "node:os"
import { BunClusterSocket, BunCrypto } from "@effect/platform-bun"
import { Config, Effect, Layer, Option } from "effect"
import { RunnerAddress, ShardingConfig, SqlMessageStorage, SqlRunnerStorage } from "effect/cluster"
import type { Clustered } from "../settings-cluster"

const prefix = "estate_cluster"

/** Where other runners reach this one: the pod's IP when Kubernetes gives it, else the host's name. */
export const runnerHost = Config.String("POD_IP").pipe(
  Config.withDefault(hostname()),
  Effect.orElseSucceed(() => hostname()),
)

/** Sharding, and its configuration, for a runner on `host`, its tables in the database Estate's pool reaches. */
export const clusterLayer = (clustered: Clustered, host: string) => {
  const config = {
    runnerAddress: Option.some(RunnerAddress.make(host, clustered.port)),
    runnerListenAddress: Option.some(RunnerAddress.make("0.0.0.0", clustered.port)),
  }
  const storage = Layer.mergeAll(
    SqlMessageStorage.layerWith({ prefix }),
    Layer.orDie(SqlRunnerStorage.layerWith({ prefix })),
  ).pipe(Layer.provide(BunCrypto.layer))
  return BunClusterSocket.layer({
    storage: "byo",
    // JSON, since the binary layout cannot tell apart the unions the state holds.
    serialization: "ndjson",
    runnerHealth: clustered.health,
    shardingConfig: config,
  }).pipe(Layer.provide(storage), Layer.provideMerge(ShardingConfig.layer(config)))
}

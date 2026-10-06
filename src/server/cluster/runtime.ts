/**
 * The cluster a runner joins when `cluster:` is on: Effect's sharding over Bun sockets on its own port, with runners,
 * shard locks and messages kept in the notes' Postgres under `estate_cluster`. Loaded only when clustered.
 */
import { hostname } from "node:os"
import { BunClusterSocket, BunCrypto } from "@effect/platform-bun"
import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Layer, Option, type Redacted } from "effect"
import { RunnerAddress, ShardingConfig, SqlMessageStorage, SqlRunnerStorage } from "effect/cluster"
import type { Clustered } from "../settings-cluster"

const prefix = "estate_cluster"

/** Where other runners reach this one: the pod's IP when Kubernetes gives it, else the host's name. */
const runnerHost = Config.String("POD_IP").pipe(
  Config.withDefault(hostname()),
  Effect.orElseSucceed(() => hostname()),
)

/** Sharding, and its configuration, for a runner on `host` with the cluster's tables in `postgres`. */
const layerOn = (clustered: Clustered, host: string, postgres: Redacted.Redacted) => {
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
  }).pipe(
    Layer.provide(storage),
    Layer.provideMerge(ShardingConfig.layer(config)),
    Layer.provideMerge(Layer.orDie(PgClient.layer({ url: postgres, applicationName: "estate" }))),
  )
}

/** The cluster this runner joins, at its own address. */
export const clusterLayer = (clustered: Clustered, postgres: Redacted.Redacted) =>
  Layer.unwrap(Effect.map(runnerHost, (host) => layerOn(clustered, host, postgres)))

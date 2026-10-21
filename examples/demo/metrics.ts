/**
 * Prometheus's series in the demo: each service's load from its `app` label, the stores' exporters, the agents'
 * GenAI metrics, and the Kafka and Postgres stores' stats from the live clusters. Traffic rises and falls with the
 * shop's events, and checkout's p99 climbs once its slow version is out.
 */
import { type Environment, seedOf, wave } from "./clock"
import { databaseStat } from "./databases"
import { clusterAsked, statOf } from "./kafka"
import { slowSince } from "./story"
import { shopTrafficOf, trafficOf } from "./traffic"

type Value = (seconds: number) => number

const size = (environment: Environment) => (environment === "production" ? 1 : 0.04)

/** A service's requests a second: its own size, scaled down in staging, rising and falling with the shop's events. */
const requestsOf = (service: string, environment: Environment): Value => {
  const usual = wave(
    (20 + (seedOf(service) % 180)) * size(environment),
    (4 + (seedOf(service) % 20)) * size(environment),
    seedOf(service),
  )
  return (seconds) => usual(seconds) * trafficOf(service, environment, seconds)
}

const p99Of = (service: string, environment: Environment): Value => {
  const steady = wave(0.04 + (seedOf(service) % 60) / 1000, 0.01, seedOf(service))
  // Busier is a little slower: a fifth more at twice the traffic.
  const usual: Value = (seconds) => steady(seconds) * (1 + 0.2 * (trafficOf(service, environment, seconds) - 1))
  if (environment !== "production" || service !== "checkout") return usual
  // Up from 80 ms to over 900 ms over the five minutes after the slow version rolled out.
  return (seconds) => usual(seconds) + 0.85 * Math.min(1, Math.max(0, (seconds * 1000 - slowSince) / 300_000))
}

const errorsOf = (service: string, environment: Environment): Value => {
  const requests = requestsOf(service, environment)
  const share = environment === "production" && service === "checkout" ? 0.03 : 0.002
  return (seconds) => requests(seconds) * share * (1 + Math.sin(seconds / 90) / 2)
}

const appOf = (query: string) => /app="([^"]+)"/.exec(query)?.[1]

/** A value over time for one of the queries the demo's catalog and Estate's presets ask, or undefined for none. */
export const seriesOf = (environment: Environment, query: string): Value | undefined => {
  const cluster = clusterAsked(environment, query)
  if (cluster !== undefined) return (seconds) => statOf(cluster, query, seconds * 1000) ?? 0
  if (databaseStat(environment, query, 0) !== undefined)
    return (seconds) => databaseStat(environment, query, seconds) ?? 0
  const app = appOf(query)
  const scale = size(environment)
  const patterns: ReadonlyArray<readonly [RegExp, Value]> = [
    // Shares and ratios first, which name more than one series.
    [/^100 \* sum\(redis_memory_used_bytes/, wave(66, 3, 21)],
    [/^100 \* sum\(rate\(redis_keyspace_hits/, wave(94.6, 0.8, 22)],
    [/^100 \* avg\(process_cpu_usage/, wave(app === "checkout" && environment === "production" ? 71 : 24, 6, 10)],
    [/^count\(cnpg_collector_up/, () => 0],
    [/^time\(\) - max\(cnpg_collector_last_available_backup/, () => 3 * 3600],
    [/^histogram_quantile.*http_request_duration/, p99Of(app ?? "web", environment)],
    [/code=~"5\.\."/, errorsOf(app ?? "web", environment)],
    [/http_requests_total/, requestsOf(app ?? "web", environment)],
    [
      /orders_placed_total/,
      (seconds) => wave(4.2 * scale, 0.8 * scale, 1)(seconds) * shopTrafficOf(environment, seconds),
    ],
    [
      /baskets_created_total/,
      (seconds) => wave(31 * scale, 4 * scale, 2)(seconds) * trafficOf("basket", environment, seconds),
    ],
    [/outbox_waiting/, wave(environment === "production" ? 140 : 2, 30 * scale, 3)],
    // The agent: runs, a few failing, and its tokens.
    [/increase\(gen_ai_client_token_usage_sum/, () => 7_400_000],
    [/gen_ai_client_token_usage_sum/, wave(380_000, 50_000, 4)],
    [/gen_ai_client_operation_duration_seconds_count.*error_type/, wave(0.003, 0.002, 5)],
    [/gen_ai_client_operation_duration_seconds_count/, wave(0.4, 0.1, 6)],
    // The JVM's and the container's, for whichever service asks.
    [/jvm_memory_used_bytes/, wave(520 * 1024 ** 2, 80 * 1024 ** 2, 7)],
    [/jvm_gc_pause/, wave(0.014, 0.004, 8)],
    [/jvm_threads/, wave(72, 6, 9)],
    [/container_cpu/, wave(0.35 * Math.max(scale, 0.2), 0.08, 11)],
    [/container_memory/, wave(340 * 1024 ** 2, 30 * 1024 ** 2, 12)],
    // postgres_exporter and CloudNativePG: connections in use, commits, lag, size and backups.
    [/pg_stat_activity_count|cnpg_backends_total/, wave(environment === "production" ? 61 : 8, 8, 13)],
    [/max_connections/, () => 100],
    [/xact_commit/, wave(420 * scale + 3, 60 * scale, 14)],
    [/replication_lag/, wave(0.3, 0.2, 15)],
    [/database_size_bytes/, wave(48 * 1024 ** 3, 0.2 * 1024 ** 3, 16)],
    [/deadlocks/, () => 0],
    // redis_exporter: memory against its limit, hits and misses, evictions and clients.
    [/redis_memory_used_bytes/, wave(2.6 * 1024 ** 3, 0.1 * 1024 ** 3, 17)],
    [/redis_memory_max_bytes/, () => 4 * 1024 ** 3],
    [/redis_keyspace_hits_total/, wave(950, 40, 18)],
    [/redis_keyspace_misses_total/, wave(30, 10, 19)],
    [/redis_evicted_keys_total/, () => 0],
    [/redis_connected_clients/, wave(environment === "production" ? 140 : 6, 12, 20)],
  ]
  return patterns.find(([pattern]) => pattern.test(query))?.[1]
}

/** Prometheus's answer to a range query: one series, sampled at each step. */
export const rangeOf = (environment: Environment, url: URL) => {
  const query = url.searchParams.get("query") ?? ""
  const [start, end, step] = ["start", "end", "step"].map((name) => Number(url.searchParams.get(name)))
  const value = seriesOf(environment, query)
  if (value === undefined || !(step && step > 0))
    return { status: "success", data: { resultType: "matrix", result: [] } }
  const values: Array<[number, string]> = []
  for (let at = start ?? 0; at <= (end ?? 0); at += step) values.push([at, String(value(at))])
  return {
    status: "success",
    data: { resultType: "matrix", result: [{ metric: { app: appOf(query) ?? "" }, values }] },
  }
}

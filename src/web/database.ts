/** A database cluster in the page's words (spec 0060): what is wrong with it, in one sentence, and its marks. */
import type { PostgresCluster } from "../shared/postgres-cluster"
import { duration, measured } from "./format"

type Instance = PostgresCluster["instances"][number]

/** "95 s", or "4 min" past two minutes: a wait short enough to count in seconds is. */
export const waited = (seconds: number) => (seconds < 120 ? `${Math.round(seconds)} s` : duration(seconds * 1000))

/** A replica further behind than the store's threshold. */
export const behind = (cluster: PostgresCluster, instance: Instance) =>
  instance.role === "replica" && (instance.lag ?? 0) > cluster.limits.lag

/** A connection idle in a transaction this long holds its locks and its snapshot: worth a word. */
const idleTooLong = 60

export const idling = (client: PostgresCluster["clients"][number]) => (client.longestIdle ?? 0) > idleTooLong

/** An inactive slot that holds WAL fills the primary's disk. */
export const holding = (slot: PostgresCluster["slots"][number]) => !slot.active && (slot.retained ?? 0) > 0

export const databaseWrong = (cluster: PostgresCluster): string => {
  const said = [
    ...cluster.instances.flatMap((each) =>
      each.gone === undefined ? [] : [`${each.name} has been gone ${duration(each.gone * 1000)}`],
    ),
    ...cluster.instances.flatMap((each) =>
      behind(cluster, each)
        ? [
            `${each.name} is ${waited(each.lag ?? 0)} behind the primary${(each.growing ?? 0) > 0 ? " and falling further" : ""}`,
          ]
        : [],
    ),
    ...cluster.instances.flatMap((each) =>
      each.connections !== null &&
      each.maxConnections !== null &&
      each.maxConnections > 0 &&
      (100 * each.connections) / each.maxConnections > cluster.limits.connections
        ? [`${each.name} has ${each.connections} of its ${each.maxConnections} connections in use`]
        : [],
    ),
    ...cluster.slots.flatMap((slot) =>
      holding(slot) ? [`slot ${slot.name} is inactive and holds ${measured(slot.retained, "bytes")} of WAL`] : [],
    ),
    ...cluster.clients.flatMap((client) =>
      idling(client) ? [`${client.name} has been idle in a transaction for ${waited(client.longestIdle ?? 0)}`] : [],
    ),
    ...((cluster.archive?.failed ?? 0) > 0 ? ["the WAL archive has failed in the last hour"] : []),
  ]
  if (said.length === 0) return "Every instance is up, and nothing is behind or held."
  // The sentence starts with an instance's or a client's name, written as it is.
  return `${said.join("; ")}.`
}

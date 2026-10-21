/** The stores' actions, recording what they were asked and answering as the server would, for the pages' tests. */
import type { Actions } from "./context"
import { databaseCluster, loneDatabase } from "./fixture-database"
import { clusterAnswer, followedMessage, kafkaCluster } from "./fixture-kafka"

type Calls = Array<readonly [string, ...ReadonlyArray<unknown>]>

export const storeActions = (
  calls: Calls,
): Pick<Actions, "askStore" | "storeCluster" | "storeMessage" | "databaseCluster"> => ({
  askStore: (store) => {
    calls.push(["askStore", store])
    return Promise.resolve(store === "bus" ? clusterAnswer : "Ask AI is not configured")
  },
  storeCluster: (store) => {
    calls.push(["storeCluster", store])
    return Promise.resolve(store === "bus" ? kafkaCluster : `kafka_exporter publishes nothing for ${store}`)
  },
  storeMessage: (store, trace) => {
    calls.push(["storeMessage", store, trace])
    return Promise.resolve(
      trace === followedMessage.trace ? followedMessage : `${store} has no Tempo to follow a message in`,
    )
  },
  databaseCluster: (store) => {
    calls.push(["databaseCluster", store])
    const drawn = store === "orders-db" ? databaseCluster : store === "shop-db" ? loneDatabase : undefined
    return Promise.resolve(drawn ?? `the exporter publishes nothing for ${store}`)
  },
})

/**
 * `GET /api/store-cluster?env=&store=`: a store's cluster now, read when its page asks: a Kafka store's (spec 0057), or a
 * Postgres or cnpg store's (spec 0060).
 */
import { Clock, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { Configured } from "../settings"
import { readCluster } from "../sources/kafka-cluster"
import { readDatabase } from "../sources/postgres-cluster"
import { rangesIn } from "../sources/ranges"
import { Estate } from "../state"
import { storesIn } from "../views/stores"
import { json, refused, searchParams, withRole } from "./routes"

const Asked = Schema.Struct({ env: Schema.String, store: Schema.String })

export const storeClusterRoute = HttpRouter.add(
  "GET",
  "/api/store-cluster",
  Effect.gen(function* () {
    yield* withRole
    const asked = yield* searchParams(Asked, "a store's cluster is asked for by env and store")
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const environment = catalog.environments.find((each) => each.name === asked.env)
    const store = storesIn(catalog, asked.env).find((each) => each.name === asked.store)
    if (environment === undefined || store === undefined) return json({ message: "no such environment or store" }, 404)
    const engine = store.engine
    if (engine !== "kafka" && engine !== "postgres" && engine !== "cnpg")
      return json({ message: `${store.name} is a ${engine} store, whose cluster Estate does not draw` }, 404)
    const ranges = yield* rangesIn(settings.sources[environment.sources] ?? {})
    if (ranges === undefined) return json({ message: `${environment.name} has no metrics to read` }, 404)
    const now = yield* Clock.currentTimeMillis
    const read =
      engine === "kafka"
        ? yield* Effect.result(readCluster(ranges, store, now / 1000))
        : yield* Effect.result(readDatabase(ranges, { ...store, engine }, now / 1000))
    return read._tag === "Success" ? json(read.success) : json({ message: read.failure.message }, 404)
  }).pipe(Effect.catchTag("Refusal", refused)),
)

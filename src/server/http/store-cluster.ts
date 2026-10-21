/** `GET /api/store-cluster?env=&store=`: a Kafka store's cluster now, read when its page asks (spec 0057). */
import { Clock, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { Configured } from "../settings"
import { readCluster } from "../sources/kafka-cluster"
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
    if (store.engine !== "kafka") return json({ message: `${store.name} is not a Kafka store` }, 404)
    const ranges = yield* rangesIn(settings.sources[environment.sources] ?? {})
    if (ranges === undefined) return json({ message: `${environment.name} has no metrics to read` }, 404)
    const now = yield* Clock.currentTimeMillis
    const read = yield* Effect.result(readCluster(ranges, store, now / 1000))
    return read._tag === "Success" ? json(read.success) : json({ message: read.failure.message }, 404)
  }).pipe(Effect.catchTag("Refusal", refused)),
)

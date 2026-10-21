/**
 * `GET /api/store-message?env=&store=&trace=` (or `&id=&topic=`): one message followed through a Kafka store, read
 * when its page asks (spec 0057).
 */
import { Clock, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { Configured } from "../settings"
import { tempoOf } from "../sources/grafana"
import { followMessage, type Asked as Message } from "../sources/kafka-message"
import { rangesIn } from "../sources/ranges"
import { Estate } from "../state"
import { storesIn } from "../views/stores"
import { json, refused, searchParams, withRole } from "./routes"

const Asked = Schema.Struct({
  env: Schema.String,
  store: Schema.String,
  trace: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.String),
  topic: Schema.optionalKey(Schema.String),
})

const messageOf = (asked: typeof Asked.Type): Message | undefined => {
  if (asked.trace !== undefined && asked.trace !== "")
    return { trace: asked.trace, ...(asked.id === undefined ? {} : { id: asked.id }) }
  if (asked.id !== undefined && asked.id !== "" && asked.topic !== undefined && asked.topic !== "")
    return { id: asked.id, topic: asked.topic }
  return undefined
}

export const storeMessageRoute = HttpRouter.add(
  "GET",
  "/api/store-message",
  Effect.gen(function* () {
    yield* withRole
    const expected = "a message is followed by its trace, or by its id and topic"
    const asked = yield* searchParams(Asked, expected)
    const message = messageOf(asked)
    if (message === undefined) return json({ message: expected }, 400)
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const environment = catalog.environments.find((each) => each.name === asked.env)
    const store = storesIn(catalog, asked.env).find((each) => each.name === asked.store)
    if (environment === undefined || store === undefined) return json({ message: "no such environment or store" }, 404)
    if (store.engine !== "kafka") return json({ message: `${store.name} is not a Kafka store` }, 404)
    const sources = settings.sources[environment.sources] ?? {}
    const tempo = tempoOf(sources)
    if (tempo === undefined) return json({ message: `${environment.name} has no Tempo to follow a message in` }, 404)
    const ranges = yield* rangesIn(sources)
    if (ranges === undefined) return json({ message: `${environment.name} has no metrics to read` }, 404)
    const now = yield* Clock.currentTimeMillis
    return yield* followMessage(tempo, ranges, store, message, now).pipe(
      Effect.map((followed) => json(followed)),
      Effect.catchTag("NotFollowed", (why) => Effect.succeed(json({ message: why.message }, 404))),
      Effect.catchTag("SourceFailure", (why) => Effect.succeed(json({ message: why.message }, 502))),
    )
  }).pipe(Effect.catchTag("Refusal", refused)),
)

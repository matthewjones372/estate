/**
 * The event stream for one environment: on connect every part of the page, then each part again when it changes.
 * Each message's id names the whole page as it then stands, so a reconnect that already has it is sent nothing new.
 * The page is rendered once per change for everyone watching an environment, not once per page.
 */
import { Clock, Context, Duration, Effect, Layer, PubSub, RcMap, type Scope, Stream, SubscriptionRef } from "effect"
import type { EventName, Events } from "../shared/events"
import { Estate, type EstateState } from "./state"
import { alertsView } from "./views/alerts"
import { catalogView } from "./views/catalog"
import { deploysView } from "./views/deploys"
import { feedView } from "./views/feed"
import { servicesView } from "./views/services"

export interface Viewer {
  readonly environment: string
  readonly silences: boolean
}

export const viewsOf = (estate: EstateState, viewer: Viewer, now: number): Events => ({
  catalog: catalogView(estate.catalog, viewer.environment),
  services: servicesView(estate, viewer.environment),
  alerts: alertsView(estate, viewer.environment, viewer.silences),
  deploys: deploysView(estate),
  feed: feedView(estate, viewer.environment, now),
})

const names: ReadonlyArray<EventName> = ["catalog", "services", "alerts", "deploys", "feed"]

type Sent = Readonly<Record<EventName, string>>

/** Every part of the page as the text sent for it, and an id naming the whole. */
export interface Rendered {
  readonly sent: Sent
  readonly id: string
}

export const rendered = (views: Events): Rendered => {
  const sent = Object.fromEntries(names.map((name) => [name, JSON.stringify(views[name])])) as Sent
  return { sent, id: Bun.hash(names.map((name) => sent[name]).join("\n")).toString(36) }
}

/** The messages that bring a page showing `before` up to `now`, and what it then shows. */
export const framesFor = (
  before: Sent | undefined,
  now: Rendered,
  lastEventId: string | undefined,
): readonly [Sent, ReadonlyArray<string>] => {
  const { sent, id } = now
  if (before === undefined && id === lastEventId) return [sent, []]
  const changed = names.filter((name) => before === undefined || before[name] !== sent[name])
  return [sent, changed.map((name) => `id: ${id}\nevent: ${name}\ndata: ${sent[name]}\n\n`)]
}

/**
 * The page as each kind of viewer of an environment sees it, rendered once per change however many are watching:
 * one reader of the estate per environment and viewer kind, kept while anyone watches and for a little after, its
 * latest rendering replayed to whoever connects.
 */
export interface SharedViews {
  readonly watch: (viewer: Viewer) => Effect.Effect<Stream.Stream<Rendered>, never, Scope.Scope>
}
export const SharedViews = Context.Service<SharedViews>("estate/SharedViews")

export const sharedViewsLayer = Layer.effect(SharedViews)(
  Effect.gen(function* () {
    const ref = yield* Estate
    const readers = yield* RcMap.make({
      lookup: (key: string) =>
        Effect.gen(function* () {
          const [environment = "", silences] = key.split("\u0000")
          const viewer = { environment, silences: silences === "true" }
          const renderings = yield* PubSub.unbounded<Rendered>({ replay: 1 })
          yield* SubscriptionRef.changes(ref).pipe(
            Stream.mapEffect((estate) =>
              Effect.map(Clock.currentTimeMillis, (now) => rendered(viewsOf(estate, viewer, now))),
            ),
            Stream.changesWith((a, b) => a.id === b.id),
            Stream.runForEach((each) => PubSub.publish(renderings, each)),
            Effect.forkScoped,
          )
          return renderings
        }),
      idleTimeToLive: "30 seconds",
    })
    return {
      watch: (viewer: Viewer) =>
        Effect.map(RcMap.get(readers, `${viewer.environment}\u0000${viewer.silences}`), Stream.fromPubSub),
    }
  }),
)

const heartbeat = Duration.seconds(15)

/** One page's stream: the shared renderings, each sent as what changed since the last this page was sent. */
export const eventStream = (
  viewer: Viewer,
  lastEventId: string | undefined,
): Stream.Stream<string, never, SharedViews> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const shared = yield* SharedViews
      const changes = Stream.unwrap(shared.watch(viewer)).pipe(
        Stream.mapAccum(
          (): Sent | undefined => undefined,
          (before, now) => framesFor(before, now, lastEventId),
        ),
      )
      return Stream.make("retry: 3000\n\n").pipe(
        Stream.concat(
          Stream.merge(
            changes,
            Stream.tick(heartbeat).pipe(
              Stream.drop(1),
              Stream.map(() => ": still here\n\n"),
            ),
          ),
        ),
      )
    }),
  )

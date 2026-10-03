/**
 * The event stream for one environment: on connect every part of the page, then each part again when it changes.
 * Each message's id names the whole page as it then stands, so a reconnect that already has it is sent nothing new.
 */
import { Clock, Duration, Effect, Stream, SubscriptionRef } from "effect"
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

const idOf = (sent: Sent): string => Bun.hash(names.map((name) => sent[name]).join("\n")).toString(36)

/** The messages that bring a page showing `before` up to `views`, and what it then shows. */
export const framesFor = (
  before: Sent | undefined,
  views: Events,
  lastEventId: string | undefined,
): readonly [Sent, ReadonlyArray<string>] => {
  const sent = Object.fromEntries(names.map((name) => [name, JSON.stringify(views[name])])) as Sent
  const id = idOf(sent)
  if (before === undefined && id === lastEventId) return [sent, []]
  const changed = names.filter((name) => before === undefined || before[name] !== sent[name])
  return [sent, changed.map((name) => `id: ${id}\nevent: ${name}\ndata: ${sent[name]}\n\n`)]
}

const heartbeat = Duration.seconds(15)

export const eventStream = (viewer: Viewer, lastEventId: string | undefined): Stream.Stream<string, never, Estate> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const ref = yield* Estate
      const changes = SubscriptionRef.changes(ref).pipe(
        Stream.mapEffect((estate) => Effect.map(Clock.currentTimeMillis, (now) => viewsOf(estate, viewer, now))),
        Stream.mapAccum(
          (): Sent | undefined => undefined,
          (before, views) => framesFor(before, views, lastEventId),
        ),
      )
      return Stream.make("retry: 3000\n\n").pipe(
        Stream.concat(Stream.merge(changes, Stream.tick(heartbeat).pipe(Stream.map(() => ": still here\n\n")))),
      )
    }),
  )

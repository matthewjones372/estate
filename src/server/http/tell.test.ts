import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, SubscriptionRef } from "effect"
import type { Catalog } from "../../shared/catalog"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import { memoryNotes, Notes } from "../notes"
import { type Call, reply } from "../remote"
import type { Settings } from "../settings"
import { SourceFailure } from "../sources/run"
import { Estate } from "../state"
import { alertsView } from "../views/alerts"

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const owned: Catalog = {
  ...catalog,
  services: catalog.services.map((service) =>
    service.name === "orders"
      ? { ...service, owner: "orders" }
      : service.name === "search"
        ? { ...service, owner: "search" }
        : service,
  ),
  teams: [
    { name: "orders", title: "Orders", links: { slack: "https://example.slack.com/archives/C0ORDERS" } },
    { name: "search", title: "Search", links: { notion: "https://notion.so/search" } },
  ],
}

const firing = estate({
  catalog: owned,
  environments: {
    staging: environment(),
    production: environment({
      alerts: ok([
        {
          id: "a1",
          name: "OrdersSlow",
          state: "firing",
          severity: "warning",
          startsAt: "2026-10-03T11:46:00Z",
          labels: { app: "orders" },
          summary: "Orders are slow to place",
          impact: "Customers wait to place orders.",
        },
        {
          id: "a2",
          name: "SearchStale",
          state: "firing",
          severity: "critical",
          startsAt: "2026-10-03T11:00:00Z",
          labels: { app: "search" },
        },
      ]),
    }),
  },
})

/** Notes kept in memory, but for threads, which the database will not take. */
const downNotes = Layer.effect(Notes)(
  Effect.gen(function* () {
    const notes = yield* Notes
    return { ...notes, keepThread: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })) }
  }),
).pipe(Layer.provide(memoryNotes))

const withSlack = (extra: Partial<Settings> = {}): Settings => ({
  ...settings({ anonymous: { name: "ada", role: "viewer" } }),
  slack: { token: Redacted.make("xoxb-test"), url: "http://slack.test/api" },
  ...extra,
})

const slackAnswering = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.url === "http://slack.test/api/chat.postMessage")
    return reply({ ok: true, channel: "C0ORDERS", ts: "1759491960.000100" })
  if (call.url.startsWith("http://slack.test/api/chat.getPermalink?"))
    return reply({ ok: true, permalink: "https://example.slack.com/archives/C0ORDERS/p1759491960000100" })
  return undefined
}

/** The second firing of a critical alert, its first a week before, told while the notes database is down. */
const again = estate({
  ...firing,
  firings: [
    {
      environment: "production",
      alert: "a2",
      name: "SearchStale",
      startsAt: "2026-09-26T11:00:00Z",
      endsAt: "2026-09-26T11:20:00Z",
    },
  ],
})

const tell = (alert: string) => new Request(`http://estate/api/alerts/${alert}/tell?env=production`, { method: "POST" })

describe("telling the team on Slack", () => {
  test("posts the alert once in its team's channel, under the asker's name, and the card links to the thread", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withSlack(), firing, slackAnswering(calls))
        const first = yield* ask(server, tell("a1"))
        const again = yield* ask(server, tell("a1"))
        const state = yield* SubscriptionRef.get(yield* Effect.provide(Estate, server.context))
        return { first: first.json(), again: again.json(), state }
      }),
    ).then(({ first, again, state }) => {
      const thread = { url: "https://example.slack.com/archives/C0ORDERS/p1759491960000100" }
      expect([first, again]).toEqual([thread, thread])
      const posts = calls.filter((call) => call.url.endsWith("chat.postMessage"))
      expect(posts.length).toBe(1)
      expect(posts[0]?.headers?.["authorization"]).toBe("Bearer xoxb-test")
      expect(JSON.parse(posts[0]?.body ?? "{}")).toMatchObject({
        channel: "C0ORDERS",
        text: "🔶 *OrdersSlow* is firing in production: Orders are slow to place\nImpact: Customers wait to place orders.\nPosted by ada from Estate",
      })
      expect(alertsView(state, "production", false).alerts.find((alert) => alert.id === "a1")?.thread).toEqual(thread)
    })
  })

  test("is not offered without a token, read-only, or a team on Slack, and says why Slack refused", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bare = yield* serverFor(settings({ anonymous: { name: "ada", role: "viewer" } }), firing)
        const readOnly = yield* serverFor(withSlack({ readOnly: true }), firing)
        const refusing = yield* serverFor(withSlack(), firing, () => reply({ ok: false, error: "not_in_channel" }))
        return [
          yield* ask(bare, tell("a1")),
          yield* ask(readOnly, tell("a1")),
          yield* ask(refusing, tell("a2")),
          yield* ask(refusing, tell("nope")),
          yield* ask(refusing, tell("a1")),
        ].map((answer) => [answer.status, (answer.json() as { message: string }).message])
      }),
    ).then((answers) =>
      expect(answers).toEqual([
        [404, "Estate has no Slack token"],
        [403, "read-only Estate posts nothing"],
        [404, "search has no team with a Slack channel to tell"],
        [404, "there is no alert nope in production"],
        [502, "Slack refused the message: not_in_channel"],
      ]),
    ))

  test("says when a critical alert fired before, and keeps its link when the notes database is down", () => {
    const calls: Call[] = []
    const ownedBySearch = {
      ...again,
      catalog: {
        ...again.catalog,
        teams: [{ name: "search", title: "Search", links: { slack: "https://example.slack.com/archives/C0SEARCH" } }],
      },
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withSlack(), ownedBySearch, slackAnswering(calls), downNotes)
        return yield* ask(server, tell("a2"))
      }),
    ).then((answer) => {
      expect(answer.status).toBe(200)
      expect(JSON.parse(calls[0]?.body ?? "{}").text).toBe(
        "🔴 *SearchStale* is firing in production\nFired before: once, last 2026-09-26.\nPosted by ada from Estate",
      )
    })
  })
})

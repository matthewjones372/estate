import { describe, expect, test } from "bun:test"
import { Context, Effect, SubscriptionRef } from "effect"
import type { Incident } from "../../shared/incidents"
import { ask, environment, estate, type Server, serverFor, settings } from "../fixture"
import { Notes } from "../notes"
import { Estate, type SourcedAlert } from "../state"
import { alertsView } from "../views/alerts"

const firing = (id: string, name: string): SourcedAlert => ({
  id,
  name,
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-12T16:47:58Z",
  labels: { alertname: name },
})
const firings = estate({
  environments: {
    staging: environment({
      alerts: { state: "ok", value: [firing("a1", "ChipRegistryUnreachable"), firing("a2", "AdoptionsNotRecorded")] },
    }),
    production: environment({ alerts: { state: "ok", value: [firing("a3", "AdoptionsSlow")] } }),
  },
})
const operator = settings({ anonymous: { name: "gil", role: "operator" } })
const viewer = settings({ anonymous: { name: "vi", role: "viewer" } })

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

// A moment between steps, so each step's events are later than the last's.
const step = (server: Server, request: Request) => ask(server, request).pipe(Effect.tap(() => Effect.sleep("2 millis")))

const eventsOf = (server: Server, environment: string, alert: string) =>
  Context.get(server.context, Notes)
    .events({ environment, alert, startsAt: "2026-10-12T16:47:58Z" })
    .pipe(Effect.map((events) => events.map((each) => [each.by, each.kind, each.text])))

/** Opens an incident with one firing, links a second, moves one to another incident, unlinks, and closes. */
const story = Effect.gen(function* () {
  const server = yield* serverFor(operator, firings)
  const slow = (yield* step(
    server,
    sending("POST", "/api/incidents", { title: " Chip registry slow ", environment: "staging", alert: "a1" }),
  )).json() as Incident
  yield* step(server, sending("POST", `/api/incidents/${slow.id}/firings`, { environment: "production", alert: "a3" }))
  const opened = yield* step(
    server,
    sending("POST", "/api/incidents", { title: "Adoptions down", environment: "staging", alert: "a2" }),
  )
  const down = opened.json() as Incident
  const moved = yield* step(
    server,
    sending("POST", `/api/incidents/${down.id}/firings`, { environment: "staging", alert: "a1" }),
  )
  const unlinked = yield* step(server, sending("DELETE", `/api/incidents/${slow.id}/firings?env=production&alert=a3`))
  const closed = yield* step(
    server,
    sending("POST", `/api/incidents/${down.id}/close`, { how: "registry restarted, adoptions recovering" }),
  )
  const state = yield* SubscriptionRef.get(Context.get(server.context, Estate))
  return {
    statuses: [opened.status, moved.status, unlinked.status, closed.status],
    ids: { slow: slow.id, down: down.id },
    shown: state.incidents ?? [],
    kept: yield* Context.get(server.context, Notes).incidents("2026-01-01T00:00:00Z"),
    a1: yield* eventsOf(server, "staging", "a1"),
    a2: yield* eventsOf(server, "staging", "a2"),
    a3: yield* eventsOf(server, "production", "a3"),
    read: (yield* ask(server, sending("GET", `/api/incidents/${down.id}`))).json() as {
      incident?: Incident
      events: ReadonlyArray<{ environment: string; alert: string; by: string; kind: string; text: string }>
    },
    open: (yield* ask(server, sending("GET", "/api/incidents"))).json(),
    staging: alertsView(state, "staging", false).alerts,
    production: alertsView(state, "production", false).alerts,
  }
})

const linkedBy = (environment: string, alert: string, name: string) =>
  expect.objectContaining({ environment, alert, name, startsAt: "2026-10-12T16:47:58Z", linkedBy: "gil" })

const a1 = { environment: "staging", alert: "a1" }
const dismiss = (id: string) =>
  sending("POST", `/api/incidents/${id}/dismissed`, { environment: "staging", alert: "a2" })

describe("incidents", () => {
  test("are opened, linked, moved, unlinked and closed, each step an event on its firings, each firing named", () =>
    Effect.runPromise(story).then(({ statuses, ids, shown, kept, a1, a2, a3, read, open, staging, production }) => {
      expect(statuses).toEqual([201, 200, 200, 200])
      const slow = shown.find((each) => each.id === ids.slow)
      const down = shown.find((each) => each.id === ids.down)
      expect(slow).toEqual({
        id: ids.slow,
        title: "Chip registry slow",
        openedBy: "gil",
        openedAt: expect.any(String),
        firings: [],
      })
      expect(down).toEqual({
        id: ids.down,
        title: "Adoptions down",
        openedBy: "gil",
        openedAt: expect.any(String),
        closedBy: "gil",
        closedAt: expect.any(String),
        ended: "registry restarted, adoptions recovering",
        firings: [
          linkedBy("staging", "a2", "AdoptionsNotRecorded"),
          linkedBy("staging", "a1", "ChipRegistryUnreachable"),
        ],
      })
      const byOpening = (a: Incident, b: Incident) => a.openedAt.localeCompare(b.openedAt)
      expect(kept.toSorted(byOpening)).toEqual(shown.toSorted(byOpening))
      expect(a1).toEqual([
        ["gil", "incident-opened", "Chip registry slow"],
        ["gil", "incident-unlinked", "Chip registry slow"],
        ["gil", "incident-linked", "Adoptions down"],
        ["gil", "incident-closed", "registry restarted, adoptions recovering"],
      ])
      expect(a2).toEqual([
        ["gil", "incident-opened", "Adoptions down"],
        ["gil", "incident-closed", "registry restarted, adoptions recovering"],
      ])
      expect(a3).toEqual([
        ["gil", "incident-linked", "Chip registry slow"],
        ["gil", "incident-unlinked", "Chip registry slow"],
      ])
      expect(read.incident).toEqual(shown.find((each) => each.id === ids.down))
      expect(read.events.map((each) => [each.environment, each.alert, each.kind, each.text])).toEqual([
        ["staging", "a1", "incident-opened", "Chip registry slow"],
        ["staging", "a2", "incident-opened", "Adoptions down"],
        ["staging", "a1", "incident-unlinked", "Chip registry slow"],
        ["staging", "a1", "incident-linked", "Adoptions down"],
        // Closing is done to the incident, so its page says it once, though each firing keeps it.
        ["staging", "a2", "incident-closed", "registry restarted, adoptions recovering"],
      ])
      expect(open).toEqual({ incidents: shown.filter((each) => each.id === ids.slow) })
      expect(staging.map((each) => [each.id, each.incident])).toEqual([
        ["a1", { id: ids.down, title: "Adoptions down", closed: true, openedAt: down?.openedAt ?? "" }],
        ["a2", { id: ids.down, title: "Adoptions down", closed: true, openedAt: down?.openedAt ?? "" }],
      ])
      expect(production.map((each) => each.incident)).toEqual([undefined])
    }))

  test("a closed incident keeps its firings: one linked again goes into a new incident, and the alert shows that one", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(operator, firings)
        const first = (yield* step(
          server,
          sending("POST", "/api/incidents", { title: "First", environment: "staging", alert: "a1" }),
        )).json() as Incident
        yield* step(server, sending("POST", `/api/incidents/${first.id}/close`, { how: "it passed" }))
        const second = (yield* step(
          server,
          sending("POST", "/api/incidents", { title: "Again", environment: "staging", alert: "a1" }),
        )).json() as Incident
        const state = yield* SubscriptionRef.get(Context.get(server.context, Estate))
        return {
          kept: state.incidents ?? [],
          shown: alertsView(state, "staging", false).alerts.find((each) => each.id === "a1")?.incident,
          events: yield* eventsOf(server, "staging", "a1"),
          ids: [first.id, second.id] as const,
        }
      }),
    ).then(({ kept, shown, events, ids: [first, second] }) => {
      expect(kept.find((each) => each.id === first)?.firings.map((each) => each.alert)).toEqual(["a1"])
      expect(shown).toEqual({
        id: second,
        title: "Again",
        closed: false,
        openedAt: kept.find((each) => each.id === second)?.openedAt ?? "",
      })
      expect(events.map(([, kind, text]) => [kind, text])).toEqual([
        ["incident-opened", "First"],
        ["incident-closed", "it passed"],
        ["incident-opened", "Again"],
      ])
    }))

  test("are kept by operators only: a viewer reads them, and may open, link, unlink or close none", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(viewer, firings)
        const writes = [
          sending("POST", "/api/incidents", { title: "Slow", environment: "staging", alert: "a1" }),
          sending("POST", "/api/incidents/i1/firings", { environment: "staging", alert: "a1" }),
          sending("DELETE", "/api/incidents/i1/firings?env=staging&alert=a1"),
          sending("POST", "/api/incidents/i1/close", { how: "fixed" }),
        ]
        const refused = yield* Effect.forEach(writes, (request) => ask(server, request))
        const read = yield* ask(server, sending("GET", "/api/incidents"))
        return { refused: refused.map((each) => each.status), read: [read.status, read.json()] }
      }),
    ).then(({ refused, read }) => {
      expect(refused).toEqual([403, 403, 403, 403])
      expect(read).toEqual([200, { incidents: [] }])
    }))

  test("refuse what is malformed, unknown or not firing, and every write where Estate is read-only", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(operator, firings)
        const opened = (yield* ask(
          server,
          sending("POST", "/api/incidents", { title: "Slow", environment: "staging", alert: "a1" }),
        )).json() as Incident
        const asked = [
          sending("POST", "/api/incidents", { title: "Slow" }),
          sending("POST", "/api/incidents", { title: " ", environment: "staging", alert: "a1" }),
          sending("POST", "/api/incidents", { title: "Slow", environment: "staging", alert: "gone" }),
          sending("POST", "/api/incidents/nope/firings", { environment: "staging", alert: "a2" }),
          sending("POST", `/api/incidents/${opened.id}/firings`, { alert: "a2" }),
          sending("POST", `/api/incidents/${opened.id}/firings`, { environment: "production", alert: "a1" }),
          sending("DELETE", `/api/incidents/${opened.id}/firings?env=staging`),
          sending("DELETE", `/api/incidents/${opened.id}/firings?env=staging&alert=a2`),
          sending("POST", `/api/incidents/${opened.id}/close`, { how: "  " }),
          sending("POST", "/api/incidents/nope/close", { how: "fixed" }),
          sending("GET", "/api/incidents/nope"),
        ]
        const statuses = yield* Effect.forEach(asked, (request) => Effect.map(ask(server, request), (r) => r.status))
        yield* ask(server, sending("POST", `/api/incidents/${opened.id}/close`, { how: "fixed" }))
        const again = yield* ask(server, sending("POST", `/api/incidents/${opened.id}/close`, { how: "fixed" }))
        const linkClosed = yield* ask(
          server,
          sending("POST", `/api/incidents/${opened.id}/firings`, { environment: "staging", alert: "a2" }),
        )
        const readOnly = yield* serverFor({ ...operator, readOnly: true }, firings)
        const refused = yield* ask(
          readOnly,
          sending("POST", "/api/incidents", { title: "Slow", environment: "staging", alert: "a1" }),
        )
        return { statuses, after: [again.status, linkClosed.status], readOnly: refused.status }
      }),
    ).then(({ statuses, after, readOnly }) => {
      expect(statuses).toEqual([400, 400, 404, 404, 400, 404, 400, 404, 400, 404, 404])
      expect(after).toEqual([400, 400])
      expect(readOnly).toBe(403)
    }))

  test("a firing said not to belong is kept on the record with who said so, an event, and is suggested no more", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const related = (id: string, name: string, service: string) => ({ ...firing(id, name), labels: { service } })
        const alerts = [related("a1", "OrdersSlow", "orders"), related("a2", "CheckoutSlow", "storefront")]
        const near = estate({ environments: { staging: environment({ alerts: { state: "ok", value: alerts } }) } })
        const server = yield* serverFor(operator, near)
        const opened = yield* ask(server, sending("POST", "/api/incidents", { title: "Orders slow", ...a1 }))
        const id = (opened.json() as Incident).id
        const ref = Context.get(server.context, Estate)
        const suggested = Effect.map(
          SubscriptionRef.get(ref),
          (state) => alertsView(state, "staging", false, 30).alerts.find((each) => each.id === "a2")?.suggested?.why,
        )
        const before = yield* suggested
        const said = yield* ask(server, dismiss(id))
        const again = yield* ask(server, dismiss(id))
        const own = yield* ask(server, sending("POST", `/api/incidents/${id}/dismissed`, a1))
        const refusals = [
          yield* ask(yield* serverFor(viewer, near), dismiss(id)),
          yield* ask(yield* serverFor({ ...operator, readOnly: true }, near), dismiss(id)),
        ]
        const state = yield* SubscriptionRef.get(ref)
        return {
          before,
          after: yield* suggested,
          status: [said.status, again.status, own.status],
          dismissed: state.incidents?.find((each) => each.id === id)?.dismissed,
          events: yield* eventsOf(server, "staging", "a2"),
          refused: refusals.map((each) => each.status),
        }
      }),
    ).then(({ before, after, status, dismissed, events, refused }) => {
      // Said twice is kept once; one of its own firings is unlinked rather than dismissed.
      expect([before, after, status]).toEqual(["next to it", undefined, [200, 200, 400]])
      expect(dismissed).toEqual([
        { environment: "staging", alert: "a2", startsAt: "2026-10-12T16:47:58Z", by: "gil", at: expect.any(String) },
      ])
      expect(events).toEqual([["gil", "incident-dismissed", "Orders slow"]])
      expect(refused).toEqual([403, 403])
    }))
})

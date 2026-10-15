import { describe, expect, test } from "bun:test"
import { Context, Effect } from "effect"
import type { Incident } from "../../shared/incidents"
import { allSeenLive } from "../../shared/timeline"
import { ask, environment, estate, type Server, serverFor, settings } from "../fixture"
import { Notes, type StoredEvent } from "../notes"
import type { Settings } from "../settings"
import type { SourcedAlert } from "../state"

const live: SourcedAlert = {
  id: "a1",
  name: "ChipRegistryUnreachable",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-12T16:47:58Z",
  labels: { alertname: "ChipRegistryUnreachable", service: "orders" },
}
const incident: Incident = {
  id: "i1",
  title: "Registry down",
  openedBy: "matt",
  openedAt: "2026-10-12T16:48:30Z",
  firings: [
    { environment: "staging", alert: "a1", name: live.name, startsAt: live.startsAt, linkedBy: "matt", linkedAt: "x" },
  ],
}
const kept = estate({
  environments: { staging: environment({ alerts: { state: "ok", value: [live] } }), production: environment() },
  incidents: [incident],
})

const cause = "lock timeout on orders_items for customer 4411 (medium)"
const withheld = "AI answered from logs only operators read"

const on = { environment: "staging", alert: "a1", startsAt: live.startsAt }
const events: ReadonlyArray<StoredEvent> = allSeenLive([
  { ...on, id: "e1", at: "2026-10-12T16:49:10Z", by: "matt", kind: "ai-asked", text: "claude-haiku-4-5" },
  { ...on, id: "e2", at: "2026-10-12T16:49:52Z", by: "Estate", kind: "ai-answered", text: cause, readLogs: true },
])

const as = (role: "viewer" | "operator", logs?: "operator"): Settings =>
  settings({ anonymous: { name: role === "viewer" ? "vi" : "gil", role }, ...(logs === undefined ? {} : { logs }) })

/** What each of the four places that hand events out says, read as `configured`. */
const everywhere = (configured: Settings) =>
  Effect.gen(function* () {
    const server: Server = yield* serverFor(configured, kept)
    yield* Effect.forEach(events, (event) => Context.get(server.context, Notes).addEvent(event))
    const get = (path: string) => Effect.map(ask(server, new Request(`http://estate${path}`)), (got) => got.text)
    return {
      firing: yield* get("/api/firings/a1/events?env=staging"),
      incident: yield* get("/api/incidents/i1"),
      markdown: yield* get("/api/firings/a1/timeline?env=staging&format=md"),
      json: yield* get("/api/incidents/i1/timeline?format=json"),
    }
  })

const expectWhole = (said: Record<string, string>) => {
  for (const text of Object.values(said)) {
    expect(text).toContain("lock timeout on orders_items")
    expect(text).not.toContain(withheld)
  }
}

describe("an AI's answer drawn from logs", () => {
  test("is withheld from a viewer where logs are for operators, keeping that it answered", () =>
    Effect.runPromise(everywhere(as("viewer", "operator"))).then((said) => {
      for (const text of [said.incident, said.json, said.firing]) {
        expect(text).not.toContain("lock timeout")
        expect(text).toContain('"kind":"ai-answered"')
        expect(text).toContain('"withheld":true')
        expect(text).toContain("claude-haiku-4-5")
      }
      expect(said.markdown).not.toContain("lock timeout")
      expect(said.markdown).toContain(`| Estate | ${withheld} |`)
      expect(said.markdown).toContain("asked AI (claude-haiku-4-5)")
    }))

  test("is whole for an operator where logs are for operators", () =>
    Effect.runPromise(everywhere(as("operator", "operator"))).then(expectWhole))

  test("is whole for a viewer and an operator where logs are for everyone", () =>
    Effect.runPromise(Effect.all([everywhere(as("viewer")), everywhere(as("operator"))])).then((both) =>
      both.forEach(expectWhole),
    ))
})

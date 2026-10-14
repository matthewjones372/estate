import { describe, expect, test } from "bun:test"
import { Effect, Redacted, Result } from "effect"
import { type Call, type Remote, type Reply, reply, stubRemote } from "../remote"
import type { Raising } from "./incident-tools"
import { incidentIo } from "./incidentio"

const settings = { token: Redacted.make("io-key"), severity: "Minor" }

const raising: Raising = {
  key: "inc-1",
  title: "Chip registry slow",
  impact: "Owners cannot look up a lost pet",
  firings: [
    {
      environment: "production",
      name: "ChipRegistryLatency",
      service: "chip-registry",
      severity: "critical",
      startsAt: "2026-10-12T16:40:00Z",
    },
  ],
  page: "https://estate.example/incidents/inc-1",
  by: "matt",
  team: { pagerduty: "PDEF456" },
}

const permalink = "https://app.incident.io/example/incidents/42"

const made = {
  id: "01HX",
  reference: "INC-42",
  name: "Chip registry slow",
  permalink,
  incident_status: { id: "s1", name: "Investigating", category: "active" },
  severity: { id: "sev-minor", name: "Minor", rank: 1 },
  incident_role_assignments: [
    { role: { id: "r1", name: "Incident Lead", role_type: "lead" }, assignee: { id: "u1", name: "ada" } },
    { role: { id: "r2", name: "Comms", role_type: "custom" } },
    { role: { id: "r3", name: "Scribe", role_type: "custom" }, assignee: { id: "u2", name: "gil" } },
  ],
}

const severities = {
  severities: [
    { id: "sev-major", name: "Major", rank: 2 },
    { id: "sev-minor", name: "Minor", rank: 1 },
  ],
}

/** incident.io's API in the shapes its reference gives, refusing a call without the key. */
const fake =
  (calls: Call[]) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    if (call.headers?.["Authorization"] !== "Bearer io-key")
      return reply({ type: "authentication_error", status: 401, errors: [{ message: "Invalid API key" }] }, 401)
    const url = new URL(call.url)
    if (url.pathname === "/v1/severities") return reply(severities)
    if (call.method === "POST" && url.pathname === "/v2/incidents") return reply({ incident: made }, 201)
    if (url.pathname === "/v2/incidents/01HX") return reply({ incident: made })
    return undefined
  }

const run = <A, E>(effect: Effect.Effect<A, E, Remote>, answer: (call: Call) => Reply | undefined) =>
  Effect.runPromise(Effect.result(effect.pipe(Effect.provide(stubRemote(answer)))))

describe("incident.io", () => {
  test("raises with the idempotency key, the title as its name, the severity's id, its visibility and mode", () => {
    const calls: Call[] = []
    return run(incidentIo(settings).raise(raising), fake(calls)).then((raised) => {
      expect(raised).toEqual(Result.succeed({ id: "01HX", url: permalink }))
      const posted = calls.find((call) => call.method === "POST")
      expect([posted?.url, posted?.headers?.["Content-Type"]]).toEqual([
        "https://api.incident.io/v2/incidents",
        "application/json",
      ])
      const body = JSON.parse(posted?.body ?? "{}")
      expect(body).toEqual({
        idempotency_key: "inc-1",
        name: "Chip registry slow",
        severity_id: "sev-minor",
        visibility: "public",
        mode: "standard",
        summary: expect.any(String),
      })
      expect(body.summary).toContain("- ChipRegistryLatency in production (chip-registry), since 2026-10-12T16:40:00Z")
      expect(body.summary).toContain("Raised from Estate by matt")
    })
  })

  test("raises privately, without announcing, where the settings say", () => {
    const calls: Call[] = []
    const quiet = { ...settings, mode: "test" as const, visibility: "private" as const, url: "https://io.example/" }
    return run(incidentIo(quiet).raise(raising), fake(calls)).then(() => {
      const posted = calls.find((call) => call.method === "POST")
      expect(posted?.url).toBe("https://io.example/v2/incidents")
      expect(JSON.parse(posted?.body ?? "{}")).toMatchObject({ visibility: "private", mode: "test" })
    })
  })

  test("reads back its status and category, severity and role assignments", () =>
    run(incidentIo(settings).read("01HX"), fake([])).then((read) => {
      expect(read).toEqual(
        Result.succeed({
          status: "Investigating (active)",
          severity: "Minor",
          responders: ["ada", "gil"],
          url: permalink,
        }),
      )
    }))

  test("reads a status whose name is its category once, and an incident with no severity", () =>
    run(incidentIo(settings).read("01HX"), () =>
      reply({
        incident: {
          ...made,
          incident_status: { name: "Triage", category: "triage" },
          severity: null,
          incident_role_assignments: [],
        },
      }),
    ).then((read) => {
      expect(read).toEqual(Result.succeed({ status: "Triage", responders: [], url: permalink }))
    }))

  test("names a severity it does not have, and fails in incident.io's words when it refuses", () =>
    Promise.all([
      run(incidentIo({ ...settings, severity: "Sev 9" }).raise(raising), fake([])),
      run(incidentIo({ ...settings, token: Redacted.make("wrong") }).raise(raising), fake([])),
      run(incidentIo(settings).raise(raising), (call) =>
        call.method === "POST"
          ? reply({ type: "validation_error", status: 422, errors: [{ message: "name is too long" }] }, 422)
          : reply(severities),
      ),
    ]).then(([unknown, refused, invalid]) => {
      expect(Result.isFailure(unknown) && unknown.failure.message).toBe(
        'incident.io has no severity "Sev 9": it has Major, Minor',
      )
      expect(Result.isFailure(refused) && refused.failure.message).toBe("incident.io answered 401: Invalid API key")
      expect(Result.isFailure(invalid) && invalid.failure.message).toBe("incident.io answered 422: name is too long")
    }))

  test("is checked by finding the severity it raises at", () =>
    Promise.all([
      run(incidentIo(settings).check, fake([])),
      run(incidentIo({ ...settings, mode: "test" }).check, fake([])),
      run(incidentIo(settings).read("01HX"), () => reply("<html>", 200)),
    ]).then(([standard, test, odd]) => {
      expect(standard).toEqual(Result.succeed("raises at Minor, announced"))
      expect(test).toEqual(Result.succeed("raises at Minor, in test mode, unannounced"))
      expect(Result.isFailure(odd) && odd.failure.message).toBe("incident.io answered in a shape Estate does not know")
    }))
})

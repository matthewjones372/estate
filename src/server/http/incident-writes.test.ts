import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer, SubscriptionRef } from "effect"
import type { Incident } from "../../shared/incidents"
import { ask, environment, estate, serverFor, settings } from "../fixture"
import { memoryNotes, Notes } from "../notes"
import { Estate, type SourcedAlert } from "../state"

const firing = (id: string, name: string, startsAt = "2026-10-12T16:47:58Z"): SourcedAlert => ({
  id,
  name,
  state: "firing",
  severity: "warning",
  startsAt,
  labels: { alertname: name },
})
const firings = estate({
  environments: {
    staging: environment({
      alerts: {
        state: "ok",
        value: [
          firing("a1", "ChipRegistryUnreachable"),
          firing("a2", "AdoptionsNotRecorded"),
          firing("a3", "AdoptionsSlow"),
        ],
      },
    }),
  },
})
const operator = settings({ anonymous: { name: "gil", role: "operator" } })

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** Notes in memory whose store takes a moment to keep an incident, as a database over the network does. */
const slowToKeep = Layer.effect(Notes)(
  Effect.map(Effect.service(Notes), (notes) => ({
    ...notes,
    keepIncident: (incident: Incident) => Effect.andThen(Effect.sleep("5 millis"), notes.keepIncident(incident)),
  })),
).pipe(Layer.provide(memoryNotes))

describe("incident writes", () => {
  test("made at once each keep the other's: two firings linked together are both in the incident", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(operator, firings, undefined, slowToKeep)
        const opened = (yield* ask(
          server,
          sending("POST", "/api/incidents", { title: "Slow", environment: "staging", alert: "a1" }),
        )).json() as Incident
        yield* Effect.all(
          ["a2", "a3"].map((alert) =>
            ask(server, sending("POST", `/api/incidents/${opened.id}/firings`, { environment: "staging", alert })),
          ),
          { concurrency: "unbounded" },
        )
        const shown = (yield* SubscriptionRef.get(Context.get(server.context, Estate))).incidents ?? []
        const kept = yield* Context.get(server.context, Notes).incidents("2026-01-01T00:00:00Z")
        const alertsIn = (incidents: ReadonlyArray<Incident>) =>
          incidents.flatMap((each) => each.firings.map((one) => one.alert)).toSorted()
        return { shown: alertsIn(shown), kept: alertsIn(kept) }
      }),
    ).then(({ shown, kept }) => {
      expect(shown).toEqual(["a1", "a2", "a3"])
      expect(kept).toEqual(["a1", "a2", "a3"])
    }))

  test("unlink the firing asked for, by its start, when the incident holds two of one alert", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const earlier = "2026-10-12T15:00:00Z"
        const later = "2026-10-12T16:47:58Z"
        const linked = (startsAt: string) => ({
          environment: "staging",
          alert: "a1",
          name: "ChipRegistryUnreachable",
          startsAt,
          linkedBy: "gil",
          linkedAt: startsAt,
        })
        const incident: Incident = {
          id: "i1",
          title: "Slow",
          openedBy: "gil",
          openedAt: earlier,
          firings: [linked(earlier), linked(later)],
        }
        const server = yield* serverFor(operator, { ...firings, incidents: [incident] })
        const unlinked = yield* ask(
          server,
          sending("DELETE", `/api/incidents/i1/firings?env=staging&alert=a1&at=${encodeURIComponent(earlier)}`),
        )
        return (unlinked.json() as Incident).firings.map((each) => each.startsAt)
      }),
    ).then((left) => {
      expect(left).toEqual(["2026-10-12T16:47:58Z"])
    }))
})

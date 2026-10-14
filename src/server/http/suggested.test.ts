import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Incident } from "../../shared/incidents"
import { environment, estate, serverFor, settings } from "../fixture"
import type { Settings } from "../settings"
import type { SourcedAlert } from "../state"

const at = "2026-10-12T16:47:58Z"
const firing = (id: string, name: string, service: string): SourcedAlert => ({
  id,
  name,
  state: "firing",
  severity: "warning",
  startsAt: at,
  labels: { service },
})
const slow: Incident = {
  id: "i1",
  title: "Orders slow",
  openedBy: "gil",
  openedAt: at,
  firings: [{ environment: "staging", alert: "a1", startsAt: at, linkedBy: "gil", linkedAt: at }],
}
const alerts = [firing("a1", "OrdersSlow", "orders"), firing("a2", "CheckoutSlow", "storefront")]
const state = estate({
  environments: { staging: environment({ alerts: { state: "ok", value: alerts } }) },
  incidents: [slow],
})

/** The alerts event a page is first sent, as this person, each alert's id and what it was suggested for. */
const sentTo = (configured: Settings) =>
  Effect.gen(function* () {
    const server = yield* serverFor(configured, state)
    const response = yield* Effect.promise(() => server.handler(new Request("http://estate/events?env=staging")))
    const text = yield* Effect.promise(() => {
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      const read = (sofar: string): Promise<string> =>
        reader === undefined || sofar.includes("event: alerts\n")
          ? Promise.resolve(sofar)
          : reader.read().then(({ value, done }) => (done ? sofar : read(sofar + decoder.decode(value))))
      return read("").then((sofar) => reader?.cancel().then(() => sofar) ?? sofar)
    })
    const data = /event: alerts\ndata: (.*)/.exec(text)?.[1] ?? "{}"
    const sent = JSON.parse(data) as { alerts: ReadonlyArray<{ id: string; suggested?: { incident: { id: string } } }> }
    return sent.alerts.map((each) => [each.id, each.suggested?.incident.id])
  })

describe("a firing that may belong to an incident, on the page's alerts", () => {
  test("is sent to an operator, and to neither a viewer nor anyone where Estate is read-only", () =>
    Effect.runPromise(
      Effect.all([
        sentTo(settings({ anonymous: { name: "gil", role: "operator" } })),
        sentTo(settings({ anonymous: { name: "vi", role: "viewer" } })),
        sentTo({ ...settings({ anonymous: { name: "gil", role: "operator" } }), readOnly: true }),
      ]),
    ).then(([operator, viewer, readOnly]) => {
      expect(operator).toEqual([
        ["a1", undefined],
        ["a2", "i1"],
      ])
      expect(viewer).toEqual([
        ["a1", undefined],
        ["a2", undefined],
      ])
      expect(readOnly).toEqual(viewer)
    }))

  test("on an incident's page are read by an operator, and not by a viewer", () =>
    Effect.runPromise(
      Effect.all(
        [
          settings({ anonymous: { name: "gil", role: "operator" } }),
          settings({ anonymous: { name: "vi", role: "viewer" } }),
        ].map((configured) =>
          Effect.flatMap(serverFor(configured, state), (server) =>
            Effect.promise(() =>
              server
                .handler(new Request("http://estate/api/incidents/i1"))
                .then((response) => response.json() as Promise<{ suggested?: ReadonlyArray<{ alert: string }> }>),
            ),
          ),
        ),
      ),
    ).then(([operator, viewer]) => {
      expect(operator?.suggested?.map((each) => each.alert)).toEqual(["a2"])
      expect(viewer?.suggested).toBeUndefined()
    }))
})

import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Result } from "effect"
import { type Call, Remote, RemoteError, reply, stubRemote } from "../remote"
import type { SourcedAlert } from "../state"
import { alertsBeside, datadogAlerts, datadogSilence, datadogUnsilence } from "./datadog"
import { alertsOf } from "./ports"
import { silencerOf } from "./silencers"

const datadog = {
  url: "https://datadog/",
  apiKey: Redacted.make("api"),
  appKey: Redacted.make("app"),
  tags: ["env:production"],
}

const monitor = (id: number, name: string, groups: Record<string, string>, tags: ReadonlyArray<string> = []) => ({
  id,
  name,
  message: "{{#is_alert}}Checkout is failing payments{{/is_alert}} @slack-payments",
  tags,
  overall_state: "Alert",
  state: {
    groups: Object.fromEntries(
      Object.entries(groups).map(([group, status]) => [group, { status, last_triggered_ts: 1_791_000_000 }]),
    ),
  },
})

/** Datadog as a stub, with its downtimes kept as they are written and cancelled; every call needs both keys. */
const fakeDatadog = (pages: ReadonlyArray<ReadonlyArray<unknown>>) => {
  const calls: Call[] = []
  const downtimes = new Map<string, unknown>()
  const answer = (call: Call) => {
    calls.push(call)
    if (call.headers?.["dd-api-key"] !== "api" || call.headers?.["dd-application-key"] !== "app")
      return reply({ errors: ["Forbidden"] }, 403)
    const url = new URL(call.url)
    if (url.pathname === "/api/v1/monitor") return reply(pages[Number(url.searchParams.get("page"))] ?? [])
    if (url.pathname === "/api/v2/downtime" && call.method === "POST") {
      const id = `dt-${downtimes.size + 1}`
      const { attributes } = JSON.parse(call.body ?? "{}").data
      downtimes.set(id, { id, attributes: { ...attributes, status: "active" } })
      return reply({ data: { id } })
    }
    if (url.pathname === "/api/v2/downtime") return reply({ data: [...downtimes.values()] })
    if (url.pathname.startsWith("/api/v2/downtime/") && call.method === "DELETE") {
      downtimes.delete(url.pathname.split("/").at(-1) ?? "")
      return reply("", 204)
    }
    return undefined
  }
  return { calls, answer, downtimes }
}

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(Effect.result(effect))

describe("Datadog's monitors", () => {
  test("give each group in Alert, Warn or No Data in the environment's tags as an alert, page by page", () => {
    const full = Array.from({ length: 1000 }, (_, index) => monitor(index + 10, `Quiet ${index}`, {}))
    const fake = fakeDatadog([
      full.map((each) => ({ ...each, overall_state: "OK" })),
      [
        monitor(1, "Checkout errors", {
          "env:production,service:checkout": "Alert",
          "env:production,service:search": "Warn",
          "env:staging,service:checkout": "Alert",
          "env:production,service:orders": "OK",
        }),
        { ...monitor(2, "Datadog agent silent", {}, ["env:production"]), overall_state: "No Data" },
      ],
    ])
    return run(datadogAlerts(datadog).pipe(Effect.provide(stubRemote(fake.answer)))).then((read) => {
      const alerts = Result.isSuccess(read) ? read.success : []
      expect(alerts.map((alert) => `${alert.name}:${alert.labels["service"] ?? "-"}:${alert.severity}`)).toEqual([
        "Checkout errors:checkout:critical",
        "Checkout errors:search:warning",
        "Datadog agent silent:-:warning",
      ])
      expect(alerts[0]).toMatchObject({
        state: "firing",
        summary: "Checkout is failing payments",
        startsAt: "2026-10-03T04:00:00.000Z",
      })
      expect(fake.calls.filter((call) => call.url.includes("/api/v1/monitor"))).toHaveLength(2)
    })
  })

  test("are silenced by a downtime written on the page, which says who and why, and alert again when it is cancelled", () => {
    const fake = fakeDatadog([[monitor(1, "Checkout errors", { "env:production,service:checkout": "Alert" })]])
    const read = datadogAlerts(datadog)
    const program = Effect.gen(function* () {
      const [alert] = yield* read
      if (alert === undefined) return yield* Effect.die("no alert")
      const id = yield* datadogSilence(datadog, alert, {
        startsAt: "2026-10-03T12:00:00Z",
        endsAt: "2026-10-03T13:00:00Z",
        by: "ada",
        reason: "a payment provider outage",
      })
      const silenced = yield* read
      yield* datadogUnsilence(datadog, id)
      return { id, silenced, again: yield* read }
    })
    return run(program.pipe(Effect.provide(stubRemote(fake.answer)))).then((result) => {
      const { id, silenced, again } = Result.isSuccess(result) ? result.success : { id: "", silenced: [], again: [] }
      expect(id).toBe("dt-1")
      const written = JSON.parse(fake.calls.find((call) => call.method === "POST")?.body ?? "{}")
      expect(written.data.attributes).toMatchObject({
        scope: "env:production AND service:checkout",
        monitor_identifier: { monitor_id: 1 },
        schedule: { start: "2026-10-03T12:00:00Z", end: "2026-10-03T13:00:00Z" },
      })
      expect(silenced[0]).toMatchObject({
        state: "silenced",
        silence: { id: "dt-1", by: "ada", reason: "a payment provider outage", endsAt: "2026-10-03T13:00:00Z" },
      })
      expect(again[0]?.state).toBe("firing")
    })
  })

  test("that refuse say so in Datadog's name, and a downtime from Datadog itself is its creator's", () => {
    const refusing = run(
      datadogAlerts({ ...datadog, appKey: Redacted.make("wrong") }).pipe(
        Effect.provide(stubRemote(fakeDatadog([]).answer)),
      ),
    )
    const theirs = fakeDatadog([[monitor(1, "Checkout errors", { "env:production,service:checkout": "Alert" })]])
    const answer = (call: Call) =>
      call.url.includes("/api/v2/downtime?")
        ? reply({
            data: [
              {
                id: "dt-9",
                attributes: {
                  message: "planned maintenance",
                  scope: "service:checkout",
                  monitor_identifier: { monitor_tags: [] },
                  schedule: { start: "2026-10-03T11:00:00Z", end: null },
                },
                relationships: { created_by: { data: { id: "u1" } } },
              },
            ],
            included: [{ id: "u1", type: "users", attributes: { name: "Grace" } }],
          })
        : theirs.answer(call)
    return Promise.all([refusing, run(datadogAlerts(datadog).pipe(Effect.provide(stubRemote(answer))))]).then(
      ([refused, read]) => {
        expect(Result.isFailure(refused) && refused.failure.message).toBe(
          'Datadog answered 403: {"errors":["Forbidden"]}',
        )
        expect(Result.isSuccess(read) && read.success[0]?.silence).toMatchObject({
          id: "dt-9",
          by: "Grace",
          reason: "planned maintenance",
        })
      },
    )
  })

  test("are read beside CloudWatch's alarms, and silenced through the environment's silencer", () => {
    const fake = fakeDatadog([[monitor(1, "Checkout errors", { "env:production,service:checkout": "Alert" })]])
    const alarm: SourcedAlert = {
      id: "alarm",
      name: "CpuHigh",
      state: "firing",
      severity: "warning",
      startsAt: "2026-10-03T12:00:00Z",
      labels: {},
    }
    const silencer = silencerOf({ datadog })
    const program = Effect.gen(function* () {
      const both = yield* alertsBeside(Effect.succeed([alarm]), datadog) ?? Effect.succeed([])
      const [, alert] = both
      if (alert === undefined || silencer === undefined) return yield* Effect.die("nothing to silence")
      const id = yield* silencer.silence(alert, { startsAt: "a", endsAt: "b", by: "ada", reason: "r" })
      yield* silencer.unsilence(id)
      return { names: both.map((each) => each.name), left: fake.downtimes.size }
    })
    return run(program.pipe(Effect.provide(stubRemote(fake.answer)))).then((result) => {
      expect(Result.isSuccess(result) && result.success).toEqual({ names: ["CpuHigh", "Checkout errors"], left: 0 })
      expect(alertsBeside(undefined, undefined)).toBeUndefined()
    })
  })

  test("an Alertmanager that cannot be reached says so in its own name, whether silencing or not", () => {
    const silencer = silencerOf({ alertmanager: { url: "http://alertmanager" } })
    const unreachable = Layer.succeed(Remote)({
      call: (call) => Effect.fail(new RemoteError({ url: call.url, message: "refused the connection" })),
    })
    const alert: SourcedAlert = { id: "a", name: "A", state: "firing", severity: "warning", startsAt: "", labels: {} }
    const asked = { startsAt: "a", endsAt: "b", by: "ada", reason: "r" }
    const why = <A>(effect: Effect.Effect<A, { readonly message: string }> | undefined) =>
      run(effect ?? Effect.die("no silencer")).then((result) => Result.isFailure(result) && result.failure.message)
    return Promise.all([
      why(silencer?.silence(alert, asked).pipe(Effect.provide(unreachable))),
      why(silencer?.unsilence("s1").pipe(Effect.provide(unreachable))),
      why(silencer?.silence(alert, asked).pipe(Effect.provide(stubRemote(() => reply("ok"))))),
    ]).then((messages) =>
      expect(messages).toEqual([
        "Alertmanager refused the connection",
        "Alertmanager refused the connection",
        "Alertmanager answered 200: ok",
      ]),
    )
  })

  test("make Datadog where alerts are read, and what silences them when there is no Alertmanager", () => {
    expect(alertsOf({ datadog })).toEqual(["datadog"])
    expect(silencerOf({ datadog })?.name).toBe("Datadog")
    expect(silencerOf({ datadog, alertmanager: { url: "http://alertmanager" } })?.name).toBe("Alertmanager")
    expect(silencerOf({})).toBeUndefined()
  })
})

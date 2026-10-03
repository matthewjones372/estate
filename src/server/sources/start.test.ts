import { describe, expect, test } from "bun:test"
import { Effect, Layer, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { estate, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, Remote, reply, stubRemote } from "../remote"
import { Estate, estateLayer } from "../state"
import { answering } from "./answers"
import { startSources } from "./start"

describe("the sources", () => {
  test("follows the catalog: an environment it gains is read, and one it loses is not", () => {
    const configured = {
      ...settings(),
      sources: {
        staging: { alertmanager: { url: "http://staging-alertmanager" } },
        production: {},
        qa: { alertmanager: { url: "http://qa-alertmanager" } },
      },
    }
    const calls: Call[] = []
    const asked = (host: string) => calls.filter((call) => call.url.startsWith(`http://${host}/`)).length
    const program = Effect.gen(function* () {
      const ref = yield* Estate
      yield* Effect.forkChild(startSources(configured))
      yield* TestClock.adjust("1 second")
      const before = asked("qa-alertmanager")
      yield* SubscriptionRef.update(ref, (state) => ({
        ...state,
        catalog: { ...state.catalog, environments: [...state.catalog.environments, { name: "qa", sources: "qa" }] },
      }))
      yield* TestClock.adjust("1 second")
      const gained = asked("qa-alertmanager")
      yield* SubscriptionRef.update(ref, (state) => ({
        ...state,
        catalog: {
          ...state.catalog,
          environments: state.catalog.environments.filter((each) => each.name !== "staging"),
        },
      }))
      yield* TestClock.adjust("1 second")
      const stagingThen = asked("staging-alertmanager")
      yield* TestClock.adjust("1 minute")
      return { before, gained, stagingThen, stagingLater: asked("staging-alertmanager") }
    })
    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(estateLayer(estate()), TestClock.layer(), stubRemote(answering({}, calls)), platform),
        ),
      ),
    ).then(({ before, gained, stagingThen, stagingLater }) => {
      expect(before).toBe(0)
      expect(gained).toBeGreaterThan(0)
      expect(stagingThen).toBeGreaterThan(0)
      expect(stagingLater).toBe(stagingThen)
    })
  })

  test("charts the alerts firing when Estate starts on its first read, not half a minute later", () => {
    const configured = {
      ...settings(),
      sources: {
        staging: { alertmanager: { url: "http://slow-alertmanager" }, prometheus: { url: "http://prometheus" } },
        production: {},
      },
    }
    // Alertmanager answers a moment after Prometheus, as a busy one does.
    const slow: Layer.Layer<Remote> = Layer.succeed(Remote)({
      call: (call) =>
        Effect.succeed(call).pipe(
          Effect.delay(call.url.startsWith("http://slow-alertmanager") ? "2 seconds" : "0 seconds"),
          Effect.map((asked) => {
            const url = asked.url.replace("http://slow-alertmanager", "http://alertmanager")
            if (url.includes("/api/v1/rules"))
              return reply({
                data: { groups: [{ rules: [{ type: "alerting", name: "OrdersSlow", query: "latency > 0.15" }] }] },
              })
            if (url.includes("/api/v1/query_range")) {
              const end = Number(new URL(url).searchParams.get("end"))
              return reply({ data: { result: [{ metric: {}, values: [[end, "0.2"]] }] } })
            }
            return answering()({ ...asked, url }) ?? reply("not found", 404)
          }),
        ),
    })
    const program = Effect.gen(function* () {
      yield* Effect.forkChild(startSources(configured))
      yield* TestClock.adjust("5 seconds")
      const staging = (yield* SubscriptionRef.get(yield* Estate)).environments["staging"]
      return staging?.metrics.value?.charts
    })
    return Effect.runPromise(
      program.pipe(Effect.provide(Layer.mergeAll(estateLayer(estate()), TestClock.layer(), slow, platform))),
    ).then((charts) => {
      expect(Object.values(charts ?? {}).map((chart) => chart.threshold)).toEqual([0.15])
    })
  })

  test("charts an alert as it starts firing, not at the next read of the metrics", () => {
    const configured = {
      ...settings(),
      sources: {
        staging: { alertmanager: { url: "http://alertmanager" }, prometheus: { url: "http://prometheus" } },
        production: {},
      },
    }
    let firing = false
    const answer = (call: Call) => {
      if (call.url.includes("/api/v1/rules"))
        return reply({
          data: { groups: [{ rules: [{ type: "alerting", name: "OrdersSlow", query: "latency > 0.15" }] }] },
        })
      if (call.url.includes("/api/v1/query_range")) {
        const end = Number(new URL(call.url).searchParams.get("end"))
        return reply({ data: { result: [{ metric: {}, values: [[end, "0.2"]] }] } })
      }
      if (call.url.includes("/api/v2/alerts") && !firing) return reply([])
      return answering()(call)
    }
    const program = Effect.gen(function* () {
      yield* Effect.forkChild(startSources(configured))
      yield* TestClock.adjust("10 seconds")
      firing = true
      yield* TestClock.adjust("15 seconds")
      return (yield* SubscriptionRef.get(yield* Estate)).environments["staging"]?.metrics.value?.charts
    })
    return Effect.runPromise(
      program.pipe(
        Effect.provide(Layer.mergeAll(estateLayer(estate()), TestClock.layer(), stubRemote(answer), platform)),
      ),
    ).then((charts) => {
      expect(Object.values(charts ?? {}).map((chart) => chart.threshold)).toEqual([0.15])
    })
  })
})

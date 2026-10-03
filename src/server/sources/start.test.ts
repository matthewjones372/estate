import { describe, expect, test } from "bun:test"
import { Effect, Layer, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { estate, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, stubRemote } from "../remote"
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
})

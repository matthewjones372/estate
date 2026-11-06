import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { estate } from "../fixture"
import { platform } from "../platform"
import { type Call, stubRemote } from "../remote"
import { estateLayer } from "../state"
import { cloudRunReader } from "./start-runtime"

describe("Cloud Run runtime reader", () => {
  test("reads cluster workloads, standalone jobs and deploys", () => {
    const calls: Call[] = []
    const gcpJson = (req: { url: string }) => {
      calls.push({ url: req.url, method: "GET", headers: {} })
      return Effect.succeed({ revisions: [], services: [] })
    }
    const section = {
      gcp: { project: "p", region: "europe-west2" },
      cloudRun: {},
      deploys: "cloud-run" as const,
    }
    const testService = {
      name: "api",
      environments: ["production"],
      runtime: { cloudRun: { service: "api" } },
    }
    const servicesIn = () => Effect.succeed([testService])
    const jobsHere = () => Effect.succeed([])

    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        cloudRunReader(section, section.gcp, gcpJson, "production", servicesIn, jobsHere),
      )
      yield* TestClock.adjust("5 seconds")
      yield* Fiber.interrupt(fiber)
    })

    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            estateLayer(estate()),
            stubRemote(() => undefined),
            platform,
            TestClock.layer(),
          ),
        ),
      ),
    ).then(() => {
      expect(calls.length).toBeGreaterThan(0)
    })
  })
})

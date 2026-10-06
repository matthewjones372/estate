import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import type { Catalog } from "../shared/catalog"
import { discoverFinding } from "./doctor-discover"
import { catalog } from "./fixture"
import { platform } from "./platform"
import { type Call, reply, stubRemote } from "./remote"

const written: Catalog = { ...catalog, discover: [{ kubernetes: { selector: "estate.dev/show=true" } }] }
const section = { kubernetes: { url: "https://production", token: Redacted.make("t") } }

const workload = (name: string, annotations: Record<string, string> = {}) => ({
  metadata: { name, namespace: "shop", labels: { "estate.dev/show": "true" }, annotations },
})

const asked = (answer: (call: Call) => ReturnType<typeof reply>, rules: Catalog = written, from = section) =>
  discoverFinding(from, rules, "production").pipe(Effect.provide(Layer.merge(stubRemote(answer), platform)))

describe("the doctor's discover line", () => {
  test("names the services found, those written over, and those left out with why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const found = yield* asked((call) =>
          new URL(call.url).pathname.endsWith("/deployments")
            ? reply({
                items: [
                  workload("basket"),
                  workload("storefront"),
                  workload("odd", { "estate.dev/repository": "nope" }),
                ],
              })
            : reply({ items: [] }),
        )
        expect(found).toEqual({
          part: "discover",
          ok: true,
          says: '2 services found, 1 written over (storefront), 1 left out (odd: "nope" is not github:owner/name)',
        })
      }),
    ))

  test("fails in the cluster's words, and says nothing without a rule or a cluster", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* asked(() => reply({ message: "forbidden" }, 403))).toMatchObject({ part: "discover", ok: false })
        expect(yield* asked(() => reply({ items: [] }), catalog)).toBeUndefined()
        expect(yield* asked(() => reply({ items: [] }), written, {} as typeof section)).toBeUndefined()
      }),
    ))
})

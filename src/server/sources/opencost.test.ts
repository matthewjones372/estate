import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { reply, stubRemote } from "../remote"
import { readOpenCost } from "./opencost"

const answering = (answer: Parameters<typeof reply>[0], status = 200) =>
  Effect.provide(stubRemote(() => reply(answer, status)))

describe("OpenCost", () => {
  test("gives a namespace's whole cost, or one workload's in a shared namespace", () =>
    Effect.runPromise(
      readOpenCost(
        "http://opencost",
        [
          { name: "batch", namespace: "batch" },
          { name: "web", namespace: "shop", workload: "web", cost: { budget: { amount: 50, per: "month" } } },
        ],
        "EUR",
      ).pipe(
        answering({
          data: [
            {
              a: { properties: { namespace: "batch", controller: "nightly" }, totalCost: 2 },
              b: { properties: { namespace: "batch", controller: "hourly" }, totalCost: 3 },
              c: { properties: { namespace: "shop", controller: "web" }, totalCost: 10 },
              d: { properties: { namespace: "shop", controller: "api" }, totalCost: 7 },
              e: { totalCost: 1 },
            },
          ],
        }),
      ),
    ).then((costs) =>
      expect(costs).toEqual({
        batch: { from: "OpenCost", currency: "EUR", monthToDate: 5, yesterday: 5 },
        web: {
          from: "OpenCost",
          currency: "EUR",
          monthToDate: 10,
          yesterday: 10,
          budget: { amount: 50, per: "month" },
        },
      }),
    ))

  test("is not asked when nothing runs there, and says why when it cannot answer", () =>
    Promise.all([
      Effect.runPromise(readOpenCost("http://opencost", [], "USD").pipe(answering({}, 500))),
      Effect.runPromise(
        Effect.flip(
          readOpenCost("http://opencost", [{ name: "x", namespace: "x" }], "USD").pipe(answering("down", 503)),
        ),
      ),
      Effect.runPromise(
        Effect.flip(
          readOpenCost("http://opencost", [{ name: "x", namespace: "x" }], "USD").pipe(answering({ data: "?" })),
        ),
      ),
    ]).then(([none, down, odd]) => {
      expect(none).toEqual({})
      expect(down.message).toBe("OpenCost answered 503: down")
      expect(odd.message).toBe("OpenCost answered in a shape Estate does not know")
    }))
})

import { expect, spyOn, test } from "bun:test"
import { deadline, phase, until } from "./wait"

test("a wait ends as soon as what it waits for is so", async () => {
  let asked = 0
  await until("three asks", async () => ++asked >= 3, { within: 1000, every: 1 })
  expect(asked).toBe(3)
})

test("a wait that runs out says what it waited for and what it saw last, instead of hanging", async () => {
  const failed = await until("Estate to be ready", async () => false, {
    within: 20,
    every: 5,
    saw: () => "waiting for production metrics",
  }).catch((error: unknown) => error)
  expect(failed).toBeInstanceOf(Error)
  expect(String(failed)).toBe(
    "Error: Estate to be ready did not happen within 0.02 s; last seen: waiting for production metrics",
  )
})

test("each phase says on stderr how far into the run it starts", () => {
  const written = spyOn(process.stderr, "write").mockImplementation(() => true)
  phase(performance.now() - 4200)("the page drawn")
  expect(written.mock.calls).toEqual([["bench: the page drawn (4 s)\n"]])
  written.mockRestore()
})

test("a step given a deadline gives its answer, or fails naming the step once the deadline passes", async () => {
  expect(await deadline("reading the heap", 1000, Promise.resolve(9.4))).toBe(9.4)
  const failed = await deadline("closing the browser", 20, new Promise(() => undefined)).catch(
    (error: unknown) => error,
  )
  expect(String(failed)).toBe("Error: closing the browser did not finish within 0.02 s")
})

import { expect, test } from "bun:test"
import { againIfClosed } from "./again"

const closed = new Error("waitForTimeout: Target page, context or browser has been closed")

test("a measure whose browser went away is taken again, and says so", async () => {
  const said: string[] = []
  let tries = 0
  const measured = await againIfClosed(
    async () => {
      tries += 1
      if (tries < 3) throw closed
      return tries
    },
    (line) => said.push(line),
  )
  expect(measured).toBe(3)
  expect(said).toHaveLength(2)
  expect(said[0]).toContain("has been closed")
})

test("a browser that keeps going away, or any other failure, fails the measure", async () => {
  const thrown = (measure: () => Promise<number>) => againIfClosed(measure, () => undefined).catch((error) => error)
  expect(await thrown(() => Promise.reject(closed))).toBe(closed)
  const other = new Error("waitForFunction: Timeout 120000ms exceeded.")
  let tries = 0
  expect(
    await thrown(() => {
      tries += 1
      return Promise.reject(other)
    }),
  ).toBe(other)
  expect(tries).toBe(1)
})

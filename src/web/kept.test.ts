import { afterEach, describe, expect, test } from "bun:test"
import { kept } from "./kept"

const was = Object.getOwnPropertyDescriptor(globalThis, "window")
afterEach(() => {
  if (was === undefined) Reflect.deleteProperty(globalThis, "window")
  else Object.defineProperty(globalThis, "window", was)
})

const withStorage = (localStorage: unknown) =>
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true })

describe("what a viewer chose", () => {
  test("is kept in this browser and read back", () => {
    const held = new Map<string, string>()
    withStorage({
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => held.set(key, value),
    })
    kept("choice").write("production")
    expect(kept("choice").read()).toBe("production")
  })

  test("is nothing, and no error, where the browser keeps nothing", () => {
    const refuse = () => {
      throw new Error("storage is blocked")
    }
    withStorage({ getItem: refuse, setItem: refuse })
    expect(kept("choice").read()).toBeNull()
    expect(() => kept("choice").write("production")).not.toThrow()
  })
})

import { describe, expect, test } from "bun:test"
import { type Movable, moveTo } from "./transition"

const pageWith = (transitions: boolean) => {
  const said: string[] = []
  let finish = () => undefined as void
  const focused = { now: "link" as unknown as Element }
  const page: Movable = {
    get activeElement() {
      return focused.now
    },
    getElementById: (id) => ({ focus: () => said.push(`focus ${id}`) }) as unknown as HTMLElement,
    ...(transitions
      ? {
          startViewTransition: (update: () => void) => {
            said.push("transition")
            update()
            return { finished: new Promise<void>((resolve) => (finish = resolve)) }
          },
        }
      : {}),
  }
  return { page, said, finish: () => finish(), focus: (on: string) => (focused.now = on as unknown as Element) }
}

describe("moving to another page", () => {
  test("cross-fades where the browser can, and moves focus to the new page once the fade is done", async () => {
    const { page, said, finish } = pageWith(true)
    moveTo(
      () => said.push("update"),
      page,
      () => false,
    )
    expect(said).toEqual(["transition", "update"])
    finish()
    await Bun.sleep(0)
    expect(said).toEqual(["transition", "update", "focus content"])
  })

  test("leaves focus where the person has put it while the fade ran, as on the jump field", async () => {
    const { page, said, finish, focus } = pageWith(true)
    moveTo(
      () => said.push("update"),
      page,
      () => false,
    )
    focus("jump field")
    finish()
    await Bun.sleep(0)
    expect(said).toEqual(["transition", "update"])
  })

  test("swaps at once, focus with it, where the browser cannot or the person asks for less motion", () => {
    for (const [transitions, still] of [
      [false, false],
      [true, true],
    ] as const) {
      const { page, said } = pageWith(transitions)
      moveTo(
        () => said.push("update"),
        page,
        () => still,
      )
      expect(said).toEqual(["update", "focus content"])
    }
  })

  test("reads the person's ask for less motion from the browser, unless told", () => {
    const { page, said } = pageWith(true)
    const was = globalThis.window
    globalThis.window = { matchMedia: () => ({ matches: true }) } as unknown as typeof window
    try {
      moveTo(() => said.push("update"), page)
    } finally {
      globalThis.window = was
    }
    expect(said).toEqual(["update", "focus content"])
  })
})

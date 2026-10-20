/** @jsxImportSource solid-js */
/** The page's store under a stream of events, in happy-dom: run by `store.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { useSnapshot } from "./context"
import { events, listening } from "./fixture"
import { mount } from "./harness"
import type { Live } from "./live"

const Probe = () => {
  const snapshot = useSnapshot()
  return (
    <p>
      {snapshot.connection} {snapshot.events.feed?.items.length ?? "no"} feed
    </p>
  )
}

describe("the page's store", () => {
  test("takes a beat, a lost stream and one new event without copying everything the server sent", () => {
    const { live, send, beat, lose } = listening()
    send("services", events.services)
    send("alerts", events.alerts)
    // Each time the store walks what the server sent, it asks the events for their names.
    let walked = 0
    const counted: Live = {
      ...live,
      snapshot: () => {
        const now = live.snapshot()
        return {
          ...now,
          events: new Proxy(now.events, {
            ownKeys: (target) => {
              walked += 1
              return Reflect.ownKeys(target)
            },
          }),
        }
      },
    }
    const page = mount(() => <Probe />, { live: counted })
    const first = walked
    lose()
    expect(page.container.textContent).toBe("lost no feed")
    beat()
    expect(page.container.textContent).toBe("open no feed")
    send("feed", events.feed)
    expect(page.container.textContent).toBe(`open ${events.feed.items.length} feed`)
    expect(walked).toBe(first)
    page.dispose()
  })
})

/** @jsxImportSource solid-js */
/** A message followed through a Kafka store's cluster, in happy-dom: run by `kafka-follow.test.ts`. */
import { describe, expect, jest, test } from "bun:test"
import type { Events } from "../shared/events"
import type { FollowedMessage } from "../shared/kafka-message"
import { events } from "./fixture"
import { caughtUp, followedMessage } from "./fixture-kafka"
import { mount } from "./harness"
import { StorePage } from "./pages/Store"
import { ClusterPanel } from "./parts/KafkaCluster"
import { recording } from "./recording"

const withBus: Events = {
  ...events,
  catalog: { ...events.catalog, stores: [{ name: "bus", engine: "kafka", links: [] }] },
}

const seen = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, " ").trim()

const followed = async (message = "4bf92f35") => {
  const page = mount(() => <StorePage name="bus" message={message} />, { sent: withBus })
  await page.settle()
  return page
}

describe("a message followed through a Kafka store", () => {
  test("is a dot in the partition it was written to, said in words to a screen reader", async () => {
    const page = await followed()
    expect(page.calls).toContainEqual(["storeMessage", "bus", "4bf92f35"])
    const carrying = [...page.container.querySelectorAll(".kafka-chip.carrying")]
    expect(carrying.map((chip) => seen(chip.querySelector("[aria-hidden]")))).toEqual(["orders 0"])
    expect(carrying[0]?.querySelector(".kafka-dot")).not.toBeNull()
    expect(seen(carrying[0])).toContain("holds the message followed, at offset 1,882,340")
    page.dispose()
  })

  test("is its path in words: who wrote it, where it was kept, and each group's read, not yet or past it", async () => {
    const page = await followed()
    const path = [...page.container.querySelectorAll(".kafka-path > li")].map(seen)
    expect(path).toEqual([
      expect.stringMatching(/^petshop wrote it \d\d:\d\d:02\.114, key cust-118$/),
      "to orders p0 at offset 1,882,340, broker 1 leading",
      expect.stringMatching(/^audit read it \d\d:\d\d:03\.002 by audit-sink, 888 ms after it was written$/),
      "orders-projector not yet: at 1,870,940 on p0, 11,400 messages before it, about 4 min at its rate",
    ])
    expect(seen(page.container.querySelector(".kafka-follow-said"))).toBe(
      "1 of 2 groups has read it; orders-projector is 11,400 messages short.",
    )
    const trace = [...page.container.querySelectorAll("a")].find((link) => link.textContent === "Open its trace")
    expect(trace?.getAttribute("href")).toBe("/traces/4bf92f35")
    page.dispose()
  })

  test("lights the groups on the diagram: one not yet in amber, saying how far before it", async () => {
    const page = await followed()
    const card = page.container.querySelector(".kafka-out .kafka-card")
    expect(card?.classList.contains("waiting")).toBe(true)
    expect(seen(card?.querySelector(".kafka-follow-state"))).toBe("not yet · 11,400 before it")
    expect(page.container.querySelector(".kafka-out .kafka-flow.behind")).not.toBeNull()
    page.dispose()
  })

  test("is followed by the trace ID typed, at its own address", async () => {
    const page = mount(() => <StorePage name="bus" />, { sent: withBus })
    await page.settle()
    expect(page.calls.some(([name]) => name === "storeMessage")).toBe(false)
    page.type(page.container.querySelector("input[name=trace]") as HTMLInputElement, " 4bf92f35 ")
    page.click(page.button("Follow"))
    expect(page.calls).toContainEqual(["navigate", "/stores/bus/messages/4bf92f35"])
    page.dispose()
  })

  test("is read again every 5 seconds until every group is past it, a group turning from not yet to past it", async () => {
    jest.useFakeTimers()
    try {
      const recorded = recording()
      const answers: Array<FollowedMessage> = [followedMessage, followedMessage, caughtUp]
      let asked = 0
      const actions = {
        ...recorded.actions,
        storeMessage: () => Promise.resolve(answers[Math.min(asked++, answers.length - 1)] as FollowedMessage),
      }
      const page = mount(() => <ClusterPanel store="bus" message="4bf92f35" />, { sent: withBus, actions })
      await Promise.resolve()
      jest.advanceTimersByTime(0)
      await Promise.resolve()
      const state = () => seen(page.container.querySelector(".kafka-out .kafka-follow-state"))
      expect([asked, state()]).toEqual([1, "not yet · 11,400 before it"])
      jest.advanceTimersByTime(5000)
      await Promise.resolve()
      expect(asked).toBe(2)
      jest.advanceTimersByTime(5000)
      await Promise.resolve()
      await Promise.resolve()
      expect([asked, state()]).toEqual([3, "past it"])
      expect(seen(page.container.querySelector(".kafka-follow-said"))).toBe(
        "Every group has read it or is past it: 1 read it, 1 past its offset with no span.",
      )
      jest.advanceTimersByTime(20_000)
      expect(asked).toBe(3)
      page.dispose()
    } finally {
      jest.useRealTimers()
    }
  })

  test("says why it cannot be followed", async () => {
    const page = await followed("gone")
    expect(page.container.textContent).toContain("bus has no Tempo to follow a message in")
    page.dispose()
  })
})

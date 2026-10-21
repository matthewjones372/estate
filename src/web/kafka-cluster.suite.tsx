/** @jsxImportSource solid-js */
/** A Kafka store's cluster on its page, in happy-dom: run by `kafka-cluster.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Events } from "../shared/events"
import { events, operator } from "./fixture"
import { kafkaCluster } from "./fixture-kafka"
import { mount } from "./harness"
import { behind, whatIsWrong } from "./kafka"
import { StorePage } from "./pages/Store"
import { ClusterPanel } from "./parts/KafkaCluster"

const withBus: Events = {
  ...events,
  catalog: {
    ...events.catalog,
    stores: [
      { name: "bus", engine: "kafka", links: [] },
      { name: "quiet", engine: "kafka", links: [] },
      { name: "cache", engine: "redis", links: [] },
    ],
  },
}

const opened = async (store = "bus") => {
  const page = mount(() => <StorePage name={store} />, { sent: withBus })
  await page.settle()
  return page
}

type Page = Awaited<ReturnType<typeof opened>>

const seen = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, " ").trim()

/** Each broker's heading and the partitions it leads, as each is seen, without what is said only to a reader. */
const brokers = (page: Page) =>
  [...page.container.querySelectorAll(".kafka-broker")].map((broker) => [
    seen(broker.querySelector("h4")),
    seen(broker.querySelector("p")),
    ...[...broker.querySelectorAll(".kafka-chip > [aria-hidden]")].map(seen),
  ])

const written = (page: Page) => [...page.container.querySelectorAll(".kafka-in strong")].map(seen)

describe("a Kafka store's cluster", () => {
  test("says what is wrong in a sentence, and that all is well when it is", () => {
    expect(whatIsWrong(kafkaCluster)).toBe(
      "Broker 3 has been gone 10 min; orders p2 has no leader; 2 partitions of orders are under-replicated.",
    )
    const well = {
      ...kafkaCluster,
      brokers: kafkaCluster.brokers.slice(0, 2),
      topics: kafkaCluster.topics.slice(1),
    }
    expect(whatIsWrong(well)).toBe("Every broker is up and every partition is in sync.")
    // Not known is not in sync: a cluster whose in-sync replicas could not be read says so.
    const unread = {
      ...well,
      topics: well.topics.map((topic) => ({
        ...topic,
        partitions: topic.partitions.map((partition) => ({ ...partition, inSync: null })),
      })),
    }
    expect(whatIsWrong(unread)).toBe("Every broker is up; replicas in sync are not known for 1 partition.")
  })

  test("draws each broker with the partitions it leads, a gone one marked, and those with no leader apart", async () => {
    const page = await opened()
    expect(page.calls).toContainEqual(["storeCluster", "bus"])
    const text = page.container.textContent ?? ""
    expect(text).toContain("3 brokers · 2 topics · 5 partitions")
    expect(text).toContain("Broker 3 has been gone 10 min")
    expect(brokers(page)).toEqual([
      ["Broker 1", "kafka-0:9092", "orders 0", "orders 3"],
      ["Broker 2", "kafka-1:9092", "orders 1 ↻", "payments 0"],
      ["Broker 3", "gone 10 min"],
      ["No leader", "offline", "orders 2 offline"],
    ])
    expect(page.container.querySelectorAll(".kafka-chip.critical:not([aria-hidden])")).toHaveLength(1)
    expect(page.container.querySelectorAll("button.kafka-chip.attention")).toHaveLength(2)
    // Each partition says what its marks mean to a screen reader.
    expect(text).toContain(
      "partition 1 of orders: 3 of 3 replicas in sync, not on its preferred leader, offsets 100 to 1,882,341",
    )
    page.dispose()
  })

  test("flows each topic in, and each group out, faster the more messages a second", async () => {
    const page = await opened()
    const flows = (side: string) =>
      [...page.container.querySelectorAll(`.kafka-${side} .kafka-flow`)].map((flow) => flow.getAttribute("class"))
    expect(flows("in")).toEqual(["kafka-flow step-4", "kafka-flow step-3"])
    expect(flows("out")).toEqual(["kafka-flow step-4 behind"])
    expect(written(page)).toEqual(["orders", "payments"])
    page.dispose()
  })

  test("hides internal topics until asked, and filters topics by name", async () => {
    const page = await opened()
    expect(written(page)).toEqual(["orders", "payments"])
    page.click(page.container.querySelector("input[type=checkbox]") as HTMLElement)
    expect(written(page)).toEqual(["orders", "payments", "__consumer_offsets"])
    page.type(page.container.querySelector("input[type=search]") as HTMLInputElement, "pay")
    expect(written(page)).toEqual(["payments"])
    expect(brokers(page)[0]).toEqual(["Broker 1", "kafka-0:9092"])
    page.dispose()
  })

  test("is read again while the page is open, and no more once it is left", async () => {
    const page = mount(() => <ClusterPanel store="bus" every={5} />, { sent: withBus })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const read = page.calls.filter(([name]) => name === "storeCluster").length
    expect(read).toBeGreaterThan(2)
    expect(page.container.querySelector(".kafka-diagram")).not.toBeNull()
    page.dispose()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(page.calls.filter(([name]) => name === "storeCluster").length).toBe(read)
  })

  test("says why it is not drawn, and is not there for a store that is not Kafka", async () => {
    const quiet = await opened("quiet")
    expect(quiet.container.textContent).toContain("The cluster")
    expect(quiet.container.textContent).toContain("kafka_exporter publishes nothing for quiet")
    quiet.dispose()
    const broken = await opened("cache")
    expect(broken.calls).not.toContainEqual(["storeCluster", "cache"])
    expect(broken.container.textContent).not.toContain("The cluster")
    broken.dispose()
  })
})

describe("a Kafka store's consumer groups", () => {
  test("call out a partition far behind the rest, and none when they are close", () => {
    const group = kafkaCluster.groups[0]
    expect(group && behind(group).map((each) => `${each.topic} p${each.partition}`)).toEqual(["orders p0"])
    expect(group && behind({ ...group, partitions: group.partitions.map((each) => ({ ...each, lag: 900 })) })).toEqual(
      [],
    )
  })

  test("each have a card with members, rate, lag and its growth, and a partition behind called out", async () => {
    const page = await opened()
    const card = seen(page.container.querySelector(".kafka-out .kafka-card"))
    expect(card).toBe("orders-projector 3 members · 230/s · lag 12,010 ▲ 40/s orders p0 is behind the rest")
    page.dispose()
  })

  test("mark each other: a group its partitions, a partition the groups reading it", async () => {
    const page = await opened()
    const marked = () => [...page.container.querySelectorAll(".kafka-chip.marked > [aria-hidden]")].map(seen)
    page.click(page.button(/^orders-projector/))
    expect(marked()).toEqual(["orders 0", "orders 1 ↻"])
    page.click(page.button(/^orders-projector/))
    expect(marked()).toEqual([])
    const p0 = [...page.container.querySelectorAll("button.kafka-chip")].find((chip) =>
      chip.textContent?.includes("partition 0 of orders"),
    ) as HTMLElement
    page.click(p0)
    expect(seen(page.container.querySelector(".kafka-out .kafka-card.marked strong"))).toBe("orders-projector")
    page.dispose()
  })
})

describe("Ask AI about a Kafka store's cluster", () => {
  test("asks about the cluster where Ask AI is set, and shows its cause, evidence, next steps and cost", async () => {
    const page = mount(() => <StorePage name="bus" />, { sent: withBus, me: { ...operator, ai: true } })
    await page.settle()
    page.click(page.button("Ask AI"))
    await page.settle()
    expect(page.calls).toContainEqual(["askStore", "bus"])
    const answer = seen(page.container.querySelector(".kafka-ask")) ?? ""
    expect(answer).toContain("Likely cause Broker 3 left the cluster")
    expect(answer).toContain("broker 3 not seen for 10 min")
    expect(answer).toContain("bring broker 3 back")
    expect(answer).toContain("fake-model · 300 in · 40 out")
    page.dispose()
  })

  test("is not offered where Ask AI is not set", async () => {
    const page = await opened()
    expect([...page.container.querySelectorAll("button")].some((each) => each.textContent === "Ask AI")).toBe(false)
    page.dispose()
  })
})

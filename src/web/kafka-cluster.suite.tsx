/** @jsxImportSource solid-js */
/** A Kafka store's cluster on its page, in happy-dom: run by `kafka-cluster.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Events } from "../shared/events"
import { events } from "./fixture"
import { kafkaCluster } from "./fixture-kafka"
import { mount } from "./harness"
import { whatIsWrong } from "./kafka"
import { StorePage } from "./pages/Store"

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

/** The partitions a cell shows, as each is seen, without what it says only to a screen reader. */
const cell = (page: Awaited<ReturnType<typeof opened>>, topic: string, column: number) =>
  [
    ...([...page.container.querySelectorAll("table.cluster tbody tr")]
      .find((row) => row.querySelector("th")?.textContent?.startsWith(topic))
      ?.querySelectorAll("td")
      [column]?.querySelectorAll(".partition > [aria-hidden]") ?? []),
  ]
    .map((chip) => chip.textContent?.replace(/\s+/g, " ").trim())
    .join(" ")

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
  })

  test("draws its brokers as columns, a gone one marked, each partition in its leader's", async () => {
    const page = await opened()
    expect(page.calls).toContainEqual(["storeCluster", "bus"])
    const text = page.container.textContent ?? ""
    expect(text).toContain("3 brokers · 2 topics · 5 partitions")
    expect(text).toContain("Broker 3 has been gone 10 min")
    const heads = [...page.container.querySelectorAll("table.cluster thead th")].map((head) =>
      head.textContent?.replace(/\s+/g, " ").trim(),
    )
    expect(heads).toEqual([
      "Topic",
      "broker 1 kafka-0:9092 leads 2",
      "broker 2 kafka-1:9092 leads 2",
      "broker 3 kafka-2:9092 gone 10 min",
      "No leader",
    ])
    expect(cell(page, "orders", 0)).toBe("p0 2/3 p3 2/3")
    expect(cell(page, "orders", 1)).toBe("p1 3/3 ↻")
    expect(cell(page, "orders", 3)).toBe("p2 2/3")
    expect(page.container.querySelector("table.cluster .partition.critical")?.textContent).toContain("p2")
    expect(page.container.querySelectorAll("table.cluster .partition.attention")).toHaveLength(2)
    // Each partition says what its marks mean to a screen reader.
    expect(text).toContain(
      "partition 1 of orders: 3 of 3 replicas in sync, not on its preferred leader, offsets 100 to 1,882,341",
    )
    page.dispose()
  })

  test("hides internal topics until asked, and filters topics by name", async () => {
    const page = await opened()
    const topics = () =>
      [...page.container.querySelectorAll("table.cluster tbody th")].map((head) => head.textContent?.split(" ")[0])
    expect(topics()).toEqual(["orders", "payments"])
    page.click(page.container.querySelector("input[type=checkbox]") as HTMLElement)
    expect(topics()).toEqual(["orders", "payments", "__consumer_offsets"])
    page.type(page.container.querySelector("input[type=search]") as HTMLInputElement, "pay")
    expect(topics()).toEqual(["payments"])
    page.dispose()
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

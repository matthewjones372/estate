import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { followedFrom, writtenOf } from "./kafka-message"
import { messageNames } from "./messaging"
import type { TraceSpan } from "./traces"

const names = messageNames(undefined)
const span = (id: string, more: Partial<TraceSpan>): TraceSpan => ({
  id,
  service: "petshop",
  name: id,
  kind: "internal",
  start: 1000,
  end: 1002,
  failed: false,
  ...more,
})
const sent = span("publish", {
  kind: "producer",
  messaging: { topic: "events", partition: 1, offset: 40, id: "7" },
})
const written = { service: "petshop", topic: "events", partition: 1, offset: 40, id: "7", at: 1002 }
const offset = (group: string, partition: number, value: number) => ({
  labels: { consumergroup: group, topic: "events", partition: String(partition) },
  value,
})

describe("a followed message", () => {
  test("is written where its producer span says, and one without an offset names the attribute", () => {
    expect(writtenOf([{ trace: "t", span: sent }], names, { trace: "t" })).toEqual(
      Result.succeed({ trace: "t", span: sent, written }),
    )
    const bare = span("publish", { kind: "producer", messaging: { topic: "events" } })
    expect(writtenOf([{ trace: "t", span: bare }], names, { trace: "t" })).toEqual(
      Result.fail(
        "petshop's producer span publish has no messaging.destination.partition.id or messaging.kafka.offset",
      ),
    )
    expect(writtenOf([{ trace: "t", span: sent }], names, { id: "8" })).toEqual(
      Result.fail('no producer span carries messaging.message.id = "8"'),
    )
  })

  test("is read by a consumer on a linked trace, and a consumer naming no group is said to lack it", () => {
    const linked = span("process", {
      service: "mailer",
      kind: "consumer",
      start: 1500,
      messaging: { topic: "events", id: "7", group: "mail" },
    })
    const elsewhere = span("process", { kind: "consumer", messaging: { topic: "events", id: "8", group: "audit" } })
    const nameless = span("handle", { kind: "consumer", messaging: { topic: "events" } })
    const followed = followedFrom(
      "t",
      written,
      [
        { trace: "u", span: linked },
        { trace: "v", span: elsewhere },
        { trace: "t", span: nameless },
      ],
      { offsets: [offset("mail", 1, 41), offset("audit", 0, 99)], rates: [] },
      names,
      2000,
    )
    expect(followed.groups).toEqual([
      { name: "audit", state: "unknown" },
      { name: "mail", state: "read", service: "mailer", at: 1500, after: 498 },
    ])
    expect([followed.done, followed.missing]).toEqual([false, ["messaging.consumer.group.name"]])
  })

  test("is not yet read by a group with no rate, with no time to wait given", () => {
    const followed = followedFrom("t", written, [], { offsets: [offset("slow", 1, 30)], rates: [] }, names, 2000)
    expect(followed.groups).toEqual([{ name: "slow", state: "not yet", offset: 30, before: 10, seconds: null }])
  })
})

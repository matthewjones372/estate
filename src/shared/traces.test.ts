import { describe, expect, test } from "bun:test"
import type { Journey } from "./catalog-journey"
import { placeOf, traceView } from "./trace-view"
import { type Lanes, measure, percentile, sampleOf, type Trace, type TraceSpan } from "./traces"

const at = Date.parse("2026-10-14T12:03:41Z")

const span = (
  id: string,
  service: string,
  name: string,
  from: number,
  to: number,
  more: Partial<TraceSpan> = {},
): TraceSpan => ({ id, service, name, kind: "internal", start: at + from, end: at + to, failed: false, ...more })

/** An adoption that waits most of a second in the outbox, as petshop's relay polls it. */
const adoption = (id: string, wait = 965, more: Partial<TraceSpan> = {}): Trace => ({
  id,
  spans: [
    span("a", "shop-web", "adopt pet", 0, 49, { kind: "client" }),
    span("a2", "shop-web", "POST /adoptions", 1, 49, { kind: "client", parent: "a" }),
    span("b", "shop", "POST /adoptions", 9, 48, { kind: "server", parent: "a" }),
    span("c", "shop", "adopt", 10, 47, { parent: "b", ...more }),
    span("d", "shop", "GET /chips/{id}", 12, 43, { kind: "client", parent: "c" }),
    span("e", "shop", "INSERT outbox", 44, 47, { parent: "c" }),
    span("f", "shop", "publish", 47 + wait, 53 + wait, { kind: "producer", parent: "c" }),
    span("g", "shop", "process", 71 + wait, 72 + wait, { kind: "consumer", parent: "f" }),
    span("h", "shop-web", "live event", 94 + wait, 96 + wait, { kind: "consumer", parent: "g" }),
  ],
})

const journey: Journey = {
  name: "adoption",
  title: "Adoption, click to screen",
  environments: ["production"],
  start: { service: "shop-web", span: "adopt pet" },
  stages: [
    {
      title: "Reaches the shop",
      where: "web",
      from: { start: "adopt pet" },
      to: { start: "POST /adoptions", service: "shop" },
    },
    { title: "Decides", where: "shop", span: "adopt" },
    { title: "Checks the chip", where: "registry", span: "GET /chips/{id}" },
    { title: "Written to the outbox", where: "shop-db", span: "INSERT outbox" },
    { title: "Waits in the outbox", where: "shop-db", from: { end: "INSERT outbox" }, to: { start: "publish" } },
    { title: "Published", where: "bus", span: "publish" },
    { title: "Reaches the page", where: "web", from: { end: "process" }, to: { start: "live event" } },
  ],
}

const lanes: Lanes = {
  where: (where) => ({ id: where, title: where === "web" ? "Browser" : where }),
  service: (service) => (service === "shop-web" ? { id: "web", title: "Browser" } : { id: service, title: service }),
}

describe("a journey in a trace", () => {
  test("measures each stage from the start of its first span, and the answer at that span's end", () => {
    const measured = measure(journey, adoption("t1"))
    expect(measured?.answered).toBe(49)
    expect(measured?.total).toBe(1059)
    expect(measured?.stages.map((took) => (took === undefined ? undefined : took.to - took.from))).toEqual([
      9, 37, 31, 3, 965, 6, 22,
    ])
    expect(measured?.startedAt).toBe("2026-10-14T12:03:41.000Z")
  })

  test("leaves out a stage the trace does not hold, and is no journey without its first span", () => {
    const refused: Trace = {
      id: "t2",
      spans: adoption("t2").spans.filter((each) => ["a", "b", "c", "d"].includes(each.id)),
    }
    expect(measure(journey, refused)?.stages.map((took) => took !== undefined)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ])
    expect(measure(journey, { id: "t3", spans: [span("x", "shop", "adopt", 0, 1)] })).toBeUndefined()
  })
})

describe("a journey over many traces", () => {
  test("is each stage's p50 and p99, how often it was found, and the slowest, failed, typical and fastest", () => {
    const traces = [
      adoption("slow", 990),
      adoption("mid", 500),
      adoption("fast", 10),
      adoption("broke", 400, { failed: true }),
      { id: "other", spans: [span("z", "shop", "arrival", 0, 3)] },
    ]
    const sample = sampleOf(journey, lanes, traces, 15)
    expect(sample.sampled).toBe(4)
    expect(sample.stages[4]).toEqual({
      title: "Waits in the outbox",
      where: { id: "shop-db", title: "shop-db" },
      text: "INSERT outbox ··· publish",
      kind: "gap",
      found: 4,
      p50: 400,
      p99: 990,
    })
    expect(sample.answered).toEqual({ p50: 49, p99: 49 })
    expect(sample.examples.map((example) => [example.why, example.id])).toEqual([
      ["slowest", "slow"],
      ["failed", "broke"],
      ["typical", "mid"],
      ["fastest", "fast"],
    ])
  })

  test("takes percentiles by nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
    expect(percentile([5, 1, 3, 2, 4], 0.99)).toBe(5)
    expect(percentile([], 0.5)).toBeUndefined()
  })
})

describe("a trace's view", () => {
  test("puts each span in its stage's lane or its service's, gaps in theirs, in time order", () => {
    const view = traceView(adoption("t1"), lanes, journey)
    expect(view.lanes.map((lane) => lane.title)).toEqual(["Browser", "shop", "registry", "shop-db", "bus"])
    expect(view.rows.map((row) => [row.title, view.lanes[row.lane]?.id, row.kind])).toEqual([
      ["adopt pet", "web", "call"],
      ["Reaches the shop", "web", "wait"],
      ["POST /adoptions", "web", "work"],
      ["POST /adoptions", "shop", "call"],
      ["Decides", "shop", "call"],
      ["Checks the chip", "registry", "work"],
      ["Written to the outbox", "shop-db", "work"],
      ["Waits in the outbox", "shop-db", "wait"],
      ["Published", "bus", "call"],
      ["process", "shop", "call"],
      ["Reaches the page", "web", "wait"],
      ["live event", "web", "work"],
    ])
    expect(view.journey).toEqual({ name: "adoption", title: "Adoption, click to screen" })
    expect(view.answered).toBe(49)
  })

  test("marks where the trace moves to another lane, and cuts a wait longer than half of it", () => {
    const view = traceView(adoption("t1"), lanes, journey)
    const handed = view.rows.flatMap((row) =>
      row.handedFrom === undefined ? [] : [`${view.lanes[row.handedFrom]?.id} → ${view.lanes[row.lane]?.id}`],
    )
    expect(handed).toEqual([
      "web → shop",
      "shop → registry",
      "shop → shop-db",
      "shop → bus",
      "bus → shop",
      "shop → web",
    ])
    expect(view.cut).toEqual({ from: 47, to: 1012 })
  })

  test("draws a trace that is no journey's by its services, from its earliest span", () => {
    const view = traceView({ id: "t9", spans: [span("x", "shop", "arrival", 5, 8)] }, lanes)
    expect(view).toMatchObject({ total: 3, lanes: [{ id: "shop" }], rows: [{ from: 0, to: 3, kind: "work" }] })
    expect(view.journey).toBeUndefined()
  })
})

describe("a trace's scale", () => {
  test("is in proportion, or gives the cut a tenth of the width and the rest the other nine", () => {
    const even = placeOf(1000)
    expect([even(0), even(500), even(1000)]).toEqual([0, 50, 100])
    const cut = placeOf(1100, { from: 50, to: 1050 })
    expect([cut(0), cut(50), cut(550), cut(1050), cut(1100)]).toEqual([0, 45, 50, 55, 100])
  })
})

import { afterAll, describe, expect, test } from "bun:test"
import { Result } from "effect"
import { checkCatalog } from "../shared/check"

/** The demo's world, run as `bun examples/demo/run.ts` runs it, on a port of its own. */
const port = 18_484
const world = Bun.spawn(["bun", "examples/demo/world.ts"], {
  env: { ...process.env, WORLD_PORT: String(port) },
  stdout: "ignore",
  stderr: "ignore",
})
afterAll(() => world.kill())

/** The world's answer, once it is listening. */
const asked = (path: string, init?: RequestInit, tries = 100): Promise<unknown> =>
  fetch(`http://127.0.0.1:${port}${path}`, init).then(
    (answer) => answer.json(),
    () =>
      tries > 0
        ? Bun.sleep(50).then(() => asked(path, init, tries - 1))
        : Promise.reject(new Error(`the demo's world did not answer ${path}`)),
  )

type Vector = { data: { result: ReadonlyArray<{ metric: Record<string, string>; value: [number, string] }> } }
const instant = (environment: string, query: string) =>
  asked(`/${environment}/api/v1/query?${new URLSearchParams({ query })}`) as Promise<Vector>

type Trace = {
  batches: ReadonlyArray<{
    scopeSpans: ReadonlyArray<{ spans: ReadonlyArray<{ name: string; attributes: ReadonlyArray<{ key: string }> }> }>
  }>
}

const clustersIn = (environment: string) =>
  instant(environment, 'count by (namespace,strimzi_io_cluster) (kafka_brokers{job="kafka-exporter"})').then((vector) =>
    vector.data.result.map((each) => each.metric["strimzi_io_cluster"]),
  )

const alertsIn = (environment: string) =>
  asked(`/${environment}/api/v2/alerts`).then((alerts) =>
    (alerts as ReadonlyArray<{ labels: { alertname: string } }>).map((alert) => alert.labels.alertname),
  )

describe("the demo", () => {
  test("is a catalog with no mistake", () =>
    Bun.file("examples/demo/catalog.yaml")
      .text()
      .then((text) => expect(Result.isSuccess(checkCatalog(Bun.YAML.parse(text)))).toBe(true)))

  test("has two Kafka clusters in production, bus with broker 4 gone, and one cluster in staging", () =>
    Promise.all([
      clustersIn("production"),
      clustersIn("staging"),
      instant(
        "production",
        'max_over_time(timestamp(kafka_broker_info{job="kafka-exporter",namespace="data",strimzi_io_cluster="bus"})[1h:1m])',
      ),
    ]).then(([production, staging, seen]) => {
      expect([production, staging]).toEqual([["bus", "clickstream"], ["bus"]])
      const ago = seen.data.result.map((each) => Math.round((Date.now() / 1000 - Number(each.value[1])) / 60))
      expect(ago).toEqual([0, 0, 0, 0, 9, 0])
    }))

  test("fires its alerts in production and none in staging", () =>
    Promise.all([alertsIn("production"), alertsIn("staging")]).then(([production, staging]) =>
      expect([production, staging]).toEqual([["KafkaBrokerDown", "ConsumerLagGrowing", "CheckoutSlow"], []]),
    ))

  test("traces each order to the partition and offset it was written at", () => {
    const now = Math.floor(Date.now() / 1000)
    return asked(`/production/api/search?q=x&start=${now - 60}&end=${now}&limit=1`)
      .then((found) =>
        asked(`/production/api/traces/${(found as { traces: [{ traceID: string }] }).traces[0].traceID}`),
      )
      .then((trace) => {
        const spans = (trace as Trace).batches.flatMap((batch) => batch.scopeSpans.flatMap((scope) => scope.spans))
        const publish = spans.find((span) => span.name === "publish")
        expect(publish?.attributes.map((attribute) => attribute.key)).toContain("messaging.kafka.offset")
      })
  })

  test("answers Ask AI with a canned answer that says so", () =>
    asked("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "CheckoutSlow is firing" }] }),
    }).then((answer) => {
      const content = (answer as { choices: [{ message: { content: string } }] }).choices[0].message.content
      expect(JSON.parse(content).likelyCause).toStartWith("Demo answer, canned: no model was asked.")
    }))
})

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers"
import { platform } from "../src/server/platform"
import { liveRemote } from "../src/server/remote"
import type { Sources } from "../src/server/settings"
import { groupErrors } from "../src/server/sources/lines"
import { logsFor } from "../src/server/sources/logs"
import type { Service } from "../src/shared/catalog"
import { eventually, urlOf } from "./real"

let loki: StartedTestContainer
let elasticsearch: StartedTestContainer

beforeAll(async () => {
  loki = await new GenericContainer("grafana/loki:3.5.0")
    .withExposedPorts(3100)
    .withWaitStrategy(Wait.forHttp("/ready", 3100).forStatusCode(200))
    .start()
  elasticsearch = await new GenericContainer("docker.elastic.co/elasticsearch/elasticsearch:8.15.3")
    .withEnvironment({
      "discovery.type": "single-node",
      "xpack.security.enabled": "false",
      // A full disk on the machine running the suite would otherwise stop the index taking its shard.
      "cluster.routing.allocation.disk.threshold_enabled": "false",
      ES_JAVA_OPTS: "-Xms512m -Xmx512m",
    })
    .withExposedPorts(9200)
    .withWaitStrategy(Wait.forHttp("/_cluster/health?wait_for_status=yellow", 9200).forStatusCode(200))
    .withStartupTimeout(240_000)
    .start()
}, 300_000)

afterAll(async () => {
  await loki?.stop()
  await elasticsearch?.stop()
})

const checkout: Service = {
  name: "checkout",
  environments: [],
  kubernetes: { namespace: "shop", workloads: [] },
  logs: { mask: ["\\d{16}"] },
}

const said = [
  "INFO payment taken",
  "ERROR card 4111111111111111 declined by the provider",
  "ERROR card 5500000000000004 declined by the provider",
  "WARN slow answer from the provider",
]

/** The service's lines in the last ten minutes, as the page asks for them, once there are as many as were said. */
const read = (sources: Sources) =>
  eventually(
    () => {
      const logs = logsFor(sources, checkout)
      if (logs === undefined) throw new Error("no logs for checkout")
      return Effect.runPromise(
        logs.read(Date.now() - 600_000, Date.now() + 1000, 100).pipe(Effect.provide(Layer.merge(liveRemote, platform))),
      )
    },
    (lines) => lines.length >= said.length,
    60,
  )

describe("real logs", () => {
  test("from Loki: a service's lines oldest first, masked, and its errors grouped by message", async () => {
    const start = Date.now() - 5000
    await fetch(`${urlOf(loki, 3100)}/loki/api/v1/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        streams: [
          {
            stream: { namespace: "shop", app: "checkout", pod: "checkout-1" },
            values: said.map((line, index) => [`${start + index * 1000}000000`, line]),
          },
          { stream: { namespace: "shop", app: "search" }, values: [[`${start}000000`, "ERROR not checkout's"]] },
        ],
      }),
    })
    const lines = await read({ loki: { url: urlOf(loki, 3100) } })
    expect(lines.map((line) => line.text)).toEqual([
      "INFO payment taken",
      "ERROR card ••• declined by the provider",
      "ERROR card ••• declined by the provider",
      "WARN slow answer from the provider",
    ])
    expect(lines[0]?.pod).toBe("checkout-1")
    const logs = logsFor({ loki: { url: urlOf(loki, 3100) } }, checkout)
    const groups = groupErrors(lines, logs?.isError ?? (() => false))
    expect(groups.map((group) => [group.count, group.shape, group.pods])).toEqual([
      [2, "ERROR card ••• declined by the provider", ["checkout-1"]],
    ])
  })

  test("from Elasticsearch: a service's documents matched by its namespace and app, oldest first, masked", async () => {
    const base = urlOf(elasticsearch, 9200)
    const start = Date.now() - 5000
    const documents = [
      ...said.map((message, index) => ({
        "@timestamp": new Date(start + index * 1000).toISOString(),
        message,
        kubernetes: { namespace: "shop", labels: { app: "checkout" }, pod: { name: "checkout-1" } },
      })),
      {
        "@timestamp": new Date(start).toISOString(),
        message: "not checkout's",
        kubernetes: { labels: { app: "search" } },
      },
    ]
    const bulk = documents.flatMap((document) => [JSON.stringify({ index: {} }), JSON.stringify(document)]).join("\n")
    const indexed = await fetch(`${base}/logs-shop/_bulk?refresh=true`, {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body: `${bulk}\n`,
    })
    expect(indexed.ok).toBe(true)
    const lines = await read({ elasticsearch: { url: base, index: "logs-*" } })
    expect(lines.map((line) => line.text)).toEqual([
      "INFO payment taken",
      "ERROR card ••• declined by the provider",
      "ERROR card ••• declined by the provider",
      "WARN slow answer from the provider",
    ])
  })
})

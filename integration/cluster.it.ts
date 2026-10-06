/**
 * Two Estate processes as runners of one cluster, against Postgres in a container and a Prometheus stub that counts
 * its calls: the two read as often as one, and when the reader is killed the other reads within a minute while its
 * pages stay ready.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Subprocess } from "bun"
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers"
import { eventually } from "./real"

let postgres: StartedTestContainer
let calls = 0
const prometheus = Bun.serve({
  port: 0,
  fetch: (request) => {
    calls += 1
    const range = new URL(request.url).pathname.endsWith("query_range")
    return Response.json({ status: "success", data: { resultType: range ? "matrix" : "vector", result: [] } })
  },
})

const runners: Record<string, { port: number; process?: Subprocess }> = {
  a: { port: 18081 },
  b: { port: 18082 },
}

/** Four environments, so the estate's five entities have room to spread between two runners. */
const places = ["north", "south", "east", "west"]
const catalogPath = "/tmp/estate-cluster-catalog.yaml"
const catalog = `environments:
${places.map((place) => `  - { name: ${place}, sources: ${place} }`).join("\n")}
services:
  - { name: shop, environments: [ ${places.join(", ")} ], load: { requests: 'sum(rate(http_requests_total{app="shop"}[1m]))' } }
`

const settingsOf = (name: string, port: number, database: string) => `
port: ${port}
metrics: { port: ${port + 1000} }
catalog: ${catalogPath}
auth:
  sessionSecret: a-session-secret-for-the-cluster-test-only
  roles: { viewer: [ developers ], operator: [ ops ] }
  anonymous: { name: ${name}, role: operator }
database: { postgres: ${database} }
cluster: { port: ${port + 16000} }
sources:
${places.map((place) => `  ${place}: { prometheus: { url: http://127.0.0.1:${prometheus.port} }, every: { metrics: 5s } }`).join("\n")}
`

const start = async (name: string, database: string) => {
  const runner = runners[name]
  if (runner === undefined) throw new Error(`no runner ${name}`)
  const path = `/tmp/estate-cluster-${name}.yaml`
  await Bun.write(catalogPath, catalog)
  await Bun.write(path, settingsOf(name, runner.port, database))
  runner.process = Bun.spawn(["bun", "src/server/main.ts"], {
    env: { ...process.env, ESTATE_SETTINGS: path, POD_IP: "127.0.0.1" },
    stdout: "ignore",
    stderr: "ignore",
  })
}

const readiness = (name: string) =>
  fetch(`http://127.0.0.1:${runners[name]?.port}/readyz`).then(async (response) => ({
    status: response.status,
    text: await response.text(),
  }))

/** The stub's calls over a window of the runners' reading. */
const callsOver = async (seconds: number) => {
  const from = calls
  await Bun.sleep(seconds * 1000)
  return calls - from
}

beforeAll(async () => {
  postgres = await new GenericContainer("public.ecr.aws/docker/library/postgres:17-alpine")
    .withEnvironment({ POSTGRES_PASSWORD: "estate", POSTGRES_DB: "estate" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
}, 300_000)

afterAll(async () => {
  for (const runner of Object.values(runners)) runner.process?.kill()
  prometheus.stop(true)
  await postgres?.stop()
})

const reads = (text: string) => /^ready, reading /.test(text)
const everything = `ready, reading estate, ${[...places].sort().join(", ")}`

describe("a cluster of two runners", () => {
  test("spreads the reading between them, reads each source as often as one runner, and keeps reading when one dies", async () => {
    const database = `postgres://postgres:estate@${postgres.getHost()}:${postgres.getMappedPort(5432)}/estate`
    await start("a", database)
    await eventually(
      () => readiness("a"),
      (ready) => ready.text === everything,
    )
    const alone = await callsOver(20)
    await start("b", database)
    // Settled once both are ready and each reads some of the estate: the entities' shards spread between them.
    const settled = await eventually(
      () => Promise.all([readiness("a"), readiness("b")]),
      (both) => both.every((each) => each.status === 200 && reads(each.text)),
      120,
    )
    const together = await callsOver(20)
    expect(together).toBeGreaterThan(0)
    expect(together).toBeLessThanOrEqual(alone * 1.5)

    const [gone, kept] = settled[0]?.text.includes("estate") === true ? ["a", "b"] : ["b", "a"]
    runners[gone]?.process?.kill(9)
    const killed = Date.now()
    const watched: Array<number> = []
    await eventually(
      async () => {
        const now = await readiness(kept)
        watched.push(now.status)
        return now
      },
      (now) => now.text === everything,
      60,
    )
    expect(Date.now() - killed).toBeLessThan(60_000)
    expect(watched.every((status) => status === 200)).toBe(true)
  }, 400_000)
})

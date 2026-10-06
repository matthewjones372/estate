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

const settingsOf = (name: string, port: number, database: string) => `
port: ${port}
metrics: { port: ${port + 1000} }
catalog: ${process.cwd()}/examples/catalog.yaml
auth:
  sessionSecret: a-session-secret-for-the-cluster-test-only
  roles: { viewer: [ developers ], operator: [ ops ] }
  anonymous: { name: ${name}, role: operator }
notes: { postgres: ${database} }
cluster: { port: ${port + 16000} }
sources:
  staging: { prometheus: { url: http://127.0.0.1:${prometheus.port} }, every: { metrics: 5s } }
  production: { prometheus: { url: http://127.0.0.1:${prometheus.port} }, every: { metrics: 5s } }
`

const start = async (name: string, database: string) => {
  const runner = runners[name]
  if (runner === undefined) throw new Error(`no runner ${name}`)
  const path = `/tmp/estate-cluster-${name}.yaml`
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

describe("a cluster of two runners", () => {
  test("reads each source as often as one runner, and keeps reading when the reader is killed", async () => {
    const database = `postgres://postgres:estate@${postgres.getHost()}:${postgres.getMappedPort(5432)}/estate`
    await start("a", database)
    await eventually(
      () => readiness("a"),
      (ready) => ready.text === "ready, reading",
    )
    const alone = await callsOver(20)
    await start("b", database)
    // Settled once one runner reads and the other follows it, wherever the entity's shard has gone.
    const settled = await eventually(
      () => Promise.all([readiness("a"), readiness("b")]),
      (both) =>
        both.every((each) => each.status === 200) &&
        both.filter((each) => each.text === "ready, reading").length === 1 &&
        both.some((each) => each.text.startsWith("ready, following")),
    )
    const together = await callsOver(20)
    expect(together).toBeGreaterThan(0)
    expect(together).toBeLessThanOrEqual(alone * 1.5)

    const [reader, follower] = settled[0]?.text === "ready, reading" ? ["a", "b"] : ["b", "a"]
    runners[reader]?.process?.kill(9)
    const killed = Date.now()
    const watched: Array<number> = []
    await eventually(
      async () => {
        const now = await readiness(follower)
        watched.push(now.status)
        return now
      },
      (now) => now.text === "ready, reading",
      60,
    )
    expect(Date.now() - killed).toBeLessThan(60_000)
    expect(watched.every((status) => status === 200)).toBe(true)
  }, 300_000)
})

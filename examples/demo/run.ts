/**
 * `bun examples/demo/run.ts`: the demo world and Estate together. Once Estate has read every source it writes the
 * incident and its comments through Estate's own API, as the people on call would have, and says where to look.
 */
import { alertId } from "../../src/server/sources/alerts"
import { firingIn } from "./story"
import { latestOrder, traceIdOf, writtenOf } from "./traces"
import { events, nextOf } from "./traffic"

const estate = "http://127.0.0.1:8080"
const here = new URL(".", import.meta.url).pathname

const started = [
  Bun.spawn(["bun", `${here}world.ts`], { stdout: "ignore", stderr: "inherit" }),
  Bun.spawn(["bun", `${here}../../src/server/main.ts`], {
    env: { ...process.env, ESTATE_SETTINGS: `${here}estate.yaml` },
    cwd: `${here}../..`,
    stdout: "ignore",
    stderr: "inherit",
  }),
]
const stop = () => {
  for (const child of started) child.kill()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)

const say = (line = "") => process.stdout.write(`${line}\n`)

/** Estate is ready once it has read every source once. */
const ready = async () => {
  for (let tries = 0; tries < 120; tries += 1) {
    const answer = await fetch(`${estate}/readyz`).catch(() => undefined)
    if (answer?.ok) return true
    await Bun.sleep(500)
  }
  return false
}

const send = async (path: string, body: unknown) => {
  const answer = await fetch(`${estate}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!answer.ok) say(`  could not write ${path}: ${answer.status} ${await answer.text()}`)
  return answer.ok ? ((await answer.json()) as { id?: string }) : undefined
}

const idOf = (name: string) => {
  const firing = firingIn("production").find((alert) => alert.labels.alertname === name)
  return firing === undefined ? "" : alertId(firing.labels)
}

/** The incident the people on call opened, its firings, what they wrote and what they did. */
const writeIncident = async () => {
  const environment = "production"
  const incident = await send("/api/incidents", {
    title: "Orders reach the warehouse late",
    environment,
    alert: idOf("ConsumerLagGrowing"),
  })
  if (incident?.id === undefined) return
  const at = `/api/incidents/${encodeURIComponent(incident.id)}`
  await send(`${at}/firings`, { environment, alert: idOf("KafkaBrokerDown") })
  for (const text of [
    "Fulfilment on call: picking's lag started climbing just as broker 4 dropped out of bus. Looking at the cluster.",
    "Platform: broker 4's node was drained for a kernel update and the pod is stuck Pending; its volume is in zone-b, which is full. Freeing a node there.",
    "Fulfilment on call: orders p7 is the one far behind, about 26k; the other partitions are a couple of thousand each. Scaling picking to 6 members to drain it.",
    "Told the warehouse that orders for the 10:00 to 11:00 slots may be picked late.",
  ])
    await send(`${at}/notes`, { text })
  await send(`${at}/happened`, { text: "Scaled picking from 3 to 6 members" })
  await send("/api/notes", {
    environment,
    alert: idOf("CheckoutSlow"),
    text: "Started when checkout's latest version rolled out. Checking the slot reservation change before rolling back.",
  })
}

/** A recent order picking has not read yet, on a partition that is not the one far behind. */
const toFollow = () => {
  for (let order = latestOrder("production"); order > 0; order -= 1)
    if (writtenOf("production", order).partition !== 7) return traceIdOf("production", order)
  return traceIdOf("production", 0)
}

say("Starting the demo world on :8484 and Estate on :8080…")
if (!(await ready())) {
  say("Estate did not become ready within a minute; see its output above.")
  stop()
}
await writeIncident()
say(`
Estate's demo is up: ${estate}

It is Larder, an online grocer that never was, played by examples/demo/world.ts. Everything is made up,
and Ask AI's answers are canned.

  Staging is well: ${estate}/?env=staging
  Production is not: ${estate}/?env=production
    - bus, its Kafka cluster of six brokers, lost broker 4: ${estate}/stores/bus?env=production
    - picking is falling behind on orders, and an incident is open about it: ${estate}/incidents
    - checkout is slow since its latest version rolled out: ${estate}/services/checkout?env=production
    - orders-db's async replica is falling behind, and an old slot holds WAL: ${estate}/stores/orders-db?env=production
  Follow an order picking has not read yet, and watch it turn to "read it" in a couple of minutes:
    ${estate}/stores/bus/messages/${toFollow()}?env=production
  Traffic rises and falls every 24 minutes, in production:
${events.map((event) => `    - ${event.name}, next in ${nextOf(event)} min`).join("\n")}
  On a wall screen: ${estate}/kiosk?token=demo-screen

Ctrl-C stops both.`)

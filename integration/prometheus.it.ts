import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { GenericContainer, Network, type StartedNetwork, type StartedTestContainer, Wait } from "testcontainers"
import { readAlerts } from "../src/server/sources/alerts"
import { chartsOf } from "../src/server/sources/metrics"
import { lastHour, prometheusRanges } from "../src/server/sources/prometheus"
import { silencerOf } from "../src/server/sources/silencers"
import { eventually, real, urlOf } from "./real"

const config = `
global: { scrape_interval: 1s, evaluation_interval: 1s }
scrape_configs: [ { job_name: prometheus, static_configs: [ { targets: [ "localhost:9090" ] } ] } ]
rule_files: [ /etc/prometheus/rules.yml ]
alerting: { alertmanagers: [ { static_configs: [ { targets: [ "alertmanager:9093" ] } ] } ] }
`

// A rule that fires as soon as Prometheus has scraped itself once, about the checkout service.
const rules = `
groups:
  - name: checkout
    rules:
      - alert: CheckoutSlow
        expr: up{job="prometheus"} > 0.5
        labels: { severity: warning, service: checkout }
        annotations: { summary: "Checkout is slow", runbook_url: "https://runbooks.example/checkout-slow" }
`

let network: StartedNetwork
let alertmanager: StartedTestContainer
let prometheus: StartedTestContainer
const sources = () => ({
  prometheus: { url: urlOf(prometheus, 9090) },
  alertmanager: { url: urlOf(alertmanager, 9093) },
})

beforeAll(async () => {
  network = await new Network().start()
  alertmanager = await new GenericContainer("prom/alertmanager:v0.28.1")
    .withNetwork(network)
    .withNetworkAliases("alertmanager")
    .withExposedPorts(9093)
    .withWaitStrategy(Wait.forHttp("/-/ready", 9093))
    .start()
  prometheus = await new GenericContainer("prom/prometheus:v3.5.0")
    .withNetwork(network)
    .withCopyContentToContainer([
      { content: config, target: "/etc/prometheus/prometheus.yml" },
      { content: rules, target: "/etc/prometheus/rules.yml" },
    ])
    .withExposedPorts(9090)
    .withWaitStrategy(Wait.forHttp("/-/ready", 9090))
    .start()
})

afterAll(async () => {
  await prometheus?.stop()
  await alertmanager?.stop()
  await network?.stop()
})

const firing = () =>
  eventually(
    () => real(readAlerts(sources())),
    (alerts) => alerts.some((alert) => alert.name === "CheckoutSlow" && alert.state === "firing"),
  )

describe("a real Prometheus and Alertmanager", () => {
  test("give a firing rule as an alert about its service, charted against its threshold", async () => {
    const alerts = await firing()
    const alert = alerts.find((each) => each.name === "CheckoutSlow")
    expect(alert).toMatchObject({
      severity: "warning",
      summary: "Checkout is slow",
      runbook: "https://runbooks.example/checkout-slow",
      labels: { service: "checkout" },
    })
    const ranges = prometheusRanges({ url: urlOf(prometheus, 9090), headers: {} })
    const ruled = await real(ranges.rules)
    expect(ruled.get("CheckoutSlow")).toBe('up{job="prometheus"} > 0.5')
    const charts = await eventually(
      () => real(chartsOf(ranges, ruled, alerts, Date.now() + lastHour.step * 1000)),
      (found) => (found[alert?.id ?? ""]?.points ?? []).some((point) => point === 1),
    )
    expect(charts[alert?.id ?? ""]).toMatchObject({ threshold: 0.5 })
  })

  test("take a silence Estate writes, with who and why, and fire again when Estate ends it", async () => {
    const alert = (await firing()).find((each) => each.name === "CheckoutSlow")
    const silencer = silencerOf(sources())
    if (alert === undefined || silencer === undefined) throw new Error("nothing to silence")
    const now = Date.now()
    const id = await real(
      silencer.silence(alert, {
        startsAt: new Date(now).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
        by: "ada",
        reason: "a test of silencing",
      }),
    )
    const silenced = await eventually(
      () => real(readAlerts(sources())),
      (alerts) => alerts.some((each) => each.name === "CheckoutSlow" && each.state === "silenced"),
    )
    expect(silenced.find((each) => each.name === "CheckoutSlow")?.silence).toMatchObject({
      id,
      by: "ada",
      reason: "a test of silencing",
    })
    await real(silencer.unsilence(id))
    await eventually(
      () => real(readAlerts(sources())),
      (alerts) => alerts.some((each) => each.name === "CheckoutSlow" && each.state === "firing"),
    )
  })
})

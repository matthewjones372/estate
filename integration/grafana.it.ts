import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import { GenericContainer, Network, type StartedNetwork, type StartedTestContainer, Wait } from "testcontainers"
import { platform } from "../src/server/platform"
import { liveRemote } from "../src/server/remote"
import { readAlerts } from "../src/server/sources/alerts"
import { grafanaRules, lokiOf, prometheusOf } from "../src/server/sources/grafana"
import { logsFor } from "../src/server/sources/logs"
import { chartsOf } from "../src/server/sources/metrics"
import { lastHour, prometheusRanges } from "../src/server/sources/prometheus"
import { silencerOf } from "../src/server/sources/silencers"
import { eventually, real, urlOf } from "./real"

const datasources = `
apiVersion: 1
datasources:
  - { name: Prometheus, uid: prom-test, type: prometheus, url: "http://prometheus:9090", access: proxy, isDefault: true }
  - { name: Loki, uid: loki-test, type: loki, url: "http://loki:3100", access: proxy }
`

// A Grafana-managed rule, as a team clicks one together: a query, a reduction, and a threshold.
const rules = `
apiVersion: 1
groups:
  - orgId: 1
    name: checkout
    folder: Shop
    interval: 10s
    rules:
      - uid: checkout-up
        title: CheckoutUp
        condition: C
        for: 0s
        labels: { service: checkout, severity: warning }
        annotations: { summary: "Checkout is up (a rule that always fires)" }
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: prom-test
            model: { refId: A, expr: 'up{job="prometheus"}' }
          - refId: B
            datasourceUid: __expr__
            model: { refId: B, type: reduce, expression: A, reducer: last }
          - refId: C
            datasourceUid: __expr__
            model: { refId: C, type: threshold, expression: B, conditions: [ { evaluator: { type: gt, params: [ 0.5 ] } } ] }
`

let network: StartedNetwork
let prometheus: StartedTestContainer
let loki: StartedTestContainer
let grafana: StartedTestContainer
const tokens = { viewer: "", editor: "" }

/** A service account in the role, and a token for it, as a team would make one for Estate. */
const serviceAccount = async (role: "Viewer" | "Editor") => {
  const admin = { authorization: `Basic ${btoa("admin:admin")}`, "content-type": "application/json" }
  const ask = async (path: string, body: object) => {
    const answer = await fetch(`${urlOf(grafana, 3000)}${path}`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify(body),
    })
    const text = await answer.text()
    if (!answer.ok) throw new Error(`Grafana answered ${answer.status} to ${path}: ${text}`)
    return JSON.parse(text) as { id?: number; key?: string }
  }
  const account = await ask("/api/serviceaccounts", { name: `estate-${role.toLowerCase()}`, role })
  const token = await ask(`/api/serviceaccounts/${account.id}/tokens`, { name: `estate-${role.toLowerCase()}` })
  return token.key ?? ""
}

beforeAll(async () => {
  network = await new Network().start()
  prometheus = await new GenericContainer("prom/prometheus:v3.5.0")
    .withNetwork(network)
    .withNetworkAliases("prometheus")
    .withCopyContentToContainer([
      {
        content:
          "global: { scrape_interval: 1s }\nscrape_configs: [ { job_name: prometheus, static_configs: [ { targets: [ localhost:9090 ] } ] } ]\n",
        target: "/etc/prometheus/prometheus.yml",
      },
    ])
    .withWaitStrategy(Wait.forHttp("/-/ready", 9090))
    .withExposedPorts(9090)
    .start()
  loki = await new GenericContainer("grafana/loki:3.5.0")
    .withNetwork(network)
    .withNetworkAliases("loki")
    .withExposedPorts(3100)
    .withWaitStrategy(Wait.forHttp("/ready", 3100).forStatusCode(200))
    .start()
  grafana = await new GenericContainer("grafana/grafana:12.2.0")
    .withNetwork(network)
    .withEnvironment({ GF_SECURITY_ADMIN_PASSWORD: "admin" })
    .withCopyContentToContainer([
      { content: datasources, target: "/etc/grafana/provisioning/datasources/estate.yml" },
      { content: rules, target: "/etc/grafana/provisioning/alerting/estate.yml" },
    ])
    .withExposedPorts(3000)
    .withWaitStrategy(Wait.forHttp("/api/health", 3000))
    .start()
  tokens.viewer = await serviceAccount("Viewer")
  tokens.editor = await serviceAccount("Editor")
}, 300_000)

afterAll(async () => {
  await grafana?.stop()
  await loki?.stop()
  await prometheus?.stop()
  await network?.stop()
})

const behind = (token: string) => ({
  url: urlOf(grafana, 3000),
  token: Redacted.make(token),
  prometheus: "prom-test",
  loki: "loki-test",
})

describe("a real Grafana", () => {
  test("answers for its Prometheus and Loki through its proxy, to a viewer's service account", async () => {
    const sources = { grafana: behind(tokens.viewer) }
    const prometheusBehind = prometheusOf(sources)
    if (prometheusBehind === undefined) throw new Error("no Prometheus through Grafana")
    const series = await eventually(
      () => real(prometheusRanges(prometheusBehind).range('up{job="prometheus"}', lastHour, Date.now() + 60_000)),
      (found) => found.points.some((point) => point === 1),
    )
    expect(series.now).toBe(1)
    await fetch(`${urlOf(loki, 3100)}/loki/api/v1/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        streams: [
          { stream: { app: "checkout" }, values: [[`${Date.now()}000000`, "ERROR card 4111111111111111 declined"]] },
        ],
      }),
    })
    const logs = logsFor(sources, { name: "checkout", environments: [], logs: { mask: ["\\d{16}"] } })
    expect(logs?.from).toBe("Loki")
    expect(lokiOf(sources)?.url).toEndWith("/api/datasources/proxy/uid/loki-test")
    const lines = await eventually(
      () =>
        Effect.runPromise(
          (logs?.read(Date.now() - 600_000, Date.now() + 1000, 10) ?? Effect.succeed([])).pipe(
            Effect.provide(Layer.merge(liveRemote, platform)),
          ),
        ),
      (found) => found.length > 0,
    )
    expect(lines[0]?.text).toBe("ERROR card ••• declined")
  })

  test("gives its own rule as an alert, charted against the threshold its condition holds it to", async () => {
    const sources = { grafana: behind(tokens.viewer) }
    const alerts = await eventually(
      () => real(readAlerts(sources)),
      (found) => found.some((alert) => alert.name === "CheckoutUp" && alert.state === "firing"),
    )
    const alert = alerts.find((each) => each.name === "CheckoutUp")
    expect(alert).toMatchObject({ severity: "warning", labels: { service: "checkout" } })
    // Grafana keeps what a service account's first request may see of its folders for about a minute: an account
    // first used just after Grafana starts is shown no rules for that long, though they fire. Estate reads the
    // rules again each read, so its charts gain their thresholds within a minute; the test waits as long.
    const rules = await eventually(
      () => real(grafanaRules(sources.grafana)),
      (found) => found.has("CheckoutUp"),
      90,
    )
    expect(rules.get("CheckoutUp")).toBe('up{job="prometheus"} > 0.5')
    const prometheusBehind = prometheusOf(sources)
    if (prometheusBehind === undefined || alert === undefined) throw new Error("nothing to chart")
    const charts = await real(chartsOf(prometheusRanges(prometheusBehind), rules, [alert], Date.now() + 60_000))
    expect(charts[alert.id]).toMatchObject({ threshold: 0.5 })
  })

  test("takes a silence through its Alertmanager from an editor's service account, and not from a viewer's", async () => {
    const reading = { grafana: behind(tokens.viewer) }
    const alert = (
      await eventually(
        () => real(readAlerts(reading)),
        (found) => found.some((each) => each.name === "CheckoutUp" && each.state === "firing"),
      )
    ).find((each) => each.name === "CheckoutUp")
    const now = Date.now()
    const asked = {
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
      by: "ada",
      reason: "a test of silencing",
    }
    const viewer = silencerOf(reading)
    const editor = silencerOf({ grafana: behind(tokens.editor) })
    if (alert === undefined || viewer === undefined || editor === undefined) throw new Error("nothing to silence")
    const refused = await real(Effect.flip(viewer.silence(alert, asked)))
    expect(refused.message).toStartWith("Grafana answered 403")
    const id = await real(editor.silence(alert, asked))
    const silenced = await eventually(
      () => real(readAlerts(reading)),
      (found) => found.some((each) => each.name === "CheckoutUp" && each.state === "silenced"),
    )
    expect(silenced.find((each) => each.name === "CheckoutUp")?.silence).toMatchObject({ id, by: "ada" })
    await real(editor.unsilence(id))
  })
})

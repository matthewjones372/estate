import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"
import type { Catalog } from "../shared/catalog"
import { doctor, printed } from "./doctor"
import { settings } from "./fixture"
import { platform } from "./platform"
import { type Call, type Reply, reply, stubRemote } from "./remote"
import type { Settings } from "./settings"
import { answering } from "./sources/answers"

const catalog: Catalog = {
  environments: [
    { name: "staging", sources: "staging" },
    { name: "aws", sources: "aws" },
    { name: "gitops", sources: "gitops" },
  ],
  services: [
    {
      name: "storefront",
      environments: ["staging", "gitops"],
      repository: "github:example/storefront",
      build: { workflow: "build.yml" },
      kubernetes: { namespace: "shop", workloads: [{ kind: "Deployment", name: "storefront" }] },
      deploy: { flux: { kustomization: "shop", imagePolicy: "storefront" } },
      load: { requests: "sum(rate(requests[1m]))", p99: "nothing" },
    },
    { name: "orders", environments: ["staging"], kubernetes: { namespace: "shop", workloads: [] } },
    { name: "quiet", environments: ["staging"] },
    { name: "web", environments: ["gitops"], deploy: { argo: { application: "web" } } },
    { name: "checkout", environments: ["aws"], runtime: { ecs: { cluster: "shop", service: "checkout" } } },
  ],
}

const configured: Settings = {
  ...settings(),
  sources: {
    staging: {
      alertmanager: { url: "http://alertmanager/" },
      prometheus: { url: "http://prometheus/" },
      kubernetes: { url: "https://cluster", token: Redacted.make("t") },
      flux: {},
      elasticsearch: { url: "http://es" },
    },
    aws: { aws: { region: "eu-west-2", endpoint: "http://aws/" } },
    gitops: { argo: { url: "http://argo" }, grafana: { url: "http://grafana" } },
  },
  builds: { github: { url: "http://github" } },
}

/** Every tool the doctor asks, as a stub: Elasticsearch has lines for storefront only. */
const tools = (call: Call): Reply | undefined => {
  const url = new URL(call.url)
  if (url.host === "prometheus" && url.pathname === "/api/v1/rules")
    return reply({ data: { groups: [{ rules: [{ type: "alerting", name: "OrdersSlow", query: "latency > 0.15" }] }] } })
  if (url.host === "prometheus" && url.pathname === "/api/v1/query_range") {
    const end = Number(url.searchParams.get("end"))
    const query = url.searchParams.get("query") ?? ""
    return reply({ data: { result: query === "nothing" ? [] : [{ metric: {}, values: [[end, "12.345"]] }] } })
  }
  if (url.host === "es")
    return reply({
      hits: {
        hits: (call.body ?? "").includes("storefront")
          ? [{ _source: { "@timestamp": new Date().toISOString(), message: "served /basket" } }]
          : [],
      },
    })
  if (url.host === "github")
    return reply({
      workflow_runs: [
        {
          head_sha: "c556728",
          display_title: "Faster pages",
          status: "completed",
          conclusion: "failure",
          updated_at: "2026-10-03T11:00:00Z",
          html_url: "u",
        },
      ],
    })
  if (url.host === "aws") {
    const operation = call.headers?.["x-amz-target"]?.split(".")[1]
    if (operation === "DescribeAlarms")
      return reply({
        MetricAlarms: [
          { AlarmName: "CheckoutCpu", StateValue: "ALARM", Dimensions: [{ Name: "ServiceName", Value: "checkout" }] },
        ],
      })
    if (operation === "GetMetricData") return reply({ MetricDataResults: [] })
    if (operation === "ListTasks") return reply({ taskArns: [] })
    if (operation === "DescribeServices")
      return reply({
        services: [
          {
            serviceName: "checkout",
            deployments: [
              {
                status: "PRIMARY",
                taskDefinition: "td/checkout:3",
                runningCount: 1,
                desiredCount: 1,
                rolloutState: "COMPLETED",
              },
            ],
          },
        ],
      })
    if (operation === "DescribeTaskDefinition")
      return reply({ taskDefinition: { containerDefinitions: [{ name: "checkout", image: "registry/checkout:v3" }] } })
  }
  if (url.host === "argo" || url.host === "grafana") return reply("no", 403)
  return answering()(call)
}

const examined = Effect.runPromise(
  doctor(configured, catalog).pipe(
    Effect.provide(Layer.merge(stubRemote(tools), platform)),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({ AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "secret" }),
    ),
  ),
)

const says = (environment: string, part: string) =>
  examined.then((reports) =>
    reports
      .find((report) => report.environment === environment)
      ?.findings.filter((each) => each.part === part)
      .map((each) => `${each.ok ? "ok" : "fail"} ${each.says}`),
  )

describe("estate doctor", () => {
  test("counts the alerts, and names those about no service with the labels they carry", () =>
    says("staging", "alerts").then((lines) => {
      expect(lines).toEqual([
        "ok alertmanager, prometheus: 1 firing, 1 pending, 1 silenced; 2 about a service or store; 1 about none (DiskFilling; their labels: alertname, namespace)",
      ])
    }))

  test("says which firing alerts have a threshold to chart against, and the load each query reads", () =>
    Promise.all([
      says("staging", "charts"),
      says("staging", "metrics"),
      says("aws", "charts"),
      says("aws", "metrics"),
    ]).then(([charts, metrics, alarms, cloudwatch]) => {
      expect(charts).toEqual(["ok 1 of 1 firing alerts have a threshold to chart against"])
      expect(metrics).toEqual(["ok prometheus: storefront requests 12.35, p99 no data"])
      expect(alarms).toEqual(["ok 0 of 1 firing alerts have a threshold to chart against (not CheckoutCpu)"])
      expect(cloudwatch).toEqual(["ok cloudwatch: no service names a load query"])
    }))

  test("counts what runs where, and says what each deploy tool chose", () =>
    Promise.all([
      says("staging", "cluster"),
      says("staging", "deploys"),
      says("aws", "cluster"),
      says("aws", "deploys"),
    ]).then(([cluster, deploys, tasks, ecs]) => {
      expect(cluster).toEqual(["ok storefront 1/2 ready; orders 0 running: check its workloads in the catalog"])
      expect(deploys?.[0]).toStartWith("ok flux: storefront")
      expect(tasks).toEqual(["ok checkout 0 running: check its workloads in the catalog"])
      expect(ecs).toEqual(["ok ecs: checkout v3"])
    }))

  test("names a service whose lines match nothing, and what to set", () =>
    says("staging", "logs").then((lines) => {
      expect(lines).toEqual([
        "ok Elasticsearch: storefront 1 lines in 15 min",
        "ok Elasticsearch: orders 0 lines in 15 min: nothing matches kubernetes.namespace=shop, kubernetes.labels.app=orders; set logs.elastic.match for orders",
        "ok Elasticsearch: quiet 0 lines in 15 min: nothing matches kubernetes.labels.app=quiet; set logs.elastic.match for quiet",
      ])
    }))

  test("says when a tool refuses, and fails the whole report", () =>
    Promise.all([says("gitops", "alerts"), says("gitops", "deploys"), examined]).then(([alerts, deploys, reports]) => {
      expect(alerts).toEqual(["fail Grafana answered 403: no"])
      expect(deploys).toEqual(["fail Argo CD answered 403: no"])
      const { text, ok } = printed(reports)
      expect(ok).toBe(false)
      expect(text).toContain(
        "gitops\n  every    ok    alerts 20s, metrics 30s, cluster 15s, deploys 30s\n  alerts   fail  Grafana answered 403: no",
      )
    }))

  test("reads the builds once, for every environment", () =>
    says("every environment", "builds").then((lines) => {
      expect(lines).toEqual(["ok storefront 1, last failed"])
    }))
})

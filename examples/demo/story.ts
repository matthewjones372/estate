/**
 * What is true in each of the demo's environments. Staging is well, a version ahead. In production, bus lost broker
 * 4, picking fell behind on orders, checkout's new version is slow, and inventory's image policy cannot list tags.
 */
import { type Environment, minutesAgo, seedOf, started } from "./clock"

/** A short commit for a service's build, the same each time. */
const shaOf = (name: string, build: number) =>
  (seedOf(`${name}${build}`) * 7919).toString(16).padStart(7, "0").slice(0, 7)

/** Services whose newer build is in staging and not yet in production. */
const aheadInStaging = new Set(["web", "basket", "orders", "picking"])

export const buildOf = (service: string, environment: Environment) =>
  40 + (seedOf(service) % 160) + (environment === "staging" && aheadInStaging.has(service) ? 1 : 0)

/** The image tag a service runs: its build and commit, as Flux's image policies pick them. */
export const tagOf = (service: string, environment: Environment) => {
  const build = buildOf(service, environment)
  return `main-${build}-${shaOf(service, build)}`
}

export const commitOf = (service: string, build: number) => `${shaOf(service, build)}e4a19c03d2b7`

/** What each build was, for its run's title. */
export const changeOf = (service: string, build: number) =>
  [
    "Tidier logs",
    "Retry once on a timeout",
    "Faster slot search",
    "Batch outbox reads",
    "New substitutions rules",
    "Bump the Kafka client",
  ][(seedOf(service) + build) % 6] ?? "A change"

/** When checkout's slow version rolled out in production. */
export const slowSince = started - 25 * 60_000

interface Firing {
  readonly labels: Record<string, string>
  readonly annotations: Record<string, string>
  readonly startsAt: string
}

export const firingIn = (environment: Environment): ReadonlyArray<Firing> =>
  environment === "staging"
    ? []
    : [
        {
          labels: { alertname: "KafkaBrokerDown", severity: "critical", store: "bus", broker: "4" },
          annotations: {
            summary: "Broker 4 of bus is not reporting",
            description:
              "kafka_exporter has not seen broker 4 since it left the cluster; its partitions are short of a replica.",
          },
          startsAt: minutesAgo(9),
        },
        {
          labels: { alertname: "ConsumerLagGrowing", severity: "critical", app: "picking", consumergroup: "picking" },
          annotations: {
            summary: "picking is falling behind on orders",
            runbook_url: "https://larder.example/runbooks/lag",
          },
          startsAt: minutesAgo(7),
        },
        {
          labels: { alertname: "CheckoutSlow", severity: "warning", app: "checkout" },
          annotations: { summary: "Checkout's p99 is over 800 ms" },
          startsAt: minutesAgo(18),
        },
      ]

/** Rules Prometheus would hold for them, for Ask AI's brief. */
export const rulesIn = (environment: Environment) =>
  environment === "staging"
    ? []
    : [
        {
          type: "alerting",
          name: "CheckoutSlow",
          query:
            'histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{app="checkout"}[5m]))) > 0.8',
        },
        {
          type: "alerting",
          name: "ConsumerLagGrowing",
          query: 'deriv(sum by (consumergroup) (kafka_consumergroup_lag{consumergroup="picking"})[10m:1m]) > 0',
        },
        { type: "alerting", name: "KafkaBrokerDown", query: 'count(kafka_broker_info{strimzi_io_cluster="bus"}) < 6' },
      ]

/** A pod's latest lines: each service says what it does, and in production the story shows in them. */
export const linesOf = (
  service: string,
  environment: Environment,
  pod: string,
  count: number,
): ReadonlyArray<string> => {
  const at = (back: number) => new Date(Date.now() - back).toISOString()
  const usual = `${at(1800)} INFO ${service} handled ${200 + (count % 50)} requests in the last 10 s`
  const told: Record<string, ReadonlyArray<string>> = environment === "production"
    ? {
        checkout: [
          `${at(1200)} WARN slot reservation took ${900 + (count % 300)} ms (pool exhausted, waited for a connection)`,
          ...(count % 2 === 0
            ? [`${at(600)} ERROR checkout ${70_000 + count} failed: timed out reserving a slot`]
            : []),
        ],
        picking: [
          `${at(1200)} WARN partition orders-7 fetch from broker 4 failed: connection refused, retrying`,
          `${at(600)} INFO rebalanced: 3 members, 12 partitions`,
        ],
        inventory: [`${at(900)} INFO stock for ${200 + (count % 90)} products updated`],
      }
    : {}
  return [usual, ...(told[service] ?? [`${at(900)} INFO ${pod} healthy`])]
}

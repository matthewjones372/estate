/**
 * Alerts from Alertmanager or Grafana's (firing, and silenced with who and why), and pending from Grafana or Prometheus
 * (or everything from Prometheus when there is neither). An alert is known by its labels, the same from either, so its
 * notes follow it.
 */
import { Duration, Effect, Schema } from "effect"
import { compact } from "../../shared/compact"
import { callJson, type Remote } from "../remote"
import type { Sources } from "../settings"
import type { EnvironmentState, SourcedAlert } from "../state"
import { before as earlier, epoch, iso } from "../time"
import { grafanaHeaders, type Manager, managerOf } from "./grafana"
import { type Failure, SourceFailure } from "./run"

const Labels = Schema.Record(Schema.String, Schema.String)

const ManagerAlert = Schema.Struct({
  labels: Labels,
  annotations: Labels,
  startsAt: Schema.String,
  status: Schema.Struct({
    state: Schema.String,
    silencedBy: Schema.Array(Schema.String),
    inhibitedBy: Schema.Array(Schema.String),
  }),
})

const Silence = Schema.Struct({
  id: Schema.String,
  createdBy: Schema.String,
  comment: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String,
})

const PrometheusAlerts = Schema.Struct({
  data: Schema.Struct({
    alerts: Schema.Array(
      Schema.Struct({
        labels: Labels,
        annotations: Labels,
        state: Schema.String,
        activeAt: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
})

/** An alert's identity: its labels, in order. */
export const alertId = (labels: Readonly<Record<string, string>>): string =>
  Bun.hash(
    JSON.stringify(
      Object.entries(labels)
        .filter(([name]) => name !== "alertstate")
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  ).toString(36)

const decoded =
  <S extends Schema.Decoder<unknown>>(schema: S, what: string) =>
  (body: unknown): Effect.Effect<S["Type"], Failure> =>
    Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => new SourceFailure({ message: `${what} answered in a shape Estate does not know` })),
    )

const fromLabels = (
  labels: Readonly<Record<string, string>>,
  annotations: Readonly<Record<string, string>>,
  state: SourcedAlert["state"],
  startsAt: string,
): SourcedAlert => {
  const { alertname = "unnamed", severity = "warning" } = labels
  const { summary, description, runbook_url, runbook } = annotations
  return compact({
    id: alertId(labels),
    name: alertname,
    state,
    severity,
    summary: summary ?? description,
    runbook: runbook_url ?? runbook,
    startsAt,
    labels,
  })
}

const managerAlerts = (manager: Manager): Effect.Effect<ReadonlyArray<SourcedAlert>, Failure, Remote> =>
  Effect.gen(function* () {
    const { url, headers, name } = manager
    const alerts = yield* callJson({
      url: `${url}/api/v2/alerts?active=true&silenced=true&inhibited=false`,
      headers,
    }).pipe(
      Effect.mapError((error) => new SourceFailure({ message: `${name} ${error.message}` })),
      Effect.flatMap(decoded(Schema.Array(ManagerAlert), name)),
    )
    const silences = yield* callJson({ url: `${url}/api/v2/silences`, headers }).pipe(
      Effect.mapError((error) => new SourceFailure({ message: `${name} ${error.message}` })),
      Effect.flatMap(decoded(Schema.Array(Silence), name)),
    )
    const byId = new Map(silences.map((silence) => [silence.id, silence]))
    return alerts.map((alert) => {
      const silence = alert.status.silencedBy.map((id) => byId.get(id)).find((each) => each !== undefined)
      const sourced = fromLabels(
        alert.labels,
        alert.annotations,
        silence === undefined ? "firing" : "silenced",
        alert.startsAt,
      )
      return silence === undefined
        ? sourced
        : {
            ...sourced,
            silence: {
              id: silence.id,
              by: silence.createdBy,
              reason: silence.comment,
              startsAt: silence.startsAt,
              endsAt: silence.endsAt,
            },
          }
    })
  })

/** Prometheus's alerts, or Grafana's in Prometheus's shape, whose states are capitalised and say Alerting. */
const prometheusAlerts = (
  url: string,
  states: ReadonlySet<string>,
  name = "Prometheus",
  headers: Readonly<Record<string, string>> = {},
): Effect.Effect<ReadonlyArray<SourcedAlert>, Failure, Remote> =>
  callJson({ url: `${url}/api/v1/alerts`, headers }).pipe(
    Effect.mapError((error) => new SourceFailure({ message: `${name} ${error.message}` })),
    Effect.flatMap(decoded(PrometheusAlerts, name)),
    Effect.map((body) =>
      body.data.alerts
        .filter((alert) => states.has(alert.state.toLowerCase()))
        .map((alert) =>
          fromLabels(
            alert.labels,
            alert.annotations,
            alert.state.toLowerCase() === "pending" ? "pending" : "firing",
            alert.activeAt ?? epoch,
          ),
        ),
    ),
  )

/** Every alert the environment's sources know: its manager's, Grafana's and Prometheus's pending ones, and CloudWatch's alarms. */
export const readAlerts = (
  sources: Sources,
  alarms?: Effect.Effect<ReadonlyArray<SourcedAlert>, Failure>,
): Effect.Effect<ReadonlyArray<SourcedAlert>, Failure, Remote> =>
  Effect.gen(function* () {
    const manager = managerOf(sources)
    const managed = manager === undefined ? [] : yield* managerAlerts(manager)
    const { grafana } = sources
    const grafanaPending =
      grafana === undefined
        ? []
        : yield* prometheusAlerts(
            `${grafana.url.replace(/\/$/, "")}/api/prometheus/grafana`,
            new Set(["pending"]),
            "Grafana",
            grafanaHeaders(grafana),
          )
    const states = new Set(manager === undefined ? ["pending", "firing"] : ["pending"])
    const prometheus =
      sources.prometheus === undefined ? [] : yield* prometheusAlerts(sources.prometheus.url.replace(/\/$/, ""), states)
    const cloudwatch = alarms === undefined ? [] : yield* alarms
    return [...managed, ...grafanaPending, ...prometheus, ...cloudwatch]
  })

/** Alerts that fired before this read and do not now have resolved; a day of them is kept. */
export const withResolved = (
  before: EnvironmentState,
  after: EnvironmentState,
  alerts: ReadonlyArray<SourcedAlert>,
  at: string,
): EnvironmentState => {
  const now = new Set(alerts.map((alert) => alert.id))
  const gone = (before.alerts.value ?? []).filter((alert) => alert.state !== "pending" && !now.has(alert.id))
  const since = iso(earlier(Date.parse(at), Duration.days(1)))
  return {
    ...after,
    resolved: [
      ...after.resolved.filter((each) => each.endsAt >= since),
      ...gone.map((alert) => ({ name: alert.name, labels: alert.labels, startsAt: alert.startsAt, endsAt: at })),
    ],
  }
}

/**
 * Datadog's monitors as alerts and its downtimes as silences. Each group of a monitor in Alert, Warn or No Data is an
 * alert, labelled with the group's tags and the monitor's, so `service:checkout` finds the checkout lane as a
 * Prometheus label would. A downtime Estate writes says who asked and why in its message, since Datadog records the
 * key's owner as its creator.
 */
import { Effect, Option, Redacted, Schema, Stream } from "effect"
import { compact } from "../../shared/compact"
import { callJson, type Remote } from "../remote"
import type { Sources } from "../settings"
import type { SourcedAlert } from "../state"
import { epoch, iso } from "../time"
import { alertId } from "./alerts"
import type { Reach } from "./grafana"
import { type Failure, SourceFailure } from "./run"

export type Datadog = NonNullable<Sources["datadog"]>

/** Datadog's API for the site the account is on, with its keys. */
export const datadogReach = (datadog: Datadog): Reach => ({
  url: (datadog.url ?? `https://api.${datadog.site ?? "datadoghq.com"}`).replace(/\/$/, ""),
  headers: {
    "dd-api-key": Redacted.value(datadog.apiKey),
    "dd-application-key": Redacted.value(datadog.appKey),
  },
})

const Group = Schema.Struct({
  status: Schema.String,
  last_triggered_ts: Schema.optionalKey(Schema.NullOr(Schema.Number)),
})

const Monitor = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  message: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tags: Schema.Array(Schema.String),
  query: Schema.optionalKey(Schema.String),
  overall_state: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.Struct({ groups: Schema.optionalKey(Schema.Record(Schema.String, Group)) })),
})
type Monitor = typeof Monitor.Type

const Downtime = Schema.Struct({
  id: Schema.String,
  attributes: Schema.Struct({
    message: Schema.optionalKey(Schema.NullOr(Schema.String)),
    scope: Schema.String,
    status: Schema.optionalKey(Schema.String),
    monitor_identifier: Schema.Struct({
      monitor_id: Schema.optionalKey(Schema.Number),
      monitor_tags: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
    schedule: Schema.optionalKey(
      Schema.NullOr(
        Schema.Struct({
          start: Schema.optionalKey(Schema.NullOr(Schema.String)),
          end: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  }),
  relationships: Schema.optionalKey(
    Schema.Struct({
      created_by: Schema.optionalKey(
        Schema.Struct({ data: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.String }))) }),
      ),
    }),
  ),
})
type Downtime = typeof Downtime.Type

const Downtimes = Schema.Struct({
  data: Schema.Array(Downtime),
  included: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        attributes: Schema.optionalKey(
          Schema.Struct({
            name: Schema.optionalKey(Schema.NullOr(Schema.String)),
            handle: Schema.optionalKey(Schema.String),
          }),
        ),
      }),
    ),
  ),
})

const failed = (error: { readonly message: string }) => new SourceFailure({ message: `Datadog ${error.message}` })

const ask = <S extends Schema.Decoder<unknown>>(datadog: Datadog, path: string, schema: S) => {
  const reach = datadogReach(datadog)
  return callJson({ url: `${reach.url}${path}`, headers: reach.headers }).pipe(
    Effect.mapError(failed),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(() => new SourceFailure({ message: "Datadog answered in a shape Estate does not know" })),
      ),
    ),
  )
}

const perPage = 1000

/** Every monitor with a group in Alert, Warn or No Data, page by page. */
export const monitorsOf = (datadog: Datadog): Effect.Effect<ReadonlyArray<Monitor>, Failure, Remote> =>
  Stream.paginate(0, (page) =>
    ask(
      datadog,
      `/api/v1/monitor?group_states=alert,warn,no%20data&page=${page}&page_size=${perPage}`,
      Schema.Array(Monitor),
    ).pipe(Effect.map((found) => [found, found.length < perPage ? Option.none() : Option.some(page + 1)] as const)),
  ).pipe(Stream.runCollect)

/** The downtimes in force now, each with the name of whoever made it. */
const downtimes = (datadog: Datadog) =>
  Stream.paginate(0, (offset) =>
    ask(
      datadog,
      `/api/v2/downtime?current_only=true&include=created_by&page%5Blimit%5D=100&page%5Boffset%5D=${offset}`,
      Downtimes,
    ).pipe(
      Effect.map((page) => {
        const people = new Map(
          (page.included ?? []).map((each) => [each.id, each.attributes?.name ?? each.attributes?.handle ?? each.id]),
        )
        const named = page.data.map((downtime) => ({
          downtime,
          creator: people.get(downtime.relationships?.created_by?.data?.id ?? ""),
        }))
        return [named, page.data.length < 100 ? Option.none() : Option.some(offset + 100)] as const
      }),
    ),
  ).pipe(Stream.runCollect)

const states: Readonly<Record<string, string>> = { Alert: "critical", Warn: "warning", "No Data": "warning" }

/** `service:checkout` as the label service=checkout; a tag with no value is a label with an empty one. */
const labelsOf = (tags: ReadonlyArray<string>): Record<string, string> =>
  Object.fromEntries(
    tags.map((tag) => {
      const at = tag.indexOf(":")
      return at < 0 ? [tag, ""] : [tag.slice(0, at), tag.slice(at + 1)]
    }),
  )

const tagsOfGroup = (group: string) => (group === "*" ? [] : group.split(","))

/** The scope a downtime covers, as `service:checkout AND env:prod`, against a group's tags. */
const covers = (scope: string, tags: ReadonlyArray<string>) =>
  scope.trim() === "*" ||
  scope
    .split(/\s+AND\s+/i)
    .map((term) => term.replace(/[()]/g, "").trim())
    .every((term) => tags.includes(term))

const written = / — (.+) \(via Estate\)$/

/** Who silenced and why: as Estate wrote it in the message, or else the downtime's creator and its message. */
const silenceOf = (downtime: Downtime, creator: string | undefined): NonNullable<SourcedAlert["silence"]> => {
  const message = downtime.attributes.message ?? ""
  const by = written.exec(message)
  const schedule = downtime.attributes.schedule
  return {
    id: downtime.id,
    by: by?.[1] ?? creator ?? "someone in Datadog",
    reason: by === null ? message : message.replace(written, ""),
    startsAt: schedule?.start ?? epoch,
    endsAt: schedule?.end ?? "9999-12-31T00:00:00Z",
  }
}

/** The first line of a monitor's message, without its notifications and template tags. */
const summaryOf = (message: string | null | undefined) =>
  (message ?? "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/@\S+/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "")

const alertsOf = (
  monitor: Monitor,
  environmentTags: ReadonlyArray<string>,
  silencing: ReadonlyArray<{ readonly downtime: Downtime; readonly creator: string | undefined }>,
): ReadonlyArray<SourcedAlert> => {
  const groups = Object.entries(monitor.state?.groups ?? {})
  const listed = groups.length > 0 ? groups : [["*", { status: monitor.overall_state ?? "OK" }] as const]
  return listed.flatMap(([group, { status, ...rest }]) => {
    const severity = states[status]
    const tags = [...tagsOfGroup(group), ...monitor.tags]
    if (severity === undefined || !environmentTags.every((tag) => tags.includes(tag))) return []
    const labels = {
      ...labelsOf(monitor.tags),
      ...labelsOf(tagsOfGroup(group)),
      alertname: monitor.name,
      monitor: String(monitor.id),
      group,
    }
    const found = silencing.find(({ downtime }) => {
      const { monitor_id, monitor_tags } = downtime.attributes.monitor_identifier
      const aimed = monitor_id === monitor.id || (monitor_tags ?? []).every((tag) => monitor.tags.includes(tag))
      return (downtime.attributes.status ?? "active") === "active" && aimed && covers(downtime.attributes.scope, tags)
    })
    const triggered = "last_triggered_ts" in rest ? rest.last_triggered_ts : undefined
    return [
      compact({
        id: alertId(labels),
        name: monitor.name,
        state: found === undefined ? ("firing" as const) : ("silenced" as const),
        severity,
        summary: summaryOf(monitor.message),
        startsAt: triggered === undefined || triggered === null ? epoch : iso(triggered * 1000),
        labels,
        silence: found === undefined ? undefined : silenceOf(found.downtime, found.creator),
      }),
    ]
  })
}

/** Every alerting group of every monitor in the environment's tags, silenced where a downtime covers it. */
export const datadogAlerts = (datadog: Datadog): Effect.Effect<ReadonlyArray<SourcedAlert>, Failure, Remote> =>
  Effect.gen(function* () {
    const found = yield* monitorsOf(datadog)
    const silencing = yield* downtimes(datadog)
    return found.flatMap((monitor) => alertsOf(monitor, datadog.tags ?? [], silencing))
  })

const Created = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })

/** A downtime for one group of one monitor, saying who asked and why. */
export const datadogSilence = (
  datadog: Datadog,
  alert: SourcedAlert,
  silence: { readonly startsAt: string; readonly endsAt: string; readonly by: string; readonly reason: string },
): Effect.Effect<string, Failure, Remote> => {
  const reach = datadogReach(datadog)
  const group = alert.labels["group"] ?? "*"
  const body = {
    data: {
      type: "downtime",
      attributes: {
        scope: group === "*" ? "*" : tagsOfGroup(group).join(" AND "),
        monitor_identifier: { monitor_id: Number(alert.labels["monitor"]) },
        schedule: { start: silence.startsAt, end: silence.endsAt },
        message: `${silence.reason} — ${silence.by} (via Estate)`,
      },
    },
  }
  return callJson({
    url: `${reach.url}/api/v2/downtime`,
    method: "POST",
    headers: { ...reach.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  }).pipe(
    Effect.mapError(failed),
    Effect.flatMap((answer) =>
      Schema.decodeUnknownEffect(Created)(answer).pipe(
        Effect.mapError(() => new SourceFailure({ message: "Datadog answered in a shape Estate does not know" })),
      ),
    ),
    Effect.map((created) => created.data.id),
  )
}

/** The downtime cancelled, so the group alerts again. */
export const datadogUnsilence = (datadog: Datadog, id: string): Effect.Effect<void, Failure, Remote> => {
  const reach = datadogReach(datadog)
  return callJson({
    url: `${reach.url}/api/v2/downtime/${encodeURIComponent(id)}`,
    method: "DELETE",
    headers: reach.headers,
  }).pipe(Effect.mapError(failed), Effect.asVoid)
}

/** Alerts read beside a manager's: CloudWatch's alarms and Datadog's monitors, where the environment has them. */
export const alertsBeside = (
  alarms: Effect.Effect<ReadonlyArray<SourcedAlert>, Failure> | undefined,
  datadog: Datadog | undefined,
): Effect.Effect<ReadonlyArray<SourcedAlert>, Failure, Remote> | undefined =>
  alarms === undefined && datadog === undefined
    ? undefined
    : Effect.map(
        Effect.all([alarms ?? Effect.succeed([]), datadog === undefined ? Effect.succeed([]) : datadogAlerts(datadog)]),
        ([cloudwatch, monitors]) => [...cloudwatch, ...monitors],
      )

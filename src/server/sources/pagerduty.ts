/**
 * PagerDuty as the incident tool, through its REST API rather than the Events API, since only the REST API answers
 * with the incident and its link. PagerDuty refuses a second open incident with the same key rather than handing the
 * first back, so a raise that fails is looked for by its key before Estate says it failed.
 */
import { Duration, Effect, Option, Redacted, Schema } from "effect"
import { type Call, Remote, type Reply } from "../remote"
import type { PagerDutySettings } from "../settings-incident-tool"
import { detailsOf, type IncidentTool, type InTool, type Raised, type Raising } from "./incident-tools"
import { type Failure, SourceFailure } from "./run"

const Made = Schema.Struct({ id: Schema.String, html_url: Schema.String })
const Created = Schema.Struct({ incident: Made })
const Listed = Schema.Struct({ incidents: Schema.Array(Made) })
const Read = Schema.Struct({
  incident: Schema.Struct({
    status: Schema.String,
    urgency: Schema.String,
    html_url: Schema.String,
    priority: Schema.optionalKey(Schema.NullOr(Schema.Struct({ summary: Schema.String }))),
    assignments: Schema.Array(Schema.Struct({ assignee: Schema.Struct({ summary: Schema.String }) })),
  }),
})
const Service = Schema.Struct({ service: Schema.Struct({ name: Schema.String }) })
const Users = Schema.Struct({ users: Schema.Array(Schema.Struct({ email: Schema.String, name: Schema.String })) })
const Refused = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.Struct({ message: Schema.String, errors: Schema.optionalKey(Schema.Array(Schema.String)) }),
  }),
)

const failed = (message: string): Failure => new SourceFailure({ message })

/** The longest Estate waits out PagerDuty's rate limit before saying when to try again. */
const longestWait = 10

/** Why PagerDuty refused, in its words where it gave them. */
const refusal = (answered: Reply): string => {
  const said = Option.getOrUndefined(Schema.decodeUnknownOption(Refused)(answered.text))
  const words =
    said === undefined ? answered.text.slice(0, 200) : [said.error.message, ...(said.error.errors ?? [])].join(": ")
  return [`PagerDuty answered ${answered.status}`, words].filter((each) => each !== "").join(": ")
}

const resetIn = (answered: Reply): number => Number(answered.headers["ratelimit-reset"] ?? longestWait)

export const pagerDuty = (settings: PagerDutySettings): IncidentTool => {
  const base = (settings.url ?? "https://api.pagerduty.com").replace(/\/$/, "")
  const headers = {
    Authorization: `Token token=${Redacted.value(settings.token)}`,
    Accept: "application/vnd.pagerduty+json;version=2",
  }

  /** Sends once more after PagerDuty's rate limit resets, when that is soon. */
  const send = (call: Call): Effect.Effect<Reply, Failure, Remote> =>
    Effect.gen(function* () {
      const remote = yield* Remote
      const once = Effect.suspend(() => remote.call(call)).pipe(
        Effect.mapError((error) => failed(`PagerDuty ${error.message}`)),
      )
      const first = yield* once
      if (first.status !== 429 || resetIn(first) > longestWait) return first
      yield* Effect.sleep(Duration.seconds(resetIn(first)))
      return yield* once
    })

  const ask = <S extends Schema.Decoder<unknown>>(call: Call, schema: S) =>
    Effect.gen(function* () {
      const answered = yield* send(call)
      if (answered.status === 429)
        return yield* failed(`PagerDuty is limiting Estate's calls: try again in ${resetIn(answered)} s`)
      if (answered.status < 200 || answered.status > 299) return yield* failed(refusal(answered))
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(answered.text).pipe(
        Effect.mapError(() => failed("PagerDuty answered in a shape Estate does not know")),
      )
    })

  const found = (key: string): Effect.Effect<Raised | undefined, Failure, Remote> =>
    Effect.map(
      ask(
        { url: `${base}/incidents?${new URLSearchParams({ incident_key: key, date_range: "all" })}`, headers },
        Listed,
      ),
      (listed) => {
        const first = listed.incidents[0]
        return first === undefined ? undefined : { id: first.id, url: first.html_url }
      },
    )

  const raise = (raising: Raising): Effect.Effect<Raised, Failure, Remote> => {
    const incident = {
      type: "incident",
      title: raising.title,
      service: { id: raising.team?.pagerduty ?? settings.service, type: "service_reference" },
      urgency: raising.firings.some((firing) => firing.severity === "critical") ? "high" : "low",
      incident_key: raising.key,
      body: { type: "incident_body", details: detailsOf(raising) },
    }
    const call: Call = {
      url: `${base}/incidents`,
      method: "POST",
      headers: { ...headers, From: settings.from, "Content-Type": "application/json" },
      body: JSON.stringify({ incident }),
    }
    return ask(call, Created).pipe(
      Effect.map((created) => ({ id: created.incident.id, url: created.incident.html_url })),
      Effect.catch((failure) =>
        found(raising.key).pipe(
          Effect.orElseSucceed(() => undefined),
          Effect.flatMap((raised) => (raised === undefined ? Effect.fail(failure) : Effect.succeed(raised))),
        ),
      ),
    )
  }

  const read = (id: string): Effect.Effect<InTool, Failure, Remote> =>
    Effect.map(ask({ url: `${base}/incidents/${encodeURIComponent(id)}`, headers }, Read), ({ incident }) => ({
      status: incident.status,
      severity: incident.priority?.summary ?? incident.urgency,
      responders: incident.assignments.map((each) => each.assignee.summary),
      url: incident.html_url,
    }))

  // Reading the service proves the token; only a write would prove `from`, so it is looked up among the users.
  const check = Effect.gen(function* () {
    const { service } = yield* ask(
      { url: `${base}/services/${encodeURIComponent(settings.service)}`, headers },
      Service,
    )
    const { users } = yield* ask(
      { url: `${base}/users?${new URLSearchParams({ query: settings.from })}`, headers },
      Users,
    )
    const user = users.find((each) => each.email.toLowerCase() === settings.from.toLowerCase())
    if (user === undefined) return yield* failed(`PagerDuty has no user ${settings.from} to raise as`)
    return `raises in ${service.name} (${settings.service}) as ${user.name} (${user.email})`
  })

  return { name: "PagerDuty", raise, read, check }
}

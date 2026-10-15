/**
 * incident.io as the incident tool, through its v2 API. Raising with Estate's incident id as the idempotency key
 * hands back the incident already raised; the API takes a severity's id, so the configured name is looked up first.
 */
import { Effect, Option, Redacted, Schema } from "effect"
import { compact } from "../../shared/compact"
import { type Call, Remote, type Reply } from "../remote"
import type { IncidentIoSettings } from "../settings-incident-tool"
import { detailsOf, type IncidentTool, type InTool, type Raised, type Raising } from "./incident-tools"
import { type Failure, SourceFailure } from "./run"

const Severities = Schema.Struct({
  severities: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
})
const Made = Schema.Struct({ incident: Schema.Struct({ id: Schema.String, permalink: Schema.String }) })
const Read = Schema.Struct({
  incident: Schema.Struct({
    permalink: Schema.String,
    incident_status: Schema.Struct({ name: Schema.String, category: Schema.String }),
    severity: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
    incident_role_assignments: Schema.Array(
      Schema.Struct({ assignee: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.String }))) }),
    ),
  }),
})
const Refused = Schema.fromJsonString(
  Schema.Struct({ errors: Schema.Array(Schema.Struct({ message: Schema.String })) }),
)

const failed = (message: string): Failure => new SourceFailure({ message })

/** Why incident.io refused, in its words where it gave them. */
const refusal = (answered: Reply): string => {
  const said = Option.getOrUndefined(Schema.decodeUnknownOption(Refused)(answered.text))
  const words = said === undefined ? answered.text.slice(0, 200) : said.errors.map((each) => each.message).join("; ")
  return [`incident.io answered ${answered.status}`, words].filter((each) => each !== "").join(": ")
}

/** The status in its own name, and its category where that says more: "Investigating (active)". */
const statusOf = (status: { readonly name: string; readonly category: string }) =>
  status.name.toLowerCase() === status.category.toLowerCase() ? status.name : `${status.name} (${status.category})`

export const incidentIo = (settings: IncidentIoSettings): IncidentTool => {
  const base = (settings.url ?? "https://api.incident.io").replace(/\/$/, "")
  const headers = { Authorization: `Bearer ${Redacted.value(settings.token)}` }
  const mode = settings.mode ?? "standard"

  const ask = <S extends Schema.Decoder<unknown>>(call: Call, schema: S) =>
    Effect.gen(function* () {
      const remote = yield* Remote
      const answered = yield* remote.call(call).pipe(Effect.mapError((error) => failed(`incident.io ${error.message}`)))
      if (answered.status < 200 || answered.status > 299) return yield* failed(refusal(answered))
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(answered.text).pipe(
        Effect.mapError(() => failed("incident.io answered in a shape Estate does not know")),
      )
    })

  const severity = Effect.gen(function* () {
    const { severities } = yield* ask({ url: `${base}/v1/severities`, headers }, Severities)
    const found = severities.find((each) => each.name.toLowerCase() === settings.severity.toLowerCase())
    if (found !== undefined) return found
    const known = severities.map((each) => each.name).join(", ")
    return yield* failed(`incident.io has no severity "${settings.severity}": it has ${known}`)
  })

  const raise = (raising: Raising): Effect.Effect<Raised, Failure, Remote> =>
    Effect.gen(function* () {
      const { id } = yield* severity
      const body = {
        idempotency_key: raising.key,
        name: raising.title,
        severity_id: id,
        visibility: settings.visibility ?? "public",
        mode,
        summary: detailsOf(raising),
      }
      const call: Call = {
        url: `${base}/v2/incidents`,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
      const { incident } = yield* ask(call, Made)
      return { id: incident.id, url: incident.permalink }
    })

  const read = (id: string): Effect.Effect<InTool, Failure, Remote> =>
    Effect.map(ask({ url: `${base}/v2/incidents/${encodeURIComponent(id)}`, headers }, Read), ({ incident }) =>
      compact({
        status: statusOf(incident.incident_status),
        severity: incident.severity?.name,
        responders: incident.incident_role_assignments.flatMap((each) =>
          each.assignee === undefined || each.assignee === null ? [] : [each.assignee.name],
        ),
        url: incident.permalink,
      }),
    )

  // Finding the severity proves the key, and that the severity named is one incident.io has.
  const check = Effect.map(
    severity,
    (found) => `raises at ${found.name}, ${mode === "test" ? "in test mode, unannounced" : "announced"}`,
  )

  return { name: "incident.io", raise, read, check }
}

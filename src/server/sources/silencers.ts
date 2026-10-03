/**
 * Where an environment's silences are written: Alertmanager, or Grafana's, as a silence matching the alert's labels,
 * or else Datadog, as a downtime on the monitor's group. Each answers with the silence's id, or fails in its own words.
 */
import { Effect, Schema } from "effect"
import { type Call, Remote } from "../remote"
import type { Sources } from "../settings"
import type { SourcedAlert } from "../state"
import { datadogSilence, datadogUnsilence } from "./datadog"
import { type Manager, managerOf } from "./grafana"
import { type Failure, SourceFailure } from "./run"

interface Asked {
  readonly startsAt: string
  readonly endsAt: string
  readonly by: string
  readonly reason: string
}

export interface Silencer {
  readonly name: string
  readonly silence: (alert: SourcedAlert, asked: Asked) => Effect.Effect<string, Failure, Remote>
  readonly unsilence: (id: string) => Effect.Effect<void, Failure, Remote>
}

const Created = Schema.Struct({ silenceID: Schema.String })

/** The manager's answer to a call, or why not in its own name. */
const answer = (manager: Manager, call: Call) =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const answered = yield* remote
      .call({ ...call, headers: { ...manager.headers, ...call.headers } })
      .pipe(Effect.mapError((error) => new SourceFailure({ message: `${manager.name} ${error.message}` })))
    if (answered.status !== 200)
      return yield* new SourceFailure({
        message: `${manager.name} answered ${answered.status}: ${answered.text.slice(0, 200)}`,
      })
    return answered.text
  })

const managerSilencer = (manager: Manager): Silencer => ({
  name: manager.name,
  silence: (alert, asked) =>
    answer(manager, {
      url: `${manager.url}/api/v2/silences`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matchers: Object.entries(alert.labels).map(([name, value]) => ({ name, value, isRegex: false, isEqual: true })),
        startsAt: asked.startsAt,
        endsAt: asked.endsAt,
        createdBy: asked.by,
        comment: asked.reason,
      }),
    }).pipe(
      Effect.flatMap((text) =>
        Schema.decodeUnknownEffect(Schema.fromJsonString(Created))(text).pipe(
          Effect.mapError(() => new SourceFailure({ message: `${manager.name} answered 200: ${text.slice(0, 200)}` })),
        ),
      ),
      Effect.map((created) => created.silenceID),
    ),
  unsilence: (id) =>
    answer(manager, { url: `${manager.url}/api/v2/silence/${encodeURIComponent(id)}`, method: "DELETE" }).pipe(
      Effect.asVoid,
    ),
})

/** The environment's silencer: its Alertmanager or Grafana's, or else Datadog, or nothing to silence with. */
export const silencerOf = (sources: Sources): Silencer | undefined => {
  const manager = managerOf(sources)
  if (manager !== undefined) return managerSilencer(manager)
  const { datadog } = sources
  return datadog === undefined
    ? undefined
    : {
        name: "Datadog",
        silence: (alert, asked) => datadogSilence(datadog, alert, asked),
        unsilence: (id) => datadogUnsilence(datadog, id),
      }
}

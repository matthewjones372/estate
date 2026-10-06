/**
 * An alert's brief, *Around this alert*, gathered whole: the view of what Estate holds, its service's errors from ten
 * minutes before it fired, and its runbook's text. The page shows it, and Ask AI and `/mcp` give it to a model.
 */
import { Clock, Duration, Effect, SubscriptionRef } from "effect"
import type { AroundAlert } from "../shared/around"
import { compact } from "../shared/compact"
import { serviceLogs } from "./log-hub"
import { Configured } from "./settings"
import { groupErrors } from "./sources/lines"
import { readRunbook } from "./sources/runbook"
import { Estate } from "./state"
import { before } from "./time"
import { aroundView } from "./views/around"

const most = 2000
const lead = Duration.minutes(10)
/** Error groups a brief carries: the most frequent, which is what a person or a model reads first. */
const groupsKept = 5

const errorsOf = (environment: string, service: string, from: number) =>
  Effect.gen(function* () {
    const logs = yield* serviceLogs(environment, service)
    if (logs === undefined) return undefined
    const read = yield* Effect.result(logs.read(from, yield* Clock.currentTimeMillis, most))
    return read._tag === "Failure"
      ? { failed: read.failure.message }
      : {
          from: logs.from,
          groups: groupErrors(read.success, logs.isError)
            .slice(0, groupsKept)
            .map((group) => ({ ...group, examples: group.examples.slice(0, 2) })),
        }
  })

/** The brief of alert `id` in `environment`; its errors only for someone who may read logs. */
export const gatherAround = (environment: string, id: string, readsLogs: boolean) =>
  Effect.gen(function* () {
    const settings = yield* Configured
    const brief = aroundView(yield* SubscriptionRef.get(yield* Estate), environment, id)
    if (brief === undefined) return undefined
    const { alert } = brief
    const [errors, runbook] = yield* Effect.all(
      [
        alert.service === undefined || !readsLogs
          ? Effect.succeed(undefined)
          : errorsOf(environment, alert.service, before(Date.parse(alert.startsAt), lead)),
        alert.runbook === undefined ? Effect.succeed(undefined) : readRunbook(alert.runbook, settings.runbooks),
      ],
      { concurrency: 2 },
    )
    const around: AroundAlert = compact({
      alert: alert.id,
      name: alert.name,
      startsAt: alert.startsAt,
      summary: alert.summary,
      impact: alert.impact?.text,
      subject: brief.subject,
      changed: brief.changed,
      depends: brief.depends,
      errors,
      before: (alert.history ?? []).map((firing) =>
        compact({ ...firing, notes: firing.notes.map(({ by, at, text }) => ({ by, at, text })) }),
      ),
      runbook: alert.runbook === undefined ? undefined : { url: alert.runbook, ...runbook },
    })
    return around
  })

const minutes = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 60_000)

/** The brief's parts that have something in them, by the names the page gives them. */
export const sectionsOf = (around: AroundAlert): ReadonlyArray<string> => [
  "Changed",
  ...(around.depends.length > 0 ? ["Depends"] : []),
  ...(around.errors !== undefined && "groups" in around.errors ? ["Errors"] : []),
  ...(around.before.length > 0 ? ["Before"] : []),
  ...(around.runbook?.text !== undefined ? ["Runbook"] : []),
]

/** The brief as text, for a model to read: each part under its name, times relative to when it fired. */
export const briefText = (around: AroundAlert): string => {
  const changed = around.changed.map((change) => {
    const gap = minutes(change.at, around.startsAt)
    return `- ${change.service}: ${change.text}, ${gap >= 0 ? `${gap} min before it fired` : `${-gap} min after`}`
  })
  const depends = around.depends.map(
    (each) =>
      `- ${each.name} (${each.kind}, ${each.side}): ${each.health}${
        each.readings.length === 0
          ? ""
          : `; ${each.readings.map((reading) => `${reading.title} ${reading.now ?? "–"}${reading.unit ?? ""}`).join(", ")}`
      }${each.reasons.length === 0 ? "" : `; ${each.reasons.join("; ")}`}`,
  )
  const errors =
    around.errors === undefined
      ? []
      : "failed" in around.errors
        ? [`- the logs did not answer: ${around.errors.failed}`]
        : around.errors.groups.map((group) => `- ${group.count}× "${group.shape}"`)
  const earlier = around.before.map(
    (firing) =>
      `- ${firing.startsAt}${firing.endsAt === undefined ? "" : ` for ${minutes(firing.startsAt, firing.endsAt)} min`}${
        firing.silence === undefined ? "" : `; silenced by ${firing.silence.by}: ${firing.silence.reason}`
      }${firing.notes.map((note) => `; "${note.text}" (${note.by})`).join("")}`,
  )
  return [
    `Alert ${around.name}, firing since ${around.startsAt}${around.subject === undefined ? "" : `, about ${around.subject}`}.`,
    ...(around.summary === undefined ? [] : [`Summary: ${around.summary}`]),
    ...(around.impact === undefined ? [] : [`Impact: ${around.impact}`]),
    "Changed in the hour before it fired, and since:",
    ...(changed.length === 0 ? ["- nothing deployed or built"] : changed),
    ...(depends.length === 0 ? [] : ["Depends:", ...depends]),
    ...(errors.length === 0 ? [] : ["Errors since ten minutes before it fired:", ...errors]),
    ...(earlier.length === 0 ? [] : ["Fired before:", ...earlier]),
    ...(around.runbook === undefined
      ? []
      : around.runbook.text === undefined
        ? [`Runbook: ${around.runbook.url} (not read)`]
        : [`Runbook (${around.runbook.url}):`, around.runbook.text]),
  ].join("\n")
}
